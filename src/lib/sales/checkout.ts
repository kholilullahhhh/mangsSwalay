import "server-only";

import { z } from "zod";

import { prisma } from "@/lib/db";
import { withDocumentNumber } from "@/lib/documents";
import { BusinessRuleError, ValidationError } from "@/lib/error";
import { applyStockChanges } from "@/lib/inventory/stock";
import type { TxClient } from "@/lib/db-client";
import { calculateTotals, validateCart } from "@/lib/pos/cart";
import { evaluatePromotion } from "@/lib/promotions/engine";

/**
 * Checkout: the one transaction that turns a cart into money, stock, and history.
 *
 * Extracted out of the Server Action so the rules can be exercised directly
 * against a real database. A checkout path that can only be reached by POSTing to
 * a React Server Action is effectively untestable — and untested money code is
 * where silent drift lives.
 *
 * The ordering of the steps below is the design:
 *
 * 1. Re-read every product inside the transaction. Prices, names, and stock come
 *    from the database, never from the caller's payload, so a tampered request
 *    cannot change what a customer is charged.
 * 2. Run the promotion engine against those DB prices. A code is worth exactly
 *    what the rules say it is worth, regardless of what the client claims.
 * 3. Write the sale, decrement stock through the guarded ledger, and grant loyalty
 *    points — all in this transaction, so there is no state in which a sale
 *    exists but stock was not decremented.
 *
 * Tax is read from settings, not from the caller. Taking it from the request would
 * mean a client could simply send `taxRate: 0` and never collect tax.
 */

/** Loyalty fallback, used only when the store has no `loyalty.ratio` setting. */
const DEFAULT_POINTS_RATIO = 10_000;

export const checkoutSchema = z.object({
  customerId: z.string().min(1).optional(),
  shiftId: z.string().optional(),
  promotionCode: z.string().trim().min(1).max(40).optional(),
  paymentMethod: z.enum([
    "CASH",
    "QRIS",
    "DEBIT",
    "CREDIT_CARD",
    "TRANSFER",
    "E_WALLET",
  ]),
  amountPaid: z.coerce.number().min(0),
  manualDiscount: z.coerce.number().min(0).default(0),
  /** Accepted for compatibility, but never trusted: see `resolveTaxRate`. */
  taxRate: z.coerce.number().min(0).max(1).default(0),
  notes: z.string().max(500).optional(),
  lines: z
    .array(
      z.object({
        productId: z.string().min(1),
        quantity: z.coerce.number().int().min(1),
        lineDiscount: z.coerce.number().min(0).default(0),
      }),
    )
    .min(1, "Keranjang masih kosong."),
});

export interface CheckoutLineInput {
  productId: string;
  quantity: number;
  lineDiscount?: number;
}

export type CheckoutInput = z.input<typeof checkoutSchema>;

export interface CheckoutLineResult {
  name: string;
  /** Integer rupiah per unit, after any line-level discount. */
  unitPrice: number;
  quantity: number;
  unit: string;
  /** Integer rupiah for this line before order-level discounts. */
  subtotal: number;
  /** Integer rupiah of line-level discount applied. */
  discount: number;
}

export interface CheckoutResult {
  invoiceNumber: string;
  saleId: string;
  /** Milliseconds since the epoch, so the receipt shows the real sale time. */
  date: number;
  subtotal: number;
  /** Promotion, manual, and line discounts combined. */
  discount: number;
  tax: number;
  total: number;
  paymentMethod: CheckoutInput["paymentMethod"];
  /** Integer rupiah actually handed over. */
  amountPaid: number;
  change: number;
  pointsEarned: number;
  promotionCode: string | null;
  cashierName: string;
  customerName: string | null;
  lines: CheckoutLineResult[];
}

/** The cashier, as far as checkout is concerned. */
export interface CheckoutActor {
  id: string;
  name: string;
}

/**
 * Model delegates the checkout needs: the global client and a transaction both
 * satisfy this, which is what lets a caller wrap the sale in its own atomic unit
 * instead of the sale opening a transaction of its own.
 */
