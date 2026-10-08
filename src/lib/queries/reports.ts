import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import {
  startOfStoreDay,
  startOfStoreDayOffset,
  startOfStoreMonth,
  endOfDay,
  STORE_TIME_ZONE,
} from "@/lib/format";

/**
 * Reporting aggregations.
 *
 * Everything is computed in Postgres: a report over a year of sales must not
 * stream a year of transactions through the Node process. Voided sales are
 * excluded everywhere, because a voided transaction is a correction rather than
 * revenue.
 */

export interface ReportRange {
  from: Date;
  to: Date;
  label: string;
}

/** Resolves a named preset or an explicit custom range. */
export function resolveRange(
  preset: string | undefined,
  customFrom?: string,
  customTo?: string,
): ReportRange {
  const now = new Date();

  const presets: Record<string, () => ReportRange> = {
    today: () => ({
      from: startOfStoreDay(now),
      to: new Date(now.getTime() + 86_400_000),
      label: "Hari ini",
    }),
    yesterday: () => ({
      from: startOfStoreDayOffset(1, now),
      to: startOfStoreDay(now),
      label: "Kemarin",
    }),
    week: () => {
      const from = startOfStoreDayOffset(6, now);
      return { from, to: new Date(now.getTime() + 86_400_000), label: "7 hari terakhir" };
    },
    month: () => ({
      from: startOfStoreMonth(now),
      to: new Date(now.getTime() + 86_400_000),
      label: "Bulan ini",
    }),
    "30d": () => ({
      from: startOfStoreDayOffset(29, now),
      to: new Date(now.getTime() + 86_400_000),
      label: "30 hari terakhir",
    }),
    "90d": () => ({
      from: startOfStoreDayOffset(89, now),
      to: new Date(now.getTime() + 86_400_000),
      label: "90 hari terakhir",
    }),
    "365d": () => ({
      from: startOfStoreDayOffset(364, now),
      to: new Date(now.getTime() + 86_400_000),
      label: "1 tahun terakhir",
    }),
  };

  if (preset === "custom" && customFrom && customTo) {
    const from = new Date(customFrom);
    const to = endOfDay(customTo);

    if (!Number.isNaN(from.getTime()) && !Number.isNaN(to.getTime()) && to >= from) {
      return { from, to, label: "Kustom" };
    }
  }

  const presetFn = presets[preset ?? "30d"] ?? presets["30d"];
  return presetFn();
}

const REVENUE_STATUSES = `('COMPLETED', 'PARTIALLY_REFUNDED')`;

export interface SalesReport {
  grossSales: number;
  discounts: number;
  taxes: number;
  refunds: number;
  /** Gross less refunds and tax — the money the store actually earned. */
  netSales: number;
  /** Gross less refunds, still including tax. Kept for reconciliation. */
  netSalesInclTax: number;
  transactions: number;
  averageTransaction: number;
  itemsSold: number;
  costOfGoods: number;
  grossProfit: number;
  marginPercent: number;
}

