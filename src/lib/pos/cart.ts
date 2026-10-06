/**
 * Cart maths — pure functions, no database access.
 *
 * Kept free of Prisma and React so the pricing rules can be unit tested without
 * a database, and so the POS client and the server agree on how a total is
 * derived. The server always recomputes from these rules; the client's numbers
 * are only ever a preview.
 *
 * Money is handled as integer rupiah throughout. Rupiah has no practical
 * subunit, and integer arithmetic means a cart of 30 line items can never
 * accumulate floating-point drift the way repeated `0.1 + 0.2` style
 * multiplication would.
 */

export interface CartLine {
  productId: string;
  sku: string;
  name: string;
  unit: string;
  /** Quantity already in the cart. Always >= 1. */
  quantity: number;
  /** Integer rupiah. */
  unitPrice: number;
  /** Integer rupiah. Optional per-line discount. */
  lineDiscount?: number;
  /** Stock on hand at the time the item was added. */
  availableStock: number;
}

export interface AppliedPromotion {
  code: string;
  name: string;
  /** Integer rupiah already reduced from the subtotal. */
  discountAmount: number;
}

export interface CartTotals {
  subtotal: number;
  lineDiscountTotal: number;
  afterLineDiscount: number;
  promotionDiscount: number;
  manualDiscount: number;
  tax: number;
  total: number;
  itemCount: number;
  totalQuantity: number;
}

export interface CalculateTotalsInput {
  lines: CartLine[];
  /** Voucher or promo codes entered at checkout. */
  promotions?: AppliedPromotion[];
  /** Manual discount entered by the cashier, integer rupiah. */
  manualDiscount?: number;
  /** Tax rate as a fraction, e.g. 0.11 for 11%. Omit or 0 for no tax. */
  taxRate?: number;
}

/** Integer rupiah subtotal for one line, after its own discount. */
export function lineSubtotal(line: CartLine): number {
  const gross = line.unitPrice * line.quantity;
  const discount = clampDiscount(line.lineDiscount ?? 0, gross);
  return gross - discount;
}

/** Total for all lines before order-level discounts. */
export function cartSubtotal(lines: CartLine[]): number {
  return lines.reduce((total, line) => total + lineSubtotal(line), 0);
}

/**
 * Computes every total the POS and receipt display.
 *
 * Order of operations is fixed and deliberate:
 *   1. line subtotals (quantity × price, minus per-line discount)
 *   2. promotional discounts, applied to the discounted subtotal
 *   3. manual discount, applied last so it can never exceed what is owed
 *   4. tax, computed on the post-discount amount
 *
 * Applying tax after discounts avoids charging tax on an amount the customer
 * did not pay.
 */
export function calculateTotals({
  lines,
  promotions = [],
  manualDiscount = 0,
  taxRate = 0,
}: CalculateTotalsInput): CartTotals {
  const subtotal = cartSubtotal(lines);
  const lineDiscountTotal = lines.reduce(
    (total, line) =>
      total +
      clampDiscount(line.lineDiscount ?? 0, line.unitPrice * line.quantity),
    0,
  );

  const afterLineDiscount = subtotal;

  // Promotions and the manual discount compete for the same amount, so they are
  // summed then clamped as a group — a voucher can never push the total below
  // zero even if both are applied.
  const requestedPromotionDiscount = promotions.reduce(
    (total, promotion) => total + promotion.discountAmount,
    0,
  );

  const promotionDiscount = Math.min(
    Math.max(0, Math.round(requestedPromotionDiscount)),
    afterLineDiscount,
  );

  const appliedManualDiscount = clampDiscount(
    manualDiscount,
    afterLineDiscount - promotionDiscount,
  );

  const taxable = afterLineDiscount - promotionDiscount - appliedManualDiscount;
  const tax = Math.round(taxable * taxRate);

  return {
    subtotal,
    lineDiscountTotal,
    afterLineDiscount,
    promotionDiscount,
    manualDiscount: appliedManualDiscount,
    tax,
    total: taxable + tax,
    itemCount: lines.length,
    totalQuantity: lines.reduce((total, line) => total + line.quantity, 0),
  };
}

/**
 * Never allows a discount to exceed the amount it discounts, and never returns
 * a negative value — a discount larger than the total is clamped, not rejected,
 * so a cashier cannot accidentally produce a payable negative total.
 */
function clampDiscount(discount: number, against: number): number {
  if (!Number.isFinite(discount) || discount <= 0) return 0;
  return Math.min(Math.round(discount), Math.max(0, Math.round(against)));
}

/**
 * Change due for a cash payment.
 *
 * Returns the shortfall instead of a negative number when the customer
 * underpays, so the caller can render "kurang Rp…" rather than "kembalian
 * -Rp…", which reads as a bug.
 */
