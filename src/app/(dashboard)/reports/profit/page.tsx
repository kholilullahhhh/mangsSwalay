import type { Metadata } from "next";

import { requirePagePermission } from "@/lib/auth/session";
import { getCashFlow, getProfitReport, resolveRange } from "@/lib/queries/reports";
import { formatCurrency, formatNumber } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { MetricTile, ReportHeader } from "@/components/reports/shell";
import { CashFlowChart } from "@/components/charts";

export const metadata: Metadata = {
  title: "Laporan Laba Rugi",
};

/**
 * Simple profit and loss.
 *
 * Cost of goods comes from the cost snapshotted on each sale line, so today's
 * purchase price cannot rewrite yesterday's margin.
 */
export default async function ProfitReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePagePermission("reports:profit");

  const params = await searchParams;
  const single = (v: string | string[] | undefined) =>
    Array.isArray(v) ? v[0] : v || undefined;

  const preset = single(params.range) ?? "30d";
  const range = resolveRange(preset, single(params.from), single(params.to));

  const [profit, flow] = await Promise.all([
    getProfitReport(range),
    getCashFlow(range),
  ]);

  const totalIn = flow.reduce((sum, row) => sum + row.inflow, 0);
  const totalOut = flow.reduce((sum, row) => sum + row.outflow, 0);

  return (
    <div className="space-y-4">
      <ReportHeader
        title="Laporan Laba Rugi"
        subtitle="Pendapatan, harga pokok, dan beban operasional dalam periode terpilih."
        range={range}
        basePath="/reports/profit"
        activePreset={preset}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricTile
          label="Pendapatan"
          value={formatCurrency(profit.revenue)}
          hint={formatNumber(profit.salesTransactions) + " transaksi"}
        />
        <MetricTile
          label="Laba kotor"
          value={formatCurrency(profit.grossProfit)}
          hint={"Margin kotor " + grossMargin(profit) + "%"}
        />
        <MetricTile
          label="Beban operasional"
          value={formatCurrency(profit.expenses)}
          tone={profit.expenses > 0 ? "negative" : "default"}
        />
        <MetricTile
          label="Laba bersih"
          value={formatCurrency(profit.netProfit)}
          hint={"Margin bersih " + profit.marginPercent + "%"}
          tone={profit.netProfit >= 0 ? "positive" : "negative"}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Rincian Laba Rugi</CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Keterangan</TableHead>
                <TableHead className="text-right">Jumlah</TableHead>
              </TableRow>
            </TableHeader>

            <TableBody>
              <Row label="Pendapatan penjualan" value={profit.revenue} />
              <Row label="Harga pokok penjualan" value={profit.cogs} negative />
              <Row
                label="Laba kotor"
                value={profit.grossProfit}
                bold
                tone={profit.grossProfit >= 0 ? "positive" : "negative"}
              />
              <Row label="Beban operasional" value={profit.expenses} negative />
              <Row
                label="Laba bersih"
                value={profit.netProfit}
                bold
                tone={profit.netProfit >= 0 ? "positive" : "negative"}
              />
              <Row
                label="Pembelian barang (informasi)"
                value={profit.purchaseTotal}
                muted
              />
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Arus Kas Harian</CardTitle>
          <p className="text-xs text-muted-foreground">
            Hanya transaksi tunai yang dihitung. Total masuk{" "}
            {formatCurrency(totalIn)}, total keluar {formatCurrency(totalOut)}.
          </p>
        </CardHeader>
        <CardContent>
          <CashFlowChart data={flow} />
        </CardContent>
      </Card>
    </div>
  );
}

/** Gross margin over revenue, guarding the zero-revenue case. */
function grossMargin(profit: { revenue: number; grossProfit: number }): number {
  return profit.revenue > 0
    ? Math.round((profit.grossProfit / profit.revenue) * 100)
    : 0;
}

function Row({
  label,
  value,
  negative,
  bold,
  muted,
  tone,
}: {
  label: string;
  value: number;
  negative?: boolean;
  bold?: boolean;
  muted?: boolean;
  tone?: "positive" | "negative";
}) {
  return (
    <TableRow>
      <TableCell
        className={
          (bold ? "font-semibold " : "") + (muted ? "text-muted-foreground" : "")
        }
      >
        {label}
      </TableCell>
      <TableCell
        className={
          "tabular pr-6 text-right " +
          (bold ? "font-semibold " : "") +
          (tone === "positive"
            ? "text-stock-ok"
            : tone === "negative"
              ? "text-stock-out"
              : muted
                ? "text-muted-foreground"
                : "")
        }
      >
        {negative ? "-" : ""}
        {formatCurrency(value)}
      </TableCell>
    </TableRow>
  );
}