export async function getSalesReport(range: ReportRange): Promise<SalesReport> {
  const [sales, refunds, items] = await Promise.all([
    prisma.$queryRaw<
      Array<{
        grossSales: unknown;
        discounts: unknown;
        taxes: unknown;
        transactions: bigint;
      }>
    >`
      SELECT
        COALESCE(SUM(total), 0) AS "grossSales",
        COALESCE(SUM(discount), 0) AS discounts,
        COALESCE(SUM(tax), 0) AS taxes,
        COUNT(*) AS transactions
      FROM "Sale"
      WHERE "date" >= ${range.from}
        AND "date" < ${range.to}
        AND status IN ${Prisma.raw(REVENUE_STATUSES)}
    `,
    prisma.$queryRaw<Array<{ total: unknown }>>`
      SELECT COALESCE(SUM(r."totalRefund"), 0) AS total
      FROM "SaleRefund" r
      JOIN "Sale" s ON s.id = r."saleId"
      WHERE s."date" >= ${range.from}
        AND s."date" < ${range.to}
    `,
    prisma.$queryRaw<
      Array<{ itemsSold: unknown; costOfGoods: unknown }>
    >`
      SELECT
        COALESCE(SUM(si.quantity), 0) AS "itemsSold",
        COALESCE(SUM(si.cost * si.quantity), 0) AS "costOfGoods"
      FROM "SaleItem" si
      JOIN "Sale" s ON s.id = si."saleId"
      WHERE s."date" >= ${range.from}
        AND s."date" < ${range.to}
        AND s.status IN ${Prisma.raw(REVENUE_STATUSES)}
    `,
  ]);

  const grossSales = Number(sales[0]?.grossSales ?? 0);
  const discounts = Number(sales[0]?.discounts ?? 0);
  const taxes = Number(sales[0]?.taxes ?? 0);
  const transactions = Number(sales[0]?.transactions ?? 0);

  const refundedAmount = Number(refunds[0]?.total ?? 0);
  const itemsSold = Number(items[0]?.itemsSold ?? 0);
  const costOfGoods = Number(items[0]?.costOfGoods ?? 0);

const netSalesInclTax = grossSales - refundedAmount;
  // Tax is collected on behalf of the government, so it is excluded from both
  // revenue and profit; including it would overstate earnings. "Omzet bersih"
  // has to mean the same thing everywhere, so this is the figure the tile shows.
  const netSales = netSalesInclTax - taxes;
  const profitBase = netSales;

  return {
    grossSales,
    discounts,
    taxes,
refunds: refundedAmount,
    netSales,
    netSalesInclTax,
    transactions,
    averageTransaction: transactions > 0 ? Math.round(netSales / transactions) : 0,
    itemsSold,
    costOfGoods,
    grossProfit: profitBase - costOfGoods,
    marginPercent: profitBase > 0 ? Math.round(((profitBase - costOfGoods) / profitBase) * 100) : 0,
  };
}

export interface DailySaleRow {
  day: string;
  label: string;
  gross: number;
  transactions: number;
  profit: number;
}

/** Daily revenue and profit, for the sales report trend. */
export async function getDailySales(range: ReportRange): Promise<DailySaleRow[]> {
  const rows = await prisma.$queryRaw<
    Array<{
      day: Date;
      gross: unknown;
      transactions: bigint;
      profit: unknown;
    }>
  >`
    SELECT
      date_trunc('day', s."date" AT TIME ZONE ${STORE_TIME_ZONE}) AS day,
      COALESCE(SUM(s.total), 0) AS gross,
      COUNT(DISTINCT s.id) AS transactions,
      COALESCE(
        SUM(s.total - COALESCE((SELECT SUM(r."totalRefund") FROM "SaleRefund" r WHERE r."saleId" = s.id), 0)),
        0
      ) AS profit
    FROM "Sale" s
    WHERE s."date" >= ${range.from}
      AND s."date" < ${range.to}
      AND s.status IN ${Prisma.raw(REVENUE_STATUSES)}
    GROUP BY 1
    ORDER BY 1 ASC
    LIMIT 400
  `;

  const formatter = new Intl.DateTimeFormat("id-ID", {
    day: "numeric",
    month: "short",
    timeZone: STORE_TIME_ZONE,
  });

  return rows.map((row) => ({
    day: row.day.toISOString().slice(0, 10),
    label: formatter.format(row.day),
    gross: Number(row.gross),
    transactions: Number(row.transactions),
    profit: Number(row.profit),
  }));
}

export interface ProductPerformanceRow {
  productId: string;
  name: string;
  sku: string;
  quantity: number;
  revenue: number;
  cost: number;
  profit: number;
}

export async function getProductPerformance(
  range: ReportRange,
  limit = 100,
): Promise<ProductPerformanceRow[]> {
  const rows = await prisma.$queryRaw<
    Array<{
      productId: string;
      name: string;
      sku: string;
      quantity: unknown;
      revenue: unknown;
      cost: unknown;
    }>
  >`
    SELECT
      p.id AS "productId",
      p.name,
      p.sku,
      COALESCE(SUM(si.quantity), 0) AS quantity,
      COALESCE(SUM(si.subtotal), 0) AS revenue,
      COALESCE(SUM(si.cost * si.quantity), 0) AS cost
    FROM "SaleItem" si
    JOIN "Sale" s ON s.id = si."saleId"
    JOIN "Product" p ON p.id = si."productId"
    WHERE s."date" >= ${range.from}
      AND s."date" < ${range.to}
      AND s.status IN ${Prisma.raw(REVENUE_STATUSES)}
    GROUP BY p.id, p.name, p.sku
    ORDER BY quantity DESC
    LIMIT ${limit}
  `;

  return rows.map((row) => {
    const revenue = Number(row.revenue);
    const cost = Number(row.cost);
    return {
      productId: row.productId,
      name: row.name,
      sku: row.sku,
      quantity: Number(row.quantity),
      revenue,
      cost,
      profit: revenue - cost,
    };
  });
}

