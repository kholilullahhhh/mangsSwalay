import "server-only";

import { Prisma, type Prisma as PrismaNS } from "@/generated/prisma/client";
import type { PurchaseStatus } from "@/generated/prisma/enums";

import { prisma } from "@/lib/db";
import { withDocumentNumber } from "@/lib/documents";
import { BusinessRuleError, ValidationError } from "@/lib/error";
import { applyStockChanges } from "@/lib/inventory/stock";
import {
  assertTransition,
  computePurchaseTotals,
  derivePaymentStatus,
  statusAffectsStock,
} from "@/lib/purchases/state-machine";
import { z } from "zod";

/**
 * Purchase order mutations.
 *
 * Two rules dominate everything here:
 *
 * 1. **Stock only moves on RECEIVED.** Receiving runs in one transaction that
 *    writes the status change, the ledger entries, and the stock increments
 *    together. If any line fails, nothing is applied — so a purchase can never be
 *    marked received while leaving stock partially updated.
 * 2. **A purchase price is snapshotted onto its line.** That snapshot is what
 *    history is measured against; `Product.purchasePrice` is only the *current*
 *    cost and is rolled forward as a weighted average, so re-pricing a purchase
 *    later never rewrites the margin of a sale that already happened.
 */

export interface PurchaseLineInput {
  productId: string;
  quantity: number;
  purchasePrice: number;
  /**
   * Expiry date for a perishable line. Required when the product is marked
   * `hasExpiry` — the batch record is what the expiry screens, the alerts and
   * the write-off decision all read, so guessing it would put invented dates in
   * front of the operator.
   */
  expiryDate?: Date | null;
  /** Optional operator-supplied batch/lot code. Falls back to a derived one. */
  batchNumber?: string | null;
}

export interface CreatePurchaseInput {
  supplierId: string;
  date: Date;
  discount?: number;
  tax?: number;
  shippingCost?: number;
  notes?: string;
  lines: PurchaseLineInput[];
}

/**
 * Creates a purchase in DRAFT.
 *
 * DRAFT is deliberate: stock is untouched until the goods physically arrive and
 * someone confirms receipt.
 */
