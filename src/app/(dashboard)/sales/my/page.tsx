import type { Metadata } from "next";
import Link from "next/link";
import { Receipt } from "lucide-react";

import { requirePagePermission } from "@/lib/auth/session";
import { getCurrentUser } from "@/lib/auth/session";
import { getSalesSummary, listSales, PAYMENT_METHOD_LABEL } from "@/lib/queries/sales";
import { SALE_STATUS_LABEL, SALE_STATUS_VARIANT, type SaleState } from "@/lib/sales/rules";
import { formatCurrency, formatDate, formatNumber, formatTime } from "@/lib/format";
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

export const metadata: Metadata = {
  title: "Penjualan Saya",
};

/**
 * A cashier's own transactions.
 *
 * The query is scoped to the signed-in user on the server. The route is separate
 * from the manager-facing list because `sales:view-own` and `sales:view` are
 * different permissions, and a cashier must never see a colleague's takings.
 */
export default async function MySalesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requirePagePermission("sales:view-own");
  void (await getCurrentUser());

  const params = await searchParams;

  const single = (value: string | string[] | undefined) =>
    Array.isArray(value) ? value[0] : value || undefined;

  const filters = {
    search: single(params.search),
    status: single(params.status),
    // Forced to the signed-in cashier; a query parameter cannot widen this.
    userId: user.id,
    dateFrom: single(params.dateFrom),
    dateTo: single(params.dateTo),
    page: single(params.page),
    perPage: single(params.perPage),
  };

  const [{ rows, total, pagination }, summary] = await Promise.all([
    listSales(filters),
    getSalesSummary(filters),
  ]);

  const serialised: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    const one = Array.isArray(value) ? value[0] : value;
    if (one) serialised[key] = one;
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">
          Penjualan Saya
        </h1>
        <p className="text-sm text-muted-foreground">
          {formatNumber(summary.transactionCount)} transaksi oleh {user.name}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Omzet saya</p>
          <p className="tabular mt-1 text-xl font-semibold">
            {formatCurrency(summary.revenue)}
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Jumlah transaksi</p>
          <p className="tabular mt-1 text-xl font-semibold">
            {formatNumber(summary.transactionCount)}
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Nilai retur</p>
          <p className="tabular mt-1 text-xl font-semibold text-stock-out">
            {formatCurrency(summary.refundedAmount)}
          </p>
        </Card>
      </div>

      <Card>
        <div className="border-b p-4">
          <form className="flex flex-wrap items-center gap-2" action="/sales/my">
            <input
              name="search"
              type="search"
              defaultValue={filters.search ?? ""}
              placeholder="Cari nomor invoice..."
              aria-label="Cari invoice"
              className="h-9 w-56 rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <select
              name="status"
              defaultValue={filters.status ?? ""}
              aria-label="Status"
              className="h-9 rounded-md border border-input bg-transparent px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="">Semua status</option>
              <option value="COMPLETED">Selesai</option>
              <option value="PARTIALLY_REFUNDED">Retur sebagian</option>
              <option value="REFUNDED">Diretur</option>
              <option value="VOID">Void</option>
            </select>
            <input
              name="dateFrom"
              type="date"
              defaultValue={filters.dateFrom ?? ""}
              aria-label="Dari tanggal"
              className="h-9 rounded-md border border-input bg-transparent px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <input
              name="dateTo"
              type="date"
              defaultValue={filters.dateTo ?? ""}
              aria-label="Sampai tanggal"
              className="h-9 rounded-md border border-input bg-transparent px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <button
              type="submit"
              className="h-9 rounded-md bg-secondary px-3 text-sm font-medium hover:bg-secondary/80"
            >
              Terapkan
            </button>
          </form>
        </div>

        <CardContent className="px-0">
          {rows.length === 0 ? (
            <EmptyState
              icon={Receipt}
              title="Belum ada transaksi"
              description="Transaksi yang Anda buat akan muncul di sini."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice</TableHead>
                  <TableHead>Waktu</TableHead>
                  <TableHead>Pelanggan</TableHead>
                  <TableHead>Metode</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>

              <TableBody>
                {rows.map((sale) => {
                  const status = sale.status as SaleState;

                  return (
                    <TableRow key={sale.id}>
                      <TableCell>
                        <Link
                          href={"/sales/" + sale.id}
                          className="font-mono text-sm font-medium hover:underline"
                        >
                          {sale.invoiceNumber}
                        </Link>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatDate(sale.date)}
                        <br />
                        {formatTime(sale.date)}
                      </TableCell>
                      <TableCell className="text-sm">
                        {sale.customer?.name ?? (
                          <span className="text-muted-foreground">Umum</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">
                        {PAYMENT_METHOD_LABEL[sale.paymentMethod]}
                      </TableCell>
                      <TableCell className="tabular text-right font-medium">
                        {formatCurrency(sale.total)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={SALE_STATUS_VARIANT[status] ?? "outline"}>
                          {SALE_STATUS_LABEL[status] ?? sale.status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>

        {rows.length > 0 ? (
          <div className="border-t px-4 py-3 text-xs text-muted-foreground">
            Menampilkan {formatNumber(total)} transaksi
            {pagination.pageCount > 1
              ? " · halaman " + pagination.page + " dari " + pagination.pageCount
              : ""}
          </div>
        ) : null}
      </Card>
    </div>
  );
}

