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
  /** Loyalty points the member is spending. Validated against the real balance. */
  redeemPoints: z.coerce.number().int().min(0).max(1_000_000).default(0),
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
  /** Points this member spent, so a refund knows what to give back. */
  pointsRedeemed: number;
  /** Rupiah those points were worth on this sale. */
  pointsDiscount: number;
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
  | "product"
  | "productBatch"
  | "sale"
  | "promotion"
  | "customer"
  | "storeSetting"
  | "cashShift"
  | "inventoryMovement"
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
  options: { client?: CheckoutClient; canApplyDiscount?: boolean } = {},
): Promise<CheckoutResult> {
  const data = checkoutSchema.parse(input);

  const resolved = {
    canApplyDiscount: options.canApplyDiscount ?? true,
  };

  if (options.client) {
    return runCheckout(options.client, data, actor, resolved);
  }

  return prisma.$transaction(
    (tx) => runCheckout(tx, data, actor, resolved),
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
  options: { canApplyDiscount: boolean },
): Promise<CheckoutResult> {
  {
      // ── 0. Who is allowed to give money away? ───────────────────────────
      // Checked before anything is read or written, because a discount that the
      // cashier has no authority to grant must never influence the total — not
      // even in a preview that is then thrown away.
      const requestedDiscount =
        data.manualDiscount +
        data.lines.reduce((sum, line) => sum + (line.lineDiscount ?? 0), 0);

      if (requestedDiscount > 0 && !options.canApplyDiscount) {
        throw new BusinessRuleError(
          "Anda tidak memiliki izin untuk memberikan diskon manual.",
        );
      }

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
          minSellingPrice: true,
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

      // ── 1b. Expiry gate ────────────────────────────────────────────────
      // A batch-tracked product whose every remaining batch is past its expiry
      // date must not reach a customer, however much stock the counter claims.
      const batchProductIds = products.map((product) => product.id);

      if (batchProductIds.length > 0) {
        const now = new Date();
        const batchRows = await tx.productBatch.findMany({
          where: { productId: { in: batchProductIds }, quantity: { gt: 0 } },
          select: { productId: true, expiryDate: true },
        });

        const freshByProduct = new Set<string>();

        for (const row of batchRows) {
          if (row.expiryDate > now) {
            freshByProduct.add(row.productId);
          }
        }

        const trackedProducts = new Set(batchRows.map((row) => row.productId));

        for (const product of products) {
          if (
            trackedProducts.has(product.id) &&
            !freshByProduct.has(product.id)
          ) {
            throw new BusinessRuleError(
              `${product.name} sudah kedaluwarsa dan tidak bisa dijual.`,
            );
          }
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
      let promotionUsageLimit = 0;

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
        promotionUsageLimit = promotion.usageLimit ?? 0;
      }

      // ── 4. Loyalty configuration, read before the totals ───────────────
      // Points can be both spent and earned on one sale, so the customer and the
      // loyalty settings have to be resolved before the total is computed —
      // otherwise the redemption could not be priced into what the customer owes.
      const [pointsSetting, pointValueSetting, loyaltyEnabled, customer] =
        await Promise.all([
          tx.storeSetting.findUnique({ where: { key: "loyalty.ratio" } }),
          tx.storeSetting.findUnique({ where: { key: "loyalty.pointValue" } }),
          tx.storeSetting.findUnique({ where: { key: "loyalty.enabled" } }),
          data.customerId
            ? tx.customer.findUnique({
                where: { id: data.customerId },
                select: {
                  id: true,
                  name: true,
                  isMember: true,
                  isActive: true,
                  points: true,
                },
              })
            : Promise.resolve(null),
        ]);

      if (data.customerId && !customer) {
        throw new ValidationError("Pelanggan tidak ditemukan.");
      }

      if (customer && !customer.isActive) {
        throw new BusinessRuleError("Pelanggan sudah dinonaktifkan.");
      }

      const pointsRatio =
        pointsSetting && typeof pointsSetting.value === "number"
          ? pointsSetting.value
          : DEFAULT_POINTS_RATIO;

      // The kill switch has to be honoured here, not just displayed on the
      // settings screen: leaving it unread would let a store that has turned
      // loyalty off keep accruing points nobody can spend.
      const loyaltyOn = loyaltyEnabled?.value !== false;
      const isMember = loyaltyOn && Boolean(customer?.isMember);

      // ── 4b. Redeeming points ────────────────────────────────────────────
      // The store sets the rupiah value of a point; the number of points is
      // requested, and the balance is read here rather than trusted. Without a
      // redemption path the loyalty programme was earn-only: points accrued
      // forever, `loyalty.pointValue` was displayed on the settings screen and
      // read by nothing, and there was no reason for a customer to be a member.
      const pointValue =
        pointValueSetting && typeof pointValueSetting.value === "number"
          ? pointValueSetting.value
          : 0;

      let pointsRedeemed = 0;
      let pointsDiscount = 0;

      if (data.redeemPoints > 0) {
        if (!isMember) {
          throw new BusinessRuleError(
            "Hanya member yang bisa menukar poin.",
          );
        }

        if (pointValue <= 0) {
          throw new BusinessRuleError(
            "Nilai tukar poin belum diatur. Hubungi administrator toko.",
          );
        }

        if (data.redeemPoints > (customer?.points ?? 0)) {
          throw new BusinessRuleError(
            `Poin tidak cukup. Tersedia ${customer?.points ?? 0} poin.`,
          );
        }

        pointsRedeemed = data.redeemPoints;
        // Flooring the value keeps redemption from handing out a fraction of a
        // rupiah, and from ever exceeding what the customer actually owes.
        pointsDiscount = Math.floor(pointsRedeemed * pointValue);
      }

      // ── 4c. Totals, with tax from settings ─────────────────────────────
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
        pointsDiscount,
        taxRate,
      });

      if (totals.total <= 0) {
        throw new BusinessRuleError("Total transaksi harus lebih dari nol.");
      }

      // ── 4b. The shift this sale is cash accountable to ──────────────────
      // The shift is the entire basis of cash reconciliation: expected cash at
      // close is the opening float plus every CASH sale booked against the
      // shift. So the id is verified here rather than accepted from the client —
      // otherwise a cashier can book takings onto someone else's till, or onto a
      // shift that has already been closed and reconciled, and the variance that
      // is supposed to expose a shortfall simply absorbs it.
      let shiftId: string | null = null;

      if (data.shiftId) {
        const shift = await tx.cashShift.findFirst({
          where: { id: data.shiftId, userId: actor.id, status: "OPEN" },
          select: { id: true },
        });

        if (!shift) {
          throw new BusinessRuleError(
            "Shift kasir tidak valid atau sudah ditutup. Buka shift sebelum menjual.",
          );
        }

        shiftId = shift.id;
      }

      // Cash with no open shift is money the store cannot account for: there is
      // no opening float to reconcile against and no till to compare the closing
      // count to. The POS offers non-cash methods in that state, because those
      // never touch the drawer.
      if (data.paymentMethod === "CASH" && !shiftId) {
        throw new BusinessRuleError(
          "Buka shift kasir sebelum menerima pembayaran tunai.",
        );
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

      // ── 5. Points earned on this sale ─────────────────────────────────
      // Points accrue on post-discount, pre-tax revenue: tax is collected for the
      // state, so a customer earns nothing on it. Net of anything redeemed, so a
      // member paying entirely with points does not also bank points for it.
      const pointsEarned =
        isMember && pointsRatio > 0
          ? Math.max(
              0,
              Math.floor(
                (totals.total - totals.tax - totals.pointsDiscount) /
                  pointsRatio,
              ),
            )
          : 0;

      // ── 6. Persist the sale ──────────────────────────────────────────────
      // Captured once and reused, so the sale row, its invoice number, and the
      // printed receipt cannot disagree about when the transaction happened.
      const soldAt = new Date();

      // `totals.subtotal` is already net of the line discounts (`cartSubtotal`
      // works on post-line-discount amounts), so adding `lineDiscountTotal` here
      // would count the same rupiah twice and the printed receipt would no longer
      // foot: subtotal − discount + tax ≠ total. The promotion and manual
      // discounts are the ones still to be deducted from that subtotal.
      const totalDiscount =
        totals.promotionDiscount + totals.pointsDiscount + totals.manualDiscount;

      const sale = await withDocumentNumber("INV", soldAt, (invoiceNumber) =>
        tx.sale.create({
          data: {
            invoiceNumber,
            customerId: customer?.id ?? null,
            userId: actor.id,
            // The verified shift, not whatever the request claimed.
            shiftId,
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
            pointsRedeemed,
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
      //
      // The claim is conditional rather than a bare increment: the cap was
      // checked against a snapshot read earlier in this transaction, so two
      // checkouts can both have been told the code is valid. Making `usedCount`
      // the thing the write is conditioned on means the loser is refused instead
      // of handing out one discount too many.
      if (promotionId && promotionHasLimit) {
        const claimed = await tx.promotion.updateMany({
          where: { id: promotionId, usedCount: { lt: promotionUsageLimit } },
          data: { usedCount: { increment: 1 } },
        });

        if (claimed.count === 0) {
          throw new BusinessRuleError(
            "Kuota promo ini sudah habis dipakai. Minta pelanggan tanpa kode promo.",
          );
        }
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
      // Spend and earn are combined into one net change. Declaring both a
      // `decrement` and an `increment` for the same field looks like it says
      // "spend and earn" but Prisma keeps only the last one — the redemption
      // would silently never be taken and the member pays cash for goods they
      // already paid for in points.
      if (customer) {
        const pointsDelta = pointsEarned - pointsRedeemed;

        await tx.customer.update({
          where: { id: customer.id },
          data: {
            ...(pointsDelta !== 0 ? { points: { increment: pointsDelta } } : {}),
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
        pointsRedeemed,
        pointsDiscount: totals.pointsDiscount,
        promotionCode: appliedPromotionCode,
        cashierName: actor.name,
        customerName: customer?.name ?? null,
        lines: receiptLines,
      };
  }
}