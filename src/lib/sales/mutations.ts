import "server-only";

import type { TxClient } from "@/lib/db-client";

/**
 * Model delegates the void and refund paths need.
 *
 * Narrower than the whole transaction so both can be handed a caller's client and
 * join their transaction instead of opening one of their own. A refund issued
 * inside another operation has to commit or roll back with it — a nested
 * transaction that commits on its own is worse than no transaction at all,
 * because it looks atomic and is not.
 */
export type SaleClient = Pick<
  TxClient,
  | "sale"
  | "saleItem"
  | "saleRefund"
  | "saleRefundItem"
  | "customer"
  | "product"
  | "storeSetting"
  | "inventoryMovement"
>;

import { prisma } from "@/lib/db";
import { BusinessRuleError, ValidationError } from "@/lib/error";
import { withDocumentNumber } from "@/lib/documents";
import { applyStockChanges } from "@/lib/inventory/stock";
import {
  canRefund,
  canVoid,
  planRefund,
  voidBlockReason,
  type RefundLineInput,
  type SaleState,
} from "@/lib/sales/rules";

/**
 * Sale void and refund.
 *
 * Both paths write to stock, so both run inside a transaction that writes the
 * sale status, the refund records, and the ledger entries together. A refund
 * that partially succeeded would be worse than one that failed outright, since
 * the customer has already handed the goods back.
 */

/**
 * Voids a sale, returning every unit to stock.
 *
 * Void is only for a whole transaction with no refunds recorded against it.
 * Once money has been returned, the correct instrument is a partial refund.
 */
export async function voidSale(
  saleId: string,
  userId: string,
  reason: string,
  options: { client?: SaleClient } = {},
): Promise<void> {
  if (reason.trim().length < 3) {
    throw new ValidationError(
      "Alasan void wajib diisi.",
      "reason",
    );
  }

  if (options.client) {
    await runVoid(options.client, saleId, userId, reason);
    return;
  }

  await prisma.$transaction((tx) => runVoid(tx, saleId, userId, reason));
}

async function runVoid(
  tx: SaleClient,
  saleId: string,
  userId: string,
  reason: string,
): Promise<void> {
  {
      const sale = await tx.sale.findUnique({
        where: { id: saleId },
        select: {
          id: true,
          invoiceNumber: true,
          status: true,
          pointsEarned: true,
          customerId: true,
          items: { select: { productId: true, quantity: true } },
          _count: { select: { refunds: true } },
        },
      });

      if (!sale) {
        throw new ValidationError("Transaksi tidak ditemukan.");
      }

      const status = sale.status as SaleState;
      const hasRefunds = sale._count.refunds > 0;

      const blocked = voidBlockReason(status, hasRefunds);

      if (blocked || !canVoid(status, hasRefunds)) {
        throw new BusinessRuleError(
          blocked ?? "Transaksi ini tidak dapat dibatalkan.",
        );
      }

      // Release stock. Void uses its own movement type so these units are
      // distinguishable from a genuine return in the ledger.
      await applyStockChanges(
        tx,
        sale.items.map((item) => ({
          productId: item.productId,
          quantity: item.quantity,
          direction: "IN" as const,
          type: "SALE_VOID" as const,
          referenceType: "Sale",
          referenceId: sale.id,
          userId,
          note: "Void transaksi " + sale.invoiceNumber,
        })),
      );

      await tx.sale.update({
        where: { id: saleId },
        data: {
          status: "VOID",
          voidedAt: new Date(),
          voidReason: reason.trim(),
        },
      });

// Loyalty points granted by a voided sale must be withdrawn, otherwise a
  // customer could void repeatedly and farm points for free.
  if (sale.customerId && sale.pointsEarned > 0) {
    await tx.customer.update({
      where: { id: sale.customerId },
      data: {
        points: { decrement: sale.pointsEarned },
        totalPurchases: { decrement: 1 },
      },
    });
  }
  }
}

/**
 * Refunds one or more lines of a sale.
 *
 * Only items returned in good condition go back into sellable stock; damaged
 * units are recorded so the shrinkage is reportable but never re-sold.
 */
export async function refundSale(
saleId: string,
  requested: RefundLineInput[],
  reason: string,
  userId: string,
  options: { client?: SaleClient } = {},
): Promise<{ refundNumber: string; totalRefund: number; restocked: number }> {
  if (reason.trim().length < 3) {
    throw new ValidationError("Alasan retur wajib diisi.", "reason");
  }

  if (requested.length === 0) {
    throw new ValidationError("Pilih minimal satu barang untuk diretur.");
  }

  if (options.client) {
    return runRefund(options.client, saleId, requested, reason, userId);
  }

  return prisma.$transaction(
    (tx) => runRefund(tx, saleId, requested, reason, userId),
    { timeout: 20_000, maxWait: 5_000 },
  );
}