export async function createPurchase(
  input: CreatePurchaseInput,
  userId: string,
): Promise<{ id: string; number: string }> {
  if (input.lines.length === 0) {
    throw new ValidationError("Pembelian harus memiliki minimal satu barang.");
  }

  for (const line of input.lines) {
    if (
      !Number.isInteger(line.quantity) ||
      !Number.isFinite(line.quantity) ||
      line.quantity <= 0
    ) {
      throw new ValidationError(
        "Jumlah barang pada pembelian harus minimal 1.",
        "quantity",
      );
    }

    if (!Number.isFinite(line.purchasePrice) || line.purchasePrice < 0) {
      throw new ValidationError(
        "Harga beli tidak boleh negatif.",
        "purchasePrice",
      );
    }

    if (line.expiryDate && Number.isNaN(line.expiryDate.getTime())) {
      throw new ValidationError(
        "Tanggal kedaluwarsa tidak valid.",
        "expiryDate",
      );
    }
  }

  const supplier = await prisma.supplier.findUnique({
    where: { id: input.supplierId },
    select: { id: true, name: true, isActive: true },
  });

  if (!supplier) {
    throw new ValidationError("Supplier tidak ditemukan.", "supplierId");
  }

  if (!supplier.isActive) {
    throw new BusinessRuleError(
      `Supplier ${supplier.name} sedang nonaktif dan tidak dapat dipilih.`,
    );
  }

  const totals = computePurchaseTotals(input.lines, input);

  // Nothing is paid at DRAFT. `recordPurchasePayment` refuses a draft, so
  // accepting money here would leave a purchase showing as paid for goods that
  // have not arrived, with no way to correct it through the same path.
  const amountPaid = 0;

  // A discount larger than the goods leaves a purchase that can never be settled:
  // the payment action requires a positive amount while the outstanding balance
  // is zero. Refused at the door instead of created and then stuck.
  if (totals.discount > totals.subtotal) {
    throw new ValidationError(
      "Diskon tidak boleh lebih besar dari nilai barang.",
      "discount",
    );
  }

  // Verify every product exists before writing anything.
  const products = await prisma.product.findMany({
    where: { id: { in: input.lines.map((line) => line.productId) } },
    select: { id: true, name: true, hasExpiry: true },
  });

  if (products.length !== new Set(input.lines.map((l) => l.productId)).size) {
    throw new ValidationError(
      "Salah satu produk tidak ditemukan. Refresh halaman dan coba lagi.",
    );
  }

  const nameById = new Map(products.map((product) => [product.id, product.name]));

  // A perishable line cannot be received without a real expiry date, and only
  // the operator knows it. Demanding it now is what keeps the batches table —
  // and every expiry alert and write-off decision derived from it — free of
  // invented shelf lives.
  const perishableIds = new Set(
    products.filter((product) => product.hasExpiry).map((product) => product.id),
  );

  for (const line of input.lines) {
    if (perishableIds.has(line.productId) && !line.expiryDate) {
      throw new ValidationError(
        `Tanggal kedaluwarsa wajib diisi untuk ${nameById.get(line.productId) ?? "produk perishable"}.`,
        "expiryDate",
      );
    }
  }

  // Reject duplicate products: two lines for one product would break the
  // ledger's one-row-per-change assumption and the COGS report.
  const seen = new Set<string>();
  for (const line of input.lines) {
    if (seen.has(line.productId)) {
      throw new ValidationError(
        `${nameById.get(line.productId)} muncul lebih dari sekali. Gabungkan menjadi satu baris.`,
      );
    }
    seen.add(line.productId);
  }

  return prisma.$transaction(async (tx) => {
    return withDocumentNumber("PO", input.date, async (number) =>
      tx.purchase.create({
        data: {
          number,
          supplierId: input.supplierId,
          date: input.date,
          status: "DRAFT",
          subtotal: totals.subtotal,
          discount: totals.discount,
          tax: totals.tax,
          shippingCost: totals.shippingCost,
          grandTotal: totals.grandTotal,
          amountPaid,
          paymentStatus: derivePaymentStatus(totals.grandTotal, amountPaid),
          notes: input.notes || null,
          userId,
          items: {
            create: input.lines.map((line) => ({
              productId: line.productId,
              quantity: line.quantity,
              purchasePrice: line.purchasePrice,
              subtotal: line.quantity * line.purchasePrice,
              // Carried onto the line so receipt can create the real batch,
              // instead of inventing a shelf life at that point.
              expiryDate: line.expiryDate ?? null,
              batchNumber: line.batchNumber?.trim() || null,
            })),
          },
        },
        select: { id: true, number: true },
      }),
    );
  });
}

/**
 * Moves a purchase to a new status.
 *
 * When the target status is RECEIVED, stock is increased for every line in the
 * same transaction. Receiving twice is impossible: the state machine forbids
 * RECEIVED → RECEIVED, so a duplicate click cannot double the stock.
 */
