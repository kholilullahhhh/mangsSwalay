import type { Metadata } from "next";

import { requirePagePermission } from "@/lib/auth/session";
import {
  getDailySales,
  getPaymentMix,
  getSalesReport,
  resolveRange,
} from "@/lib/queries/reports";
import { PAYMENT_METHOD_LABEL } from "@/lib/queries/sales";
import { formatCurrency, formatNumber } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/data/empty-state";
import { SalesTrendChart, PaymentMethodChart } from "@/components/charts";

import { MetricTile, ReportHeader } from "@/components/reports/shell";

export const metadata: Metadata = {
  title: "Laporan Penjualan",
};

/**
 * Sales report.
 *
 * Revenue excludes tax (collected for the state, not earned) and voided sales,
 * and subtracts refunds so the figure reflects money actually kept.
 */
export default async function SalesReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePagePermission("reports:sales");

  const params = await searchParams;
  const single = (v: string | string[] | undefined) =>
    Array.isArray(v) ? v[0] : v || undefined;

  const preset = single(params.range) ?? "30d";
  const range = resolveRange(preset, single(params.from), single(params.to));

  const [report, daily, payments] = await Promise.all([
    getSalesReport(range),
    getDailySales(range),
    getPaymentMix(range),
  ]);

  return (
    <div className="space-y-4">
      <ReportHeader
        title="Laporan Penjualan"
        subtitle="Omzet, diskon, pajak, dan retur dalam periode terpilih."
        range={range}
        basePath="/reports/sales"
        activePreset={preset}
        exportHref="/api/reports/sales/export"
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricTile
          label="Omzet kotor"
          value={formatCurrency(report.grossSales)}
          hint={formatNumber(report.transactions) + " transaksi"}
        />
        <MetricTile
          label="Retur"
          value={formatCurrency(report.refunds)}
          tone={report.refunds > 0 ? "negative" : "default"}
        />
        <MetricTile
          label="Omzet bersih"
          value={formatCurrency(report.netSales)}
          tone="positive"
        />
        <MetricTile
          label="Rata-rata transaksi"
          value={formatCurrency(report.averageTransaction)}
          hint={formatNumber(report.itemsSold) + " item terjual"}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Tren Harian</CardTitle>
        </CardHeader>
        <CardContent>
          {daily.length > 0 ? (
            <SalesTrendChart data={daily.map((row) => ({ label: row.label, total: row.gross }))} />
          ) : (
            <EmptyState
              title="Belum ada penjualan pada periode ini"
              description="Coba perluas rentang tanggal."
            />
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Metode Pembayaran</CardTitle>
          </CardHeader>
          <CardContent>
            {payments.length > 0 ? (
              <PaymentMethodChart
                data={payments.map((row) => ({
                  method: PAYMENT_METHOD_LABEL[row.method] ?? row.method,
                  total: row.total,
                }))}
              />
            ) : (
              <EmptyState title="Belum ada data pembayaran" />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Rincian</CardTitle>
          </CardHeader>
          <CardContent className="px-0">
            <Table>
              <TableBody>
                <SummaryRow label="Diskon diberikan" value={report.discounts} negative />
                <SummaryRow label="Pajak terkumpul" value={report.taxes} />
                <SummaryRow label="Harga pokok penjualan" value={report.costOfGoods} negative />
                <SummaryRow
                  label="Laba kotor"
                  value={report.grossProfit}
                  tone={report.grossProfit >= 0 ? "positive" : "negative"}
                />
                <SummaryRow
                  label="Margin"
                  value={report.marginPercent}
                  suffix=""
                  tone={report.marginPercent >= 0 ? "positive" : "negative"}
                />
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function SummaryRow({
  label,
  value,
  negative,
  tone,
  suffix = "",
}: {
  label: string;
  value: number;
  negative?: boolean;
  tone?: "positive" | "negative";
  suffix?: string;
}) {
  return (
    <TableRow>
      <TableCell className="pl-6">{label}</TableCell>
      <TableCell
        className={
          "pr-6 text-right font-medium " +
          (tone === "positive"
            ? "text-stock-ok"
            : tone === "negative"
              ? "text-stock-out"
              : negative
                ? "text-muted-foreground"
                : "")
        }
      >
        {negative ? "-" : ""}
        {suffix === "%" ? value : formatCurrency(value)}
        {suffix === "%" ? "%" : ""}
      </TableCell>
    </TableRow>
  );
}

