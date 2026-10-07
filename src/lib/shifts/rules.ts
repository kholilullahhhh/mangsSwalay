/**
 * Cash shift arithmetic.
 *
 * Pure so the variance calculation can be tested directly. Getting this wrong
 * is how a store ends up unable to explain why the till does not balance, so
 * every component is named and individually verifiable.
 */

export interface ShiftComponents {
  openingCash: number;
  /** Cash sales settled during the shift. */
  cashSales: number;
  /** Cash refunds paid out during the shift. */
  cashRefunds: number;
  /** Manual cash-in (float top-ups, change from the office). */
  cashIn: number;
  /** Manual cash-out (petty cash, supplier runs). */
  cashOut: number;
}

/**
 * Cash the drawer should hold when the shift closes.
 *
 * Non-cash sales are deliberately excluded: a QRIS payment never entered the
 * drawer, so counting it would invent money that is not there.
 */
export function expectedCash(components: ShiftComponents): number {
  return (
    components.openingCash +
    components.cashSales -
    components.cashRefunds +
    components.cashIn -
    components.cashOut
  );
}

export interface ShiftVariance {
  expected: number;
  actual: number;
  /** Signed: negative means the drawer is short. */
  variance: number;
  direction: "balanced" | "over" | "short";
  requiresExplanation: boolean;
}

/**
 * Compares counted cash against the expected balance.
 *
 * A small tolerance absorbs coin-rounding noise; anything larger is flagged as
 * needing an explanation so it lands in the audit trail.
 */
export function calculateVariance(
  components: ShiftComponents,
  actualCash: number,
  tolerance = 500,
): ShiftVariance {
  const expected = expectedCash(components);
  const variance = actualCash - expected;

  return {
    expected,
    actual: actualCash,
    variance,
    direction:
      variance > tolerance ? "over" : variance < -tolerance ? "short" : "balanced",
    requiresExplanation: Math.abs(variance) > tolerance,
  };
}

export function describeVariance(variance: ShiftVariance): string {
  if (variance.direction === "balanced") {
    return "Kasin sesuai. Tidak ada selisih.";
  }

  const amount = Math.abs(variance.variance);

  return variance.direction === "short"
    ? "Kasin kurang Rp" + amount.toLocaleString("id-ID") + "."
    : "Kasin lebih Rp" + amount.toLocaleString("id-ID") + ".";
}

/** Common reasons offered when a variance has to be explained. */
export const VARIANCE_REASONS = [
  "Selisih pembulatan koin",
  "Uang salah kembalian",
  "Kurang saat mulai shift",
  "Kelebihan saat mulai shift",
  "Barang hilang / dicuri",
  " salah input kasir",
  "Lainnya",
] as const;

/**
 * Reasons that are acceptable without further investigation.
 *
 * Anything else should trigger a review, so the list is deliberately short.
 */
export const MINOR_VARIANCE_REASONS = [
  "Selisih pembulatan koin",
  "Uang salah kembalian",
  "Lainnya",
] as const;

export function isMinorVariance(reason: string): boolean {
  return (MINOR_VARIANCE_REASONS as readonly string[]).includes(reason.trim());
}

export function validateClosingCash(
  actualCash: number,
  tolerance = 500,
): { valid: boolean; error?: string } {
  if (!Number.isFinite(actualCash) || actualCash < 0) {
    return { valid: false, error: "Jumlah kas aktual harus angka dan tidak boleh negatif." };
  }

  if (!Number.isInteger(actualCash)) {
    return { valid: false, error: "Jumlah kas harus bilangan bulat." };
  }

  void tolerance;
  return { valid: true };
}
