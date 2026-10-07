import type { Metadata } from "next";

import { requirePagePermission } from "@/lib/auth/session";
import { getInventoryReport } from "@/lib/queries/reports";
import { getStockSummary as getStockPosition } from "@/lib/queries/inventory";
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

import { MetricTile } from "@/components/reports/shell";

export const metadata: Metadata = {
  title: "Laporan Stok",
};

/**
 * Inventory valuation.
 *
 * Values stock at cost, not retail: retail value is shown alongside only as the
 * potential margin, so the two are never confused.
 */
export default async function InventoryReportPage() {
  await requirePagePermission("reports:inventory");

  const [report, position] = await Promise.all([
    getInventoryReport(),
    getStockPosition(),
  ]);

  const potentialMargin = report.totalRetailValue - report.totalCostValue;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">
          Laporan Stok
        </h1>
        <p className="text-sm text-muted-foreground">
          Posisi persediaan per kategori pada saat ini.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricTile
          label="Nilai persediaan (modal)"
          value={formatCurrency(report.totalCostValue)}
          hint={formatNumber(report.totalUnits) + " unit"}
        />
        <MetricTile
          label="Nilai jika terjual"
          value={formatCurrency(report.totalRetailValue)}
        />
        <MetricTile
          label="Potensi margin"
          value={formatCurrency(potentialMargin)}
          tone={potentialMargin >= 0 ? "positive" : "negative"}
        />
        <MetricTile
          label="Perlu restock"
          value={formatNumber(position.lowStockCount)}
          tone={position.lowStockCount > 0 ? "negative" : "positive"}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Nilai Persediaan per Kategori</CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Kategori</TableHead>
                <TableHead className="text-center">Produk</TableHead>
                <TableHead className="text-right">Unit</TableHead>
                <TableHead className="text-right">Nilai Modal</TableHead>
                <TableHead className="text-right">Nilai Jual</TableHead>
              </TableRow>
            </TableHeader>

            <TableBody>
              {report.rows.map((row) => (
                <TableRow key={row.category}>
                  <TableCell className="font-medium">{row.category}</TableCell>
                  <TableCell className="tabular text-center">
                    {formatNumber(row.products)}
                  </TableCell>
                  <TableCell className="tabular text-right">
                    {formatNumber(row.units)}
                  </TableCell>
                  <TableCell className="tabular text-right">
                    {formatCurrency(row.costValue)}
                  </TableCell>
                  <TableCell className="tabular text-right text-muted-foreground">
                    {formatCurrency(row.retailValue)}
                  </TableCell>
                </TableRow>
              ))}

              <TableRow className="border-t-2 font-semibold">
                <TableCell>Total</TableCell>
                <TableCell />
                <TableCell className="tabular text-right">
                  {formatNumber(report.totalUnits)}
                </TableCell>
                <TableCell className="tabular text-right">
                  {formatCurrency(report.totalCostValue)}
                </TableCell>
                <TableCell className="tabular text-right">
                  {formatCurrency(report.totalRetailValue)}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
