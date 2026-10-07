import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatDate } from "@/lib/format";

/** Date-range presets shared by every report screen. */
export const RANGE_PRESETS = [
  { value: "today", label: "Hari ini" },
  { value: "yesterday", label: "Kemarin" },
  { value: "week", label: "7 hari" },
  { value: "month", label: "Bulan ini" },
  { value: "30d", label: "30 hari" },
  { value: "90d", label: "90 hari" },
  { value: "365d", label: "1 tahun" },
] as const;

/**
 * Range filter rendered as links, so switching period works without JavaScript
 * and the current selection lives in the URL.
 */
export function RangeFilter({
  active,
  basePath,
}: {
  active: string;
  basePath: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      {RANGE_PRESETS.map((preset) => (
        <Button
          key={preset.value}
          asChild
          size="sm"
          variant={active === preset.value ? "secondary" : "ghost"}
        >
          <Link
            href={
              basePath +
              (preset.value === "365d" ? "" : "?range=" + preset.value)
            }
          >
            {preset.label}
          </Link>
        </Button>
      ))}

      <form className="flex items-center gap-1" action={basePath}>
        <input type="date" name="from" aria-label="Dari tanggal" className="h-9 rounded-md border border-input bg-transparent px-2 text-sm" />
        <span className="text-xs text-muted-foreground">s/d</span>
        <input type="date" name="to" aria-label="Sampai tanggal" className="h-9 rounded-md border border-input bg-transparent px-2 text-sm" />
        <input type="hidden" name="range" value="custom" />
        <Button type="submit" size="sm" variant="outline">
          Terapkan
        </Button>
      </form>
    </div>
  );
}

/** Headline metric tile used across the report screens. */
export function MetricTile({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "positive" | "negative";
}) {
  const toneClass =
    tone === "positive"
      ? "text-stock-ok"
      : tone === "negative"
        ? "text-stock-out"
        : "";

  return (
    <Card className="p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={"tabular mt-1 text-xl font-semibold " + toneClass}>{value}</p>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </Card>
  );
}

/** Shared report header with title, resolved period, and optional export. */
export function ReportHeader({
  title,
  subtitle,
  range,
  basePath,
  activePreset,
  exportHref,
}: {
  title: string;
  subtitle: string;
  range: { from: Date; to: Date; label: string };
  basePath: string;
  activePreset: string;
  exportHref?: string;
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
          <p className="text-sm text-muted-foreground">{subtitle}</p>
          <p className="text-xs text-muted-foreground">
            Periode: {range.label} · {formatDate(range.from)} -{" "}
            {formatDate(range.to)}
          </p>
        </div>

        {exportHref ? (
          <Button variant="outline" size="sm" asChild>
            <a href={exportHref} download>
              Export CSV
            </a>
          </Button>
        ) : null}
      </div>

      <RangeFilter active={activePreset} basePath={basePath} />
    </div>
  );
}
