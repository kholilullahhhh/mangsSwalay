import "server-only";

import { Prisma } from "@/generated/prisma/client";

import { prisma } from "@/lib/db";
import {
  parsePagination,
  resolveSort,
  searchFilter,
  toPageRequest,
} from "@/lib/pagination";

/**
 * Purchase and supplier list queries.
 *
 * Server-side filtering, sorting, and pagination throughout, matching the
 * product list implementation.
 */

export interface PurchaseListFilters {
  search?: string;
  supplierId?: string;
  status?: string;
  paymentStatus?: string;
  dateFrom?: string;
  dateTo?: string;
  sort?: string;
  direction?: string;
  page?: string;
  perPage?: string;
}

const PURCHASE_SORT_FIELDS = {
  date: "date",
  number: "number",
  grandTotal: "grandTotal",
  supplier: "supplier",
} as const;

type PurchaseSortField = keyof typeof PURCHASE_SORT_FIELDS;

const PURCHASE_STATUSES = [
  "DRAFT",
  "ORDERED",
  "RECEIVED",
  "COMPLETED",
  "CANCELLED",
] as const;

export function buildPurchaseWhere(
  filters: PurchaseListFilters,
): Prisma.PurchaseWhereInput {
  const where: Prisma.PurchaseWhereInput = {};

  const search = searchFilter(filters.search, ["number", "notes"]);
  if (search.OR) {
    where.OR = search.OR as Prisma.PurchaseWhereInput[];
  }

  if (filters.supplierId) {
    where.supplierId = filters.supplierId;
  }

  if (
    filters.status &&
    (PURCHASE_STATUSES as readonly string[]).includes(filters.status)
  ) {
    where.status = filters.status as (typeof PURCHASE_STATUSES)[number];
  }

  if (
    filters.paymentStatus === "UNPAID" ||
    filters.paymentStatus === "PARTIAL" ||
    filters.paymentStatus === "PAID"
  ) {
    where.paymentStatus = filters.paymentStatus;
  }

  // Date range filter, used by the purchase report and the list view.
  if (filters.dateFrom || filters.dateTo) {
    where.date = {
      ...(filters.dateFrom ? { gte: new Date(filters.dateFrom) } : {}),
      ...(filters.dateTo
        ? {
            // End date is inclusive, so extend to the end of that day.
            lte: endOfDay(new Date(filters.dateTo)),
          }
        : {}),
    };
  }

  return where;
}

function endOfDay(date: Date): Date {
  const result = new Date(date);
  result.setHours(23, 59, 59, 999);
  return result;
}

export interface PurchaseListResult {
  rows: Array<{
    id: string;
    number: string;
    date: Date;
    status: string;
    grandTotal: unknown;
    amountPaid: unknown;
    paymentStatus: string;
    itemCount: number;
    supplier: { id: string; name: string };
  }>;
  total: number;
  pagination: ReturnType<typeof toPageRequest>;
}

export async function listPurchases(
  filters: PurchaseListFilters,
): Promise<PurchaseListResult> {
  const pagination = parsePagination({
    page: filters.page,
    perPage: filters.perPage,
  });

  const where = buildPurchaseWhere(filters);

  const sortField = (filters.sort ?? "date") as PurchaseSortField;
  const direction = filters.direction === "asc" ? "asc" : "desc";

  // `supplier` sorts by the related name, which Prisma supports as a nested
  // order field; everything else sorts on a scalar column.
  const orderBy: Prisma.PurchaseOrderByWithRelationInput[] =
    sortField === "supplier"
      ? [{ supplier: { name: direction } }, { date: direction }]
      : resolveSort<PurchaseSortField>(
          sortField,
          direction,
          PURCHASE_SORT_FIELDS,
          "date",
          "desc",
        ) as unknown as Prisma.PurchaseOrderByWithRelationInput[];

  const total = await prisma.purchase.count({ where });
  const pageRequest = toPageRequest(total, pagination);

  const rows = await prisma.purchase.findMany({
    where,
    orderBy,
    skip: pageRequest.skip,
    take: pageRequest.take,
    select: {
      id: true,
      number: true,
      date: true,
      status: true,
      grandTotal: true,
      amountPaid: true,
      paymentStatus: true,
      supplier: { select: { id: true, name: true } },
      _count: { select: { items: true } },
    },
  });

  return {
    rows: rows.map(({ _count, ...row }) => ({ ...row, itemCount: _count.items })),
    total,
    pagination: pageRequest,
  };
}

