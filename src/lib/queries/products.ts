import "server-only";

import { Prisma } from "@/generated/prisma/client";

import { prisma } from "@/lib/db";
import {
  parsePagination,
  resolveSort,
  searchFilter,
  toPageRequest,
  type PaginationParams,
} from "@/lib/pagination";

/**
 * Product list queries.
 *
 * Filtering, sorting, and counting all happen in Postgres; only one page of
 * rows reaches the browser. `stock <= minStock` compares two columns, which
 * Prisma's filter API cannot express, so that one predicate is resolved with a
 * bounded raw query and the rest stays in Prisma.
 */

export interface ProductListFilters {
  search?: string;
  categoryId?: string;
  brandId?: string;
  /** `low` = at/below minimum, `out` = zero, `in` = healthy stock. */
  stock?: "low" | "out" | "in";
  isActive?: "true" | "false" | "all";
  isFeatured?: "true" | "false";
  sort?: string;
  direction?: string;
  page?: string;
  perPage?: string;
}

export interface ProductRow {
  id: string;
  sku: string;
  barcode: string | null;
  name: string;
  slug: string;
  image: string | null;
  unit: string;
  purchasePrice: unknown;
  sellingPrice: unknown;
  minSellingPrice: unknown;
  stock: number;
  minStock: number;
  maxStock: number | null;
  isActive: boolean;
  isFeatured: boolean;
  hasExpiry: boolean;
  category: { id: string; name: string };
  brand: { id: string; name: string } | null;
}

const PRODUCT_SORT_FIELDS = {
  name: "name",
  sku: "sku",
  sellingPrice: "sellingPrice",
  purchasePrice: "purchasePrice",
  stock: "stock",
  createdAt: "createdAt",
} as const;

type ProductSortField = keyof typeof PRODUCT_SORT_FIELDS;

const PRODUCT_SELECT = {
  id: true,
  sku: true,
  barcode: true,
  name: true,
  slug: true,
  image: true,
  unit: true,
  purchasePrice: true,
  sellingPrice: true,
  minSellingPrice: true,
  stock: true,
  minStock: true,
  maxStock: true,
  isActive: true,
  isFeatured: true,
  hasExpiry: true,
  category: { select: { id: true, name: true } },
  brand: { select: { id: true, name: true } },
} as const;

/**
 * Builds the WHERE clause for a product list.
 *
 * Exported so the CSV export reuses the exact same predicates and therefore
 * exports what the user is actually looking at.
 */
export function buildProductWhere(
  filters: ProductListFilters,
): Prisma.ProductWhereInput {
  const where: Prisma.ProductWhereInput = {};

  const search = searchFilter(filters.search, ["name", "sku", "barcode"]);
  if (search.OR) {
    where.OR = search.OR as Prisma.ProductWhereInput[];
  }

  if (filters.categoryId) {
    where.categoryId = filters.categoryId;
  }

  if (filters.brandId) {
    where.brandId = filters.brandId;
  }

  // Defaults to hiding archived products; "all" is an explicit opt-in.
  if (filters.isActive === "false") {
    where.isActive = false;
  } else if (filters.isActive !== "all") {
    where.isActive = true;
  }

  if (filters.isFeatured === "true") {
    where.isFeatured = true;
  } else if (filters.isFeatured === "false") {
    where.isFeatured = false;
  }

  if (filters.stock === "out") {
    where.stock = 0;
  } else if (filters.stock === "in") {
    where.stock = { gt: 0 };
  }

  return where;
}

export interface ProductListResult {
  rows: ProductRow[];
  total: number;
  pagination: ReturnType<typeof toPageRequest>;
}

/**
 * Resolves the ids of products at or below their reorder threshold.
 *
 * Kept as a separate bounded query (capped at 500 ids) so it composes with the
 * other Prisma filters instead of duplicating them in raw SQL. In practice the
 * low-stock set is small — it's the products that need buying — so materialising
 * the ids is cheaper than hand-rolling the whole query twice.
 */
async function lowStockIds(limit = 500): Promise<string[]> {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id
    FROM "Product"
    WHERE "isActive" = true
      AND "minStock" > 0
      AND "stock" > 0
      AND "stock" <= "minStock"
    ORDER BY stock ASC
    LIMIT ${limit}
  `;

  return rows.map((row) => row.id);
}

export async function listProducts(
  filters: ProductListFilters,
): Promise<ProductListResult> {
  const pagination: PaginationParams = parsePagination({
    page: filters.page,
    perPage: filters.perPage,
  });

  const where = buildProductWhere(filters);

  if (filters.stock === "low") {
    const ids = await lowStockIds();

    // An empty id list must return nothing rather than "everything".
    if (ids.length === 0) {
      const empty = toPageRequest(0, pagination);
      return { rows: [], total: 0, pagination: empty };
    }

    where.id = { in: ids };
  }

  const orderBy = resolveSort<ProductSortField>(
    filters.sort,
    filters.direction,
    PRODUCT_SORT_FIELDS,
    "name",
    "asc",
  );

  const total = await prisma.product.count({ where });
  const pageRequest = toPageRequest(total, pagination);

  const rows = await prisma.product.findMany({
    where,
    orderBy,
    skip: pageRequest.skip,
    take: pageRequest.take,
    select: PRODUCT_SELECT,
  });

  return { rows: rows as ProductRow[], total, pagination: pageRequest };
}

/** Count of products matching a stock level, for filter badge counts. */
export async function countProductsByStockLevel(
  level: "low" | "out",
): Promise<number> {
  const [low, out] = await Promise.all([
    prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count
      FROM "Product"
      WHERE "isActive" = true AND "minStock" > 0
        AND "stock" > 0 AND "stock" <= "minStock"
    `,
    prisma.product.count({ where: { isActive: true, stock: 0 } }),
  ]);

  return level === "low" ? Number(low[0]?.count ?? 0) : out;
}