export async function transitionPurchase(
  purchaseId: string,
  to: PurchaseStatus,
  userId: string,
): Promise<void> {
  await prisma.$transaction(
    async (tx) => {
      const purchase = await tx.purchase.findUnique({
        where: { id: purchaseId },
        select: {
          id: true,
          number: true,
          status: true,
          grandTotal: true,
          items: {
            select: {
              productId: true,
              quantity: true,
              purchasePrice: true,
              expiryDate: true,
              batchNumber: true,
              product: { select: { name: true } },
            },
          },
        },
      });

      if (!purchase) {
        throw new ValidationError("Pembelian tidak ditemukan.");
      }

      assertTransition(purchase.status, to);

      if (purchase.items.length === 0) {
        throw new BusinessRuleError(
          "Pembelian ini tidak memiliki barang, tidak bisa diteruskan.",
        );
      }

      // Claim the transition before anything else happens.
      //
      // `assertTransition` validated a status read a moment ago, and under READ
      // COMMITTED that read can already be out of date: two clicks on "Terima"
      // both see ORDERED, both pass, and both would run the stock increments
      // below — turning a 100-unit receipt into a 200-unit one. Conditioning the
      // write on the status we validated makes the loser match no rows and abort,
      // so stock moves exactly once no matter how the request arrives.
      const claimed = await tx.purchase.updateMany({
        where: { id: purchaseId, status: purchase.status },
        data: {
          status: to,
          ...(statusAffectsStock(to) ? { receivedAt: new Date() } : {}),
        },
      });

      if (claimed.count === 0) {
        throw new BusinessRuleError(
          "Status pembelian sudah diubah oleh pengguna lain. Muat ulang halaman.",
        );
      }

      if (!statusAffectsStock(to)) {
        return;
      }

      // Receiving: one guarded ledger entry per line.
      await applyStockChanges(
        tx,
        purchase.items.map((item) => ({
          productId: item.productId,
          quantity: item.quantity,
          direction: "IN",
          type: "PURCHASE",
          referenceType: "Purchase",
          referenceId: purchase.id,
          userId,
          note: `Penerimaan barang ${purchase.number} — ${item.product.name}`,
        })),
      );

      // Roll the product's current cost forward as a weighted average.
      //
      // Overwriting with the newest price would revalue every unit still on the
      // shelf at the latest supplier price — receiving one expensive unit of a
      // SKU would inflate the stock valuation of all the cheap ones. The average
      // is what the remaining stock is actually worth, and `PurchaseItem` keeps
      // its own snapshot so historical margins never move.
      for (const item of purchase.items) {
        const current = await tx.product.findUnique({
          where: { id: item.productId },
          select: { purchasePrice: true, stock: true },
        });

        if (!current) continue;

        const oldQty = Math.max(0, current.stock);
        const newQty = oldQty + item.quantity;

        if (newQty === 0) {
          await tx.product.update({
            where: { id: item.productId },
            data: { purchasePrice: item.purchasePrice },
          });

          continue;
        }

        const weighted = new Prisma.Decimal(
          (Number(current.purchasePrice) * oldQty +
            Number(item.purchasePrice) * item.quantity) /
            newQty,
        );

        await tx.product.update({
          where: { id: item.productId },
          data: { purchasePrice: weighted.toDecimalPlaces(2) },
        });
      }

      // Expiry batches for perishable goods.
      //
      // The date comes from the purchase line, not from a guess: a fabricated
      // shelf life drives expiry alerts, the dashboard widget and the write-off
      // decisions, so inventing one is worse than having none. A perishable line
      // without a date is refused at creation instead.
      const perishables = await tx.product.findMany({
        where: {
          id: { in: purchase.items.map((item) => item.productId) },
          hasExpiry: true,
        },
        select: { id: true },
      });

      const perishableIds = new Set(perishables.map((p) => p.id));

      for (const item of purchase.items) {
        if (!perishableIds.has(item.productId)) continue;

        const batchNumber =
          item.batchNumber?.trim() ||
          `${purchase.number}-${item.productId.slice(-4)}`;

        const expiryDate = item.expiryDate;

        if (!expiryDate) {
          throw new BusinessRuleError(
            `Barang perishable "${item.product.name}" harus memiliki tanggal kedaluwarsa. Perbarui pembelian sebelum menerimanya.`,
          );
        }

        await tx.productBatch.upsert({
          where: {
            productId_batchNumber: {
              productId: item.productId,
              batchNumber,
            },
          },
          update: { quantity: { increment: item.quantity }, expiryDate },
          create: {
            productId: item.productId,
            batchNumber,
            expiryDate,
            quantity: item.quantity,
            purchasePrice: item.purchasePrice,
          },
        });
      }
    },
    { timeout: 20_000, maxWait: 5_000 },
  );
}

/** Records a payment against a purchase (full or partial). */
export async function recordPurchasePayment(
  purchaseId: string,
  amount: number,
): Promise<void> {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new ValidationError("Nominal pembayaran harus lebih dari nol.");
  }

  const purchase = await prisma.purchase.findUnique({
    where: { id: purchaseId },
    select: { id: true, status: true, grandTotal: true, amountPaid: true },
  });

  if (!purchase) {
    throw new ValidationError("Pembelian tidak ditemukan.");
  }

  if (purchase.status === "DRAFT" || purchase.status === "CANCELLED") {
    throw new BusinessRuleError(
      "Pembayaran hanya bisa dicatat setelah pembelian berstatus Diterima.",
    );
  }

  const grandTotal = Number(purchase.grandTotal);
  const newPaid = Math.min(Number(purchase.amountPaid) + amount, grandTotal);

  // Read, add, write — with the value we read as the condition of the write.
  //
  // Two payments recorded at the same moment both read the same `amountPaid` and
  // would both write the same new total, so one of them would vanish while the
  // audit log still claimed both were made: the store is short the difference and
  // the purchase still reads PARTIAL. Comparing against the value we read turns
  // that into a refusal the operator can retry.
  const updated = await prisma.purchase.updateMany({
    where: { id: purchaseId, amountPaid: purchase.amountPaid },
    data: {
      amountPaid: newPaid,
      paymentStatus: derivePaymentStatus(grandTotal, newPaid),
    },
  });

  if (updated.count === 0) {
    throw new BusinessRuleError(
      "Pembayaran sudah diubah oleh pengguna lain. Muat ulang halaman dan coba lagi.",
    );
  }
}

