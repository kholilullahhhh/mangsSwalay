import "server-only";

import type { TxClient } from "@/lib/db-client";

/**
 * Model delegates the void and refund paths need.
 *
 * Narrower than the whole transaction so both can be handed a caller's client and
 * join their transaction instead of opening one of their own. A refund issued
 * inside another operation has to commit or roll back with it â€” a nested
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
  | "productBatch"
  | "promotion"
  | "storeSetting"
  | "inventoryMovement"
>;

import { prisma } from "@/lib/db";
import { BusinessRuleError, ValidationError } from "@/lib/error";
import { withDocumentNumber } from "@/lib/documents";
import { applyStockChanges } from "@/lib/inventory/stock";
import {
  allocateProportionally,
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
          pointsRedeemed: true,
          customerId: true,
          promotionCode: true,
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

      // Claim the sale before touching anything else.
      //
      // The read above is a plain SELECT, so two voids fired at the same moment
      // (a double-click, two tabs, a retried request) would both see COMPLETED
      // and both go on to return the stock. Making the status itself the
      // condition of the write turns that race into a no-op for the loser, which
      // is the only guarantee that stock is returned exactly once.
      const claimed = await tx.sale.updateMany({
        where: { id: saleId, status: sale.status },
        data: {
          status: "VOID",
          voidedAt: new Date(),
          voidReason: reason.trim(),
        },
      });

      if (claimed.count === 0) {
        throw new BusinessRuleError(
          "Transaksi sudah dibatalkan oleh pengguna lain.",
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

      // Loyalty granted by a voided sale must be withdrawn, otherwise a
      // customer could void repeatedly and farm points for free.
      //
      // `totalPurchases` is undone for every attributed sale, not only the ones
      // that earned points: checkout increments it for any customer, member or
      // not, so gating the reversal on `pointsEarned > 0` would leave the count
      // permanently inflated for non-members.
      if (sale.customerId) {
        await tx.customer.update({
          where: { id: sale.customerId },
          data: {
            // Points spent are returned too — the sale never happened.
            ...(pointsEarnedNet(sale.pointsRedeemed, sale.pointsEarned) !== 0
              ? {
                  points: {
                    increment: pointsEarnedNet(
                      sale.pointsRedeemed,
                      sale.pointsEarned,
                    ),
                  },
                }
              : {}),
            totalPurchases: { decrement: 1 },
          },
        });
      }

      // Give a capped promotion's use back. Checkout consumes one, so voiding
      // the sale that used the last available slot would otherwise burn it
      // permanently.
      if (sale.promotionCode) {
        const promotion = await tx.promotion.findUnique({
          where: { code: sale.promotionCode },
          select: { id: true, usageLimit: true },
        });

        if (promotion && promotion.usageLimit !== null) {
          await tx.promotion.updateMany({
            where: { id: promotion.id, usedCount: { gt: 0 } },
            data: { usedCount: { decrement: 1 } },
          });
        }
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
          subtotal: true,
          total: true,
          pointsEarned: true,
          pointsRedeemed: true,
          promotionCode: true,
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

      // A line's own subtotal is what the item was priced at before the
      // order-level discount and tax were applied, so refunding from it would
      // hand back more than the customer ever paid. Each line instead receives
      // its share of `Sale.total` â€” the money actually collected â€” and those
      // shares sum to that total exactly.
      const paidTotal = Number(sale.total);
      const shares = allocateProportionally(
        paidTotal,
        sale.items.map((item) => Number(item.subtotal)),
      );

      const refundable = sale.items.map((item, index) => ({
        saleItemId: item.id,
        productId: item.productId,
        name: item.product.name,
        quantity: item.quantity,
        returnedQty: item.returnedQty,
        subtotal: shares[index],
        // Sum of what earlier refunds already paid on this line, so the
        // remainder logic can guarantee the refunds sum to the share.
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

      // A sale that was written down to zero collected nothing, so a return of
      // the goods is worth Rp 0. That is still a real return â€” the stock must go
      // back and the status must advance â€” so the value check only applies when
      // the customer actually paid something.
      if (plan.totalRefund <= 0 && paidTotal > 0) {
        throw new BusinessRuleError("Nilai retur tidak boleh nol.");
      }

      // Claim each line's remaining quantity before writing anything.
      //
      // The availability check above reads a READ COMMITTED snapshot, so two
      // refunds submitted together both see the same `returnedQty` and both
      // believe the units are free. Making the write itself refuse to take more
      // than is left means the loser aborts instead of refunding the same units
      // twice.
      for (const line of plan.lines) {
        const claimed = await tx.saleItem.updateMany({
          where: {
            id: line.saleItemId,
            returnedQty: { lte: remainingOf(refundable, line.saleItemId) },
          },
          data: { returnedQty: { increment: line.quantity } },
        });

        if (claimed.count === 0) {
          throw new BusinessRuleError(
            `${line.name} sudah diretur oleh transaksi lain. Muat ulang halaman.`,
          );
        }
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

      // Damaged units are not sellable again, but they still left the shelf, so
      // the shrinkage is written to the ledger. Without this the stock counter
      // silently drops with no movement row explaining where the units went.
      for (const line of plan.damagedLines) {
        await tx.inventoryMovement.create({
          data: {
            productId: line.productId,
            type: "DAMAGED",
            quantity: line.quantity,
            previousStock: 0,
            newStock: 0,
            referenceType: "SaleRefund",
            referenceId: refund.id,
            userId,
            note: `Retur rusak dari ${sale.invoiceNumber} (tidak dikembalikan ke stok)`,
          },
        });
      }

      await tx.sale.update({
        where: { id: saleId },
        data: { status: plan.newStatus },
      });

      // Loyalty is earned on the sale, so it is given back with the goods.
      // Without this a member could buy, return, and keep the points.
      // Loyalty is earned on the sale, so it is given back with the goods.
      // Without this a member could buy, return, and keep the points.
      if (sale.customerId && paidTotal > 0) {
        const ratio = Math.min(1, plan.totalRefund / paidTotal);
        const isFull = plan.newStatus === "REFUNDED";

        const pointsBack = isFull
          ? sale.pointsEarned
          : Math.round(sale.pointsEarned * ratio);

        // Points spent on the sale come back too, or the customer keeps the value
        // of the goods *and* the points they paid for them.
        const pointsReturned = isFull
          ? sale.pointsRedeemed
          : Math.round(sale.pointsRedeemed * ratio);

        // Net change rather than a decrement/increment pair, so the common case —
        // one of the two being zero — is a plain assignment the database accepts.
        const pointsDelta = pointsEarnedNet(pointsReturned, pointsBack);

        await tx.customer.update({
          where: { id: sale.customerId },
          data: {
            ...(pointsDelta !== 0 ? { points: { increment: pointsDelta } } : {}),
            ...(isFull ? { totalPurchases: { decrement: 1 } } : {}),
          },
        });
      }

      if (sale.promotionCode) {
        const promotion = await tx.promotion.findUnique({
          where: { code: sale.promotionCode },
          select: { id: true, usageLimit: true },
        });

        if (promotion && promotion.usageLimit !== null) {
          await tx.promotion.updateMany({
            where: { id: promotion.id, usedCount: { gt: 0 } },
            data: { usedCount: { decrement: 1 } },
          });
        }
      }

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

/** Net change to a member's balance: points given back, less points withdrawn. */
function pointsEarnedNet(pointsReturned: number, pointsWithdrawn: number): number {
  return pointsReturned - pointsWithdrawn;
}

/** Units of a sale line that were still returnable when the plan was built. */
function remainingOf(
  items: Array<{ saleItemId: string; quantity: number; returnedQty: number }>,
  saleItemId: string,
): number {
  const item = items.find((entry) => entry.saleItemId === saleItemId);
  return item ? item.quantity - item.returnedQty : 0;
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
      userId: true,
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