/** A purchase with its lines, for the detail view. */
export async function getPurchaseById(id: string) {
  return prisma.purchase.findUnique({
    where: { id },
    select: {
      id: true,
      number: true,
      date: true,
      status: true,
      subtotal: true,
      discount: true,
      tax: true,
      shippingCost: true,
      grandTotal: true,
      amountPaid: true,
      paymentStatus: true,
      notes: true,
      receivedAt: true,
      createdAt: true,
      supplier: {
        select: { id: true, name: true, code: true, contactPerson: true, phone: true },
      },
      user: { select: { id: true, name: true } },
      items: {
        select: {
          id: true,
          productId: true,
          quantity: true,
          purchasePrice: true,
          subtotal: true,
          product: {
            select: { id: true, name: true, sku: true, unit: true },
          },
        },
        orderBy: { product: { name: "asc" } },
      },
    },
  });
}

/** Supplier options for filter dropdowns and purchase forms. */
export async function listSupplierOptions(): Promise<
  Array<{ id: string; name: string; code: string }>
> {
  return prisma.supplier.findMany({
    where: { isActive: true },
    select: { id: true, name: true, code: true },
    orderBy: { name: "asc" },
  });
}

export interface PurchaseProductOption {
  id: string;
  sku: string;
  name: string;
  hasExpiry: boolean;
  purchasePrice: number;
}

/** Products available to order, for the purchase-creation form. */
export async function listPurchaseProductOptions(): Promise<
  PurchaseProductOption[]
> {
  const rows = await prisma.product.findMany({
    where: { isActive: true },
    select: {
      id: true,
      sku: true,
      name: true,
      hasExpiry: true,
      purchasePrice: true,
    },
    orderBy: { name: "asc" },
  });

  return rows.map((row) => ({
    id: row.id,
    sku: row.sku,
    name: row.name,
    hasExpiry: row.hasExpiry,
    purchasePrice: Number(row.purchasePrice),
  }));
}

export interface SupplierListFilters {
  search?: string;
  isActive?: "true" | "false" | "all";
  sort?: string;
  direction?: string;
  page?: string;
  perPage?: string;
}

export interface SupplierRow {
  id: string;
  code: string;
  name: string;
  company: string | null;
  contactPerson: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  isActive: boolean;
  purchaseCount: number;
}

export async function listSuppliers(
  filters: SupplierListFilters,
): Promise<{
  rows: SupplierRow[];
  total: number;
  pagination: ReturnType<typeof toPageRequest>;
}> {
  const pagination = parsePagination({
    page: filters.page,
    perPage: filters.perPage,
  });

  const where: Prisma.SupplierWhereInput = {};

  const search = searchFilter(filters.search, [
    "name",
    "code",
    "company",
    "contactPerson",
    "phone",
  ]);
  if (search.OR) {
    where.OR = search.OR as Prisma.SupplierWhereInput[];
  }

  if (filters.isActive === "false") {
    where.isActive = false;
  } else if (filters.isActive !== "all") {
    where.isActive = true;
  }

  const orderBy: Prisma.SupplierOrderByWithRelationInput =
    filters.sort === "code" && filters.direction !== "asc"
      ? { code: "desc" }
      : { name: "asc" };

  const total = await prisma.supplier.count({ where });
  const pageRequest = toPageRequest(total, pagination);

  const rows = await prisma.supplier.findMany({
    where,
    orderBy,
    skip: pageRequest.skip,
    take: pageRequest.take,
    select: {
      id: true,
      code: true,
      name: true,
      company: true,
      contactPerson: true,
      phone: true,
      email: true,
      address: true,
      isActive: true,
      _count: { select: { purchases: true } },
    },
  });

  return {
    rows: rows.map(({ _count, ...row }) => ({
      ...row,
      purchaseCount: _count.purchases,
    })),
    total,
    pagination: pageRequest,
  };
}

/** Single supplier with purchase history, for the detail view. */
export async function getSupplierById(id: string) {
  return prisma.supplier.findUnique({
    where: { id },
    select: {
      id: true,
      code: true,
      name: true,
      company: true,
      contactPerson: true,
      phone: true,
      email: true,
      address: true,
      notes: true,
      isActive: true,
      createdAt: true,
      purchases: {
        select: {
          id: true,
          number: true,
          date: true,
          status: true,
          grandTotal: true,
        },
        orderBy: { date: "desc" },
        take: 20,
      },
      _count: { select: { purchases: true } },
    },
  });
}