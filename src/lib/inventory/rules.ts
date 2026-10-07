/**
 * Stock adjustment and opname (physical count) rules.
 *
 * Pure functions so both can be tested without a database, and so the UI can
 * preview a calculation using the exact arithmetic the server will apply.
 */

/** Reasons an operator may give for a manual stock correction. */
export const ADJUSTMENT_REASONS = [
  { value: "DAMAGED", label: "Barang rusak" },
  { value: "LOST", label: "Barang hilang" },
  { value: "EXPIRED", label: "Barang kadaluarsa" },
  { value: "MISINPUT", label: "Kesalahan input" },
  { value: "OPNAME", label: "Stock opname" },
  { value: "RETURN_TO_SUPPLIER", label: "Dikembalikan ke supplier" },
  { value: "OTHER", label: "Lainnya" },
] as const;

export type AdjustmentReason = (typeof ADJUSTMENT_REASONS)[number]["value"];

export const ADJUSTMENT_REASON_LABEL: Record<string, string> =
  Object.fromEntries(
    ADJUSTMENT_REASONS.map((reason) => [reason.value, reason.label]),
  );

/**
 * Maps an adjustment reason to the ledger movement type.
 *
 * Damage and expiry are distinct from a generic correction so the ledger can be
 * filtered by cause — "how much did we write off to breakage this month" is a
 * question the report needs to answer.
 */
export function movementTypeForReason(
  reason: AdjustmentReason,
):
  | "ADJUSTMENT_IN"
  | "ADJUSTMENT_OUT"
  | "DAMAGED"
  | "EXPIRED"
  | "RETURN_PURCHASE" {
  switch (reason) {
    case "DAMAGED":
      return "DAMAGED";
    case "EXPIRED":
      return "EXPIRED";
    case "RETURN_TO_SUPPLIER":
      return "RETURN_PURCHASE";
    default:
      return "ADJUSTMENT_OUT";
  }
}

export interface AdjustmentLine {
  productId: string;
  productName: string;
  /** Stock recorded in the system before the correction. */
  systemStock: number;
  /** Counted or measured stock. */
  actualStock: number;
  /** Integer rupiah, used to value the difference. */
  unitCost: number;
}

export interface AdjustmentPreviewLine extends AdjustmentLine {
  /** actualStock - systemStock. Negative means stock leaves. */
  difference: number;
  /** difference × unitCost. Negative means inventory value written down. */
  valueDifference: number;
  direction: "IN" | "OUT" | "NONE";
}

/**
 * Computes the difference for one adjusted line.
 *
 * A line with no difference is reported as NONE so the caller can skip it
 * entirely — writing a zero-quantity ledger row would be noise that makes the
 * audit trail harder to read.
 */
export function previewAdjustment(line: AdjustmentLine): AdjustmentPreviewLine {
  const difference = line.actualStock - line.systemStock;

  return {
    ...line,
    difference,
    valueDifference: difference * line.unitCost,
    direction: difference === 0 ? "NONE" : difference > 0 ? "IN" : "OUT",
  };
}

export interface AdjustmentSummary {
  lines: AdjustmentPreviewLine[];
  changedCount: number;
  totalIncrease: number;
  totalDecrease: number;
  netValueDifference: number;
  /** True when any line would drive stock below zero. */
  hasInvalidLine: boolean;
  invalidProductIds: string[];
}

export function summariseAdjustment(
  lines: AdjustmentLine[],
): AdjustmentSummary {
  const previews = lines.map(previewAdjustment);

  const invalidProductIds = previews
    .filter((line) => line.actualStock < 0)
    .map((line) => line.productId);

  return {
    lines: previews,
    changedCount: previews.filter((line) => line.direction !== "NONE").length,
    totalIncrease: previews
      .filter((line) => line.difference > 0)
      .reduce((sum, line) => sum + line.difference, 0),
    totalDecrease: Math.abs(
      previews
        .filter((line) => line.difference < 0)
        .reduce((sum, line) => sum + line.difference, 0),
    ),
    netValueDifference: previews.reduce(
      (sum, line) => sum + line.valueDifference,
      0,
    ),
    hasInvalidLine: invalidProductIds.length > 0,
    invalidProductIds,
  };
}

