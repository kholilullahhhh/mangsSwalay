import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { requireAnyPermission, hasPermission } from "@/lib/auth/session";
import { roleHasPermission } from "@/lib/rbac";
import { getSaleById } from "@/lib/sales/mutations";
import {
  canRefund,
  canVoid,
  refundBlockReason,
  remainingReturnable,
  voidBlockReason,
  SALE_STATUS_LABEL,
  SALE_STATUS_VARIANT,
  type SaleState,
} from "@/lib/sales/rules";
import { PAYMENT_METHOD_LABEL } from "@/lib/queries/sales";
import {
  formatCurrency,
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

import { SaleActions, RefundForm } from "./actions";

export const metadata: Metadata = {
  title: "Detail Penjualan",
};

/**
 * Sale detail: the receipt view plus the void and refund controls.
 *
 * Action availability is derived from the same pure rules the server enforces,
 * and the reason an action is blocked is shown rather than silently omitting the
 * button.
 */
export default async function SaleDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  // Either grant opens the screen. A cashier holds `sales:view-own` only, and
  // "Penjualan Saya" links every one of their invoices here — gating on
  // `sales:view` alone made that link lead to a 403.
  const user = await requireAnyPermission(["sales:view", "sales:view-own"]);
  const scopedToSelf = !roleHasPermission(user.role, "sales:view");

  const { id } = await params;
  const sale = await getSaleById(id);

  // Widening the gate is only safe if the read is scoped with it: someone who
  // may only see their own takings must not reach another's invoice by guessing
  // the id out of the URL.
  if (!sale || (scopedToSelf && sale.userId !== user.id)) {
    notFound();
  }

  const status = sale.status as SaleState;
  const hasRefunds = sale.refunds.length > 0;

  const refundable = sale.items.map((item) => ({
    saleItemId: item.id,
    productId: item.productId,
    name: item.product.name,
    quantity: item.quantity,
    returnedQty: item.returnedQty,
    subtotal: Number(item.subtotal),
    refundedAmount: Number(
      item.refundItems.reduce((sum, entry) => sum + Number(entry.amount), 0),
    ),
  }));

  const canVoidSale = canVoid(status, hasRefunds);
  const canRefundSale = canRefund(status, refundable);

  const [canVoidPermission, canRefundPermission] = await Promise.all([
    hasPermission("sales:void"),
    hasPermission("sales:refund"),
  ]);

  const refundedTotal = sale.refunds.reduce(
    (sum, refund) => sum + Number(refund.totalRefund),
    0,
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Button variant="ghost" size="sm" asChild className="-ml-2 mb-1">
            <Link href="/sales">
              <ArrowLeft className="size-4" aria-hidden />
              Kembali
            </Link>
          </Button>

          <h1 className="flex flex-wrap items-center gap-2 font-mono text-lg font-semibold tracking-tight">
            {sale.invoiceNumber}
            <Badge variant={SALE_STATUS_VARIANT[status] ?? "outline"}>
              {SALE_STATUS_LABEL[status] ?? sale.status}
            </Badge>
          </h1>

          <p className="text-sm text-muted-foreground">
            {formatDateTime(sale.date)} · Kasir {sale.user.name}
          </p>
        </div>

        <div className="flex gap-2">

          {canRefundPermission && canRefundSale ? (
            <RefundForm
              saleId={sale.id}
              items={refundable.map((item) => ({
                saleItemId: item.saleItemId,
                name: item.name,
                remaining: remainingReturnable(item),
              }))}
            />
          ) : null}

          {canVoidPermission ? (
            <SaleActions
              saleId={sale.id}
              canVoid={canVoidSale}
              voidBlockedReason={voidBlockReason(status, hasRefunds)}
            />
          ) : null}
        </div>
      </div>

      {status === "VOID" ? (
        <Alert variant="destructive">
          <AlertTitle>Transaksi dibatalkan (void)</AlertTitle>
          <AlertDescription>
            Stok telah dikembalikan ke gudang
            {sale.voidedAt ? " pada " + formatDateTime(sale.voidedAt) : ""}.
            {sale.voidReason ? " Alasan: " + sale.voidReason : ""}
          </AlertDescription>
        </Alert>
      ) : null}

      {canRefundPermission && !canRefundSale ? (
        <Alert>
          <AlertTitle>Retur tidak tersedia</AlertTitle>
          <AlertDescription>
            {refundBlockReason(status, refundable)}
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
                  <TableHead className="text-right">Harga</TableHead>
                  <TableHead className="text-right">Subtotal</TableHead>
                  <TableHead className="text-right">Retur</TableHead>
                </TableRow>
              </TableHeader>

              <TableBody>
                {sale.items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      <p className="font-medium">{item.product.name}</p>
                      <p className="font-mono text-xs text-muted-foreground">
                        {item.product.sku}
                      </p>
                    </TableCell>
                    <TableCell className="tabular text-right">
                      {formatNumber(item.quantity)}
                    </TableCell>
                    <TableCell className="tabular text-right">
                      {formatCurrency(item.price)}
                    </TableCell>
                    <TableCell className="tabular text-right font-medium">
                      {formatCurrency(item.subtotal)}
                    </TableCell>
                    <TableCell className="tabular text-right">
                      {item.returnedQty > 0 ? (
                        <span className="text-stock-out">
                          {formatNumber(item.returnedQty)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
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
                  <dd className="tabular">{formatCurrency(sale.subtotal)}</dd>
                </div>

                {Number(sale.discount) > 0 ? (
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Diskon</dt>
                    <dd className="tabular text-stock-ok">
                      -{formatCurrency(sale.discount)}
                    </dd>
                  </div>
                ) : null}

                {Number(sale.tax) > 0 ? (
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Pajak</dt>
                    <dd className="tabular">{formatCurrency(sale.tax)}</dd>
                  </div>
                ) : null}

                <div className="flex justify-between border-t pt-2 text-base font-semibold">
                  <dt>Total</dt>
                  <dd className="tabular">{formatCurrency(sale.total)}</dd>
                </div>

                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Metode</dt>
                  <dd>{PAYMENT_METHOD_LABEL[sale.paymentMethod]}</dd>
                </div>

                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Dibayar</dt>
                  <dd className="tabular">{formatCurrency(sale.amountPaid)}</dd>
                </div>

                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Kembalian</dt>
                  <dd className="tabular">{formatCurrency(sale.change)}</dd>
                </div>

                {refundedTotal > 0 ? (
                  <div className="flex justify-between border-t pt-2">
                    <dt className="text-muted-foreground">Sudah diretur</dt>
                    <dd className="tabular font-medium text-stock-out">
                      -{formatCurrency(refundedTotal)}
                    </dd>
                  </div>
                ) : null}
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Pelanggan</CardTitle>
            </CardHeader>
            <CardContent className="text-sm">
              {sale.customer ? (
                <dl className="space-y-1">
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Nama</dt>
                    <dd>
                      <Link
                        href={"/customers/" + sale.customer.id}
                        className="hover:underline"
                      >
                        {sale.customer.name}
                      </Link>
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Telepon</dt>
                    <dd>{sale.customer.phone ?? "-"}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Member</dt>
                    <dd>{sale.customer.memberNumber ?? "-"}</dd>
                  </div>
                  {sale.pointsEarned > 0 ? (
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Poin</dt>
                      <dd className="tabular">+{sale.pointsEarned}</dd>
                    </div>
                  ) : null}
                </dl>
              ) : (
                <p className="text-muted-foreground">
                  Transaksi umum (tanpa data pelanggan).
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {sale.refunds.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Riwayat Retur</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-3">
              {sale.refunds.map((refund) => (
                <li key={refund.id} className="rounded-md border p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-mono text-sm font-medium">
                      {refund.number}
                    </span>
                    <span className="tabular font-semibold text-stock-out">
                      -{formatCurrency(refund.totalRefund)}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {formatDateTime(refund.date)} · oleh {refund.approver.name}
                  </p>
                  <p className="mt-1 text-xs">{refund.reason}</p>
                  <ul className="mt-2 space-y-0.5">
                    {refund.items.map((item, index) => (
                      <li key={index} className="text-xs text-muted-foreground">
                        {formatNumber(item.quantity)} unit ·{" "}
                        {formatCurrency(item.amount)} ·{" "}
                        {item.condition === "DAMAGED"
                          ? "rusak (tidak kembali ke stok jual)"
                          : "baik (kembali ke stok)"}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}


