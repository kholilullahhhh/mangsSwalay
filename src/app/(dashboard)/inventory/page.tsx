import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, Boxes, CalendarClock, ClipboardList, Package } from "lucide-react";

import { requirePagePermission, hasPermission } from "@/lib/auth/session";
import { getStockSummary, listStock, type StockListFilters } from "@/lib/queries/inventory";
import { listCategoryOptions } from "@/lib/queries/products";
import { formatCurrency, formatNumber } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StockBadge } from "@/components/data/stock-badge";
import {
  TablePagination,
  type PaginationMeta,
} from "@/components/data/table-pagination";
import { EmptyState } from "@/components/data/empty-state";
import { StockFilters } from "./filters";

export const metadata: Metadata = {
  title: "Stok",
};

/**
 * Stock overview.
 *
 * Read-only by design: stock is never edited from this screen. It changes
 * through a purchase receipt, a sale, an adjustment, or an approved opname, so
 * every unit can be traced to a reason.
 */
export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePagePermission("stock:view");

  const params = await searchParams;

  const stockParam = single(params.stock);
  const stockLevel =
    stockParam === "low" || stockParam === "out" || stockParam === "in"
      ? stockParam
      : undefined;

  const expiryParam = single(params.hasExpiry);
  const hasExpiryFilter =
    expiryParam === "true" || expiryParam === "false" ? expiryParam : undefined;

  const filters: StockListFilters = {
    search: single(params.search),
    categoryId: single(params.categoryId),
    stock: stockLevel,
hasExpiry: hasExpiryFilter,
    sort: single(params.sort),
    direction: single(params.direction),
    page: single(params.page),
    perPage: single(params.perPage),
  };

  // One call, not one per field: running listStock per value would issue three
  // identical COUNT+SELECT pairs.
  const [summary, stock, categories, canAdjust, canOpname] = await Promise.all([
    getStockSummary(),
    listStock(filters),
    listCategoryOptions(),
    hasPermission("stock:adjust"),
    hasPermission("stock:opname"),
  ]);

  const { rows, total, pagination } = stock;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Stok</h1>
          <p className="text-sm text-muted-foreground">
            {formatNumber(summary.productCount)} produk aktif
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {canOpname ? (
            <Button variant="outline" size="sm" asChild>
              <Link href="/inventory/opname">
                <ClipboardList className="size-4" aria-hidden />
                Stock Opname
              </Link>
            </Button>
          ) : null}
          {canAdjust ? (
            <Button size="sm" asChild>
              <Link href="/inventory/adjustment">
                <AlertTriangle className="size-4" aria-hidden />
                Adjustment Stok
              </Link>
            </Button>
          ) : null}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryTile
          label="Total unit"
          value={formatNumber(summary.totalUnits)}
          icon={Boxes}
        />
        <SummaryTile
          label="Nilai persediaan"
          value={formatCurrency(summary.stockValue)}
          icon={Package}
        />
        <SummaryTile
          label="Perlu restock"
          value={formatNumber(summary.lowStockCount)}
          icon={AlertTriangle}
          tone={summary.lowStockCount > 0 ? "warning" : "default"}
        />
        <SummaryTile
          label="Batch mendekati kedaluwarsa"
          value={formatNumber(summary.expiringBatchCount)}
          icon={CalendarClock}
          tone={summary.expiringBatchCount > 0 ? "warning" : "default"}
        />
      </div>

      <StockFilters
        categories={categories}
        current={{
          search: filters.search,
          categoryId: filters.categoryId,
          stock: filters.stock,
          hasExpiry: filters.hasExpiry,
        }}
        lowStockCount={summary.lowStockCount}
        outOfStockCount={summary.outOfStockCount}
      />

      <Card>
        {rows.length === 0 ? (
          <EmptyState
            icon={Boxes}
            title={
              filters.stock === "low"
                ? "Semua stok aman"
                : filters.stock === "out"
                  ? "Tidak ada produk tanpa stok"
                  : "Tidak ada produk"
            }
            description={
              filters.stock === "low"
                ? "Tidak ada produk yang berada di bawah atau sama dengan stok minimum."
                : "Coba ubah filter atau kata kunci pencarian."
            }
          />
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Produk</TableHead>
                  <TableHead>Kategori</TableHead>
                  <TableHead className="text-right">Stok</TableHead>
                  <TableHead className="text-right">Min</TableHead>
                  <TableHead className="text-right">Harga Beli</TableHead>
                  <TableHead className="text-right">Nilai</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>

              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <Link
                        href={`/products/${row.id}`}
                        className="font-medium hover:underline"
                      >
                        {row.name}
                      </Link>
                      <p className="font-mono text-xs text-muted-foreground">
                        {row.sku}
                      </p>
                    </TableCell>

                    <TableCell>
                      <Badge variant="secondary">{row.category.name}</Badge>
                    </TableCell>

                    <TableCell className="tabular text-right text-base font-semibold">
                      {formatNumber(row.stock)}
                    </TableCell>

                    <TableCell className="tabular text-right text-muted-foreground">
                      {row.minStock > 0 ? formatNumber(row.minStock) : "-"}
                    </TableCell>

                    <TableCell className="tabular text-right">
                      {formatCurrency(row.purchasePrice)}
                    </TableCell>

                    <TableCell className="tabular text-right">
                      {formatCurrency(
                        Number(row.purchasePrice) * row.stock,
                      )}
                    </TableCell>

                    <TableCell>
                      <StockBadge
                        stock={row.stock}
                        minStock={row.minStock}
                        unit={row.unit}
                      />
                      {row.hasExpiry ? (
                        <Badge
                          variant="outline"
                          className="ml-1 text-[10px]"
                        >
                          Batch
                        </Badge>
                      ) : null}
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

function SummaryTile({
  label,
  value,
  icon: Icon,
  tone = "default",
}: {
  label: string;
  value: string;
  icon: typeof Boxes;
  tone?: "default" | "warning";
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-4 p-5">
        <span
          className={
            tone === "warning"
              ? "flex size-10 items-center justify-center rounded-lg bg-stock-low/15 text-stock-low"
              : "flex size-10 items-center justify-center rounded-lg bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-300"
          }
          aria-hidden
        >
          <Icon className="size-5" />
        </span>
        <div className="min-w-0">
          <p className="tabular text-xl font-semibold tracking-tight">
            {value}
          </p>
          <p className="truncate text-xs text-muted-foreground">{label}</p>
        </div>
      </CardContent>
    </Card>
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




