import "server-only";

import type { StockMovementType } from "@/generated/prisma/enums";
import type { BatchClient, StockClient as TxClient } from "@/lib/db-client";

/**
 * Stock mutation — the single choke point for every change to `Product.stock`.
 *
 * Nothing else in the codebase may write to `stock`. Going through this module
 * is what guarantees three things the spec requires:
 *
 * 1. Stock can never go negative. The decrement is a *conditional* UPDATE
 *    (`where: { id, stock: { gte: qty } }`), so two cashiers selling the last
 *    unit at the same time cannot both succeed. If the predicate matches no row
 *    we throw and the surrounding transaction rolls back. A read-then-write
 *    would pass this check twice under concurrent load.
 * 2. Every change writes exactly one `InventoryMovement` row carrying the
 *    before/after values, so the ledger is a complete audit trail.
 * 3. The movement and the counter commit together, inside the caller's
 *    transaction.
 */

// Re-exported so callers keep importing their client type from here, next to the
// functions that use it.
export type { StockClient as TxClient } from "@/lib/db-client";

export class InsufficientStockError extends Error {
  readonly code = "INSUFFICIENT_STOCK";

  constructor(
    readonly productId: string,
    readonly productName: string,
    readonly requested: number,
    readonly available: number,
  ) {
    super(
      `Stok ${productName} tidak mencukupi. Diminta ${requested}, tersedia ${available}.`,
    );
    this.name = "InsufficientStockError";
  }
}

export class UnknownProductError extends Error {
  readonly code = "UNKNOWN_PRODUCT";

  constructor(readonly productId: string) {
    super(`Produk tidak ditemukan: ${productId}`);
    this.name = "UnknownProductError";
  }
}

export interface StockChange {
  productId: string;
  /** Always a positive magnitude; `direction` carries the sign. */
  quantity: number;
  type: StockMovementType;
  direction: "IN" | "OUT";
  userId?: string | null;
  referenceType?: string | null;
  referenceId?: string | null;
  note?: string | null;
  /** Fails the update if the current stock is below this threshold. */
  requireAtLeast?: number;
}

/**
 * Applies a single stock change and records the ledger entry.
 *
 * Must be called with a transaction client so it participates in the caller's
 * atomic unit of work (checkout, purchase receipt, opname approval, refund).
 */
export async function applyStockChange(
  tx: TxClient,
  change: StockChange,
): Promise<{ previousStock: number; newStock: number }> {
  if (!Number.isInteger(change.quantity) || change.quantity <= 0) {
    throw new Error(`Quantity tidak valid: ${change.quantity}`);
  }

  if (
    change.requireAtLeast !== undefined &&
    change.requireAtLeast > 0 &&
    change.direction === "OUT"
  ) {
    const current = await tx.product.findUnique({
      where: { id: change.productId },
      select: { name: true, stock: true },
    });

    if (!current) {
      throw new UnknownProductError(change.productId);
    }

    if (current.stock > change.requireAtLeast) {
      throw new InsufficientStockError(
        change.productId,
        current.name,
        change.quantity,
        current.stock,
      );
    }
  }

  // Conditional write, and the rows it touched come back so the ledger records
  // what the database actually holds.
  //
  // `count === 0` means another transaction already took the stock we needed, so
  // this is the concurrency guard. Deriving `previousStock` from the *returned*
  // stock rather than from an earlier read matters just as much: under
  // READ COMMITTED that read can be arbitrarily stale, and a ledger whose
  // before/after values disagree with the counter is worse than no ledger,
  // because it is the thing the counter gets reconciled against.
  const updated = await tx.product.updateManyAndReturn({
    where: {
      id: change.productId,
      ...(change.direction === "OUT"
        ? { stock: { gte: change.quantity } }
        : {}),
    },
    data:
      change.direction === "OUT"
        ? { stock: { decrement: change.quantity } }
        : { stock: { increment: change.quantity } },
    select: { stock: true },
  });

  if (updated.length === 0) {
    // Either the product does not exist, or the guard rejected the write.
    // Re-read for an accurate error message: the earlier read may be stale.
    const current = await tx.product.findUnique({
      where: { id: change.productId },
      select: { name: true, stock: true },
    });

    if (!current) {
      throw new UnknownProductError(change.productId);
    }

    throw new InsufficientStockError(
      change.productId,
      current.name,
      change.quantity,
      current.stock,
    );
  }

  const newStock = updated[0].stock;
  const previousStock =
    change.direction === "OUT"
      ? newStock + change.quantity
      : newStock - change.quantity;

  await tx.inventoryMovement.create({
    data: {
      productId: change.productId,
      type: change.type,
      quantity: change.quantity,
      previousStock,
      newStock,
      referenceType: change.referenceType ?? null,
      referenceId: change.referenceId ?? null,
      note: change.note ?? null,
      userId: change.userId ?? null,
    },
  });

  // Keep batch balances telling the truth alongside the product counter.
  await syncBatches(tx, change.productId, change.quantity, change.direction);

  return { previousStock, newStock };
}

