import type { Metadata } from "next";
import Link from "next/link";

import { requirePagePermission } from "@/lib/auth/session";
import {
  getDeadStock,
  getProductPerformance,
  resolveRange,
} from "@/lib/queries/reports";
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
  title: "Laporan Produk",
};

/** Best sellers alongside the products that never moved — the two lists a buyer needs. */
export default async function ProductReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePagePermission("reports:products");

  const params = await searchParams;
  const single = (v: string | string[] | undefined) =>
    Array.isArray(v) ? v[0] : v || undefined;

  const preset = single(params.range) ?? "30d";
  const range = resolveRange(preset, single(params.from), single(params.to));

  const [performance, dead] = await Promise.all([
    getProductPerformance(range, 100),
    getDeadStock(range, 50),
  ]);

  const totalRevenue = performance.reduce((sum, row) => sum + row.revenue, 0);
  const totalProfit = performance.reduce((sum, row) => sum + row.profit, 0);
  const totalUnits = performance.reduce((sum, row) => sum + row.quantity, 0);

  return (
    <div className="space-y-4">
      <ReportHeader
        title="Laporan Produk"
        subtitle="Performa penjualan per produk dan daftar barang yang tidak bergerak."
        range={range}
        basePath="/reports/products"
        activePreset={preset}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricTile label="Produk terjual" value={formatNumber(totalUnits)} />
        <MetricTile label="Pendapatan" value={formatCurrency(totalRevenue)} />
        <MetricTile
          label="Laba kotor"
          value={formatCurrency(totalProfit)}
          tone={totalProfit >= 0 ? "positive" : "negative"}
        />
        <MetricTile
          label="Produk tidak bergerak"
          value={formatNumber(dead.length)}
          tone={dead.length > 0 ? "negative" : "positive"}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Performa Produk</CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          {performance.length === 0 ? (
            <EmptyState
              title="Belum ada penjualan"
              description="Tidak ada produk terjual pada periode ini."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Produk</TableHead>
                  <TableHead className="text-right">Terjual</TableHead>
                  <TableHead className="text-right">Pendapatan</TableHead>
                  <TableHead className="text-right">Laba</TableHead>
                </TableRow>
              </TableHeader>

              <TableBody>
                {performance.map((row) => (
                  <TableRow key={row.productId}>
                    <TableCell>
                      <Link
                        href={"/products/" + row.productId}
                        className="font-medium hover:underline"
                      >
                        {row.name}
                      </Link>
                      <p className="font-mono text-xs text-muted-foreground">
                        {row.sku}
                      </p>
                    </TableCell>
                    <TableCell className="tabular text-right">
                      {formatNumber(row.quantity)}
                    </TableCell>
                    <TableCell className="tabular text-right">
                      {formatCurrency(row.revenue)}
                    </TableCell>
                    <TableCell
                      className={
                        "tabular text-right font-medium " +
                        (row.profit >= 0 ? "text-stock-ok" : "text-stock-out")
                      }
                    >
                      {formatCurrency(row.profit)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Barang Tidak Bergerak</CardTitle>
          <p className="text-xs text-muted-foreground">
            Produk aktif yang tidak terjual sama sekali pada periode ini.
            Kandidat untuk diskon atau discontinuation.
          </p>
        </CardHeader>
        <CardContent className="px-0">
          {dead.length === 0 ? (
            <EmptyState
              title="Semua produk bergerak"
              description="Tidak ada produk tanpa penjualan pada periode ini."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Produk</TableHead>
                  <TableHead className="text-right">Stok</TableHead>
                  <TableHead className="text-right">Nilai Persediaan</TableHead>
                </TableRow>
              </TableHeader>

              <TableBody>
                {dead.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <Link
                        href={"/products/" + row.id}
                        className="font-medium hover:underline"
                      >
                        {row.name}
                      </Link>
                      <p className="font-mono text-xs text-muted-foreground">
                        {row.sku}
                      </p>
                    </TableCell>
                    <TableCell className="tabular text-right">
                      {formatNumber(row.stock)}
                    </TableCell>
                    <TableCell className="tabular text-right">
                      {formatCurrency(row.value)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