// ── Stock opname ───────────────────────────────────────────────────────────

export interface OpnameLineInput {
  productId: string;
  productName: string;
  /** Stock the system believed, captured when the session was created. */
  systemStock: number;
  /** What the operator physically counted. Null until counted. */
  physicalStock: number | null;
  unitCost: number;
}

export interface OpnameLinePreview extends OpnameLineInput {
  difference: number | null;
  valueDifference: number | null;
  status: "PENDING" | "MATCHED" | "DIFFERENT";
  /** Convenience flag mirroring `difference` sign; NONE when zero or uncounted. */
  direction: "IN" | "OUT" | "NONE";
}

export function previewOpnameLine(line: OpnameLineInput): OpnameLinePreview {
  if (line.physicalStock === null) {
    return {
      ...line,
      difference: null,
      valueDifference: null,
      status: "PENDING",
      direction: "NONE",
    };
  }

  const difference = line.physicalStock - line.systemStock;

  return {
    ...line,
    difference,
    valueDifference: difference * line.unitCost,
    status: difference === 0 ? "MATCHED" : "DIFFERENT",
    direction: difference === 0 ? "NONE" : difference > 0 ? "IN" : "OUT",
  };
}

export interface OpnameSummary {
  lines: OpnameLinePreview[];
  totalLines: number;
  countedLines: number;
  pendingLines: number;
  matchedLines: number;
  differentLines: number;
  /** Unit gain across all counted lines. */
  totalIncrease: number;
  /** Unit loss across all counted lines. */
  totalDecrease: number;
  /** Absolute rupiah value of the discrepancies. */
  absoluteValueDifference: number;
  /** Fraction of lines counted, 0-100. */
  progress: number;
  /** True once every line has been counted and at least one differs. */
  readyForApproval: boolean;
}

export function summariseOpname(lines: OpnameLineInput[]): OpnameSummary {
  const previews = lines.map(previewOpnameLine);

  const counted = previews.filter((line) => line.physicalStock !== null);
  const different = previews.filter((line) => line.status === "DIFFERENT");

  const totalLines = previews.length;
  const countedLines = counted.length;

  return {
    lines: previews,
    totalLines,
    countedLines,
    pendingLines: totalLines - countedLines,
    matchedLines: previews.filter((line) => line.status === "MATCHED").length,
    differentLines: different.length,
    totalIncrease: previews.reduce(
      (sum, line) => sum + (line.difference && line.difference > 0 ? line.difference : 0),
      0,
    ),
    totalDecrease: Math.abs(
      previews.reduce(
        (sum, line) => sum + (line.difference && line.difference < 0 ? line.difference : 0),
        0,
      ),
    ),
    absoluteValueDifference: previews.reduce(
      (sum, line) => sum + Math.abs(line.valueDifference ?? 0),
      0,
    ),
    progress:
      totalLines === 0 ? 0 : Math.round((countedLines / totalLines) * 100),
    // Every line must be counted, and at least one must actually differ —
    // approving a no-op session would just add ledger noise.
    readyForApproval: totalLines > 0 && countedLines === totalLines && different.length > 0,
  };
}

/** Human-readable summary used in confirmations and the audit log. */
export function describeOpnameSummary(summary: OpnameSummary): string {
  if (summary.countedLines === 0) {
    return "Belum ada barang yang dihitung.";
  }

  const parts = [
    `${summary.matchedLines} cocok`,
    `${summary.differentLines} berbeda`,
  ];

  if (summary.totalIncrease > 0) parts.push(`+${summary.totalIncrease} unit lebih`);
  if (summary.totalDecrease > 0) parts.push(`${summary.totalDecrease} unit kurang`);

  return parts.join(", ");
}