import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, CalendarClock } from "lucide-react";

import { requirePagePermission } from "@/lib/auth/session";
import { listBatches } from "@/lib/queries/inventory";
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

export const metadata: Metadata = {
  title: "Batch & Expiry",
};

/**
 * Batch and expiry tracking.
 *
 * Expiry is the reason a minimarket writes off stock, so this screen is
 * ordered by soonest expiry rather than by product name: the actionable batches
 * are the ones nearest the front.
 */
export default async function BatchesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePagePermission("stock:batches");

  const params = await searchParams;

  const statusParam = single(params.status);
  const status =
    statusParam === "expiring" || statusParam === "expired" || statusParam === "all"
      ? statusParam
      : "expiring";

  const { rows, total, pagination } = await listBatches({
    status,
    page: single(params.page),
    perPage: single(params.perPage),
  });

  const serialised: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    const one = Array.isArray(value) ? value[0] : value;
    if (one) serialised[key] = one;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">
            Batch &amp; Kedaluwarsa
          </h1>
          <p className="text-sm text-muted-foreground">
            {formatNumber(total)} batch
          </p>
        </div>

        <Button variant="ghost" size="sm" asChild>
          <Link href="/inventory">
            <ArrowLeft className="size-4" aria-hidden />
            Kembali ke stok
          </Link>
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        <StatusTab
          label="Mendekati kedaluwarsa (30 hari)"
          value="expiring"
          active={status === "expiring"}
        />
        <StatusTab
          label="Sudah kedaluwarsa"
          value="expired"
          active={status === "expired"}
        />
        <StatusTab
          label="Semua batch"
          value="all"
          active={status === "all"}
        />
      </div>

      <Card>
        {rows.length === 0 ? (
          <EmptyState
            icon={CalendarClock}
            title={
              status === "expired"
                ? "Tidak ada barang kedaluwarsa"
                : "Tidak ada batch mendekati kedaluwarsa"
            }
            description="Barang nearing expiry akan muncul di sini beserta tanggalnya."
          />
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Produk</TableHead>
                  <TableHead>Nomor Batch</TableHead>
                  <TableHead>Kedaluwarsa</TableHead>
                  <TableHead>Sisa Waktu</TableHead>
                  <TableHead className="text-right">Jumlah</TableHead>
                  <TableHead className="text-right">Nilai</TableHead>
                </TableRow>
              </TableHeader>

              <TableBody>
                {rows.map((batch) => {
                  const expired = batch.daysRemaining <= 0;
                  const critical = !expired && batch.daysRemaining <= 7;

                  return (
                    <TableRow key={batch.id}>
                      <TableCell>
                        <Link
                          href={"/products/" + batch.product.id}
                          className="font-medium hover:underline"
                        >
                          {batch.product.name}
                        </Link>
                        <p className="font-mono text-xs text-muted-foreground">
                          {batch.product.sku}
                        </p>
                      </TableCell>

                      <TableCell className="font-mono text-xs">
                        {batch.batchNumber}
                      </TableCell>

                      <TableCell className="text-sm">
                        {formatDate(batch.expiryDate)}
                      </TableCell>

                      <TableCell>
                        <Badge
                          variant={
                            expired
                              ? "destructive"
                              : critical
                                ? "outline"
                                : "secondary"
                          }
                          className={
                            expired
                              ? ""
                              : critical
                                ? "border-stock-expiring/40 text-stock-expiring"
                                : ""
                          }
                        >
                          {expired
                            ? "Kedaluwarsa"
                            : batch.daysRemaining + " hari"}
                        </Badge>
                      </TableCell>

                      <TableCell className="tabular text-right">
                        {formatNumber(batch.quantity)} {batch.product.unit}
                      </TableCell>

                      <TableCell className="tabular text-right">
                        {formatCurrency(batch.totalValue)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>

            <TablePagination
              pagination={{ ...pagination, total } as PaginationMeta}
              searchParams={serialised}
              total={total}
            />
          </>
        )}
      </Card>
    </div>
  );
}

function StatusTab({
  label,
  value,
  active,
}: {
  label: string;
  value: string;
  active: boolean;
}) {
  return (
    <Button
      size="sm"
      variant={active ? "secondary" : "ghost"}
      asChild
    >
      <Link href={value === "all" ? "/inventory/batches" : "/inventory/batches?status=" + value}>
        {label}
      </Link>
    </Button>
  );
}

function single(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value || undefined;
}