export function calculateChange(
  total: number,
  amountPaid: number,
): { change: number; shortfall: number; isSufficient: boolean } {
  const difference = amountPaid - total;

  if (difference < 0) {
    return { change: 0, shortfall: Math.abs(difference), isSufficient: false };
  }

  return { change: difference, shortfall: 0, isSufficient: true };
}

/**
 * Denominations offered as quick cash buttons.
 *
 * Only values at or above the total are suggested, and the list always ends with
 * an exact amount, so a cashier can always settle the payment in one tap.
 */
export function suggestCashAmounts(
  total: number,
): Array<{ label: string; amount: number }> {
  const denominations = [
    1000, 2000, 5000, 10000, 20000, 50000, 100000, 150000, 200000, 500000,
  ];

  const useful = denominations.filter((value) => value >= total).slice(0, 3);

  // Round up to the next 10k so the suggestion is an easy figure to hand over.
  const roundedUp = Math.ceil(total / 10_000) * 10_000;

  if (roundedUp >= total && !useful.includes(roundedUp)) {
    useful.push(roundedUp);
  }

  return useful.map((amount) => ({
    label: amount === total ? "Uang pas" : `Rp${amount / 1000}rb`,
    amount,
  }));
}

/**
 * Validates the cart before checkout.
 *
 * Returns every problem at once so the cashier can fix them in a single pass
 * instead of discovering them one at a time.
 */
export function validateCart(
  lines: CartLine[],
): Array<{ productId: string; message: string }> {
  const problems: Array<{ productId: string; message: string }> = [];

  if (lines.length === 0) {
    return problems;
  }

  const seen = new Set<string>();

  for (const line of lines) {
    if (seen.has(line.productId)) {
      problems.push({
        productId: line.productId,
        message: `${line.name} muncul lebih dari sekali di keranjang.`,
      });
    }
    seen.add(line.productId);

    if (!Number.isInteger(line.quantity) || line.quantity < 1) {
      problems.push({
        productId: line.productId,
        message: `Jumlah untuk ${line.name} harus minimal 1.`,
      });
    }

    if (line.unitPrice < 0) {
      problems.push({
        productId: line.productId,
        message: `Harga ${line.name} tidak valid.`,
      });
    }

    if (line.quantity > line.availableStock) {
      problems.push({
        productId: line.productId,
        message: `Stok ${line.name} tidak mencukupi. Diminta ${line.quantity}, tersedia ${line.availableStock}.`,
      });
    }
  }

  return problems;
}

/**
 * Adds an item to the cart, merging quantities when the product is present.
 *
 * Refuses to exceed available stock rather than clamping silently, so the UI
 * can explain why the quantity did not change.
 */
export function addToCart(
  lines: CartLine[],
  incoming: CartLine,
): { lines: CartLine[]; error?: string } {
  const existing = lines.find(
    (line) => line.productId === incoming.productId,
  );

  const requestedQuantity = (existing?.quantity ?? 0) + incoming.quantity;

  if (requestedQuantity > incoming.availableStock) {
    return {
      lines,
      error: `Stok ${incoming.name} tidak mencukupi. Tersedia ${incoming.availableStock}.`,
    };
  }

  if (!existing) {
    return { lines: [...lines, { ...incoming, quantity: incoming.quantity }] };
  }

  return {
    lines: lines.map((line) =>
      line.productId === incoming.productId
        ? { ...line, quantity: requestedQuantity, availableStock: incoming.availableStock }
        : line,
    ),
  };
}

/** Changes a line's quantity. A quantity of zero or less removes the line. */
export function setQuantity(
  lines: CartLine[],
  productId: string,
  quantity: number,
): { lines: CartLine[]; error?: string } {
  if (!Number.isInteger(quantity) || quantity < 0) {
    return { lines, error: "Jumlah harus berupa bilangan bulat positif." };
  }

  if (quantity === 0) {
    return { lines: lines.filter((line) => line.productId !== productId) };
  }

  const line = lines.find((entry) => entry.productId === productId);

  if (!line) {
    return { lines, error: "Produk tidak ada di keranjang." };
  }

  if (quantity > line.availableStock) {
    return {
      lines,
      error: `Stok ${line.name} tidak mencukupi. Tersedia ${line.availableStock}.`,
    };
  }

  return {
    lines: lines.map((entry) =>
      entry.productId === productId ? { ...entry, quantity } : entry,
    ),
  };
}

/** Loyalty points earned for a total, given a configurable ratio. */
export function calculatePoints(
  total: number,
  ratio: number,
): number {
  if (ratio <= 0 || total <= 0) return 0;
  return Math.floor(total / ratio);
}

/** Value of a member's points, in integer rupiah. */
export function pointsToValue(points: number, valuePerPoint: number): number {
  if (points <= 0 || valuePerPoint <= 0) return 0;
  // Floor, so redeeming can never hand out slightly more than the store owes.
  return Math.floor(points * valuePerPoint);
}