async function runRefund(
  tx: SaleClient,
  saleId: string,
  requested: RefundLineInput[],
  reason: string,
  userId: string,
): Promise<{ refundNumber: string; totalRefund: number; restocked: number }> {
  {
      const sale = await tx.sale.findUnique({
        where: { id: saleId },
        select: {
          id: true,
          invoiceNumber: true,
          status: true,
          paymentMethod: true,
          customerId: true,
items: {
            select: {
              id: true,
              productId: true,
              quantity: true,
              returnedQty: true,
              subtotal: true,
              product: { select: { name: true } },
              refundItems: { select: { amount: true } },
            },
          },
        },
      });

      if (!sale) {
        throw new ValidationError("Transaksi tidak ditemukan.");
      }

      const status = sale.status as SaleState;

const refundable = sale.items.map((item) => ({
        saleItemId: item.id,
        productId: item.productId,
        name: item.product.name,
        quantity: item.quantity,
        returnedQty: item.returnedQty,
        subtotal: Number(item.subtotal),
        // Sum of what earlier refunds already paid on this line, so the
        // remainder logic can guarantee the refunds sum to the subtotal.
        refundedAmount: Number(
          item.refundItems.reduce((sum, entry) => sum + Number(entry.amount), 0),
        ),
      }));

      if (!canRefund(status, refundable)) {
        throw new BusinessRuleError(
          status === "VOID"
            ? "Transaksi sudah void sehingga tidak dapat diretur."
            : "Seluruh barang pada transaksi ini sudah diretur.",
        );
      }

      const plan = planRefund(refundable, requested, status);

      if (plan.errors.length > 0) {
        throw new BusinessRuleError(plan.errors[0]);
      }

      if (plan.totalRefund <= 0) {
        throw new BusinessRuleError("Nilai retur tidak boleh nol.");
      }

      const refund = await withDocumentNumber(
        "RFN",
        new Date(),
        async (refundNumber) =>
          tx.saleRefund.create({
            data: {
              number: refundNumber,
              saleId: sale.id,
              date: new Date(),
              totalRefund: plan.totalRefund,
              paymentMethod: sale.paymentMethod,
              reason: reason.trim(),
              approvedById: userId,
              items: {
                create: plan.lines.map((line) => ({
                  saleItemId: line.saleItemId,
                  quantity: line.quantity,
                  amount: line.amount,
                  condition: line.condition,
                })),
              },
            },
            select: { id: true, number: true },
          }),
      );

      // Track how much of each line has been returned.
      for (const line of plan.lines) {
        await tx.saleItem.update({
          where: { id: line.saleItemId },
          data: { returnedQty: { increment: line.quantity } },
        });
      }

      // Only good-condition items re-enter sellable stock.
      if (plan.restockLines.length > 0) {
        await applyStockChanges(
          tx,
          plan.restockLines.map((line) => ({
            productId: line.productId,
            quantity: line.quantity,
            direction: "IN" as const,
            type: "RETURN_SALE" as const,
            referenceType: "SaleRefund",
            referenceId: refund.id,
            userId,
            note: "Retur penjualan " + sale.invoiceNumber,
          })),
        );
      }

await tx.sale.update({
        where: { id: saleId },
        data: { status: plan.newStatus },
      });

      return {
        refundNumber: refund.number,
        totalRefund: plan.totalRefund,
        restocked: plan.restockLines.reduce(
          (sum, line) => sum + line.quantity,
          0,
        ),
      };
  }
}

/** A sale with its lines and refund history, for the detail view. */
export async function getSaleById(id: string) {
  return prisma.sale.findUnique({
    where: { id },
    select: {
      id: true,
      invoiceNumber: true,
      date: true,
      status: true,
      subtotal: true,
      discount: true,
      tax: true,
      total: true,
      paymentMethod: true,
      amountPaid: true,
      change: true,
      pointsEarned: true,
      notes: true,
      voidReason: true,
      voidedAt: true,
      shiftId: true,
      customer: {
        select: { id: true, name: true, phone: true, memberNumber: true },
      },
      user: { select: { id: true, name: true } },
      items: {
        select: {
          id: true,
          productId: true,
          quantity: true,
          returnedQty: true,
          price: true,
          cost: true,
          discount: true,
          subtotal: true,
          product: {
            select: { id: true, name: true, sku: true, unit: true },
          },
          refundItems: { select: { amount: true, quantity: true, condition: true } },
        },
        orderBy: { product: { name: "asc" } },
      },
      refunds: {
        select: {
          id: true,
          number: true,
          date: true,
          totalRefund: true,
          reason: true,
          approver: { select: { name: true } },
          items: { select: { saleItemId: true, quantity: true, amount: true, condition: true } },
        },
        orderBy: { date: "desc" },
      },
    },
  });
}

