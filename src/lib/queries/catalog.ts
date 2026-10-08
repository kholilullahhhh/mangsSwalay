import "server-only";

import { Prisma } from "@/generated/prisma/client";

import { prisma } from "@/lib/db";
import {
  parsePagination,
  searchFilter,
  toPageRequest,
} from "@/lib/pagination";

/** Customer, expense, category, user, notification and audit-log queries. */

// ── Customers ─────────────────────────────────────────────────────────────

export interface CustomerFilters {
  search?: string;
  isMember?: "true" | "false" | "all";
  page?: string;
  perPage?: string;
}

export async function listCustomers(filters: CustomerFilters) {
  const pagination = parsePagination({
    page: filters.page,
    perPage: filters.perPage,
  });

  const where: Prisma.CustomerWhereInput = {};

  const search = searchFilter(filters.search, [
    "name",
    "phone",
    "email",
    "memberNumber",
  ]);
  if (search.OR) {
    where.OR = search.OR as Prisma.CustomerWhereInput[];
  }

  if (filters.isMember === "true") {
    where.isMember = true;
  } else if (filters.isMember === "false") {
    where.isMember = false;
  }

  const total = await prisma.customer.count({ where });
  const pageRequest = toPageRequest(total, pagination);

  const rows = await prisma.customer.findMany({
    where,
    orderBy: { name: "asc" },
    skip: pageRequest.skip,
    take: pageRequest.take,
select: {
      id: true,
      name: true,
      phone: true,
      email: true,
      memberNumber: true,
      isMember: true,
      address: true,
      notes: true,
      isActive: true,
      points: true,
      totalPurchases: true,
      createdAt: true,
    },
  });

  return { rows, total, pagination: pageRequest };
}

/** A customer with their purchase history and lifetime spend. */
export async function getCustomerById(id: string) {
  const customer = await prisma.customer.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      phone: true,
      email: true,
      address: true,
      memberNumber: true,
      isMember: true,
      points: true,
      totalPurchases: true,
      notes: true,
      isActive: true,
      createdAt: true,
    },
  });

  if (!customer) return null;

  const [spend, sales] = await Promise.all([
    prisma.sale.aggregate({
      where: { customerId: id, status: { in: ["COMPLETED", "PARTIALLY_REFUNDED"] } },
      _sum: { total: true },
      _count: { _all: true },
    }),
    prisma.sale.findMany({
      where: { customerId: id },
      orderBy: [{ date: "desc" }, { id: "desc" }],
      take: 20,
      select: {
        id: true,
        invoiceNumber: true,
        date: true,
        total: true,
        status: true,
        pointsEarned: true,
        items: { select: { quantity: true } },
      },
    }),
  ]);

  const lifetimeSpend = Number(spend._sum.total ?? 0);
  const lifetimeTransactions = spend._count._all;

  return {
    customer,
    lifetimeSpend,
    lifetimeTransactions,
    averageBasket:
      lifetimeTransactions > 0
        ? Math.round(lifetimeSpend / lifetimeTransactions)
        : 0,
    sales,
  };
}

/** Top members by lifetime spend, for the loyalty screen. */
export async function listTopMembers(take = 20) {
  const rows = await prisma.$queryRaw<
    Array<{
      id: string;
      name: string;
      memberNumber: string | null;
      points: number;
      totalPurchases: number;
      lifetimeSpend: unknown;
    }>
  >`
    SELECT
      c.id,
      c.name,
      c."memberNumber",
      c.points,
      c."totalPurchases",
      COALESCE(SUM(s.total), 0) AS "lifetimeSpend"
    FROM "Customer" c
    LEFT JOIN "Sale" s
      ON s."customerId" = c.id
      AND s.status IN ('COMPLETED', 'PARTIALLY_REFUNDED')
    WHERE c."isMember" = true
    GROUP BY c.id
    ORDER BY "lifetimeSpend" DESC, c.points DESC
    LIMIT ${take}
  `;

  return rows.map((row) => ({
    ...row,
    lifetimeSpend: Number(row.lifetimeSpend),
  }));
}

// ── Categories ─────────────────────────────────────────────────────────────

export async function listCategoriesWithCounts() {
  const rows = await prisma.category.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      image: true,
      icon: true,
      isActive: true,
      createdAt: true,
      _count: { select: { products: true } },
    },
  });

  return rows.map((row) => ({
    ...row,
    productCount: row._count.products,
  }));
}

// ── Expenses ───────────────────────────────────────────────────────────────

export interface ExpenseFilters {
  category?: string;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
  page?: string;
  perPage?: string;
}

export async function listExpenses(filters: ExpenseFilters) {
  const pagination = parsePagination({
    page: filters.page,
    perPage: filters.perPage,
  });

  const where: Prisma.ExpenseWhereInput = {};

  if (filters.category) {
    where.category = filters.category as Prisma.ExpenseWhereInput["category"];
  }

  if (filters.dateFrom || filters.dateTo) {
    where.date = {
      ...(filters.dateFrom ? { gte: new Date(filters.dateFrom) } : {}),
      ...(filters.dateTo ? { lte: endOfDay(filters.dateTo) } : {}),
    };
  }

  const search = searchFilter(filters.search, ["description", "notes"]);
  if (search.OR) {
    where.OR = search.OR as Prisma.ExpenseWhereInput[];
  }

  const total = await prisma.expense.count({ where });
  const pageRequest = toPageRequest(total, pagination);

  const [rows, totals] = await Promise.all([
    prisma.expense.findMany({
      where,
      orderBy: [{ date: "desc" }, { id: "desc" }],
      skip: pageRequest.skip,
      take: pageRequest.take,
      select: {
        id: true,
        category: true,
        amount: true,
        description: true,
        date: true,
        createdAt: true,
        user: { select: { name: true } },
      },
    }),
    prisma.expense.aggregate({ where, _sum: { amount: true } }),
  ]);

  return {
    rows: rows.map((row) => ({ ...row, amount: Number(row.amount) })),
    total,
    totalAmount: Number(totals._sum.amount ?? 0),
    pagination: pageRequest,
  };
}

