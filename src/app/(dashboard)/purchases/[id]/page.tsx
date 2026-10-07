import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CheckCircle2, PackageCheck } from "lucide-react";

import { requirePagePermission, hasPermission } from "@/lib/auth/session";
import { getPurchaseById } from "@/lib/queries/purchases";
import {
  PURCHASE_STATUS_LABEL,
  PURCHASE_STATUS_VARIANT,
  nextStatuses,
} from "@/lib/purchases/state-machine";
import {
  formatCurrency,
  formatDate,
  formatDateTime,
  formatNumber,
} from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";

import { StatusActions } from "../status-actions";
import { recordPaymentFormAction } from "../actions";

export const metadata: Metadata = {
  title: "Detail Pembelian",
};

/**
 * Purchase detail.
 *
 * The status action buttons come from the same `nextStatuses` map the server
 * action validates against, so the UI cannot offer a transition the server would
 * reject — and the server still re-checks, because the UI is not the boundary.
 */
export default async function PurchaseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requirePagePermission("purchases:view");

  const { id } = await params;
  const purchase = await getPurchaseById(id);

  if (!purchase) {
    notFound();
  }

  const [canUpdate, canReceive, canCancel] = await Promise.all([
    hasPermission("purchases:update"),
    hasPermission("purchases:receive"),
    hasPermission("purchases:cancel"),
  ]);

  const available = nextStatuses(
    purchase.status as keyof typeof PURCHASE_STATUS_LABEL,
  );

  const outstanding = Math.max(
    0,
    Number(purchase.grandTotal) - Number(purchase.amountPaid),
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Button variant="ghost" size="sm" asChild className="-ml-2 mb-1">
            <Link href="/purchases">
              <ArrowLeft className="size-4" aria-hidden />
              Kembali
            </Link>
          </Button>

          <h1 className="flex items-center gap-2 font-mono text-lg font-semibold tracking-tight">
            {purchase.number}
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
          </h1>

          <p className="text-sm text-muted-foreground">
            {purchase.supplier.name} · {formatDate(purchase.date)}
          </p>
        </div>

        {available.length > 0 ? (
          <StatusActions
            purchaseId={purchase.id}
            availableStatuses={available}
            canUpdate={canUpdate}
            canReceive={canReceive}
            canCancel={canCancel}
          />
        ) : null}
      </div>

      {purchase.status === "DRAFT" || purchase.status === "ORDERED" ? (
        <Alert>
          <PackageCheck className="size-4" aria-hidden />
          <AlertTitle>Stok belum bertambah</AlertTitle>
          <AlertDescription>
            Barang baru menambah stok setelah pesanan berstatus{" "}
            <strong>Diterima</strong>. Status{" "}
            {PURCHASE_STATUS_LABEL[
              purchase.status as keyof typeof PURCHASE_STATUS_LABEL
            ] ?? purchase.status}{" "}
            hanya mencatat niat membeli.
          </AlertDescription>
        </Alert>
      ) : null}

      {purchase.status === "RECEIVED" ? (
        <Alert>
          <CheckCircle2 className="size-4" aria-hidden />
          <AlertTitle>Barang diterima pada {formatDateTime(purchase.receivedAt)}</AlertTitle>
          <AlertDescription>
            Stok sudah bertambah untuk {purchase.items.length} jenis barang dan
            tercatat di riwayat stok.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Rincian Barang</CardTitle>
          </CardHeader>
          <CardContent className="px-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Produk</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Harga Beli</TableHead>
                  <TableHead className="text-right">Subtotal</TableHead>
                </TableRow>
              </TableHeader>

              <TableBody>
                {purchase.items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      <Link
                        href={`/products/${item.productId}`}
                        className="font-medium hover:underline"
                      >
                        {item.product.name}
                      </Link>
                      <p className="font-mono text-xs text-muted-foreground">
                        {item.product.sku}
                      </p>
                    </TableCell>
                    <TableCell className="tabular text-right">
                      {formatNumber(item.quantity)}
                    </TableCell>
                    <TableCell className="tabular text-right">
                      {formatCurrency(item.purchasePrice)}
                    </TableCell>
                    <TableCell className="tabular text-right font-medium">
                      {formatCurrency(item.subtotal)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Ringkasan</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Subtotal</dt>
                  <dd className="tabular">
                    {formatCurrency(purchase.subtotal)}
                  </dd>
                </div>

                {Number(purchase.discount) > 0 ? (
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Diskon</dt>
                    <dd className="tabular">
                      -{formatCurrency(purchase.discount)}
                    </dd>
                  </div>
                ) : null}

                {Number(purchase.tax) > 0 ? (
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Pajak</dt>
                    <dd className="tabular">{formatCurrency(purchase.tax)}</dd>
                  </div>
                ) : null}

                {Number(purchase.shippingCost) > 0 ? (
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Ongkir</dt>
                    <dd className="tabular">
                      {formatCurrency(purchase.shippingCost)}
                    </dd>
                  </div>
                ) : null}

                <div className="flex justify-between border-t pt-2 text-base font-semibold">
                  <dt>Total</dt>
                  <dd className="tabular">
                    {formatCurrency(purchase.grandTotal)}
                  </dd>
                </div>

                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Dibayar</dt>
                  <dd className="tabular">
                    {formatCurrency(purchase.amountPaid)}
                  </dd>
                </div>

                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Sisa</dt>
                  <dd
                    className={
                      outstanding > 0
                        ? "tabular font-medium text-stock-out"
                        : "tabular text-stock-ok"
                    }
                  >
                    {outstanding > 0
                      ? formatCurrency(outstanding)
                      : "Lunas"}
                  </dd>
                </div>
              </dl>

              {purchase.status !== "DRAFT" && outstanding > 0 ? (
                <PaymentForm purchaseId={purchase.id} />
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Informasi</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">Supplier</dt>
                  <dd className="text-right">
                    <Link
                      href={`/suppliers/${purchase.supplier.id}`}
                      className="hover:underline"
                    >
                      {purchase.supplier.name}
                    </Link>
                    <p className="font-mono text-xs text-muted-foreground">
                      {purchase.supplier.code}
                    </p>
                  </dd>
                </div>

                {purchase.supplier.contactPerson ? (
                  <div className="flex justify-between gap-2">
                    <dt className="text-muted-foreground">Narahubung</dt>
                    <dd className="text-right">
                      {purchase.supplier.contactPerson}
                    </dd>
                  </div>
                ) : null}

                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">Dibuat oleh</dt>
                  <dd className="text-right">{purchase.user.name}</dd>
                </div>

                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">Dibuat</dt>
                  <dd className="text-right">
                    {formatDateTime(purchase.createdAt)}
                  </dd>
                </div>
              </dl>

              {purchase.notes ? (
                <p className="mt-3 rounded-md border bg-muted/40 p-3 text-sm">
                  {purchase.notes}
                </p>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function PaymentForm({ purchaseId }: { purchaseId: string }) {
  return (
    <form action={recordPaymentFormAction} className="mt-4 space-y-2 border-t pt-4">
      <label
        htmlFor={`pay-${purchaseId}`}
        className="text-xs font-medium text-muted-foreground"
      >
        Catat pembayaran
      </label>
      <div className="flex gap-2">
        <input type="hidden" name="id" value={purchaseId} />
        <input
          id={`pay-${purchaseId}`}
          name="amount"
          type="number"
          min={1}
          step={1000}
          placeholder="Rp"
          required
          className="tabular h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <Button type="submit" size="sm" variant="outline">
          Catat
        </Button>
      </div>
    </form>
  );
}