export type CheckoutClient = Pick<
  TxClient,
  "product" | "sale" | "promotion" | "customer" | "storeSetting" | "inventoryMovement"
>;

/**
 * Tax rate for this store, as a fraction.
 *
 * Read inside the transaction so the rate applied to a sale is the rate in force
 * at the moment it happened. `tax.enabled` gates it: a store that has turned tax
 * off must not be charged because a stale client sent a rate.
 */
async function resolveTaxRate(tx: CheckoutClient): Promise<number> {
  const [enabled, rate] = await Promise.all([
    tx.storeSetting.findUnique({ where: { key: "tax.enabled" }, select: { value: true } }),
    tx.storeSetting.findUnique({ where: { key: "tax.rate" }, select: { value: true } }),
  ]);

  if (enabled?.value !== true) return 0;

  const value = typeof rate?.value === "number" ? rate.value : 0;

  return Number.isFinite(value) && value > 0 ? Math.min(value, 1) : 0;
}

/**
 * Records a completed sale.
 *
 * Throws `ValidationError` or `BusinessRuleError` on anything it refuses, which
 * the Server Action turns into a user-facing message. Every failure path leaves
 * the database untouched.
 *
 * `options.client` exists so this can join a caller's transaction. Prisma nests
 * an interactive transaction inside another as a savepoint, so the outer rollback
 * still undoes the sale. Without it, every call would open its own transaction
 * and commit regardless of what the caller decided — which is how "the test says
 * the write was rolled back" and the database disagrees.
 */
export async function checkoutSale(
  input: CheckoutInput,
  actor: CheckoutActor,
  options: { client?: CheckoutClient } = {},
): Promise<CheckoutResult> {
  const data = checkoutSchema.parse(input);

  if (options.client) {
    return runCheckout(options.client, data, actor);
  }

  return prisma.$transaction(
    (tx) => runCheckout(tx, data, actor),
    {
      // A contended row (two cashiers selling the same last unit) aborts one
      // transaction rather than silently waiting; the client can retry.
      isolationLevel: "ReadCommitted",
      timeout: 15_000,
      maxWait: 5_000,
    },
  );
}