function endOfDay(value: string): Date {
  const date = new Date(value);
  date.setHours(23, 59, 59, 999);
  return date;
}

export const EXPENSE_CATEGORY_LABEL: Record<string, string> = {
  ELECTRICITY: "Listrik",
  INTERNET: "Internet",
  TRANSPORTATION: "Transportasi",
  MAINTENANCE: "Pemeliharaan",
  SALARY: "Gaji",
  RENT: "Sewa",
  OPERATIONAL: "Operasional",
  OTHER: "Lainnya",
};

export const EXPENSE_CATEGORIES = Object.keys(EXPENSE_CATEGORY_LABEL);

// ── Users ──────────────────────────────────────────────────────────────────

export async function listUsers(search?: string) {
  const where: Prisma.UserWhereInput = {};

  const s = searchFilter(search, ["name", "username", "email"]);
  if (s.OR) {
    where.OR = s.OR as Prisma.UserWhereInput[];
  }

  return prisma.user.findMany({
    where,
    orderBy: { name: "asc" },
    select: {
      id: true,
      username: true,
      name: true,
      email: true,
      role: true,
      phone: true,
      isActive: true,
      lastLoginAt: true,
      createdAt: true,
      _count: { select: { sales: true, shifts: true } },
    },
  });
}

// ── Notifications ──────────────────────────────────────────────────────────

export async function listNotifications(options: {
  userId: string | null;
  take?: number;
}) {
  return prisma.notification.findMany({
    take: options.take ?? 50,
    orderBy: { createdAt: "desc" },
    where: {
      // A null userId means the alert is broadcast to every user.
      OR: [{ userId: options.userId }, { userId: null }],
    },
    select: {
      id: true,
      type: true,
      severity: true,
      title: true,
      message: true,
      link: true,
      isRead: true,
      createdAt: true,
    },
  });
}

export async function countUnreadNotifications(userId: string): Promise<number> {
  return prisma.notification.count({
    where: { isRead: false, OR: [{ userId }, { userId: null }] },
  });
}

// ── Audit log ──────────────────────────────────────────────────────────────

export interface AuditFilters {
  action?: string;
  entity?: string;
  userId?: string;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: string;
  perPage?: string;
}

export async function listAuditLogs(filters: AuditFilters) {
  const pagination = parsePagination({
    page: filters.page,
    perPage: filters.perPage,
  });

  const where: Prisma.AuditLogWhereInput = {};

  if (filters.action) where.action = filters.action;
  if (filters.entity) where.entity = filters.entity;
  if (filters.userId) where.userId = filters.userId;

  if (filters.dateFrom || filters.dateTo) {
    where.createdAt = {
      ...(filters.dateFrom ? { gte: new Date(filters.dateFrom) } : {}),
      ...(filters.dateTo ? { lte: endOfDay(filters.dateTo) } : {}),
    };
  }

  const search = searchFilter(filters.search, ["action", "entity", "entityId"]);
  if (search.OR) {
    where.OR = search.OR as Prisma.AuditLogWhereInput[];
  }

  const total = await prisma.auditLog.count({ where });
  const pageRequest = toPageRequest(total, pagination);

  const rows = await prisma.auditLog.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: pageRequest.skip,
    take: pageRequest.take,
    select: {
      id: true,
      userId: true,
      action: true,
      entity: true,
      entityId: true,
      oldData: true,
      newData: true,
      ipAddress: true,
      createdAt: true,
      user: { select: { name: true, username: true, role: true } },
    },
  });

  return { rows, total, pagination: pageRequest };
}

/** Distinct actions present in the log, for the filter dropdown. */
export async function listAuditActions(): Promise<string[]> {
  const rows = await prisma.auditLog.findMany({
    distinct: ["action"],
    select: { action: true },
    orderBy: { action: "asc" },
  });
  return rows.map((row) => row.action);
}

// ── Store settings ─────────────────────────────────────────────────────────

export async function getAllSettings(): Promise<
  Array<{ key: string; value: unknown; description: string | null }>
> {
  const rows = await prisma.storeSetting.findMany({
    orderBy: { key: "asc" },
    select: { key: true, value: true, description: true },
  });

  return rows.map((row) => ({ ...row, description: row.description }));
}

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const row = await prisma.storeSetting.findUnique({ where: { key } });
  if (!row) return fallback;
  return (row.value ?? fallback) as T;
}

// ── Promotions ─────────────────────────────────────────────────────────────

export async function listPromotions() {
  return prisma.promotion.findMany({
    orderBy: [{ isActive: "desc" }, { endDate: "asc" }],
    select: {
      id: true,
      code: true,
      name: true,
      description: true,
      type: true,
      value: true,
      minPurchaseAmount: true,
      buyQuantity: true,
      getQuantity: true,
      startDate: true,
      endDate: true,
      usageLimit: true,
      usedCount: true,
      isActive: true,
categoryId: true,
      category: { select: { id: true, name: true } },
      _count: { select: { products: true } },
      // Needed by the edit form: without the actual ids, saving a PRODUCT
      // promotion would clear the selection it was supposed to preserve.
      products: { select: { productId: true } },
    },
  }).then((rows) =>
    rows.map((row) => ({ ...row, productIds: row.products.map((p) => p.productId) })),
  );
}
