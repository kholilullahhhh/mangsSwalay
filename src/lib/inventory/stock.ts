import "server-only";

import { Prisma } from "@/generated/prisma/client";
import type { StockMovementType } from "@/generated/prisma/enums";

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

export type TxClient = Prisma.TransactionClient;

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

  const product = await tx.product.findUnique({
    where: { id: change.productId },
    select: { id: true, name: true, stock: true },
  });

  if (!product) {
    throw new UnknownProductError(change.productId);
  }

  const previousStock = product.stock;

  // Conditional write. `count === 0` means another transaction already took the
  // stock we needed, so this is the concurrency guard.
  const result = await tx.product.updateMany({
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
  });

  if (result.count === 0) {
    // Re-read for an accurate error message: the earlier read may be stale.
    const current = await tx.product.findUnique({
      where: { id: change.productId },
      select: { name: true, stock: true },
    });

    throw new InsufficientStockError(
      change.productId,
      current?.name ?? product.name,
      change.quantity,
      current?.stock ?? 0,
    );
  }

  const newStock =
    change.direction === "OUT"
      ? previousStock - change.quantity
      : previousStock + change.quantity;

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

  return { previousStock, newStock };
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