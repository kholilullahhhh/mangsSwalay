import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ShoppingCart } from "lucide-react";

import { requirePagePermission } from "@/lib/auth/session";
import { getSupplierById } from "@/lib/queries/purchases";
import {
  PURCHASE_STATUS_LABEL,
  PURCHASE_STATUS_VARIANT,
} from "@/lib/purchases/state-machine";
import {
  formatCurrency,
  formatDate,
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

export const metadata: Metadata = {
  title: "Detail Supplier",
};

export default async function SupplierDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requirePagePermission("suppliers:view");

  const { id } = await params;
  const supplier = await getSupplierById(id);

  if (!supplier) {
    notFound();
  }

  return (
    <div className="space-y-4">
      <div>
        <Link
          href="/suppliers"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Kembali ke supplier
        </Link>

        <h1 className="mt-1 flex flex-wrap items-center gap-2 text-lg font-semibold tracking-tight">
          {supplier.name}
          <Badge variant="outline" className="font-mono">
            {supplier.code}
          </Badge>
          {!supplier.isActive ? (
            <Badge variant="destructive">Nonaktif</Badge>
          ) : null}
        </h1>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Kontak</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Badan usaha</dt>
                <dd className="text-right">{supplier.company ?? "-"}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Narahubung</dt>
                <dd>{supplier.contactPerson ?? "-"}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Telepon</dt>
                <dd>
                  {supplier.phone ? (
                    <a href={"tel:" + supplier.phone} className="hover:underline">
                      {supplier.phone}
                    </a>
                  ) : (
                    "-"
                  )}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Email</dt>
                <dd className="max-w-48 truncate text-right">
                  {supplier.email ?? "-"}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Bergabung</dt>
                <dd>{formatDate(supplier.createdAt)}</dd>
              </div>
            </dl>

            {supplier.address ? (
              <p className="mt-3 rounded-md border bg-muted/40 p-3 text-sm">
                {supplier.address}
              </p>
            ) : null}

            {supplier.notes ? (
              <p className="mt-2 rounded-md border bg-muted/40 p-3 text-sm">
                {supplier.notes}
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">
              Riwayat Pembelian ({formatNumber(supplier._count.purchases)})
            </CardTitle>
          </CardHeader>
          <CardContent className="px-0">
            {supplier.purchases.length === 0 ? (
              <EmptyState
                icon={ShoppingCart}
                title="Belum ada pembelian"
                description="Pesanan pembelian dari supplier ini akan muncul di sini."
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nomor</TableHead>
                    <TableHead>Tanggal</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>

                <TableBody>
                  {supplier.purchases.map((purchase) => (
                    <TableRow key={purchase.id}>
                      <TableCell>
                        <Link
                          href={"/purchases/" + purchase.id}
                          className="font-mono text-xs hover:underline"
                        >
                          {purchase.number}
                        </Link>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatDate(purchase.date)}
                      </TableCell>
                      <TableCell className="tabular text-right font-medium">
                        {formatCurrency(purchase.grandTotal)}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            PURCHASE_STATUS_VARIANT[
                              purchase.status as keyof typeof PURCHASE_STATUS_VARIANT
                            ] ?? "outline"
                          }
                        >
                          {PURCHASE_STATUS_LABEL[
                            purchase.status as keyof typeof PURCHASE_STATUS_LABEL
                          ] ?? purchase.status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
