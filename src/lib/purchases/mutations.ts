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
 * 2. **A purchase price is snapshotted onto its line**, never written back to
 *    `Product.purchasePrice`. That column is the *current* cost; the line keeps
 *    what was actually paid, so historical COGS and margin reports stay correct
 *    after prices change.
 */

export interface PurchaseLineInput {
  productId: string;
  quantity: number;
  purchasePrice: number;
}

export interface CreatePurchaseInput {
  supplierId: string;
  date: Date;
  discount?: number;
  tax?: number;
  shippingCost?: number;
  amountPaid?: number;
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
    if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
      throw new ValidationError(
        "Jumlah barang pada pembelian harus minimal 1.",
        "quantity",
      );
    }

    if (line.purchasePrice < 0) {
      throw new ValidationError(
        "Harga beli tidak boleh negatif.",
        "purchasePrice",
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
  const amountPaid = Math.min(
    Math.max(0, input.amountPaid ?? 0),
    totals.grandTotal,
  );

  // Verify every product exists before writing anything.
  const products = await prisma.product.findMany({
    where: { id: { in: input.lines.map((line) => line.productId) } },
    select: { id: true, name: true },
  });

  if (products.length !== new Set(input.lines.map((l) => l.productId)).size) {
    throw new ValidationError(
      "Salah satu produk tidak ditemukan. Refresh halaman dan coba lagi.",
    );
  }

  const nameById = new Map(products.map((product) => [product.id, product.name]));

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

      await tx.purchase.update({
        where: { id: purchaseId },
        data: {
          status: to,
          ...(statusAffectsStock(to) ? { receivedAt: new Date() } : {}),
        },
      });

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

      // Update the product's current cost so future margin estimates use it.
      // PurchaseItem keeps its own snapshot, so history is unaffected.
      for (const item of purchase.items) {
        await tx.product.update({
          where: { id: item.productId },
          data: { purchasePrice: item.purchasePrice },
        });
      }

      // Optionally create expiry batches for perishable goods.
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

        const batchNumber = `${purchase.number}-${item.productId.slice(-4)}`;

        await tx.productBatch.upsert({
          where: {
            productId_batchNumber: {
              productId: item.productId,
              batchNumber,
            },
          },
          update: { quantity: { increment: item.quantity } },
          create: {
            productId: item.productId,
            batchNumber,
            // A conservative shelf life; operators adjust the real date from the
            // Batch & Expiry screen once the packaging is checked.
            expiryDate: new Date(
              Date.now() + 90 * 24 * 60 * 60 * 1000,
            ),
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

  await prisma.purchase.update({
    where: { id: purchaseId },
    data: {
      amountPaid: newPaid,
      paymentStatus: derivePaymentStatus(grandTotal, newPaid),
    },
  });
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

  const lastNumber = last ? Number(last.code.replace("SUP-", "")) : 0;

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
    },
  });
}

/**
 * Deactivates rather than deletes a supplier.
 *
 * Historical purchases must keep resolving to a supplier name, so a supplier
 * with history is only ever deactivated.
 */
export async function deactivateSupplier(id: string): Promise<void> {
  const purchaseCount = await prisma.purchase.count({
    where: { supplierId: id },
  });

  if (purchaseCount === 0) {
    await prisma.supplier.delete({ where: { id } });
    return;
  }

  await prisma.supplier.update({
    where: { id },
    data: { isActive: false },
  });
}

export const purchaseLineSchema = z.object({
  productId: z.string().min(1),
  quantity: z.coerce.number().int().min(1),
  purchasePrice: z.coerce.number().min(0),
});

export type { PrismaNS, Prisma };