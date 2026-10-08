/**
 * Promotion engine — pure functions, no database access.
 *
 * Split from the POS cart maths on purpose. A promotion is the one place where
 * an off-by-one rupiah becomes real money owed to a customer, and it needs to be
 * testable without a database: every rule below is a decision the checkout
 * transaction depends on, so each one is verified directly in `test-sales.ts`.
 *
 * Money is integer rupiah, matching `pos/cart.ts`. Percentages are expressed as
 * fractions (0.1 = 10%) internally so no rule has to remember whether `value`
 * means 10 or 0.1.
 *
 * The engine never mutates a cart. It returns the discount it would grant, and
 * the caller clamps it against the amount actually being discounted. That keeps
 * "what the promotion says" separate from "what the cart can afford to give up".
 */

/** Mirrors the `PromotionType` enum in the Prisma schema. */
export type PromotionType =
  | "PERCENTAGE"
  | "FIXED"
  | "BUY_X_GET_Y"
  | "PRODUCT"
  | "CATEGORY"
  | "MINIMUM_PURCHASE";

/**
 * A promotion as the engine needs to see it.
 *
 * Deliberately a plain interface rather than the Prisma model: the engine must
 * not be able to accidentally read a field the checkout transaction has not yet
 * verified, and it keeps the rules testable with hand-built literals.
 */
export interface PromotionInput {
  id: string;
  code: string;
  name: string;
  type: PromotionType;
  /**
   * For percentage-based types, a *fraction*: 0.1 means 10%.
   *
   * Fractional rather than 0-100 because the arithmetic below then reads the same
   * as the maths it implements. The database stores 0-100, so the conversion
   * happens once at the boundary rather than being repeated, and mistyped here,
   * which previously discounted 100x too little.
   */
  value: number;
  /** Spend threshold for MINIMUM_PURCHASE. */
  minPurchaseAmount: number | null;
  /** Buy quantity for BUY_X_GET_Y. */
  buyQuantity: number | null;
  /** Free quantity for BUY_X_GET_Y. */
  getQuantity: number | null;
  /** Restricts PRODUCT/CATEGORY promotions to one category. */
  categoryId: string | null;
  startDate: Date;
  endDate: Date;
  /** Null means unlimited. */
  usageLimit: number | null;
  usedCount: number;
  isActive: boolean;
  /** Products explicitly attached, for PRODUCT promotions. */
  productIds: string[];
}

/** The subset of a cart line the engine reads. */
export interface PromotionLine {
  productId: string;
  /** Display name, used only to explain which line a promotion applies to. */
  name: string;
  categoryId: string;
  quantity: number;
  /** Integer rupiah per unit, after any line-level discount. */
  unitPrice: number;
}

export type PromotionRejection =
  | "INACTIVE"
  | "NOT_STARTED"
  | "EXPIRED"
  | "USAGE_LIMIT_REACHED"
  | "BELOW_MINIMUM"
  | "NO_ELIGIBLE_ITEMS"
  | "INVALID_CONFIGURATION";

export interface PromotionVerdict {
  /** True when the promotion may be applied to this cart. */
  valid: boolean;
  /** Integer rupiah the promotion would grant. Only meaningful when valid. */
  discount: number;
  /** Human-readable Indonesian explanation, shown to the cashier either way. */
  reason: string;
  rejection?: PromotionRejection;
  /** Lines that the promotion targets, for the receipt to show. */
  eligibleProductIds: string[];
}

const REJECTION_TEXT: Record<PromotionRejection, string> = {
  INACTIVE: "Promo sedang nonaktif.",
  NOT_STARTED: "Promo belum mulai berlaku.",
  EXPIRED: "Promo sudah berakhir.",
  USAGE_LIMIT_REACHED: "Promo sudah habis dipakai.",
  BELOW_MINIMUM: "Belanja belum mencapai minimum promo.",
  NO_ELIGIBLE_ITEMS: "Tidak ada produk yang memenuhi promo ini.",
  INVALID_CONFIGURATION: "Konfigurasi promo tidak valid.",
};

/**
 * Whether a promotion is running right now.
 *
 * Both bounds are inclusive: a promo ending today at midnight should still work
 * for the whole of today, not vanish at 00:00.
 */
export function isWithinWindow(
  promotion: Pick<PromotionInput, "startDate" | "endDate">,
  now: Date,
): boolean {
  return now.getTime() >= promotion.startDate.getTime() &&
    now.getTime() <= promotion.endDate.getTime();
}

