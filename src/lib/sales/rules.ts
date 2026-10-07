/**
 * Sale void and refund rules.
 *
 * Pure functions so the eligibility logic and the money arithmetic can be tested
 * exhaustively without a database, and so the UI can explain *why* an action is
 * unavailable instead of hiding the button and leaving the operator guessing.
 */

export type SaleState = "COMPLETED" | "VOID" | "REFUNDED" | "PARTIALLY_REFUNDED";

export interface RefundableItem {
  saleItemId: string;
  productId: string;
  name: string;
  quantity: number;
  /** Already returned in previous refunds. */
  returnedQty: number;
  /** Integer rupiah charged for the line. */
  subtotal: number;
  /** Integer rupiah already refunded against this line. */
  refundedAmount?: number;
}

/** How much of a line can still be returned. */
export function remainingReturnable(item: RefundableItem): number {
  return Math.max(0, item.quantity - item.returnedQty);
}

/** Evenly divided unit value, used for display and for partial refunds. */
export function unitValueOf(item: RefundableItem): number {
  if (item.quantity <= 0) return 0;
  return Math.floor(item.subtotal / item.quantity);
}

/**
 * Value of returning `quantity` more units of a line.
 *
 * Derived from the line's own subtotal rather than today's selling price, so a
 * price change after the sale cannot alter what the customer is refunded.
 *
 * When a line's subtotal does not divide evenly by its quantity (common when a
 * discount is spread across units), a naive per-unit split overpays: ten refunds
 * of one unit each would exceed the amount actually charged. So the remainder is
 * absorbed by whichever refund completes the line, and that refund pays
 * whatever is left rather than a pro-rata share. The sum of every refund against
 * a line therefore always equals its subtotal exactly.
 */
export function refundValueFor(item: RefundableItem, quantity: number): number {
  if (item.quantity <= 0 || quantity <= 0) return 0;

  const alreadyRefunded = item.refundedAmount ?? 0;
  const remaining = remainingReturnable(item);

  if (quantity >= remaining) {
    // Completes the line: pay the exact outstanding balance.
    return Math.max(0, item.subtotal - alreadyRefunded);
  }

  const perUnit = unitValueOf(item);

  // Never let a partial refund exceed the outstanding balance.
  const proRata = perUnit * quantity;

  return Math.min(proRata, Math.max(0, item.subtotal - alreadyRefunded));
}

export interface RefundLineInput {
  saleItemId: string;
  quantity: number;
  condition: "GOOD" | "DAMAGED";
}

export interface RefundPlanLine {
  saleItemId: string;
  productId: string;
  name: string;
  quantity: number;
  condition: "GOOD" | "DAMAGED";
  amount: number;
}

export interface RefundPlan {
  lines: RefundPlanLine[];
  totalRefund: number;
  /** Items returned in sellable condition, which go back onto the shelf. */
  restockLines: Array<{ productId: string; quantity: number }>;
  /** Items too damaged to sell again; stock is deliberately not restored. */
  damagedLines: Array<{ productId: string; quantity: number }>;
  errors: string[];
  newStatus: SaleState;
}

/**
 * Builds a refund plan.
 *
 * A damaged return does NOT go back into sellable stock: putting it back on the
 * shelf would let a customer buy something already broken. Those units are
 * recorded on the refund as write-offs instead, which keeps the shrinkage
 * visible in reports without inflating inventory.
 */
