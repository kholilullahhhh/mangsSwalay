import type { PurchaseStatus } from "@/generated/prisma/enums";

/**
 * Purchase order state machine.
 *
 * Extracted as pure functions so the workflow rules can be tested exhaustively
 * without a database, and so the same rules are consulted by the UI (to decide
 * which buttons to show) and by the server action (to enforce them).
 *
 * The important invariant: **stock only increases on RECEIVED.** A DRAFT or
 * ORDERED purchase is an intention to buy, not a delivery. Allowing stock to
 * rise at draft time would let a purchase order that is later cancelled
 * silently inflate inventory.
 */

export const PURCHASE_TRANSITIONS: Record<
  PurchaseStatus,
  readonly PurchaseStatus[]
> = {
  // Draft can be sent to the supplier, or abandoned.
  DRAFT: ["ORDERED", "CANCELLED"],
  // Once ordered, the goods are committed — cancelling means returning them,
  // which is a different flow, so it is not offered here.
  ORDERED: ["RECEIVED", "CANCELLED"],
  // Goods are in. COMPLETED just closes the paperwork (settled payment).
  RECEIVED: ["COMPLETED"],
  // Terminal states.
  COMPLETED: [],
  CANCELLED: [],
};

/** Statuses in which no further transition is possible. */
export const TERMINAL_STATUSES: readonly PurchaseStatus[] = [
  "COMPLETED",
  "CANCELLED",
];

export function canTransition(
  from: PurchaseStatus,
  to: PurchaseStatus,
): boolean {
  return PURCHASE_TRANSITIONS[from].includes(to);
}

/**
 * Validates a transition, throwing a message suitable for showing to a user.
 *
 * Used by the server action so an out-of-order transition fails loudly rather
 * than silently doing nothing.
 */
export function assertTransition(
  from: PurchaseStatus,
  to: PurchaseStatus,
): void {
  if (from === to) {
    throw new PurchaseTransitionError(
      `Pembelian sudah berstatus ${to}.`,
    );
  }

  if (!canTransition(from, to)) {
    const allowed = PURCHASE_TRANSITIONS[from];

    throw new PurchaseTransitionError(
      allowed.length === 0
        ? `Pembelian berstatus ${from} tidak dapat diubah lagi.`
        : `Tidak bisa mengubah status dari ${from} ke ${to}. Pilihan yang tersedia: ${allowed.join(", ")}.`,
    );
  }
}

/** Next statuses reachable from the current one, for rendering action buttons. */
export function nextStatuses(from: PurchaseStatus): readonly PurchaseStatus[] {
  return PURCHASE_TRANSITIONS[from];
}

/** Whether stock should be increased when entering this status. */
export function statusAffectsStock(to: PurchaseStatus): boolean {
  return to === "RECEIVED";
}

/** Whether the purchase counts as a completed payable obligation. */
export function isSettled(status: PurchaseStatus): boolean {
  return status === "COMPLETED" || status === "CANCELLED";
}

export class PurchaseTransitionError extends Error {
  readonly code = "INVALID_TRANSITION";

  constructor(message: string) {
    super(message);
    this.name = "PurchaseTransitionError";
  }
}

/** Human-readable status labels for the UI. */
export const PURCHASE_STATUS_LABEL: Record<PurchaseStatus, string> = {
  DRAFT: "Draft",
  ORDERED: "Dipesan",
  RECEIVED: "Diterima",
  COMPLETED: "Selesai",
  CANCELLED: "Dibatalkan",
};

/** Badge variant per status, so colours stay consistent across the app. */
export const PURCHASE_STATUS_VARIANT: Record<
  PurchaseStatus,
  "outline" | "secondary" | "default" | "destructive"
> = {
  DRAFT: "outline",
  ORDERED: "secondary",
  RECEIVED: "default",
  COMPLETED: "secondary",
  CANCELLED: "destructive",
};

/**
 * Derives the payment status from the amounts paid and the grand total.
 *
 * Kept here so the stored column is always recomputed from source values
 * rather than trusted from client input.
 */
export function derivePaymentStatus(
  grandTotal: number,
  amountPaid: number,
): "UNPAID" | "PARTIAL" | "PAID" {
  if (amountPaid <= 0) return "UNPAID";
  if (amountPaid >= grandTotal) return "PAID";
  return "PARTIAL";
}

export interface PurchaseTotalLine {
  productId: string;
  quantity: number;
  purchasePrice: number;
}

export interface PurchaseTotals {
  subtotal: number;
  discount: number;
  tax: number;
  shippingCost: number;
  grandTotal: number;
}

/**
 * Computes purchase header totals from its lines.
 *
 * Pure so it can be unit tested without a database and so the preview total in
 * the purchase form uses exactly the same arithmetic the server applies on
 * save. Grand total is floored at zero: a discount larger than the goods value
 * is clamped rather than producing a negative payable.
 */
export function computePurchaseTotals(
  lines: PurchaseTotalLine[],
  options: { discount?: number; tax?: number; shippingCost?: number } = {},
): PurchaseTotals {
  const subtotal = lines.reduce(
    (total, line) => total + line.quantity * line.purchasePrice,
    0,
  );

  const discount = Math.max(0, options.discount ?? 0);
  const tax = Math.max(0, options.tax ?? 0);
  const shippingCost = Math.max(0, options.shippingCost ?? 0);

  const grandTotal = Math.max(0, subtotal - discount + tax + shippingCost);

  return { subtotal, discount, tax, shippingCost, grandTotal };
}