"use client";

import {
  type TooltipValueType,
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { formatCurrencyCompact, formatNumber } from "@/lib/format";

/**
 * Chart components.
 *
 * Recharts is a Client Component library, so these wrappers carry
 * `"use client"`. The data itself arrives from Server Components as plain
 * numbers, which keeps the server-rendered payload small — no Decimal objects or
 * Prisma types cross the boundary.
 *
 * All charts share the same muted gridlines, single axis style, and tooltip
 * treatment so a screen of them reads as one system.
 */

const AXIS_PROPS = {
  stroke: "var(--muted-foreground)",
  fontSize: 11,
  tickLine: false,
  axisLine: false,
} as const;

const GRID_PROPS = {
  strokeDasharray: "3 3",
  stroke: "var(--border)",
  vertical: false,
} as const;

/**
 * Recharts passes tooltip values as `ValueType | undefined`, a union that also
 * covers arrays (it models stacked series). Every chart here plots a single
 * numeric series, so formatters accept the full union — including `undefined` —
 * and narrow to a number internally. Declaring the parameter as plain `number`
 * would not satisfy Recharts' contravariant signature.
 */
type TooltipValue = TooltipValueType | undefined;

function tooltipNumber(value: TooltipValue): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  // Array values only occur with stacked series, which we don't use.
  return 0;
}

const TOOLTIP_PROPS = {
  cursor: { fill: "var(--accent)", opacity: 0.5 },
  contentStyle: {
    background: "var(--popover)",
    border: "1px solid var(--border)",
    borderRadius: "0.5rem",
    fontSize: "0.8125rem",
    color: "var(--popover-foreground)",
  },
} as const;

export interface SalesTrendPoint {
  label: string;
  total: number;
  /** Optional: shown in the tooltip when available. */
  transactions?: number;
}