/**
 * Products with stock but no sales in the range — the "slow moving" list.
 *
 * Reads the catalogue and the sold set separately rather than a LEFT JOIN with
 * an aggregate, which keeps the query index-friendly on a large catalogue.
 */
export async function getDeadStock(
  range: ReportRange,
  limit = 50,
): Promise<Array<{ id: string; name: string; sku: string; stock: number; value: number }>> {
  const sold = await prisma.saleItem.groupBy({
    by: ["productId"],
    where: {
      sale: { date: { gte: range.from, lt: range.to }, status: { in: ["COMPLETED", "PARTIALLY_REFUNDED"] } },
    },
    _sum: { quantity: true },
  });

  const soldIds = sold.filter((row) => (row._sum.quantity ?? 0) > 0).map((row) => row.productId);

  const candidates = await prisma.product.findMany({
    where: { isActive: true, ...(soldIds.length > 0 ? { id: { notIn: soldIds } } : {}) },
    select: { id: true, name: true, sku: true, stock: true, purchasePrice: true },
    take: limit,
  });

  return candidates.map((product) => ({
    id: product.id,
    name: product.name,
    sku: product.sku,
    stock: product.stock,
    value: Number(product.purchasePrice) * product.stock,
  }));
}

export interface InventoryReportRow {
  category: string;
  products: number;
  units: number;
  costValue: number;
  retailValue: number;
}

export async function getInventoryReport(): Promise<{
  rows: InventoryReportRow[];
  totalCostValue: number;
  totalRetailValue: number;
  totalUnits: number;
}> {
  const rows = await prisma.$queryRaw<
    Array<{
      category: string;
      products: bigint;
      units: unknown;
      costValue: unknown;
      retailValue: unknown;
    }>
  >`
    SELECT
      c.name AS category,
      COUNT(p.id) AS products,
      COALESCE(SUM(p.stock), 0) AS units,
      COALESCE(SUM(p.stock * p."purchasePrice"), 0) AS "costValue",
      COALESCE(SUM(p.stock * p."sellingPrice"), 0) AS "retailValue"
    FROM "Category" c
    LEFT JOIN "Product" p ON p."categoryId" = c.id AND p."isActive" = true
    GROUP BY c.name
    ORDER BY "costValue" DESC
  `;

  const mapped = rows.map((row) => ({
    category: row.category,
    products: Number(row.products),
    units: Number(row.units),
    costValue: Number(row.costValue),
    retailValue: Number(row.retailValue),
  }));

  return {
    rows: mapped,
    totalCostValue: mapped.reduce((sum, row) => sum + row.costValue, 0),
    totalRetailValue: mapped.reduce((sum, row) => sum + row.retailValue, 0),
    totalUnits: mapped.reduce((sum, row) => sum + row.units, 0),
  };
}

export interface PurchaseReportRow {
  supplier: string;
  orders: number;
  total: number;
  paid: number;
  outstanding: number;
}