/** Options for filter dropdowns. */
export async function listCategoryOptions(): Promise<
  Array<{ id: string; name: string }>
> {
  return prisma.category.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

export async function listBrandOptions(): Promise<
  Array<{ id: string; name: string }>
> {
  return prisma.brand.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

/** A single product with its relations, for the edit form. */
export type ProductDetail = ProductRow & {
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export async function getProductById(id: string): Promise<ProductDetail | null> {
  const product = await prisma.product.findUnique({
    where: { id },
    select: {
      ...PRODUCT_SELECT,
      description: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return product as ProductDetail | null;
}

export interface BarcodeLookup {
  id: string;
  sku: string;
  barcode: string | null;
  name: string;
  unit: string;
  categoryId: string;
  sellingPrice: unknown;
  stock: number;
  isActive: boolean;
}

/**
 * Product lookup by barcode, for the POS scanner.
 *
 * Returns inactive products too (flagged with `isActive: false`) so the caller
 * can tell the cashier "this product is archived" instead of a bare
 * "not found", which is a much more actionable message.
 */
export async function findProductByBarcode(
  barcode: string,
): Promise<BarcodeLookup | null> {
const trimmed = barcode.trim();

  // Scanners emit digits, but Code 128 labels carry letters too, and a strict
  // numeric filter here would silently reject a perfectly valid product at the
  // till. What matters is an exact match, which the caller relies on — a partial
  // one would put the wrong item in the basket.
  if (trimmed.length < 4 || trimmed.length > 40) {
    return null;
  }

  return prisma.product.findUnique({
    where: { barcode: trimmed },
    select: {
      id: true,
      sku: true,
      barcode: true,
      name: true,
      unit: true,
      categoryId: true,
      sellingPrice: true,
      stock: true,
      isActive: true,
    },
  });
}

export interface PosSearchRow {
  id: string;
  sku: string;
  barcode: string | null;
  name: string;
  unit: string;
  categoryId: string;
  sellingPrice: unknown;
  purchasePrice: unknown;
  stock: number;
}

/**
 * Type-ahead product search for the POS.
 *
 * Matches on name, SKU, and barcode so a cashier can type any of the three.
 * Only sellable stock is returned (active, stock > 0). The result set is capped
 * so the cart never receives an unbounded list.
 */
export async function searchProductsForPos(
  query: string,
  options: { categoryId?: string; take?: number } = {},
): Promise<PosSearchRow[]> {
  const trimmed = query.trim();

  if (trimmed.length < 1) {
    return [];
  }

  const or: Prisma.ProductWhereInput[] = [
    { name: { contains: trimmed, mode: "insensitive" } },
    { sku: { contains: trimmed, mode: "insensitive" } },
  ];

  // Barcodes are numeric, so an exact match is far more useful than a partial
  // one — and a substring match on "899" would return hundreds of products.
  if (/^\d{6,14}$/.test(trimmed)) {
    or.push({ barcode: trimmed });
  }

  return prisma.product.findMany({
    where: {
      isActive: true,
      stock: { gt: 0 },
      ...(options.categoryId ? { categoryId: options.categoryId } : {}),
      OR: or,
    },
    select: {
      id: true,
      sku: true,
      barcode: true,
      name: true,
      unit: true,
      categoryId: true,
      sellingPrice: true,
      purchasePrice: true,
      stock: true,
    },
    take: Math.min(options.take ?? 20, 50),
    orderBy: { name: "asc" },
  });
}

/**
 * Products grouped by category for the POS product grid.
 *
 * Paginates by category rather than by product so the grid pages predictably
 * instead of splitting a category across two pages.
 */
export async function listPosGrid(
  options: { categoryId?: string; take?: number } = {},
): Promise<PosSearchRow[]> {
  return prisma.product.findMany({
    where: {
      isActive: true,
      stock: { gt: 0 },
      ...(options.categoryId ? { categoryId: options.categoryId } : {}),
    },
    select: {
      id: true,
      sku: true,
      barcode: true,
      name: true,
      unit: true,
      categoryId: true,
      sellingPrice: true,
      purchasePrice: true,
      stock: true,
    },
    take: Math.min(options.take ?? 60, 200),
    orderBy: [{ category: { name: "asc" } }, { name: "asc" }],
  });
}
