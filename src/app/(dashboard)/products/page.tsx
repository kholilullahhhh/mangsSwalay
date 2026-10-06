import type { Metadata } from "next";
import Link from "next/link";
import { Package, Upload } from "lucide-react";

import { requirePermission, hasPermission } from "@/lib/auth/session";
import {
  listProducts,
  listBrandOptions,
  listCategoryOptions,
  buildProductWhere,
} from "@/lib/queries/products";
import { formatCurrency, formatNumber } from "@/lib/format";
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
import { StockBadge } from "@/components/data/stock-badge";
import {
  TablePagination,
  type PaginationMeta,
} from "@/components/data/table-pagination";
import { EmptyState } from "@/components/data/empty-state";
import { ProductFilters } from "./filters";
import { NewProductButton } from "./new-product-button";

export const metadata: Metadata = {
  title: "Produk",
};

/**
 * Product list.
 *
 * A Server Component: filtering, sorting, and pagination all run in Postgres and
 * only the current page is serialised. Every control is a link or a form, so the
 * view works without client-side JavaScript.
 */
export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Server-side authorisation â€” the real check, not just a hidden menu item.
  await requirePermission("products:view");

  const params = await searchParams;

  const filters = {
    search: asString(params.search),
    categoryId: asString(params.categoryId),
    brandId: asString(params.brandId),
    stock: asStock(params.stock),
    isActive: asActive(params.isActive),
    isFeatured: asBoolean(params.isFeatured),
    sort: asString(params.sort),
    direction: asString(params.direction),
    page: asString(params.page),
    perPage: asString(params.perPage),
  };

  const [{ rows, total, pagination }, categories, brands, canCreate, canImport] =
    await Promise.all([
      listProducts(filters),
      listCategoryOptions(),
      listBrandOptions(),
      hasPermission("products:create"),
      hasPermission("products:import"),
    ]);

  const hasFilters = Boolean(
    filters.search ||
      filters.categoryId ||
      filters.brandId ||
      filters.stock ||
      filters.isActive === "false" ||
      filters.isActive === "all" ||
      filters.isFeatured,
  );

  const paginationMeta: PaginationMeta = {
    ...pagination,
    total,
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Produk</h1>
          <p className="text-sm text-muted-foreground">
            {formatNumber(total)} produk
            {filters.stock === "low" ? " perlu restock" : ""}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {canImport ? (
            <Button variant="outline" size="sm" asChild>
              <Link href="/products/import">
                <Upload className="size-4" aria-hidden />
                Import CSV
              </Link>
            </Button>
          ) : null}

          {canCreate ? (
            <NewProductButton
              categories={categories}
              brands={brands}
            />
          ) : null}
        </div>
      </div>

      <ProductFilters
        categories={categories}
        brands={brands}
        current={filters}
      />

      <Card>
        {rows.length === 0 ? (
          <EmptyState
            icon={Package}
            title={hasFilters ? "Tidak ada produk yang cocok" : "Belum ada produk"}
            description={
              hasFilters
                ? "Coba ubah kata kunci pencarian atau kosongkan filter yang aktif."
                : "Tambahkan produk pertama untuk mulai mencatat stok dan berjualan."
            }
            action={
              hasFilters ? (
                <Button variant="outline" size="sm" asChild>
                  <Link href="/products">Hapus filter</Link>
                </Button>
              ) : canCreate ? (
                <NewProductButton
                  categories={categories}
                  brands={brands}
                  label="Tambah Produk"
                />
              ) : null
            }
          />
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <SortableHead
                    field="name"
                    label="Produk"
                    searchParams={params}
                  />
                  <SortableHead
                    field="sku"
                    label="SKU"
                    searchParams={params}
                  />
                  <TableHead>Kategori</TableHead>
                  <SortableHead
                    field="purchasePrice"
                    label="Harga Beli"
                    searchParams={params}
                  />
                  <SortableHead
                    field="sellingPrice"
                    label="Harga Jual"
                    searchParams={params}
                  />
                  <SortableHead
                    field="stock"
                    label="Stok"
                    searchParams={params}
                  />
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>

              <TableBody>
                {rows.map((product) => (
                  <TableRow key={product.id}>
                    <TableCell>
                      <Link
                        href={`/products/${product.id}`}
                        className="font-medium hover:underline"
                      >
                        {product.name}
                      </Link>
                      {product.barcode ? (
                        <p className="font-mono text-xs text-muted-foreground">
                          {product.barcode}
                        </p>
                      ) : null}
                    </TableCell>

                    <TableCell className="font-mono text-xs">
                      {product.sku}
                    </TableCell>

                    <TableCell>
                      <Badge variant="secondary">
                        {product.category.name}
                      </Badge>
                    </TableCell>

                    <TableCell className="tabular">
                      {formatCurrency(product.purchasePrice)}
                    </TableCell>

                    <TableCell className="tabular font-medium">
                      {formatCurrency(product.sellingPrice)}
                    </TableCell>

                    <TableCell>
                      <StockBadge
                        stock={product.stock}
                        minStock={product.minStock}
                        unit={product.unit}
                      />
                    </TableCell>

                    <TableCell>
                      {!product.isActive ? (
                        <Badge variant="destructive">Nonaktif</Badge>
                      ) : product.isFeatured ? (
                        <Badge variant="outline">Unggulan</Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          {product.hasExpiry ? "Berbatch" : "â€”"}
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            <TablePagination
              pagination={paginationMeta}
              searchParams={serialiseSearchParams(params)}
              total={total}
            />
          </>
        )}
      </Card>
    </div>
  );
}

function SortableHead({
  field,
  label,
  searchParams,
}: {
  field: string;
  label: string;
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const currentSort = asString(searchParams.sort);
  const currentDirection = asString(searchParams.direction);
  const isSorted = currentSort === field;

  // Re-clicking the active column reverses it; a new column starts ascending.
  const nextDirection =
    isSorted && currentDirection === "asc" ? "desc" : "asc";

  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    const single = Array.isArray(value) ? value[0] : value;
    if (single && key !== "sort" && key !== "direction") {
query.set(key, single);
    }
  }

  query.set("sort", field);
    query.set("direction", nextDirection);
    query.delete("page");

  return (
    <TableHead>
      <a
        href={`?${query.toString()}`}
        className="inline-flex items-center gap-1 hover:text-foreground"
      >
        {label}
        <span aria-hidden className="text-[10px]">
          {isSorted ? (currentDirection === "asc" ? "â†‘" : "â†“") : "â†•"}
        </span>
      </a>
    </TableHead>
  );
}

function serialiseSearchParams(
  searchParams: Record<string, string | string[] | undefined>,
): Record<string, string> {
  const output: Record<string, string> = {};

  for (const [key, value] of Object.entries(searchParams)) {
    const single = Array.isArray(value) ? value[0] : value;
    if (single) output[key] = single;
  }

  return output;
}

function asString(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value || undefined;
}

function asStock(
  value: string | string[] | undefined,
): "low" | "out" | "in" | undefined {
  const single = asString(value);
  return single === "low" || single === "out" || single === "in"
    ? single
    : undefined;
}

function asActive(
  value: string | string[] | undefined,
): "true" | "false" | "all" | undefined {
  const single = asString(value);
  return single === "false" || single === "all" ? single : undefined;
}

function asBoolean(
  value: string | string[] | undefined,
): "true" | "false" | undefined {
  const single = asString(value);
  return single === "true" || single === "false" ? single : undefined;
}

export { buildProductWhere };