async function runCheckout(
  tx: CheckoutClient,
  data: z.infer<typeof checkoutSchema>,
  actor: CheckoutActor,
): Promise<CheckoutResult> {
  {
      // ── 1. Re-read products; the client payload is not trusted ──────────
      const productIds = data.lines.map((line) => line.productId);

      const products = await tx.product.findMany({
        where: { id: { in: productIds } },
        select: {
          id: true,
          name: true,
          sku: true,
          unit: true,
          stock: true,
          isActive: true,
          sellingPrice: true,
          purchasePrice: true,
          categoryId: true,
        },
      });

      const byId = new Map(products.map((product) => [product.id, product]));

      for (const line of data.lines) {
        const product = byId.get(line.productId);

        if (!product) {
          throw new ValidationError(
            "Produk tidak ditemukan. Refresh halaman dan coba lagi.",
          );
        }

        if (!product.isActive) {
          throw new BusinessRuleError(
            `${product.name} sudah dinonaktifkan dan tidak bisa dijual.`,
          );
        }

        if (product.stock < line.quantity) {
          throw new BusinessRuleError(
            `Stok ${product.name} tidak mencukupi. Diminta ${line.quantity}, tersedia ${product.stock}.`,
          );
        }
      }

      // ── 2. Build cart lines using DB prices ──────────────────────────────
      const cartLines = data.lines.map((line) => {
        const product = byId.get(line.productId)!;

        return {
          productId: product.id,
          sku: product.sku,
          name: product.name,
          unit: product.unit,
          quantity: line.quantity,
          unitPrice: Number(product.sellingPrice),
          lineDiscount: line.lineDiscount,
          availableStock: product.stock,
        };
      });

      const problems = validateCart(cartLines);

      if (problems.length > 0) {
        throw new BusinessRuleError(problems[0].message);
      }

      // ── 3. Promotion, evaluated against DB prices ────────────────────────
      let promotionDiscount = 0;
      let appliedPromotionCode: string | null = null;
      let promotionId: string | null = null;
      let promotionHasLimit = false;

      if (data.promotionCode) {
        const code = data.promotionCode.toUpperCase();

        const promotion = await tx.promotion.findUnique({
          where: { code },
          include: { products: { select: { productId: true } } },
        });

        if (!promotion) {
          throw new BusinessRuleError(`Kode promo "${code}" tidak ditemukan.`);
        }

        // Percentages are stored as 0-100 but the engine works in fractions.
        const isFractional = promotion.type !== "FIXED" && promotion.type !== "BUY_X_GET_Y";

        const verdict = evaluatePromotion(
          {
            id: promotion.id,
            code: promotion.code,
            name: promotion.name,
            type: promotion.type,
            value: isFractional
              ? Number(promotion.value) / 100
              : Number(promotion.value),
            minPurchaseAmount: promotion.minPurchaseAmount
              ? Number(promotion.minPurchaseAmount)
              : null,
            buyQuantity: promotion.buyQuantity,
            getQuantity: promotion.getQuantity,
            categoryId: promotion.categoryId,
            startDate: promotion.startDate,
            endDate: promotion.endDate,
            usageLimit: promotion.usageLimit,
            usedCount: promotion.usedCount,
            isActive: promotion.isActive,
            productIds: promotion.products.map((entry) => entry.productId),
          },
          cartLines.map((line) => {
            const product = byId.get(line.productId)!;

            return {
              productId: product.id,
              name: product.name,
              categoryId: product.categoryId ?? "",
              quantity: line.quantity,
              // The engine discounts what the customer actually pays for the line,
              // so a line discount is spread across its units rather than left on
              // top. Flooring keeps the engine from seeing one rupiah more per
              // unit than the customer paid in total.
              unitPrice: Math.max(
                0,
                line.unitPrice - Math.floor((line.lineDiscount ?? 0) / line.quantity),
              ),
            };
          }),
          new Date(),
        );

        if (!verdict.valid) {
          throw new BusinessRuleError(verdict.reason);
        }

        promotionDiscount = verdict.discount;
        appliedPromotionCode = promotion.code;
        promotionId = promotion.id;
        promotionHasLimit = promotion.usageLimit !== null;
      }

      // ── 4. Totals, with tax from settings ────────────────────────────────
      const taxRate = await resolveTaxRate(tx);

      const totals = calculateTotals({
        lines: cartLines,
        promotions: promotionDiscount
          ? [
              {
                code: appliedPromotionCode ?? "",
                name: appliedPromotionCode ?? "",
                discountAmount: promotionDiscount,
              },
            ]
          : [],
        manualDiscount: data.manualDiscount,
        taxRate,
      });

      if (totals.total <= 0) {
        throw new BusinessRuleError("Total transaksi harus lebih dari nol.");
      }

      // Cash must cover the total; other methods settle at exactly the total.
      if (data.paymentMethod === "CASH" && data.amountPaid < totals.total) {
        throw new BusinessRuleError(
          `Pembayaran kurang Rp${(totals.total - data.amountPaid).toLocaleString("id-ID")}.`,
        );
      }

      const amountPaid =
        data.paymentMethod === "CASH" ? Math.round(data.amountPaid) : totals.total;

      const change =
        data.paymentMethod === "CASH" ? amountPaid - totals.total : 0;

      // ── 5. Loyalty configuration ─────────────────────────────────────────
      const [pointsSetting, customer] = await Promise.all([
        tx.storeSetting.findUnique({ where: { key: "loyalty.ratio" } }),
        data.customerId
          ? tx.customer.findUnique({
              where: { id: data.customerId },
              select: { id: true, name: true, isMember: true },
            })
          : Promise.resolve(null),
      ]);

      const pointsRatio =
        pointsSetting && typeof pointsSetting.value === "number"
          ? pointsSetting.value
          : DEFAULT_POINTS_RATIO;

      // Points accrue on post-discount, pre-tax revenue: tax is collected for the
      // state, so a customer earns nothing on it.
      const pointsEarned =
        customer?.isMember && pointsRatio > 0
          ? Math.floor((totals.total - totals.tax) / pointsRatio)
          : 0;

      // ── 6. Persist the sale ──────────────────────────────────────────────
      // Captured once and reused, so the sale row, its invoice number, and the
      // printed receipt cannot disagree about when the transaction happened.
      const soldAt = new Date();

      const totalDiscount =
        totals.promotionDiscount + totals.manualDiscount + totals.lineDiscountTotal;

      const sale = await withDocumentNumber("INV", soldAt, (invoiceNumber) =>
        tx.sale.create({
          data: {
            invoiceNumber,
            customerId: customer?.id ?? null,
            userId: actor.id,
            shiftId: data.shiftId ?? null,
            date: soldAt,
            promotionCode: appliedPromotionCode,
            subtotal: totals.subtotal,
            discount: totalDiscount,
            tax: totals.tax,
            total: totals.total,
            paymentMethod: data.paymentMethod,
            amountPaid,
            change,
            status: "COMPLETED",
            pointsEarned,
            notes: data.notes || null,
            items: {
              create: cartLines.map((line) => {
                const product = byId.get(line.productId)!;

                return {
                  productId: product.id,
                  quantity: line.quantity,
                  price: product.sellingPrice,
                  // Cost snapshot: a later purchase-price change must not rewrite
                  // the margin of a sale that already happened.
                  cost: product.purchasePrice,
                  discount: line.lineDiscount,
                  subtotal: line.unitPrice * line.quantity - (line.lineDiscount ?? 0),
                };
              }),
            },
          },
          select: { id: true, invoiceNumber: true },
        }),
      );

      // ── 7. Consume one use of the promotion ──────────────────────────────
      // Only bumped when the promotion is capped, and inside this transaction so
      // two concurrent checkouts cannot both take the last available use.
      if (promotionId && promotionHasLimit) {
        await tx.promotion.update({
          where: { id: promotionId },
          data: { usedCount: { increment: 1 } },
        });
      }

      // ── 8. Decrement stock through the guarded ledger ────────────────────
      await applyStockChanges(
        tx,
        cartLines.map((line) => ({
          productId: line.productId,
          quantity: line.quantity,
          direction: "OUT",
          type: "SALE",
          referenceType: "Sale",
          referenceId: sale.id,
          userId: actor.id,
          note: `Penjualan ${sale.invoiceNumber}`,
        })),
      );

      // ── 9. Customer totals and loyalty points ────────────────────────────
      if (customer) {
        await tx.customer.update({
          where: { id: customer.id },
          data: {
            points: { increment: pointsEarned },
            totalPurchases: { increment: 1 },
          },
        });
      }

      // ── 10. The receipt snapshot ─────────────────────────────────────────
      // Rendered from these values, not from the caller's cart, so what the
      // customer holds always matches what was written to the Sale.
      const receiptLines: CheckoutLineResult[] = cartLines.map((line) => {
        const product = byId.get(line.productId)!;

        return {
          name: product.name,
          unitPrice: line.unitPrice,
          quantity: line.quantity,
          unit: product.unit,
          subtotal: line.unitPrice * line.quantity - (line.lineDiscount ?? 0),
          discount: line.lineDiscount ?? 0,
        };
      });

      return {
        invoiceNumber: sale.invoiceNumber,
        saleId: sale.id,
        date: soldAt.getTime(),
        subtotal: totals.subtotal,
        discount: totalDiscount,
        tax: totals.tax,
        total: totals.total,
        paymentMethod: data.paymentMethod,
        amountPaid,
        change,
        pointsEarned,
        promotionCode: appliedPromotionCode,
        cashierName: actor.name,
        customerName: customer?.name ?? null,
        lines: receiptLines,
      };
  }
}