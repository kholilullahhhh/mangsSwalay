import type { Metadata } from "next";
import Link from "next/link";
import { Receipt } from "lucide-react";

import { requirePagePermission } from "@/lib/auth/session";
import {
  getSalesSummary,
  listSales,
  listCashierOptions,
  PAYMENT_METHOD_LABEL,
} from "@/lib/queries/sales";
import {
  SALE_STATUS_LABEL,
  SALE_STATUS_VARIANT,
  type SaleState,
} from "@/lib/sales/rules";
import { formatCurrency, formatDate, formatNumber, formatTime } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  TablePagination,
  type PaginationMeta,
} from "@/components/data/table-pagination";
import { EmptyState } from "@/components/data/empty-state";

export const metadata: Metadata = {
  title: "Penjualan",
};

/**
 * Sale history.
 *
 * Revenue figures exclude voided sales: voided transactions are corrections, not
 * money taken, and counting them would overstate takings to the manager.
 */
export default async function SalesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePagePermission("sales:view");

  const params = await searchParams;

  const filters = {
    search: single(params.search),
    status: single(params.status),
    paymentMethod: single(params.paymentMethod),
    userId: single(params.userId),
    dateFrom: single(params.dateFrom),
    dateTo: single(params.dateTo),
    page: single(params.page),
    perPage: single(params.perPage),
  };

  const [{ rows, total, pagination }, summary, cashiers] = await Promise.all([
    listSales(filters),
    getSalesSummary(filters),
    listCashierOptions(),
  ]);

  const hasFilters = Boolean(
    filters.search ||
      filters.status ||
      filters.paymentMethod ||
      filters.userId ||
      filters.dateFrom ||
      filters.dateTo,
  );

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Penjualan</h1>
        <p className="text-sm text-muted-foreground">
          {formatNumber(summary.transactionCount)} transaksi
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Omzet</p>
          <p className="tabular mt-1 text-xl font-semibold">
            {formatCurrency(summary.revenue)}
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Transaksi</p>
          <p className="tabular mt-1 text-xl font-semibold">
            {formatNumber(summary.transactionCount)}
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Retur</p>
          <p className="tabular mt-1 text-xl font-semibold text-stock-out">
            {formatCurrency(summary.refundedAmount)}
          </p>
          <p className="text-xs text-muted-foreground">
            {formatNumber(summary.refundCount)} kali retur
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Omzet bersih</p>
          <p className="tabular mt-1 text-xl font-semibold text-stock-ok">
            {formatCurrency(summary.netRevenue)}
          </p>
        </Card>
      </div>

      <Card>
        <div className="border-b p-4">
          <form className="flex flex-wrap items-center gap-2" action="/sales">
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

            <select
              name="paymentMethod"
              defaultValue={filters.paymentMethod ?? ""}
              aria-label="Metode pembayaran"
              className="h-9 rounded-md border border-input bg-transparent px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="">Semua metode</option>
              {Object.entries(PAYMENT_METHOD_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>

            <select
              name="userId"
              defaultValue={filters.userId ?? ""}
              aria-label="Kasir"
              className="h-9 rounded-md border border-input bg-transparent px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="">Semua kasir</option>
              {cashiers.map((cashier) => (
                <option key={cashier.id} value={cashier.id}>
                  {cashier.name}
                </option>
              ))}
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

            <Button type="submit" size="sm" variant="secondary">
              Terapkan
            </Button>

            {hasFilters ? (
              <Button variant="ghost" size="sm" asChild>
                <Link href="/sales">Reset</Link>
              </Button>
            ) : null}
          </form>
        </div>

        {rows.length === 0 ? (
          <EmptyState
            icon={Receipt}
            title={
              hasFilters ? "Tidak ada transaksi yang cocok" : "Belum ada transaksi"
            }
            description={
              hasFilters
                ? "Coba ubah filter atau rentang tanggal."
                : "Transaksi dari kasir akan muncul di sini."
            }
          />
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice</TableHead>
                  <TableHead>Waktu</TableHead>
                  <TableHead>Kasir</TableHead>
                  <TableHead>Pelanggan</TableHead>
                  <TableHead className="text-center">Item</TableHead>
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

                      <TableCell className="text-sm">{sale.user.name}</TableCell>

                      <TableCell className="text-sm">
                        {sale.customer ? (
                          sale.customer.name
                        ) : (
                          <span className="text-muted-foreground">Umum</span>
                        )}
                      </TableCell>

                      <TableCell className="tabular text-center text-sm">
                        {sale.itemCount}
                      </TableCell>

                      <TableCell className="text-sm">
                        {PAYMENT_METHOD_LABEL[sale.paymentMethod] ??
                          sale.paymentMethod}
                      </TableCell>

                      <TableCell className="tabular text-right font-medium">
                        {formatCurrency(sale.total)}
                      </TableCell>

                      <TableCell>
                        <Badge
                          variant={
                            SALE_STATUS_VARIANT[status] ?? "outline"
                          }
                        >
                          {SALE_STATUS_LABEL[status] ?? sale.status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>

            <TablePagination
              pagination={{ ...pagination, total } as PaginationMeta}
              searchParams={serialise(params)}
              total={total}
            />
          </>
        )}
      </Card>
    </div>
  );
}

function single(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value || undefined;
}

function serialise(
  params: Record<string, string | string[] | undefined>,
): Record<string, string> {
  const output: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    const one = Array.isArray(value) ? value[0] : value;
    if (one) output[key] = one;
  }
  return output;
}