/** Whether the usage limit still leaves room. A null limit is unlimited. */
export function hasUsageRemaining(promotion: PromotionInput): boolean {
  if (promotion.usageLimit === null) return true;
  return promotion.usedCount < promotion.usageLimit;
}

/**
 * Which cart lines a promotion is allowed to discount.
 *
 * A promotion with no explicit scope applies to the whole cart, which is the
 * common case for order-level vouchers. PRODUCT narrows to its attached
 * products, CATEGORY narrows to one category.
 */
export function eligibleLines(
  promotion: PromotionInput,
  lines: PromotionLine[],
): PromotionLine[] {
  if (promotion.type === "PRODUCT") {
    const ids = new Set(promotion.productIds);
    return lines.filter((line) => ids.has(line.productId));
  }

  if (promotion.type === "CATEGORY") {
    if (!promotion.categoryId) return [];
    return lines.filter((line) => line.categoryId === promotion.categoryId);
  }

  return lines;
}

/**
 * Free units granted by a BUY_X_GET_Y promotion.
 *
 * `buyQuantity` paid units yield `getQuantity` free units per group, and the
 * leftover paid units carry into the next group — buying 3 of a "buy 2 get 1"
 * item grants 1 free, and buying 4 grants 2. Computing it as
 * `floor(quantity / (buy + get)) * get` would wrongly grant nothing at 3, so
 * the remainder is what makes the promotion match what the signage says.
 *
 * Never returns more units than are in the cart, which would discount items the
 * customer is not buying.
 */
export function freeUnitsFor(
  quantity: number,
  buyQuantity: number,
  getQuantity: number,
): number {
  if (buyQuantity < 1 || getQuantity < 1 || quantity < 1) return 0;

  const groups = Math.floor(quantity / buyQuantity);
  const granted = groups * getQuantity;

  // Never hand out more free units than the customer actually put in the cart.
  return Math.min(granted, Math.max(0, quantity - buyQuantity));
}

/**
 * Evaluates a promotion against a cart.
 *
 * Order of checks is deliberate: eligibility of time and usage comes first, then
 * the spend threshold, then whether any item qualifies. Reporting "below
 * minimum" when the real problem is an expired promo would send a cashier
 * hunting for the wrong problem.
 */