export async function getPurchaseReport(range: ReportRange) {
  const [rows, totals] = await Promise.all([
    prisma.$queryRaw<
      Array<{
        supplier: string;
        orders: bigint;
        total: unknown;
        paid: unknown;
      }>
    >`
      SELECT
        s.name AS supplier,
        COUNT(p.id) AS orders,
        COALESCE(SUM(p."grandTotal"), 0) AS total,
        COALESCE(SUM(p."amountPaid"), 0) AS paid
      FROM "Purchase" p
      JOIN "Supplier" s ON s.id = p."supplierId"
      WHERE p.date >= ${range.from}
        AND p.date < ${range.to}
        AND p.status IN ('RECEIVED', 'COMPLETED')
      GROUP BY s.name
      ORDER BY total DESC
    `,
    prisma.purchase.aggregate({
      where: {
        date: { gte: range.from, lt: range.to },
        status: { in: ["RECEIVED", "COMPLETED"] },
      },
      _sum: { grandTotal: true, amountPaid: true },
      _count: { _all: true },
    }),
  ]);

  const mapped: PurchaseReportRow[] = rows.map((row) => {
    const total = Number(row.total);
    const paid = Number(row.paid);
    return {
      supplier: row.supplier,
      orders: Number(row.orders),
      total,
      paid,
      outstanding: Math.max(0, total - paid),
    };
  });

  return {
    rows: mapped,
    totalPurchase: Number(totals._sum.grandTotal ?? 0),
    totalPaid: Number(totals._sum.amountPaid ?? 0),
    totalOutstanding: Math.max(
      0,
      Number(totals._sum.grandTotal ?? 0) - Number(totals._sum.amountPaid ?? 0),
    ),
    orderCount: totals._count._all,
  };
}

export interface ProfitReport {
  revenue: number;
  cogs: number;
  grossProfit: number;
  expenses: number;
  netProfit: number;
  marginPercent: number;
  salesTransactions: number;
  purchaseTotal: number;
}

/**
 * Revenue minus cost of goods minus operating expenses.
 *
 * COGS uses the cost snapshotted on each sale line, not the product's current
 * purchase price, so a price change today cannot rewrite yesterday's margin.
 */
export async function getProfitReport(range: ReportRange): Promise<ProfitReport> {
  const [sales, expenseAgg, purchaseAgg] = await Promise.all([
    getSalesReport(range),
    prisma.expense.aggregate({
      where: { date: { gte: range.from, lt: range.to } },
      _sum: { amount: true },
    }),
    prisma.purchase.aggregate({
      where: {
        date: { gte: range.from, lt: range.to },
        status: { in: ["RECEIVED", "COMPLETED"] },
      },
      _sum: { grandTotal: true },
    }),
  ]);

  const expenses = Number(expenseAgg._sum.amount ?? 0);
  const revenue = sales.netSales - sales.taxes;
  const netProfit = revenue - sales.costOfGoods - expenses;

  return {
    revenue,
    cogs: sales.costOfGoods,
    grossProfit: revenue - sales.costOfGoods,
    expenses,
    netProfit,
    marginPercent: revenue > 0 ? Math.round((netProfit / revenue) * 100) : 0,
    salesTransactions: sales.transactions,
    purchaseTotal: Number(purchaseAgg._sum.grandTotal ?? 0),
  };
}

export interface PaymentMixRow {
  method: string;
  transactions: number;
  total: number;
}

export async function getPaymentMix(range: ReportRange): Promise<PaymentMixRow[]> {
  const rows = await prisma.sale.groupBy({
    by: ["paymentMethod"],
    where: { date: { gte: range.from, lt: range.to }, status: "COMPLETED" },
    _sum: { total: true },
    _count: { _all: true },
  });

  return rows
    .map((row) => ({
      method: row.paymentMethod,
      transactions: row._count._all,
      total: Number(row._sum.total ?? 0),
    }))
    .sort((a, b) => b.total - a.total);
}

export interface CashFlowPoint {
  label: string;
  inflow: number;
  outflow: number;
}

/**
 * Daily cash movement: cash received against cash spent.
 *
 * Only cash touches this report. Card, QRIS, and transfer sales are settled
 * outside the tiller's drawer, so counting them as inflow would overstate cash
 * on hand. Cash refunds leave the drawer on the day they are issued, which can
 * be a different day from the original sale.
 *
 * Purchase payments are attributed to the purchase order date. Payment terms
 * are not tracked per payment, so a paid order shows its whole payment on the
 * order date — an approximation, but a consistent one that cannot silently
 * erase a large supplier bill from the report.
 *
 * Cash movements recorded against a shift (petty cash in and out) are included:
 * they are the same money this page is meant to account for, and leaving them out
 * would make the cash-flow view disagree with the shift it is drawn from.
 */