/** Deletes a DRAFT purchase that was created by mistake. */
export async function deleteDraftPurchase(purchaseId: string): Promise<void> {
  const purchase = await prisma.purchase.findUnique({
    where: { id: purchaseId },
    select: { status: true },
  });

  if (!purchase) {
    throw new ValidationError("Pembelian tidak ditemukan.");
  }

  if (purchase.status !== "DRAFT") {
    throw new BusinessRuleError(
      "Hanya pembelian berstatus Draft yang bisa dihapus. Gunakan pembatalan untuk status lain.",
    );
  }

  await prisma.purchase.delete({ where: { id: purchaseId } });
}

// ── Suppliers ─────────────────────────────────────────────────────────────

export interface SupplierInput {
  code?: string;
  name: string;
  company?: string;
  phone?: string;
  email?: string;
  address?: string;
  contactPerson?: string;
  notes?: string;
  /** Only honoured by `updateSupplier`: reactivates a deactivated supplier. */
  isActive?: boolean;
}

export async function createSupplier(
  input: SupplierInput,
): Promise<{ id: string; code: string }> {
  // Codes are human-facing references on paper purchase orders, so they are
  // generated when omitted.
  const code =
    input.code?.trim() ||
    (await nextSupplierCode());

  const supplier = await prisma.supplier.create({
    data: {
      code,
      name: input.name,
      company: input.company || null,
      phone: input.phone || null,
      email: input.email || null,
      address: input.address || null,
      contactPerson: input.contactPerson || null,
      notes: input.notes || null,
    },
    select: { id: true, code: true },
  });

  return supplier;
}

async function nextSupplierCode(): Promise<string> {
  const last = await prisma.supplier.findFirst({
    where: { code: { startsWith: "SUP-" } },
    orderBy: { code: "desc" },
    select: { code: true },
  });

  // `parseInt` rather than `Number`: an operator may type any code they like
  // ("SUP-A"), and `Number("A")` is NaN, which would stringify into the literal
  // code "SUP-NaN" and, being the highest-sorting row, wedge every later call to
  // this function on a unique-constraint failure.
  const parsed = last ? Number.parseInt(last.code.slice(4), 10) : 0;
  const lastNumber = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;

  return `SUP-${String(lastNumber + 1).padStart(3, "0")}`;
}

export async function updateSupplier(
  id: string,
  input: SupplierInput,
): Promise<void> {
  const existing = await prisma.supplier.findUnique({
    where: { id },
    select: { id: true },
  });

  if (!existing) {
    throw new ValidationError("Supplier tidak ditemukan.");
  }

  await prisma.supplier.update({
    where: { id },
    data: {
      ...(input.code ? { code: input.code } : {}),
      name: input.name,
      company: input.company || null,
      phone: input.phone || null,
      email: input.email || null,
      address: input.address || null,
      contactPerson: input.contactPerson || null,
      notes: input.notes || null,
      // Reactivating from the edit form. Deactivation used to be a one-way door:
      // a supplier disabled by mistake could never be brought back, only deleted.
      ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
    },
  });
}

/**
 * Deactivates rather than deletes a supplier.
 *
 * Historical purchases must keep resolving to a supplier name, so a supplier
 * with history is only ever deactivated. Returns whether the row was actually
 * removed, so the audit log can tell a deletion from a deactivation instead of
 * recording both as the same event.
 */
export async function deactivateSupplier(
  id: string,
): Promise<"deleted" | "deactivated"> {
  const purchaseCount = await prisma.purchase.count({
    where: { supplierId: id },
  });

  if (purchaseCount === 0) {
    await prisma.supplier.delete({ where: { id } });
    return "deleted";
  }

  await prisma.supplier.update({
    where: { id },
    data: { isActive: false },
  });

  return "deactivated";
}

export const purchaseLineSchema = z.object({
  productId: z.string().min(1),
  quantity: z.coerce.number().int().min(1).max(1_000_000),
  purchasePrice: z.coerce.number().min(0).max(9_999_999_999),
  expiryDate: z.coerce.date().optional(),
  batchNumber: z.string().trim().max(60).optional(),
});

export type { PrismaNS, Prisma };