export function evaluatePromotion(
  promotion: PromotionInput,
  lines: PromotionLine[],
  now: Date = new Date(),
): PromotionVerdict {
  const reject = (rejection: PromotionRejection): PromotionVerdict => ({
    valid: false,
    discount: 0,
    reason: REJECTION_TEXT[rejection],
    rejection,
    eligibleProductIds: [],
  });

  if (!promotion.isActive) return reject("INACTIVE");

  if (now.getTime() < promotion.startDate.getTime()) {
    return reject("NOT_STARTED");
  }

  if (now.getTime() > promotion.endDate.getTime()) {
    return reject("EXPIRED");
  }

  if (!hasUsageRemaining(promotion)) return reject("USAGE_LIMIT_REACHED");

  const targetLines = eligibleLines(promotion, lines);

  if (targetLines.length === 0) return reject("NO_ELIGIBLE_ITEMS");

  const cartSubtotal = lines.reduce(
    (sum, line) => sum + line.unitPrice * line.quantity,
    0,
  );
  const targetSubtotal = targetLines.reduce(
    (sum, line) => sum + line.unitPrice * line.quantity,
    0,
  );

  if (promotion.type === "MINIMUM_PURCHASE") {
    const threshold = promotion.minPurchaseAmount ?? 0;

    if (threshold <= 0) return reject("INVALID_CONFIGURATION");
    if (cartSubtotal < threshold) return reject("BELOW_MINIMUM");

    // Same bound as PERCENTAGE: `value` is a fraction here, so anything above 1
    // is a rupiah figure typed into a percentage field. Without this it becomes a
    // 100%-off (or worse) verdict that silently zeroes the basket, and checkout
    // then refuses the sale as a zero total with no clue why.
    if (promotion.value <= 0 || promotion.value > 1) {
      return reject("INVALID_CONFIGURATION");
    }

    // `value` arrives as a fraction (0.15 = 15%), so it is applied directly.
    const discount = Math.round(promotion.value * cartSubtotal);

    return {
      valid: true,
      // A percentage promo can never discount more than it is discounting.
      discount: Math.min(discount, cartSubtotal),
      reason: `Potongan ${percentOf(promotion.value)}% untuk belanja di atas ${formatRupiah(threshold)}.`,
      eligibleProductIds: lines.map((line) => line.productId),
    };
  }

  if (promotion.type === "PERCENTAGE") {
    if (promotion.value <= 0 || promotion.value > 1) {
      return reject("INVALID_CONFIGURATION");
    }

    // A bare percentage voucher applies to the whole cart, so a customer
    // qualifying it on one item is not punished for also buying others.
    const discount = Math.round(promotion.value * cartSubtotal);

    return {
      valid: true,
      discount: Math.min(discount, cartSubtotal),
      reason: `Potongan ${percentOf(promotion.value)}% dari total belanja.`,
      eligibleProductIds: lines.map((line) => line.productId),
    };
  }

  if (promotion.type === "FIXED") {
    if (promotion.value <= 0) return reject("INVALID_CONFIGURATION");

    return {
      valid: true,
      discount: Math.min(Math.round(promotion.value), cartSubtotal),
      reason: `Potongan tetap ${formatRupiah(promotion.value)}.`,
      eligibleProductIds: lines.map((line) => line.productId),
    };
  }

  if (promotion.type === "BUY_X_GET_Y") {
    const buy = promotion.buyQuantity ?? 0;
    const get = promotion.getQuantity ?? 0;

    if (buy < 1 || get < 1) return reject("INVALID_CONFIGURATION");

    // The cheapest qualifying line gives the customer the best value, which is
    // also how a shopper reads "buy 2 get 1": the free one is the cheapest.
    const qualifying = targetLines.filter((line) => line.quantity >= buy);

    if (qualifying.length === 0) return reject("NO_ELIGIBLE_ITEMS");

    const cheapest = qualifying.reduce((min, line) =>
      line.unitPrice < min.unitPrice ? line : min,
    );

    const free = freeUnitsFor(cheapest.quantity, buy, get);
    const discount = free * cheapest.unitPrice;

    if (discount <= 0) return reject("NO_ELIGIBLE_ITEMS");

    return {
      valid: true,
      discount,
      reason: `Beli ${buy} gratis ${get} (${cheapest.name}).`,
      eligibleProductIds: [cheapest.productId],
    };
  }

  // PRODUCT and CATEGORY are scope-only: they define which lines are eligible,
  // and the discount itself comes from `value` as a percentage.
  if (promotion.value <= 0 || promotion.value > 1) {
    return reject("INVALID_CONFIGURATION");
  }

  const discount = Math.round(promotion.value * targetSubtotal);

  return {
    valid: true,
    discount: Math.min(discount, targetSubtotal),
    reason: `Potongan ${percentOf(promotion.value)}% untuk produk terpilih.`,
    eligibleProductIds: targetLines.map((line) => line.productId),
  };
}

/**
 * Applies one or more promotions to a cart.
 *
 * Only the first valid promotion is honoured. Stacking would let a cashier
 * combine a percentage voucher with a buy-X-get-Y and drive the total to zero on
 * goods the store still has to pay for, so the engine applies one and reports
 * the rest as ignored.
 *
 * The result is clamped against the cart subtotal, which is the final guard: no
 * combination of promotions can make a payable total negative.
 */
export function applyPromotions(
  promotions: PromotionInput[],
  lines: PromotionLine[],
  now: Date = new Date(),
): {
  /** Undefined when no promotion qualified. */
  applied?: PromotionVerdict & { code: string; name: string };
  ignored: Array<{ code: string; reason: string }>;
  totalDiscount: number;
} {
  const cartSubtotal = lines.reduce(
    (sum, line) => sum + line.unitPrice * line.quantity,
    0,
  );

  const ignored: Array<{ code: string; reason: string }> = [];
  let applied: (PromotionVerdict & { code: string; name: string }) | null = null;

  for (const promotion of promotions) {
    const verdict = evaluatePromotion(promotion, lines, now);

    if (verdict.valid && !applied) {
      applied = { ...verdict, code: promotion.code, name: promotion.name };
    } else if (!verdict.valid) {
      ignored.push({ code: promotion.code, reason: verdict.reason });
    } else {
      ignored.push({
        code: promotion.code,
        reason: "Hanya satu promo yang bisa dipakai per transaksi.",
      });
    }
  }

  return {
    applied: applied ?? undefined,
    ignored,
    totalDiscount: Math.min(applied?.discount ?? 0, cartSubtotal),
  };
}

/** Renders a fractional rate as the whole percent a user would have typed. */
function percentOf(fraction: number): number {
  return Math.round(fraction * 100);
}

function formatRupiah(value: number): string {
  return "Rp" + Math.round(value).toLocaleString("id-ID");
}