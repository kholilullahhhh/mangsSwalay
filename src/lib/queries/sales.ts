import "server-only";

import { Prisma } from "@/generated/prisma/client";

import { prisma } from "@/lib/db";
import {
  parsePagination,
  searchFilter,
  toPageRequest,
} from "@/lib/pagination";
import {
  PAYMENT_METHOD_LABEL,
  PAYMENT_METHODS,
} from "@/lib/payments/constants";

/** Sale read queries. */

export interface SaleListFilters {
  search?: string;
  status?: string;
  paymentMethod?: string;
  userId?: string;
  customerId?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: string;
  perPage?: string;
}

const SALE_STATUSES = [
  "COMPLETED",
  "VOID",
  "REFUNDED",
  "PARTIALLY_REFUNDED",
] as const;

const PAYMENT_METHOD_VALUES = PAYMENT_METHODS.map((method) => method.value) as [
  "CASH",
  "QRIS",
  "DEBIT",
  "CREDIT_CARD",
  "TRANSFER",
  "E_WALLET",
];

export function buildSaleWhere(
  filters: SaleListFilters,
): Prisma.SaleWhereInput {
  const where: Prisma.SaleWhereInput = {};

  const search = searchFilter(filters.search, ["invoiceNumber"]);
  if (search.OR) {
    where.OR = search.OR as Prisma.SaleWhereInput[];
  }

  if (
    filters.status &&
    (SALE_STATUSES as readonly string[]).includes(filters.status)
  ) {
    where.status = filters.status as (typeof SALE_STATUSES)[number];
  }

  if (
    filters.paymentMethod &&
    PAYMENT_METHOD_VALUES.includes(filters.paymentMethod as (typeof PAYMENT_METHOD_VALUES)[number])
  ) {
    where.paymentMethod = filters.paymentMethod as (typeof PAYMENT_METHOD_VALUES)[number];
  }

  if (filters.userId) {
    where.userId = filters.userId;
  }

  if (filters.customerId) {
    where.customerId = filters.customerId;
  }

  if (filters.dateFrom || filters.dateTo) {
    where.date = {
      ...(filters.dateFrom ? { gte: new Date(filters.dateFrom) } : {}),
      ...(filters.dateTo ? { lte: endOfDay(filters.dateTo) } : {}),
    };
  }

  return where;
}

function endOfDay(value: string): Date {
  const date = new Date(value);
  date.setHours(23, 59, 59, 999);
  return date;
}

export async function listSales(filters: SaleListFilters) {
  const pagination = parsePagination({
    page: filters.page,
    perPage: filters.perPage,
  });

  const where = buildSaleWhere(filters);

  const total = await prisma.sale.count({ where });
  const pageRequest = toPageRequest(total, pagination);

  const rows = await prisma.sale.findMany({
    where,
    // Tie-broken on id: several sales can share a timestamp, and ordering on
    // that alone makes pagination repeat or skip rows.
    orderBy: [{ date: "desc" }, { id: "desc" }],
    skip: pageRequest.skip,
    take: pageRequest.take,
    select: {
      id: true,
      invoiceNumber: true,
      date: true,
      status: true,
      total: true,
      paymentMethod: true,
      user: { select: { id: true, name: true } },
      customer: { select: { id: true, name: true } },
      _count: { select: { items: true } },
    },
  });

  return {
    rows: rows.map((row) => ({
      ...row,
      total: Number(row.total),
      itemCount: row._count.items,
    })),
    total,
    pagination: pageRequest,
  };
}

/** Aggregates for the sales list header. */
export async function getSalesSummary(filters: SaleListFilters) {
  const where = buildSaleWhere(filters);

  // Voided sales are excluded from revenue: they are not money taken.
  const revenue = await prisma.sale.aggregate({
    where: { ...where, status: { in: ["COMPLETED", "PARTIALLY_REFUNDED"] } },
    _sum: { total: true, discount: true, tax: true },
    _count: { _all: true },
  });

  // Issued separately rather than in Promise.all: Prisma's generated types for
  // the two aggregates are unrelated, and the tuple collapses.
  const refunds = await prisma.saleRefund.aggregate({
    where: { sale: where },
    _sum: { totalRefund: true },
    _count: { _all: true },
  });

  const refundedAmount = Number(refunds._sum.totalRefund ?? 0);

  return {
    revenue: Number(revenue._sum.total ?? 0),
    transactionCount: revenue._count._all,
    totalDiscount: Number(revenue._sum.discount ?? 0),
    totalTax: Number(revenue._sum.tax ?? 0),
    refundedAmount,
    refundCount: refunds._count._all,
    netRevenue: Number(revenue._sum.total ?? 0) - refundedAmount,
  };
}

/** Distinct cashiers who have made sales, for the filter dropdown. */
export async function listCashierOptions() {
  return prisma.user.findMany({
    where: { role: { in: ["CASHIER", "ADMIN", "MANAGER", "SUPER_ADMIN"] } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

// Re-exported for the many server pages that read labels alongside sales data.
// The definition lives in lib/payments/constants so Client Components can use it
// without pulling this database module into the browser bundle.
export { PAYMENT_METHOD_LABEL, PAYMENT_METHODS };

/** Recent refunds for the returns screen. */
export async function listRefunds(take = 50) {
  return prisma.saleRefund.findMany({
    take,
    orderBy: [{ date: "desc" }, { id: "desc" }],
    select: {
      id: true,
      number: true,
      date: true,
      totalRefund: true,
      reason: true,
      paymentMethod: true,
      approver: { select: { name: true } },
      sale: { select: { id: true, invoiceNumber: true } },
      items: { select: { quantity: true, amount: true, condition: true } },
    },
  });
}