/** Area chart of daily revenue. */
export function SalesTrendChart({
  data,
  height = 280,
}: {
  data: SalesTrendPoint[];
  height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="salesFill" x1="0" y1="0" x2="0" y2="1">
            <stop
              offset="0%"
              stopColor="var(--chart-1)"
              stopOpacity={0.35}
            />
            <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
          </linearGradient>
        </defs>

        <CartesianGrid {...GRID_PROPS} />
        <XAxis dataKey="label" {...AXIS_PROPS} />
        <YAxis
          {...AXIS_PROPS}
          width={56}
          tickFormatter={(value: number) => formatCurrencyCompact(value)}
        />
        <Tooltip
          {...TOOLTIP_PROPS}
          formatter={(value: TooltipValue) => [
            `Rp ${formatNumber(tooltipNumber(value))}`,
            "Penjualan",
          ]}
        />
        <Area
          type="monotone"
          dataKey="total"
          stroke="var(--chart-1)"
          strokeWidth={2}
          fill="url(#salesFill)"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export interface CategoryPoint {
  category: string;
  total: number;
}

/** Revenue split by category. */
export function CategorySalesChart({
  data,
  height = 280,
}: {
  data: CategoryPoint[];
  height?: number;
}) {
  // Single-hue shades rather than the default categorical palette, so the
  // category chart stays within the brand's green family.
  const shades = [
    "var(--chart-1)",
    "var(--chart-3)",
    "var(--chart-5)",
    "var(--chart-2)",
    "var(--chart-4)",
    "var(--chart-1)",
    "var(--chart-3)",
    "var(--chart-5)",
  ];

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid {...GRID_PROPS} />
        <XAxis
          dataKey="category"
          {...AXIS_PROPS}
          interval={0}
          angle={-25}
          textAnchor="end"
          height={64}
        />
        <YAxis
          {...AXIS_PROPS}
          width={56}
          tickFormatter={(value: number) => formatCurrencyCompact(value)}
        />
        <Tooltip
          {...TOOLTIP_PROPS}
          formatter={(value: TooltipValue) => [
            `Rp ${formatNumber(tooltipNumber(value))}`,
            "Penjualan",
          ]}
        />
        <Bar dataKey="total" radius={[6, 6, 0, 0]} maxBarSize={44}>
          {data.map((entry, index) => (
            <Cell key={entry.category} fill={shades[index % shades.length]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export interface PaymentPoint {
  method: string;
  total: number;
}

/** Payment method mix as a donut. */
export function PaymentMethodChart({
  data,
  height = 280,
}: {
  data: PaymentPoint[];
  height?: number;
}) {
  const colors = [
    "var(--chart-1)",
    "var(--chart-2)",
    "var(--chart-3)",
    "var(--chart-4)",
    "var(--chart-5)",
  ];

  const total = data.reduce((sum, entry) => sum + entry.total, 0);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie
          data={data}
          dataKey="total"
          nameKey="method"
          innerRadius="52%"
          outerRadius="78%"
          paddingAngle={2}
          stroke="none"
        >
          {data.map((entry, index) => (
            <Cell
              key={entry.method}
              fill={colors[index % colors.length]}
            />
          ))}
        </Pie>

        <Tooltip
          {...TOOLTIP_PROPS}
          formatter={(value: TooltipValue, name: TooltipValue) => {
            const amount = tooltipNumber(value);
            return [
              `Rp ${formatNumber(amount)} (${
                total > 0 ? Math.round((amount / total) * 100) : 0
              }%)`,
              String(name ?? ""),
            ];
          }}
        />
        <Legend
          verticalAlign="bottom"
          height={28}
          iconType="circle"
          iconSize={8}
          formatter={(value: string) => (
            <span className="text-xs text-muted-foreground">{value}</span>
          )}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}

export interface PurchaseVsSalePoint {
  period: string;
  purchase: number;
  sale: number;
}

/** Purchases against sales over the same window. */
export function PurchaseVsSaleChart({
  data,
  height = 280,
}: {
  data: PurchaseVsSalePoint[];
  height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid {...GRID_PROPS} />
        <XAxis dataKey="period" {...AXIS_PROPS} />
        <YAxis
          {...AXIS_PROPS}
          width={56}
          tickFormatter={(value: number) => formatCurrencyCompact(value)}
        />
        <Tooltip
          {...TOOLTIP_PROPS}
          formatter={(value: TooltipValue, name: TooltipValue) => [
            `Rp ${formatNumber(tooltipNumber(value))}`,
            name === "sale" ? "Penjualan" : "Pembelian",
          ]}
        />
        <Legend
          verticalAlign="bottom"
          height={28}
          iconType="circle"
          iconSize={8}
          formatter={(value: string) => (
            <span className="text-xs text-muted-foreground">
              {value === "sale" ? "Penjualan" : "Pembelian"}
            </span>
          )}
        />
        <Bar
          dataKey="sale"
          fill="var(--chart-1)"
          radius={[4, 4, 0, 0]}
          maxBarSize={18}
        />
        <Bar
          dataKey="purchase"
          fill="var(--chart-2)"
          radius={[4, 4, 0, 0]}
          maxBarSize={18}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

export interface CashFlowPoint {
  label: string;
  inflow: number;
  outflow: number;
}

/**
 * Cash in against cash out, grouped bars.
 *
 * Outflow is shown as the full negative magnitude: bar length is what the reader
 * compares, and a mirrored axis would make a net-positive day look identical to
 * a net-negative one.
 */
export function CashFlowChart({
  data,
  height = 280,
}: {
  data: CashFlowPoint[];
  height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid {...GRID_PROPS} />
        <XAxis dataKey="label" {...AXIS_PROPS} />
        <YAxis
          {...AXIS_PROPS}
          width={56}
          tickFormatter={(value: number) => formatCurrencyCompact(value)}
        />
        <Tooltip
          {...TOOLTIP_PROPS}
          formatter={(value: TooltipValue, name: TooltipValue) => [
            `Rp ${formatNumber(tooltipNumber(value))}`,
            name === "inflow" ? "Kas Masuk" : "Keluar",
          ]}
        />
        <Legend
          verticalAlign="bottom"
          height={28}
          iconType="circle"
          iconSize={8}
          formatter={(value: string) => (
            <span className="text-xs text-muted-foreground">
              {value === "inflow" ? "Kas Masuk" : "Keluar"}
            </span>
          )}
        />
        <Bar
          dataKey="inflow"
          fill="var(--chart-1)"
          radius={[4, 4, 0, 0]}
          maxBarSize={18}
        />
        <Bar
          dataKey="outflow"
          fill="var(--chart-2)"
          radius={[4, 4, 0, 0]}
          maxBarSize={18}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

export interface TrendLinePoint {
  label: string;
  value: number;
}

/** Compact sparkline-style line, for secondary widgets. */
export function MiniTrendChart({
  data,
  height = 120,
}: {
  data: TrendLinePoint[];
  height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="miniFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.3} />
            <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <Line
          dataKey="value"
          stroke="var(--chart-1)"
          strokeWidth={1.5}
          dot={false}
          isAnimationActive={false}
        />
        <Area
          type="monotone"
          dataKey="value"
          stroke="none"
          fill="url(#miniFill)"
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
