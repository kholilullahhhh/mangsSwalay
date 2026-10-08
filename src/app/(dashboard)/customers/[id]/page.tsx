import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Coins, Phone } from "lucide-react";

import { requirePagePermission, hasPermission } from "@/lib/auth/session";
import { getCustomerById } from "@/lib/queries/catalog";
import {
  SALE_STATUS_LABEL,
  SALE_STATUS_VARIANT,
  type SaleState,
} from "@/lib/sales/rules";
import {
  formatCurrency,
  formatDate,
  formatDateTime,
  formatNumber,
} from "@/lib/format";
import { Badge } from "@/components/ui/badge";
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
import { CustomerDialog } from "../new-customer-button";

export const metadata: Metadata = {
  title: "Detail Pelanggan",
};

export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requirePagePermission("customers:view");

const canManage = await hasPermission("customers:manage");

  const { id } = await params;
  const data = await getCustomerById(id);

  if (!data) {
    notFound();
  }

  const { customer, lifetimeSpend, lifetimeTransactions, averageBasket, sales } =
    data;

  return (
    <div className="space-y-4">
      <div>
        <Link
          href="/customers"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Kembali ke pelanggan
        </Link>

        <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
          <h1 className="flex flex-wrap items-center gap-2 text-lg font-semibold tracking-tight">
            {customer.name}
            {customer.isMember ? (
              <Badge variant="secondary">{customer.memberNumber}</Badge>
            ) : null}
            {!customer.isActive ? (
              <Badge variant="destructive">Nonaktif</Badge>
            ) : null}
          </h1>

          {canManage ? (
            <CustomerDialog
              customer={{
                id: customer.id,
                name: customer.name,
                phone: customer.phone,
                email: customer.email,
                address: customer.address,
                notes: customer.notes,
                isMember: customer.isMember,
                isActive: customer.isActive,
              }}
            />
          ) : null}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Total belanja</p>
          <p className="tabular mt-1 text-xl font-semibold">
            {formatCurrency(lifetimeSpend)}
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Transaksi</p>
          <p className="tabular mt-1 text-xl font-semibold">
            {formatNumber(lifetimeTransactions)}
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Rata-rata belanja</p>
          <p className="tabular mt-1 text-xl font-semibold">
            {formatCurrency(averageBasket)}
          </p>
        </Card>
        <Card className="p-4">
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            <Coins className="size-3.5" aria-hidden />
            Poin loyalitas
          </p>
          <p className="tabular mt-1 text-xl font-semibold text-brand-600">
            {formatNumber(customer.points)}
          </p>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Kontak</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Telepon</dt>
                <dd className="flex items-center gap-1">
                  {customer.phone ? (
                    <>
                      <Phone className="size-3.5 text-muted-foreground" aria-hidden />
                      <a href={"tel:" + customer.phone} className="hover:underline">
                        {customer.phone}
                      </a>
                    </>
                  ) : (
                    "-"
                  )}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Email</dt>
                <dd>{customer.email ?? "-"}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Alamat</dt>
                <dd className="max-w-56 text-right">{customer.address ?? "-"}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Bergabung</dt>
                <dd>{formatDate(customer.createdAt)}</dd>
              </div>
            </dl>

            {customer.notes ? (
              <p className="mt-3 rounded-md border bg-muted/40 p-3 text-sm">
                {customer.notes}
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Riwayat Pembelian</CardTitle>
          </CardHeader>
          <CardContent className="px-0">
            {sales.length === 0 ? (
              <EmptyState
                title="Belum ada transaksi"
                description="Riwayat pembelian pelanggan akan muncul di sini."
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Invoice</TableHead>
                    <TableHead>Tanggal</TableHead>
                    <TableHead className="text-center">Item</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Poin</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>

                <TableBody>
                  {sales.map((sale) => {
                    const status = sale.status as SaleState;

                    return (
                      <TableRow key={sale.id}>
                        <TableCell>
                          <Link
                            href={"/sales/" + sale.id}
                            className="font-mono text-xs hover:underline"
                          >
                            {sale.invoiceNumber}
                          </Link>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {formatDateTime(sale.date)}
                        </TableCell>
                        <TableCell className="tabular text-center text-sm">
                          {sale.items.reduce((sum, item) => sum + item.quantity, 0)}
                        </TableCell>
                        <TableCell className="tabular text-right font-medium">
                          {formatCurrency(sale.total)}
                        </TableCell>
                        <TableCell className="tabular text-right text-xs">
                          {sale.pointsEarned > 0 ? "+" + sale.pointsEarned : "-"}
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
        </Card>
      </div>
    </div>
  );
}