export function planRefund(
  items: RefundableItem[],
  requested: RefundLineInput[],
  currentStatus: SaleState,
): RefundPlan {
  const errors: string[] = [];
  const lines: RefundPlanLine[] = [];
  const restockLines: Array<{ productId: string; quantity: number }> = [];
  const damagedLines: Array<{ productId: string; quantity: number }> = [];

  if (currentStatus === "VOID") {
    errors.push(
      "Transaksi sudah void. Stok sudah dikembalikan sehingga retur tidak dapat diproses.",
    );
  }

  if (requested.length === 0) {
    errors.push("Pilih minimal satu barang untuk diretur.");
  }

  const seen = new Set<string>();

  for (const request of requested) {
    if (seen.has(request.saleItemId)) {
      errors.push("Barang yang sama tercatat lebih dari sekali.");
      continue;
    }
    seen.add(request.saleItemId);

    const item = items.find((entry) => entry.saleItemId === request.saleItemId);

    if (!item) {
      errors.push("Barang tidak ditemukan pada transaksi ini.");
      continue;
    }

    const remaining = remainingReturnable(item);

    if (request.quantity <= 0) {
      errors.push("Jumlah retur harus minimal 1.");
      continue;
    }

    if (request.quantity > remaining) {
      errors.push(
        remaining === 0
          ? item.name + " sudah diretur seluruhnya."
          : item.name + " hanya tersisa " + remaining + " unit yang dapat diretur.",
      );
      continue;
    }

    const amount = refundValueFor(item, request.quantity);

    lines.push({
      saleItemId: item.saleItemId,
      productId: item.productId,
      name: item.name,
      quantity: request.quantity,
      condition: request.condition,
      amount,
    });

    const bucket = request.condition === "GOOD" ? restockLines : damagedLines;
    const existing = bucket.find((entry) => entry.productId === item.productId);

    if (existing) {
      existing.quantity += request.quantity;
    } else {
      bucket.push({ productId: item.productId, quantity: request.quantity });
    }
  }

  const totalRefund = lines.reduce((sum, line) => sum + line.amount, 0);

  // Status is derived from how much of the sale has been returned.
  const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);
  const totalReturned = items.reduce((sum, item) => sum + item.returnedQty, 0);
  const newReturned =
    totalReturned + lines.reduce((sum, line) => sum + line.quantity, 0);

  const newStatus: SaleState =
    newReturned >= totalQuantity ? "REFUNDED" : "PARTIALLY_REFUNDED";

  return {
    lines,
    totalRefund,
    restockLines,
    damagedLines,
    errors,
    newStatus,
  };
}

/**
 * Whether a sale can be voided.
 *
 * Void is the blunt instrument: it reverses the whole transaction and returns
 * every unit to stock. Once any refund exists the numbers would disagree, so a
 * partial refund is the only correct path from that point on.
 */
export function canVoid(status: SaleState, hasRefunds: boolean): boolean {
  if (hasRefunds) return false;
  return status === "COMPLETED";
}

/** Reason a void is unavailable, shown instead of a silently disabled button. */
export function voidBlockReason(
  status: SaleState,
  hasRefunds: boolean,
): string | null {
  if (hasRefunds) {
    return "Transaksi ini sudah memiliki retur. Gunakan retur sebagian untuk koreksi.";
  }

  if (status === "VOID") {
    return "Transaksi sudah dibatalkan.";
  }

  if (status === "REFUNDED") {
    return "Seluruh barang sudah diretur. Tidak ada yang perlu dibatalkan.";
  }

  return null;
}

/** Whether a further refund is possible at all. */
export function canRefund(
  status: SaleState,
  items: RefundableItem[],
): boolean {
  if (status === "VOID" || status === "REFUNDED") return false;
  return items.some((item) => remainingReturnable(item) > 0);
}

export function refundBlockReason(
  status: SaleState,
  items: RefundableItem[],
): string | null {
  if (status === "VOID") {
    return "Transaksi sudah void. Stok sudah dikembalikan otomatis.";
  }

  if (status === "REFUNDED") {
    return "Seluruh barang pada transaksi ini sudah diretur.";
  }

  if (!items.some((item) => remainingReturnable(item) > 0)) {
    return "Tidak ada barang yang masih dapat diretur.";
  }

  return null;
}

export const SALE_STATUS_LABEL: Record<SaleState, string> = {
  COMPLETED: "Selesai",
  VOID: "Void",
  REFUNDED: "Diretur",
  PARTIALLY_REFUNDED: "Retur Sebagian",
};

export const SALE_STATUS_VARIANT: Record<
  SaleState,
  "outline" | "secondary" | "destructive"
> = {
  COMPLETED: "outline",
  VOID: "destructive",
  REFUNDED: "secondary",
  PARTIALLY_REFUNDED: "secondary",
};
