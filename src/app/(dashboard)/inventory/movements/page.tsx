import type { Metadata } from "next";
import Link from "next/link";
import { FileClock } from "lucide-react";

import { requirePagePermission } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { listMovements, MOVEMENT_LABEL } from "@/lib/queries/inventory";
import { formatDateTime, formatNumber } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
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
import { MovementFilters } from "../movement-filters";

export const metadata: Metadata = {
  title: "Pergerakan Stok",
};

/**
 * The stock ledger.
 *
 * Append-only: every row is a real movement with before/after values, so this
 * view is the audit trail for why any product holds the quantity it holds.
 */
export default async function MovementsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePagePermission("stock:view");

  const params = await searchParams;

const { rows, total, pagination } = await listMovements({
    search: single(params.search),
    productId: single(params.productId),
    type: single(params.type),
    dateFrom: single(params.dateFrom),
    dateTo: single(params.dateTo),
    direction: single(params.direction),
    page: single(params.page),
    perPage: single(params.perPage),
  });

  // Backs the product picker. Capped deliberately: this is a filter, not the
  // catalogue, and a select of ten thousand options is unusable anyway.
  const filterOptions = await prisma.product.findMany({
    where: { isActive: true },
    select: { id: true, name: true, sku: true },
    orderBy: { name: "asc" },
    take: 500,
  });

const serialised: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    const one = Array.isArray(value) ? value[0] : value;
    if (one) serialised[key] = one;
  }

  const filterState = {
    search: single(params.search) ?? "",
    productId: single(params.productId) ?? "",
    type: single(params.type) ?? "",
    dateFrom: single(params.dateFrom) ?? "",
    dateTo: single(params.dateTo) ?? "",
    direction: single(params.direction) ?? "",
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">
          Pergerakan Stok
        </h1>
        <p className="text-sm text-muted-foreground">
          {formatNumber(total)} catatan perubahan stok
        </p>
      </div>

      <Card>
        <MovementFilters
          initial={filterState}
          types={Object.entries(MOVEMENT_LABEL).map(([value, label]) => ({
            value,
            label,
          }))}
          products={filterOptions.map((product) => ({
            id: product.id,
            label: `${product.name} (${product.sku})`,
          }))}
        />
        {rows.length === 0 ? (
          <EmptyState
            icon={FileClock}
            title="Belum ada pergerakan stok"
            description="Setiap penjualan, pembelian, dan penyesuaian akan tercatat di sini."
          />
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Waktu</TableHead>
                  <TableHead>Produk</TableHead>
                  <TableHead>Jenis</TableHead>
                  <TableHead className="text-right">Jumlah</TableHead>
                  <TableHead className="text-right">Sebelum</TableHead>
                  <TableHead className="text-right">Sesudah</TableHead>
                  <TableHead>Oleh</TableHead>
                </TableRow>
              </TableHeader>

<TableBody>
                {rows.map((row) => {
                  // Taken from the row's own arithmetic, not from its type.
                  // `OPNAME` is genuinely bidirectional — an approval can add
                  // stock as easily as remove it — so classifying it by name
                  // rendered a surplus as a red "-5" directly beside the "10 → 15"
                  // on the same row.
                  const delta = row.newStock - row.previousStock;
                  const isIn = delta > 0;

                  return (
                    <TableRow key={row.id}>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatDateTime(row.createdAt)}
                      </TableCell>

                      <TableCell>
                        <Link
                          href={"/products/" + row.product.id}
                          className="text-sm font-medium hover:underline"
                        >
                          {row.product.name}
                        </Link>
                        <p className="font-mono text-xs text-muted-foreground">
                          {row.product.sku}
                        </p>
                      </TableCell>

                      <TableCell>
                        <Badge
                          variant="outline"
                          className={
                            isIn
                              ? "border-stock-ok/40 text-stock-ok"
                              : "border-stock-out/40 text-stock-out"
                          }
                        >
                          {MOVEMENT_LABEL[row.type] ?? row.type}
                        </Badge>
                        {row.note ? (
                          <p className="mt-0.5 max-w-52 truncate text-xs text-muted-foreground">
                            {row.note}
                          </p>
                        ) : null}
                      </TableCell>

<TableCell
                        className={
                          delta === 0
                            ? "tabular text-right font-medium text-muted-foreground"
                            : isIn
                              ? "tabular text-right font-medium text-stock-ok"
                              : "tabular text-right font-medium text-stock-out"
                        }
                      >
                        {delta > 0 ? "+" : delta < 0 ? "-" : ""}
                        {formatNumber(Math.abs(delta))}
                      </TableCell>

                      <TableCell className="tabular text-right text-muted-foreground">
                        {formatNumber(row.previousStock)}
                      </TableCell>

                      <TableCell className="tabular text-right font-medium">
                        {formatNumber(row.newStock)}
                      </TableCell>

                      <TableCell className="text-sm text-muted-foreground">
                        {row.user?.name ?? "Sistem"}
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

function single(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value || undefined;
}