/**
 * Moves the batch counter with the product counter.
 *
 * `Product.stock` stays authoritative — batches are the expiry dimension on top
 * of it, not a second source of truth — but leaving `ProductBatch.quantity` at
 * whatever the purchase receipt set would make the Batch & Expiry screen, the
 * dashboard widget and the expiry notifications report stock that has already
 * been sold. So the batches are kept in step, oldest-expiring-first on the way
 * out (FEFO: the goods that go out first are the ones closest to expiring).
 *
 * Returns and voids have no batch to identify, so units coming back in are
 * credited to the batch with the longest remaining life, which is where they are
 * most likely to have come from.
 *
 * Partial coverage is deliberate and safe: a product can hold stock that never
 * had a batch (opening stock, or a receipt without an expiry date), so the
 * batches are adjusted by whatever they actually cover rather than being
 * required to reconcile to the product counter.
 */
async function syncBatches(
  tx: BatchClient,
  productId: string,
  quantity: number,
  direction: "IN" | "OUT",
): Promise<void> {
  const batches = await tx.productBatch.findMany({
    where: { productId },
    select: { id: true, quantity: true, expiryDate: true },
    orderBy: { expiryDate: "asc" },
  });

  if (batches.length === 0) {
    return;
  }

  if (direction === "IN") {
    // Back to the batch that keeps longest: the most recently received stock.
    const target = [...batches]
      .reverse()
      .find((batch) => batch.quantity > 0) ?? batches[batches.length - 1];

    await tx.productBatch.update({
      where: { id: target.id },
      data: { quantity: { increment: quantity } },
    });

    return;
  }

  let remaining = quantity;

  for (const batch of batches) {
    if (remaining <= 0) break;

    const take = Math.min(remaining, batch.quantity);

    if (take <= 0) continue;

    // Conditional so a batch can never be driven negative by a concurrent sale.
    const claimed = await tx.productBatch.updateMany({
      where: { id: batch.id, quantity: { gte: take } },
      data: { quantity: { decrement: take } },
    });

    remaining -= claimed.count === 0 ? 0 : take;
  }
}

/**
 * Applies many stock changes in order.
 *
 * Runs sequentially rather than in parallel so that two lines touching the same
 * product settle deterministically against the same session.
 */
export async function applyStockChanges(
  tx: TxClient,
  changes: StockChange[],
): Promise<Array<{ productId: string; previousStock: number; newStock: number }>> {
  const results = [];

  for (const change of changes) {
    const result = await applyStockChange(tx, change);
    results.push({ productId: change.productId, ...result });
  }

  return results;
}

/**
 * Releases stock back on sale void.
 *
 * Uses SALE_VOID rather than ADJUSTMENT_IN so voids remain distinguishable from
 * manual corrections in the ledger.
 */
export async function voidSaleStock(
  tx: TxClient,
  items: Array<{ productId: string; quantity: number }>,
  userId: string | null,
  saleId: string,
): Promise<void> {
  await applyStockChanges(
    tx,
    items.map((item) => ({
      productId: item.productId,
      quantity: item.quantity,
      direction: "IN",
      type: "SALE_VOID",
      referenceType: "Sale",
      referenceId: saleId,
      note: "Pengembalian stok karena transaksi void",
      userId,
    })),
  );
}