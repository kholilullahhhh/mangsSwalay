import { cn } from "@/lib/utils";
import { formatNumber } from "@/lib/format";

/**
 * Stock level badge.
 *
 * Three states, matching the spec's alert rules:
 * - `out`  stock === 0                → out of stock
 * - `low`  stock <= minStock          → needs restock
 * - `ok`   stock >  minStock          → healthy
 *
 * Colour is paired with text so the state is not conveyed by hue alone.
 */
export function StockBadge({
  stock,
  minStock,
  unit,
  className,
}: {
  stock: number;
  minStock: number;
  unit?: string;
  className?: string;
}) {
  const state = getStockState(stock, minStock);

  const styles = {
    ok: "border-transparent bg-stock-ok/12 text-stock-ok",
    low: "border-transparent bg-stock-low/18 text-stock-low",
    out: "border-transparent bg-stock-out/12 text-stock-out",
  } as const;

  const labels = {
    ok: "Aman",
    low: "Menipis",
    out: "Habis",
  } as const;

  return (
    <span
      className={cn(
        "inline-flex items-baseline gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium tabular",
        styles[state],
        className,
      )}
    >
      {formatNumber(stock)}
      {unit ? <span className="text-[10px] opacity-70">{unit}</span> : null}
      <span className="sr-only">
        {labels[state]}
        {state !== "ok" ? `, minimum ${minStock}` : ""}
      </span>
    </span>
  );
}

export type StockState = "ok" | "low" | "out";

export function getStockState(stock: number, minStock: number): StockState {
  if (stock <= 0) return "out";
  if (minStock > 0 && stock <= minStock) return "low";
  return "ok";
}

/** Human-readable label for a stock state, for tooltips and legends. */
export const STOCK_STATE_LABEL: Record<StockState, string> = {
  ok: "Stok aman",
  low: "Perlu restock",
  out: "Stok habis",
};

/** Percentage of the minimum threshold remaining, clamped to 0-100. */
export function stockRatio(stock: number, minStock: number): number {
  if (minStock <= 0) return 100;
  return Math.max(0, Math.min(100, Math.round((stock / minStock) * 100)));
}