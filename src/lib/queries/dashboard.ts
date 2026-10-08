import "server-only";

import { prisma } from "@/lib/db";
import type { SaleStatus } from "@/generated/prisma/enums";
import {
  startOfStoreDay,
  startOfStoreDayOffset,
  startOfStoreMonth,
} from "@/lib/format";

/**
 * Dashboard queries.
 *
 * Every function here is scoped to "today" in the store timezone (WIB), not the
 * server's timezone, so a store that opens at 07:00 doesn't see yesterday's
 * takings as today's. Aggregations run in Postgres rather than in JavaScript,
 * and only the columns the cards render are selected.
 */

/**
 * Sale statuses that represent money the store actually collected.
 *
 * A voided sale collected nothing. A fully refunded sale also nets to nothing,
 * but a *partially* refunded one still collected most of it — so counting only
 * COMPLETED (as this file used to) made the dashboard disagree with the reports,
 * which have always used both. One definition, used everywhere.
 */
const REVENUE_STATUSES: SaleStatus[] = [
  "COMPLETED",
  "PARTIALLY_REFUNDED",
];

export interface DashboardSummary {
  salesToday: number;
  salesTodayCount: number;
  salesTodayPrevious: number;
  salesMonth: number;
  salesMonthCount: number;
  salesMonthPrevious: number;
  productsSoldToday: number;
  totalStock: number;
  lowStockCount: number;
  outOfStockCount: number;
  expensesToday: number;
  expensesMonth: number;
  receivable: number;
}

/**
 * Headline metrics for the dashboard overview.
 *
 * Deliberately store-wide regardless of role: a cashier still benefits from
 * seeing total sales, and role-specific figures (e.g. per-cashier performance)
 * are exposed through their own permission-gated queries.
 */
export async function getSummary(): Promise<DashboardSummary> {
  const now = new Date();
  const todayStart = startOfStoreDay(now);
  const yesterdayStart = startOfStoreDayOffset(1, now);
  const monthStart = startOfStoreMonth(now);

  const [
    todayAgg,
    yesterdayAgg,
    monthAgg,
    itemsSold,
    stockAgg,
    lowStockCount,
    outOfStockCount,
    expensesToday,
    expensesMonth,
  ] = await Promise.all([
    // Voided sales are excluded everywhere: they are not revenue.
    prisma.sale.aggregate({
      where: { date: { gte: todayStart }, status: { in: REVENUE_STATUSES } },
      _sum: { total: true },
      _count: { _all: true },
    }),
    prisma.sale.aggregate({
      where: { date: { gte: yesterdayStart, lt: todayStart }, status: { in: REVENUE_STATUSES } },
      _sum: { total: true },
    }),
    prisma.sale.aggregate({
      where: { date: { gte: monthStart }, status: { in: REVENUE_STATUSES } },
      _sum: { total: true },
      _count: { _all: true },
    }),
    prisma.saleItem.aggregate({
      where: { sale: { date: { gte: todayStart }, status: { in: REVENUE_STATUSES } } },
      _sum: { quantity: true },
    }),
    prisma.product.aggregate({
      where: { isActive: true },
      _sum: { stock: true },
    }),
    getLowStockCount(),
    prisma.product.count({
      where: { isActive: true, stock: 0 },
    }),
    prisma.expense.aggregate({
      where: { date: { gte: todayStart } },
      _sum: { amount: true },
    }),
    prisma.expense.aggregate({
      where: { date: { gte: monthStart } },
      _sum: { amount: true },
    }),
  ]);

  const salesToday = toNumber(todayAgg._sum.total);
  const salesMonth = toNumber(monthAgg._sum.total);

  return {
    salesToday,
    salesTodayCount: todayAgg._count._all,
    salesTodayPrevious: toNumber(yesterdayAgg._sum.total),
    salesMonth,
    salesMonthCount: monthAgg._count._all,
    salesMonthPrevious: 0,
    productsSoldToday: itemsSold._sum.quantity ?? 0,
    totalStock: stockAgg._sum.stock ?? 0,
    lowStockCount,
    outOfStockCount,
    expensesToday: toNumber(expensesToday._sum.amount),
    expensesMonth: toNumber(expensesMonth._sum.amount),
    receivable: 0,
  };
}

