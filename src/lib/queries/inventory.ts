import "server-only";

import { Prisma } from "@/generated/prisma/client";
import type { StockMovementType } from "@/generated/prisma/enums";

import { prisma } from "@/lib/db";
import {
  parsePagination,
  resolveSort,
  searchFilter,
  toPageRequest,
} from "@/lib/pagination";

/** Inventory read queries: stock levels, ledger, and expiry tracking. */

export interface StockListFilters {
  search?: string;
  categoryId?: string;
  stock?: "low" | "out" | "in";
  hasExpiry?: "true" | "false";
  sort?: string;
  direction?: string;
  page?: string;
  perPage?: string;
}

const STOCK_SORT_FIELDS = {
  name: "name",
  sku: "sku",
  stock: "stock",
  sellingPrice: "sellingPrice",
  updatedAt: "updatedAt",
} as const;

/**
 * Resolves ids matching a stock level.
 *
 * The "stock <= minStock" predicate compares two columns, which Prisma cannot
 * express, so it runs as one bounded raw query and composes with the remaining
 * filters via id.
 */
async function idsByStockLevel(
  level: "low" | "out" | "in",
): Promise<string[]> {
  if (level === "low") {
    const rows = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "Product"
      WHERE "isActive" = true AND "minStock" > 0
        AND "stock" > 0 AND "stock" <= "minStock"
      ORDER BY stock ASC LIMIT 500
    `;
    return rows.map((row) => row.id);
  }

  const rows = await prisma.product.findMany({
    where:
      level === "out"
        ? { isActive: true, stock: 0 }
        : { isActive: true, stock: { gt: 0 } },
    select: { id: true },
    take: 500,
  });

  return rows.map((row) => row.id);
}

export async function listStock(filters: StockListFilters) {
  const pagination = parsePagination({
    page: filters.page,
    perPage: filters.perPage,
  });

  const where: Prisma.ProductWhereInput = { isActive: true };

  const search = searchFilter(filters.search, ["name", "sku", "barcode"]);
  if (search.OR) {
    where.OR = search.OR as Prisma.ProductWhereInput[];
  }

  if (filters.categoryId) {
    where.categoryId = filters.categoryId;
  }

  if (filters.hasExpiry === "true") {
    where.hasExpiry = true;
  } else if (filters.hasExpiry === "false") {
    where.hasExpiry = false;
  }

  if (filters.stock) {
    const ids = await idsByStockLevel(filters.stock);

    if (ids.length === 0) {
      return { rows: [], total: 0, pagination: toPageRequest(0, pagination) };
    }

    where.id = { in: ids };
  }

  const orderBy = resolveSort(
    filters.sort as keyof typeof STOCK_SORT_FIELDS,
    filters.direction,
    STOCK_SORT_FIELDS,
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
    select: {
      id: true,
      sku: true,
      name: true,
      unit: true,
      stock: true,
      minStock: true,
      maxStock: true,
      hasExpiry: true,
      purchasePrice: true,
      sellingPrice: true,
      updatedAt: true,
      category: { select: { id: true, name: true } },
    },
  });

  return { rows, total, pagination: pageRequest };
}

export interface MovementFilters {
  search?: string;
  productId?: string;
  type?: string;
  dateFrom?: string;
  dateTo?: string;
  sort?: string;
  direction?: string;
  page?: string;
  perPage?: string;
}

const MOVEMENT_TYPES = [
  "PURCHASE",
  "SALE",
  "RETURN_PURCHASE",
  "RETURN_SALE",
  "ADJUSTMENT_IN",
  "ADJUSTMENT_OUT",
  "DAMAGED",
  "EXPIRED",
  "TRANSFER_IN",
  "TRANSFER_OUT",
  "OPNAME",
  "SALE_VOID",
] as const;

/**
 * The stock ledger.
 *
 * Append-only by design, so this view exposes no update path: a correction is
 * itself a new movement rather than an edit, which is what keeps the history
 * trustworthy.
 */
export async function listMovements(filters: MovementFilters) {
  const pagination = parsePagination({
    page: filters.page,
    perPage: filters.perPage,
  });

  const where: Prisma.InventoryMovementWhereInput = {};

  const search = searchFilter(filters.search, ["note", "referenceType"]);
  if (search.OR) {
    where.OR = search.OR as Prisma.InventoryMovementWhereInput[];
  }

  if (filters.productId) {
    where.productId = filters.productId;
  }

  if (
    filters.type &&
    (MOVEMENT_TYPES as readonly string[]).includes(filters.type)
  ) {
    where.type = filters.type as StockMovementType;
  }

  if (filters.dateFrom || filters.dateTo) {
    where.createdAt = {
      ...(filters.dateFrom ? { gte: new Date(filters.dateFrom) } : {}),
      ...(filters.dateTo ? { lte: endOfDay(filters.dateTo) } : {}),
    };
  }

  const total = await prisma.inventoryMovement.count({ where });
  const pageRequest = toPageRequest(total, pagination);

  const direction = filters.direction === "asc" ? "asc" : "desc";

  const rows = await prisma.inventoryMovement.findMany({
    where,
    // Tie-broken on id. Bulk-seeded and batch-inserted movements share an
    // identical createdAt, so ordering on that column alone is non-deterministic
    // and pagination can repeat or skip rows between pages.
    orderBy: [{ createdAt: direction }, { id: direction }],
    skip: pageRequest.skip,
    take: pageRequest.take,
    select: {
      id: true,
      type: true,
      quantity: true,
      previousStock: true,
      newStock: true,
      note: true,
      referenceType: true,
      referenceId: true,
      createdAt: true,
      product: { select: { id: true, name: true, sku: true, unit: true } },
      user: { select: { id: true, name: true } },
    },
  });

  return { rows, total, pagination: pageRequest };
}

function endOfDay(value: string): Date {
  const date = new Date(value);
  date.setHours(23, 59, 59, 999);
  return date;
}

/** Movement type labels for the ledger UI. */
export const MOVEMENT_LABEL: Record<string, string> = {
  PURCHASE: "Pembelian",
  SALE: "Penjualan",
  RETURN_PURCHASE: "Retur Pembelian",
  RETURN_SALE: "Retur Penjualan",
  ADJUSTMENT_IN: "Penyesuaian Masuk",
  ADJUSTMENT_OUT: "Penyesuaian Keluar",
  DAMAGED: "Rusak",
  EXPIRED: "Kedaluwarsa",
  TRANSFER_IN: "Transfer Masuk",
  TRANSFER_OUT: "Transfer Keluar",
  OPNAME: "Stock Opname",
  SALE_VOID: "Void Penjualan",
};

export interface BatchFilters {
  productId?: string;
  status?: "expiring" | "expired" | "all";
  warningDays?: number;
  page?: string;
  perPage?: string;
}

/**
 * Batches ordered by expiry date.
 *
 * The warning window is configurable; 30 days is the default the spec asks for
 * and what the dashboard widget assumes.
 */
export async function listBatches(filters: BatchFilters) {
  const pagination = parsePagination({
    page: filters.page,
    perPage: filters.perPage,
  });

  const warningDays = filters.warningDays ?? 30;
  const now = new Date();
  const threshold = new Date(now.getTime() + warningDays * 86_400_000);

  const where: Prisma.ProductBatchWhereInput = { quantity: { gt: 0 } };

  if (filters.productId) {
    where.productId = filters.productId;
  }

  if (filters.status === "expiring") {
    where.expiryDate = { gt: now, lte: threshold };
  } else if (filters.status === "expired") {
    where.expiryDate = { lte: now };
  }

  const total = await prisma.productBatch.count({ where });
  const pageRequest = toPageRequest(total, pagination);

  const rows = await prisma.productBatch.findMany({
    where,
    orderBy: { expiryDate: "asc" },
    skip: pageRequest.skip,
    take: pageRequest.take,
    select: {
      id: true,
      batchNumber: true,
      expiryDate: true,
      quantity: true,
      purchasePrice: true,
      product: {
        select: { id: true, name: true, sku: true, unit: true },
      },
    },
  });

  return {
    rows: rows.map((batch) => ({
      ...batch,
      daysRemaining: Math.ceil(
        (batch.expiryDate.getTime() - now.getTime()) / 86_400_000,
      ),
      totalValue: Number(batch.purchasePrice) * batch.quantity,
    })),
    total,
    pagination: pageRequest,
  };
}

/** Aggregate stock position for the inventory header cards. */
export async function getStockSummary() {
  const [aggregate, batchesExpiring, batchesExpired, lowStock, outOfStock] =
    await Promise.all([
      prisma.product.aggregate({
        where: { isActive: true },
        _sum: { stock: true },
        _count: { _all: true },
      }),
      prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*)::bigint AS count FROM "ProductBatch"
        WHERE quantity > 0 AND "expiryDate" > NOW()
          AND "expiryDate" <= NOW() + INTERVAL '30 days'
      `,
      prisma.productBatch.count({
        where: { quantity: { gt: 0 }, expiryDate: { lte: new Date() } },
      }),
      prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*)::bigint AS count FROM "Product"
        WHERE "isActive" = true AND "minStock" > 0
          AND "stock" > 0 AND "stock" <= "minStock"
      `,
      prisma.product.count({ where: { isActive: true, stock: 0 } }),
    ]);

  const valueRows = await prisma.$queryRaw<
    Array<{ total: unknown; units: unknown }>
  >`
    SELECT COALESCE(SUM(stock * "purchasePrice"), 0) AS total,
           COALESCE(SUM(stock), 0) AS units
    FROM "Product" WHERE "isActive" = true
  `;

  return {
    totalUnits: aggregate._sum.stock ?? 0,
    productCount: aggregate._count._all,
    lowStockCount: Number(lowStock[0]?.count ?? 0),
    outOfStockCount: outOfStock,
    expiringBatchCount: Number(batchesExpiring[0]?.count ?? 0),
    expiredBatchCount: batchesExpired,
    stockValue: Number(valueRows[0]?.total ?? 0),
  };
}

