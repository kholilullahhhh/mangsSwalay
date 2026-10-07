import type { Metadata } from "next";
import Link from "next/link";

import { requirePagePermission } from "@/lib/auth/session";
import { getPurchaseReport, resolveRange } from "@/lib/queries/reports";
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
import { EmptyState } from "@/components/data/empty-state";

import { MetricTile, ReportHeader } from "@/components/reports/shell";

export const metadata: Metadata = {
  title: "Laporan Pembelian",
};

/**
 * Spend per supplier.
 *
 * Only received and completed orders count as spend — a draft or merely ordered
 * PO has not yet moved money or stock.
 */
export default async function PurchaseReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePagePermission("reports:purchases");

  const params = await searchParams;
  const single = (v: string | string[] | undefined) =>
    Array.isArray(v) ? v[0] : v || undefined;

  const preset = single(params.range) ?? "30d";
  const range = resolveRange(preset, single(params.from), single(params.to));

  const report = await getPurchaseReport(range);

  return (
    <div className="space-y-4">
      <ReportHeader
        title="Laporan Pembelian"
        subtitle="Pengeluaran per supplier dan sisa tagihan yang belum dibayar."
        range={range}
        basePath="/reports/purchases"
        activePreset={preset}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricTile
          label="Total pembelian"
          value={formatCurrency(report.totalPurchase)}
          hint={formatNumber(report.orderCount) + " order diterima"}
        />
        <MetricTile
          label="Sudah dibayar"
          value={formatCurrency(report.totalPaid)}
          tone="positive"
        />
        <MetricTile
          label="Sisa tagihan"
          value={formatCurrency(report.totalOutstanding)}
          tone={report.totalOutstanding > 0 ? "negative" : "positive"}
        />
        <MetricTile label="Jumlah supplier" value={formatNumber(report.rows.length)} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Pembelian per Supplier</CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          {report.rows.length === 0 ? (
            <EmptyState
              title="Belum ada pembelian"
              description="Tidak ada order diterima pada periode ini."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Supplier</TableHead>
                  <TableHead className="text-right">Order</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Dibayar</TableHead>
                  <TableHead className="text-right">Sisa</TableHead>
                </TableRow>
              </TableHeader>

              <TableBody>
                {report.rows.map((row) => (
                  <TableRow key={row.supplier}>
                    <TableCell className="font-medium">{row.supplier}</TableCell>
                    <TableCell className="tabular text-right">
                      {formatNumber(row.orders)}
                    </TableCell>
                    <TableCell className="tabular text-right">
                      {formatCurrency(row.total)}
                    </TableCell>
                    <TableCell className="tabular text-right">
                      {formatCurrency(row.paid)}
                    </TableCell>
                    <TableCell
                      className={
                        "tabular text-right font-medium " +
                        (row.outstanding > 0 ? "text-stock-out" : "text-stock-ok")
                      }
                    >
                      {formatCurrency(row.outstanding)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Lihat detail order di{" "}
        <Link href="/purchases" className="underline">
          halaman pembelian
        </Link>
        .
      </p>
    </div>
  );
}