function toNumber(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") return value;
  const candidate = value as { toNumber?: () => number };
  if (typeof candidate.toNumber === "function") return candidate.toNumber();
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Counts products at or below their reorder threshold.
 *
 * `stock <= minStock` compares two columns, which Prisma's filter API cannot
 * express, so this runs one raw SQL statement instead. Doing it in Postgres
 * avoids pulling every candidate product into the Node process.
 */
async function getLowStockCount(): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*)::bigint AS count
    FROM "Product"
    WHERE "isActive" = true
      AND "stock" > 0
      AND "minStock" > 0
      AND "stock" <= "minStock"
  `;

  return Number(rows[0]?.count ?? 0);
}

export interface DailySalesPoint {
  date: string;
  label: string;
  total: number;
  transactions: number;
}

/**
 * Sales totals per day for a trailing window.
 *
 * Groups in SQL via `date_trunc` on the store timezone rather than grouping in
 * JavaScript, so a 30-day window doesn't pull 30 days of individual sales into
 * the server process.
 */
export async function getSalesTrend(
  days: 7 | 30,
): Promise<DailySalesPoint[]> {
  const now = new Date();
  const start = startOfStoreDayOffset(days - 1, now);

  const rows = await prisma.$queryRaw<
    Array<{ day: Date; total: unknown; transactions: bigint }>
  >`
    SELECT
      date_trunc('day', "date" AT TIME ZONE 'Asia/Jakarta') AS day,
      COALESCE(SUM(total), 0) AS total,
      COUNT(*) AS transactions
    FROM "Sale"
    WHERE "date" >= ${start}
      AND status IN ('COMPLETED', 'PARTIALLY_REFUNDED')
    GROUP BY 1
    ORDER BY 1 ASC
  `;

  const byDay = new Map<string, { total: number; transactions: number }>();

  for (const row of rows) {
    const key = toDayKey(row.day);
    byDay.set(key, {
      total: toNumber(row.total),
      transactions: Number(row.transactions),
    });
  }

  // Fill gaps so the chart shows zero-sales days instead of skipping them.
  const points: DailySalesPoint[] = [];

  for (let offset = days - 1; offset >= 0; offset--) {
    const day = startOfStoreDayOffset(offset, now);
    const key = toDayKey(day);
    const entry = byDay.get(key);

    points.push({
      date: key,
      label: new Intl.DateTimeFormat("id-ID", {
        day: "numeric",
        month: "short",
        timeZone: "Asia/Jakarta",
      }).format(day),
      total: entry?.total ?? 0,
      transactions: entry?.transactions ?? 0,
    });
  }

  return points;
}

/**
 * Day bucket key for a value Postgres grouped with
 * `date_trunc('day', "date" AT TIME ZONE 'Asia/Jakarta')`.
 *
 * The instant is built in UTC, so `toISOString()` is the only reading that is
 * correct on any host. The local getters this replaces produced a different key
 * depending on the server's timezone â€” on the WIB host this app is meant to run
 * on, every point of the trend chart was a day off from the row it came from and
 * the chart rendered empty.
 */
function toDayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export interface CategorySalesPoint {
  category: string;
  total: number;
  quantity: number;
}

/** Revenue split by category, for the dashboard breakdown chart. */
export async function getSalesByCategory(
  days = 30,
): Promise<CategorySalesPoint[]> {
  const now = new Date();
  const start = startOfStoreDayOffset(days - 1, now);

  const rows = await prisma.$queryRaw<
    Array<{ category: string; total: unknown; quantity: bigint }>
  >`
    SELECT
      c.name AS category,
      COALESCE(SUM(si.subtotal), 0) AS total,
      COALESCE(SUM(si.quantity), 0)::bigint AS quantity
    FROM "SaleItem" si
    JOIN "Sale" s ON s.id = si."saleId"
    JOIN "Product" p ON p.id = si."productId"
    JOIN "Category" c ON c.id = p."categoryId"
    WHERE s."date" >= ${start}
      AND s.status IN ('COMPLETED', 'PARTIALLY_REFUNDED')
    GROUP BY c.name
    ORDER BY 2 DESC
    LIMIT 8
  `;

  return rows.map((row) => ({
    category: row.category,
    total: toNumber(row.total),
    quantity: Number(row.quantity),
  }));
}

export interface PaymentBreakdownPoint {
  method: string;
  total: number;
  transactions: number;
}

/** Payment method mix, for the dashboard chart. */
export async function getPaymentBreakdown(
  days = 30,
): Promise<PaymentBreakdownPoint[]> {
  const now = new Date();
  const start = startOfStoreDayOffset(days - 1, now);

  const grouped = await prisma.sale.groupBy({
    by: ["paymentMethod"],
    where: { date: { gte: start }, status: { in: REVENUE_STATUSES } },
    _sum: { total: true },
    _count: { _all: true },
  });

  return grouped
    .map((row) => ({
      method: row.paymentMethod,
      total: toNumber(row._sum.total),
      transactions: row._count._all,
    }))
    .sort((a, b) => b.total - a.total);
}

export interface TopProduct {
  id: string;
  name: string;
  sku: string;
  quantity: number;
  total: number;
}

/** Best sellers over a trailing window. */
export async function getTopProducts(
  days = 30,
  limit = 8,
): Promise<TopProduct[]> {
  const now = new Date();
  const start = startOfStoreDayOffset(days - 1, now);

  const grouped = await prisma.saleItem.groupBy({
    by: ["productId"],
    where: {
      sale: { date: { gte: start }, status: { in: REVENUE_STATUSES } },
    },
    _sum: { quantity: true, subtotal: true },
    orderBy: { _sum: { quantity: "desc" } },
    take: limit,
  });

  if (grouped.length === 0) {
    return [];
  }

  const products = await prisma.product.findMany({
    where: { id: { in: grouped.map((row) => row.productId) } },
    select: { id: true, name: true, sku: true },
  });

  const byId = new Map(products.map((product) => [product.id, product]));

  return grouped.flatMap((row) => {
    const product = byId.get(row.productId);
    if (!product) return [];

    return [
      {
        id: product.id,
        name: product.name,
        sku: product.sku,
        quantity: row._sum.quantity ?? 0,
        total: toNumber(row._sum.subtotal),
      },
    ];
  });
}

export interface PurchaseSalePoint {
  period: string;
  purchase: number;
  sale: number;
}

/** Purchases vs sales per day, to show margin of restocking activity. */
export async function getPurchaseVsSale(days = 14): Promise<PurchaseSalePoint[]> {
  const now = new Date();
  const start = startOfStoreDayOffset(days - 1, now);

  const [purchaseRows, saleRows] = await Promise.all([
    prisma.$queryRaw<Array<{ day: Date; total: unknown }>>`
      SELECT
        date_trunc('day', date AT TIME ZONE 'Asia/Jakarta') AS day,
        COALESCE(SUM("grandTotal"), 0) AS total
      FROM "Purchase"
      WHERE date >= ${start}
        AND status IN ('RECEIVED', 'COMPLETED')
      GROUP BY 1
    `,
    prisma.$queryRaw<Array<{ day: Date; total: unknown }>>`
      SELECT
        date_trunc('day', "date" AT TIME ZONE 'Asia/Jakarta') AS day,
        COALESCE(SUM(total), 0) AS total
      FROM "Sale"
      WHERE "date" >= ${start} AND status IN ('COMPLETED', 'PARTIALLY_REFUNDED')
      GROUP BY 1
    `,
  ]);

  const purchases = new Map<string, number>();
  const sales = new Map<string, number>();

  for (const row of purchaseRows) purchases.set(toDayKey(row.day), toNumber(row.total));
  for (const row of saleRows) sales.set(toDayKey(row.day), toNumber(row.total));

  const points: PurchaseSalePoint[] = [];

  for (let offset = days - 1; offset >= 0; offset--) {
    const day = startOfStoreDayOffset(offset, now);
    const key = toDayKey(day);

    points.push({
      period: new Intl.DateTimeFormat("id-ID", {
        day: "numeric",
        month: "short",
        timeZone: "Asia/Jakarta",
      }).format(day),
      purchase: purchases.get(key) ?? 0,
      sale: sales.get(key) ?? 0,
    });
  }

  return points;
}

export interface RecentSale {
  id: string;
  invoiceNumber: string;
  total: unknown;
  paymentMethod: string;
  status: string;
  date: Date;
  user: { name: string };
  customer: { name: string } | null;
}

/** Most recent sales, for the dashboard activity feed. */
export async function getRecentSales(take = 8): Promise<RecentSale[]> {
  return prisma.sale.findMany({
    take,
    orderBy: { date: "desc" },
    select: {
      id: true,
      invoiceNumber: true,
      total: true,
      paymentMethod: true,
      status: true,
      date: true,
      user: { select: { name: true } },
      customer: { select: { name: true } },
    },
  });
}

export interface LowStockItem {
  id: string;
  name: string;
  sku: string;
  stock: number;
  minStock: number;
  unit: string;
}

/**
 * Products at or below their reorder threshold.
 *
 * The `stock <= minStock` comparison is between two columns, which Prisma's
 * filter API cannot express, so the candidate set is narrowed in SQL and the
 * final comparison happens in memory. The candidate list is bounded and indexed
 * on `minStock`, so this stays cheap as the catalogue grows.
 */
export async function getLowStockItems(take = 10): Promise<LowStockItem[]> {
  // Same column-vs-column comparison as getLowStockCount, so raw SQL is used
  // here too rather than filtering a full product table in memory.
  return prisma.$queryRaw<LowStockItem[]>`
    SELECT
      id,
      name,
      sku,
      stock,
      "minStock",
      unit
    FROM "Product"
    WHERE "isActive" = true
      AND "stock" > 0
      AND "minStock" > 0
      AND "stock" <= "minStock"
    ORDER BY stock ASC, name ASC
    LIMIT ${take}
  `;
}

/** Products that are completely out of stock. */
export async function getOutOfStockItems(take = 10): Promise<LowStockItem[]> {
  return prisma.product.findMany({
    where: { isActive: true, stock: 0 },
    select: { id: true, name: true, sku: true, stock: true, minStock: true, unit: true },
    orderBy: { name: "asc" },
    take,
  });
}

export interface ExpiringBatch {
  id: string;
  productName: string;
  batchNumber: string;
  expiryDate: Date;
  quantity: number;
  daysRemaining: number;
}

/** Batches expiring within the configured warning window. */
export async function getExpiringBatches(
  warningDays = 30,
  take = 10,
): Promise<ExpiringBatch[]> {
  const now = new Date();
  const threshold = new Date(now.getTime() + warningDays * 86_400_000);

  const batches = await prisma.productBatch.findMany({
    where: {
      quantity: { gt: 0 },
      expiryDate: { lte: threshold },
    },
    select: {
      id: true,
      batchNumber: true,
      expiryDate: true,
      quantity: true,
      product: { select: { name: true } },
    },
    orderBy: { expiryDate: "asc" },
    take,
  });

  return batches.map((batch) => ({
    id: batch.id,
    productName: batch.product.name,
    batchNumber: batch.batchNumber,
    expiryDate: batch.expiryDate,
    quantity: batch.quantity,
    daysRemaining: Math.ceil(
      (batch.expiryDate.getTime() - now.getTime()) / 86_400_000,
    ),
  }));
}