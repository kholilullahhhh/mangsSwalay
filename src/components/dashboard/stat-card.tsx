import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Minus,
} from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export interface StatCardProps {
  label: string;
  value: string;
  icon: LucideIcon;
  /** Optional percentage delta against the previous period. */
  change?: { text: string; direction: "up" | "down" | "flat" } | null;
  /** Whether an upward change is good. Revenue up = good; expenses up = bad. */
  upIsGood?: boolean;
  hint?: string;
  href?: string;
  loading?: boolean;
}

/**
 * Single metric tile.
 *
 * Intentionally not every figure gets a card — the dashboard uses cards for
 * headline numbers and plain rows for supporting detail, so the page keeps a
 * clear hierarchy instead of becoming a wall of boxes.
 */
export function StatCard({
  label,
  value,
  icon: Icon,
  change,
  upIsGood = true,
  hint,
  href,
  loading = false,
}: StatCardProps) {
  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-start justify-between gap-4 p-5">
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="h-7 w-32" />
            <Skeleton className="h-3 w-20" />
          </div>
          <Skeleton className="size-10 rounded-lg" />
        </CardContent>
      </Card>
    );
  }

  const ChangeIcon =
    change?.direction === "up"
      ? ArrowUpRight
      : change?.direction === "down"
        ? ArrowDownRight
        : Minus;

  // Colour reflects business meaning, not just arithmetic: rising expenses are
  // red even though the number went up.
  const isGood = change
    ? change.direction === "flat"
      ? null
      : (change.direction === "up") === upIsGood
    : null;

  const body = (
    <CardContent className="flex items-start justify-between gap-4 p-5">
      <div className="min-w-0 space-y-1.5">
        <p className="truncate text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </p>

        <p className="tabular text-2xl font-semibold tracking-tight">
          {value}
        </p>

        {change ? (
          <p
            className={[
              "inline-flex items-center gap-1 text-xs font-medium",
              isGood === null
                ? "text-muted-foreground"
                : isGood
                  ? "text-stock-ok"
                  : "text-destructive",
            ].join(" ")}
          >
            <ChangeIcon className="size-3.5" aria-hidden />
            {change.text}
            {hint ? <span className="text-muted-foreground">{hint}</span> : null}
          </p>
        ) : hint ? (
          <p className="text-xs text-muted-foreground">{hint}</p>
        ) : null}
      </div>

      <span
        className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-300"
        aria-hidden
      >
        <Icon className="size-5" />
      </span>
    </CardContent>
  );

  if (href) {
    return (
      <Card className="transition-shadow hover:shadow-md focus-within:ring-2 focus-within:ring-ring">
        <a href={href} className="block rounded-xl focus-visible:outline-none">
          {body}
        </a>
      </Card>
    );
  }

  return <Card>{body}</Card>;
}

export interface AlertSummaryCardProps {
  label: string;
  count: number;
  icon: LucideIcon;
  tone: "warning" | "danger" | "info";
  href?: string;
  description?: string;
}

/**
 * Count tile for an operational alert (low stock, expiring batches, open shifts).
 */
export function AlertSummaryCard({
  label,
  count,
  icon: Icon,
  tone,
  href,
  description,
}: AlertSummaryCardProps) {
  const tones = {
    warning: "bg-stock-low/15 text-stock-low",
    danger: "bg-stock-out/15 text-stock-out",
    info: "bg-stock-ok/15 text-stock-ok",
  } as const;

  return (
    <Card className="transition-shadow hover:shadow-md">
      <CardContent className="flex items-center gap-4 p-5">
        <span
          className={`flex size-10 shrink-0 items-center justify-center rounded-lg ${tones[tone]}`}
          aria-hidden
        >
          <Icon className="size-5" />
        </span>

        <div className="min-w-0 flex-1">
          <p className="tabular text-2xl font-semibold tracking-tight">{count}</p>
          <p className="truncate text-xs font-medium text-muted-foreground">
            {label}
          </p>
        </div>

        {href ? (
          <a
            href={href}
            className="shrink-0 text-xs font-medium text-brand-600 hover:underline dark:text-brand-400"
          >
            Lihat
          </a>
        ) : null}
      </CardContent>

      {description ? (
        <p className="px-5 pb-4 text-xs text-muted-foreground">{description}</p>
      ) : null}
    </Card>
  );
}

/** Generic skeleton for chart areas while data loads. */
export function ChartSkeleton({ className }: { className?: string }) {
  return (
    <div className={["flex h-64 items-end gap-2 p-5", className].join(" ")}>
      {[45, 70, 55, 85, 60, 95, 75].map((height, index) => (
        <Skeleton
          key={index}
          className="flex-1 rounded-t"
          style={{ height: `${height}%` }}
        />
      ))}
    </div>
  );
}

/** Empty-state block used across dashboard widgets. */
export function WidgetEmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      <AlertTriangle
        className="size-8 text-muted-foreground/60"
        aria-hidden
      />
      <p className="text-sm font-medium">{title}</p>
      {description ? (
        <p className="max-w-sm text-sm text-muted-foreground">{description}</p>
      ) : null}
      {action ? <div className="pt-2">{action}</div> : null}
    </div>
  );
}