export async function getCashFlow(range: ReportRange): Promise<CashFlowPoint[]> {
  const [cashSales, cashRefunds, expenses, purchases, movements] =
    await Promise.all([
      // `amountPaid - change`, which for a cash sale is exactly `total`: the
      // drawer takes the note handed over and gives the change straight back.
      // Summing `amountPaid` alone would book change as cash retained.
      prisma.$queryRaw<Array<{ day: string; total: unknown }>>`
        SELECT
          (date_trunc('day', s."date" AT TIME ZONE ${STORE_TIME_ZONE}))::date::text AS day,
          COALESCE(SUM(s."amountPaid" - s."change"), 0) AS total
        FROM "Sale" s
        WHERE s."date" >= ${range.from}
          AND s."date" < ${range.to}
          AND s.status IN ${Prisma.raw(REVENUE_STATUSES)}
          AND s."paymentMethod" = 'CASH'
        GROUP BY 1
      `,
      prisma.$queryRaw<Array<{ day: string; total: unknown }>>`
        SELECT
          (date_trunc('day', r.date AT TIME ZONE ${STORE_TIME_ZONE}))::date::text AS day,
          COALESCE(SUM(r."totalRefund"), 0) AS total
        FROM "SaleRefund" r
        WHERE r.date >= ${range.from}
          AND r.date < ${range.to}
          AND r."paymentMethod" = 'CASH'
        GROUP BY 1
      `,
      prisma.$queryRaw<Array<{ day: string; total: unknown }>>`
        SELECT
          (date_trunc('day', e.date AT TIME ZONE ${STORE_TIME_ZONE}))::date::text AS day,
          COALESCE(SUM(e.amount), 0) AS total
        FROM "Expense" e
        WHERE e.date >= ${range.from} AND e.date < ${range.to}
        GROUP BY 1
      `,
      prisma.$queryRaw<Array<{ day: string; total: unknown }>>`
        SELECT
          (date_trunc('day', p.date AT TIME ZONE ${STORE_TIME_ZONE}))::date::text AS day,
          COALESCE(SUM(p."amountPaid"), 0) AS total
        FROM "Purchase" p
        WHERE p.date >= ${range.from}
          AND p.date < ${range.to}
          AND p.status IN ('RECEIVED', 'COMPLETED')
        GROUP BY 1
      `,
      prisma.$queryRaw<Array<{ day: string; inflow: unknown; outflow: unknown }>>`
        SELECT
          (date_trunc('day', m."createdAt" AT TIME ZONE ${STORE_TIME_ZONE}))::date::text AS day,
          COALESCE(SUM(m.amount) FILTER (WHERE m.type = 'CASH_IN'), 0) AS inflow,
          COALESCE(SUM(m.amount) FILTER (WHERE m.type = 'CASH_OUT'), 0) AS outflow
        FROM "CashMovement" m
        WHERE m."createdAt" >= ${range.from}
          AND m."createdAt" < ${range.to}
        GROUP BY 1
      `,
    ]);

  const inflowMap = new Map<string, number>();
  const outflowMap = new Map<string, number>();

  const add = (map: Map<string, number>, key: string, amount: number) => {
    map.set(key, (map.get(key) ?? 0) + amount);
  };

  for (const row of cashSales) add(inflowMap, row.day, Number(row.total));
  for (const row of cashRefunds) add(outflowMap, row.day, Number(row.total));
  for (const row of expenses) add(outflowMap, row.day, Number(row.total));
  for (const row of purchases) add(outflowMap, row.day, Number(row.total));
  for (const row of movements) {
    add(inflowMap, row.day, Number(row.inflow));
    add(outflowMap, row.day, Number(row.outflow));
  }

  const keys = new Set([...inflowMap.keys(), ...outflowMap.keys()]);
  const formatter = new Intl.DateTimeFormat("id-ID", {
    day: "numeric",
    month: "short",
    timeZone: STORE_TIME_ZONE,
  });

  return [...keys].sort().map((key) => ({
    label: formatter.format(new Date(key + "T00:00:00Z")),
    inflow: inflowMap.get(key) ?? 0,
    outflow: outflowMap.get(key) ?? 0,
  }));
}

