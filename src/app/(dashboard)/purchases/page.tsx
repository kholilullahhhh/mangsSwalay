import type { Metadata } from "next";
import Link from "next/link";
import { ShoppingCart } from "lucide-react";

import { requirePagePermission, hasPermission } from "@/lib/auth/session";
import {
  listPurchases,
  listSupplierOptions,
  listPurchaseProductOptions,
  type PurchaseListFilters,
} from "@/lib/queries/purchases";
import {
  PURCHASE_STATUS_LABEL,
  PURCHASE_STATUS_VARIANT,
} from "@/lib/purchases/state-machine";
import { formatCurrency, formatDate, formatNumber } from "@/lib/format";
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

import { PurchaseFilters } from "./filters";
import { NewPurchaseButton } from "./new-purchase-button";

export const metadata: Metadata = {
  title: "Pembelian",
};

/**
 * Purchase order list.
 *
 * Server-rendered with database-side filtering and pagination. Status filters are
 * the primary navigation here, because "what has arrived yet" is the question
 * this screen exists to answer.
 */
export default async function PurchasesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
await requirePagePermission("purchases:view");

  const params = await searchParams;

  const paymentError = single(params.paymentError);
  const paymentRecorded = single(params.payment) === "recorded";

  const filters: PurchaseListFilters = {
    search: single(params.search),
    supplierId: single(params.supplierId),
    status: single(params.status),
    paymentStatus: single(params.paymentStatus),
    dateFrom: single(params.dateFrom),
    dateTo: single(params.dateTo),
    sort: single(params.sort),
    direction: single(params.direction),
    page: single(params.page),
    perPage: single(params.perPage),
  };

const [{ rows, total, pagination }, suppliers, purchaseProducts, canCreate] =
    await Promise.all([
      listPurchases(filters),
      listSupplierOptions(),
      listPurchaseProductOptions(),
      hasPermission("purchases:create"),
    ]);

  const hasFilters = Boolean(
    filters.search ||
      filters.supplierId ||
      filters.status ||
      filters.paymentStatus ||
      filters.dateFrom ||
      filters.dateTo,
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Pembelian</h1>
          <p className="text-sm text-muted-foreground">
            {formatNumber(total)} pesanan pembelian
          </p>
        </div>

{canCreate ? (
          <NewPurchaseButton suppliers={suppliers} products={purchaseProducts} />
        ) : null}
      </div>

      {/* The payment form is a plain server-rendered form with nowhere to render
          an inline error, so its outcome comes back through the URL. Surfacing it
          is the difference between "the payment failed" and "nothing happened". */}
      {paymentRecorded ? (
        <p
          role="status"
          className="rounded-md border border-stock-ok/40 bg-stock-ok/10 px-3 py-2 text-sm text-stock-ok"
        >
          Pembayaran berhasil dicatat.
        </p>
      ) : null}

      {paymentError ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          Pembayaran gagal dicatat: {paymentError}
        </p>
      ) : null}

      <PurchaseFilters suppliers={suppliers} current={filters} />

      <Card>
        {rows.length === 0 ? (
          <EmptyState
            icon={ShoppingCart}
            title={hasFilters ? "Tidak ada pesanan yang cocok" : "Belum ada pembelian"}
            description={
              hasFilters
                ? "Coba ubah filter status atau supplier."
                : "Buat pesanan pembelian untuk mencatat barang yang datang dari supplier."
            }
            action={
              hasFilters ? (
                <Button variant="outline" size="sm" asChild>
                  <Link href="/purchases">Hapus filter</Link>
                </Button>
              ) : null
            }
          />
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nomor</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead>Tanggal</TableHead>
                  <TableHead className="text-center">Item</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Pembayaran</TableHead>
                </TableRow>
              </TableHeader>

              <TableBody>
                {rows.map((purchase) => (
                  <TableRow key={purchase.id}>
                    <TableCell>
                      <Link
                        href={`/purchases/${purchase.id}`}
                        className="font-mono text-sm font-medium hover:underline"
                      >
                        {purchase.number}
                      </Link>
                    </TableCell>

                    <TableCell className="text-sm">
                      {purchase.supplier.name}
                    </TableCell>

                    <TableCell className="text-sm text-muted-foreground">
                      {formatDate(purchase.date)}
                    </TableCell>

                    <TableCell className="text-center tabular text-sm">
                      {purchase.itemCount}
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

                    <TableCell>
                      <PaymentBadge
                        status={purchase.paymentStatus}
                        paid={Number(purchase.amountPaid)}
                        total={Number(purchase.grandTotal)}
                      />
                    </TableCell>
                  </TableRow>
                ))}
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

function PaymentBadge({
  status,
  paid,
  total,
}: {
  status: string;
  paid: number;
  total: number;
}) {
  if (status === "PAID") {
    return (
      <Badge variant="outline" className="border-stock-ok/40 text-stock-ok">
        Lunas
      </Badge>
    );
  }

  const outstanding = Math.max(0, total - paid);

  return (
    <Badge
      variant="outline"
      className={status === "UNPAID" ? "border-stock-out/40 text-stock-out" : "border-stock-low/40 text-stock-low"}
    >
      {status === "UNPAID" ? "Belum bayar" : `Kurang ${formatCurrency(outstanding)}`}
    </Badge>
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

