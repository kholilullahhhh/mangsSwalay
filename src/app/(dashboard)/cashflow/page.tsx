import type { Metadata } from "next";

import { requirePagePermission } from "@/lib/auth/session";
import { getCashFlow, resolveRange } from "@/lib/queries/reports";
import { formatCurrency } from "@/lib/format";
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
import { CashFlowChart } from "@/components/charts";

import { MetricTile, ReportHeader } from "@/components/reports/shell";

export const metadata: Metadata = {
  title: "Arus Kas",
};

/**
 * Daily cash movement for the store.
 *
 * Cash only: card, QRIS, and transfer settle outside the drawer, and counting
 * them here would overstate the till. Purchases are attributed to the order
 * date, since payments are not tracked individually.
 */
export default async function CashFlowPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePagePermission("reports:cashflow");

  const params = await searchParams;
  const single = (v: string | string[] | undefined) =>
    Array.isArray(v) ? v[0] : v || undefined;

  const preset = single(params.range) ?? "30d";
  const range = resolveRange(preset, single(params.from), single(params.to));

  const flow = await getCashFlow(range);

  const totalIn = flow.reduce((sum, row) => sum + row.inflow, 0);
  const totalOut = flow.reduce((sum, row) => sum + row.outflow, 0);
  const net = totalIn - totalOut;

  return (
    <div className="space-y-4">
      <ReportHeader
        title="Arus Kas"
        subtitle="Pergerakan uang tunai harian: penjualan, retur, pembelian, dan beban."
        range={range}
        basePath="/cashflow"
        activePreset={preset}
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <MetricTile label="Kas masuk" value={formatCurrency(totalIn)} tone="positive" />
        <MetricTile label="Kas keluar" value={formatCurrency(totalOut)} tone="negative" />
        <MetricTile
          label="Selisih bersih"
          value={formatCurrency(net)}
          tone={net >= 0 ? "positive" : "negative"}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Grafik Arus Kas</CardTitle>
        </CardHeader>
        <CardContent>
          {flow.length > 0 ? (
            <CashFlowChart data={flow} />
          ) : (
            <EmptyState
              title="Belum ada pergerakan kas"
              description="Tidak ada transaksi tunai pada periode ini."
            />
          )}
        </CardContent>
      </Card>

      {flow.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Rincian Harian</CardTitle>
          </CardHeader>
          <CardContent className="px-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tanggal</TableHead>
                  <TableHead className="text-right">Masuk</TableHead>
                  <TableHead className="text-right">Keluar</TableHead>
                  <TableHead className="text-right">Selisih</TableHead>
                </TableRow>
              </TableHeader>

              <TableBody>
                {flow.map((row) => {
                  const net = row.inflow - row.outflow;
                  return (
                    <TableRow key={row.label}>
                      <TableCell className="font-medium">{row.label}</TableCell>
                      <TableCell className="tabular text-right text-stock-ok">
                        {formatCurrency(row.inflow)}
                      </TableCell>
                      <TableCell className="tabular text-right text-stock-out">
                        {formatCurrency(row.outflow)}
                      </TableCell>
                      <TableCell
                        className={
                          "tabular text-right font-medium " +
                          (net >= 0 ? "text-stock-ok" : "text-stock-out")
                        }
                      >
                        {formatCurrency(net)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
