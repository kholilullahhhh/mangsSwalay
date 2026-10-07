import type { Metadata } from "next";
import { Undo2 } from "lucide-react";

import { requirePagePermission } from "@/lib/auth/session";
import { listRefunds } from "@/lib/queries/sales";
import { formatCurrency, formatDateTime, formatNumber } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/data/empty-state";
import { PAYMENT_METHOD_LABEL } from "@/lib/queries/sales";

export const metadata: Metadata = {
  title: "Retur Penjualan",
};

/**
 * Refund history across all sales.
 *
 * Kept separate from the sale list because a return is a distinct financial
 * event: it needs its own document number and its own review trail.
 */
export default async function ReturnsPage() {
  await requirePagePermission("sales:refund");

  const refunds = await listRefunds(100);

  const totalRefunded = refunds.reduce(
    (sum, refund) => sum + Number(refund.totalRefund),
    0,
  );

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">
          Retur Penjualan
        </h1>
        <p className="text-sm text-muted-foreground">
          {formatNumber(refunds.length)} retur · total{" "}
          {formatCurrency(totalRefunded)}
        </p>
      </div>

      <Card>
        <CardContent className="px-0">
          {refunds.length === 0 ? (
            <EmptyState
              icon={Undo2}
              title="Belum ada retur"
              description="Retur yang diproses dari detail transaksi akan muncul di sini."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>No. Retur</TableHead>
                  <TableHead>Invoice</TableHead>
                  <TableHead>Waktu</TableHead>
                  <TableHead className="text-center">Item</TableHead>
                  <TableHead>Metode</TableHead>
                  <TableHead className="text-right">Nilai</TableHead>
                  <TableHead>Disetujui</TableHead>
                  <TableHead>Alasan</TableHead>
                </TableRow>
              </TableHeader>

              <TableBody>
                {refunds.map((refund) => (
                  <TableRow key={refund.id}>
                    <TableCell className="font-mono text-xs font-medium">
                      {refund.number}
                    </TableCell>

                    <TableCell>
                      <a
                        href={"/sales/" + refund.sale.id}
                        className="font-mono text-xs hover:underline"
                      >
                        {refund.sale.invoiceNumber}
                      </a>
                    </TableCell>

                    <TableCell className="text-xs text-muted-foreground">
                      {formatDateTime(refund.date)}
                    </TableCell>

                    <TableCell className="tabular text-center text-sm">
                      {refund.items.reduce(
                        (sum, item) => sum + item.quantity,
                        0,
                      )}
                    </TableCell>

                    <TableCell className="text-sm">
                      {PAYMENT_METHOD_LABEL[refund.paymentMethod]}
                    </TableCell>

                    <TableCell className="tabular text-right font-medium text-stock-out">
                      -{formatCurrency(refund.totalRefund)}
                    </TableCell>

                    <TableCell className="text-sm text-muted-foreground">
                      {refund.approver.name}
                    </TableCell>

                    <TableCell className="max-w-56">
                      <p className="truncate text-xs" title={refund.reason}>
                        {refund.reason}
                      </p>
                      {refund.items.some((item) => item.condition === "DAMAGED") ? (
                        <Badge
                          variant="outline"
                          className="mt-0.5 border-stock-low/40 text-stock-low text-[10px]"
                        >
                          ada barang rusak
                        </Badge>
                      ) : null}
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

