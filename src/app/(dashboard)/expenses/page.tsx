import type { Metadata } from "next";
import Link from "next/link";
import { Banknote } from "lucide-react";

import { requirePagePermission, hasPermission } from "@/lib/auth/session";
import {
  listExpenses,
  EXPENSE_CATEGORY_LABEL,
} from "@/lib/queries/catalog";
import { formatCurrency, formatDate, formatNumber } from "@/lib/format";
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
import {
  TablePagination,
  type PaginationMeta,
} from "@/components/data/table-pagination";
import { EmptyState } from "@/components/data/empty-state";

import { DeleteExpenseButton, NewExpenseButton } from "./new-expense-button";

export const metadata: Metadata = {
  title: "Pengeluaran",
};

/** Operational expenses; they form the cost side of the profit report. */
export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePagePermission("expenses:view");

  const params = await searchParams;
  const single = (v: string | string[] | undefined) =>
    Array.isArray(v) ? v[0] : v || undefined;

  const filters = {
    category: single(params.category),
    dateFrom: single(params.dateFrom),
    dateTo: single(params.dateTo),
    search: single(params.search),
    page: single(params.page),
    perPage: single(params.perPage),
  };

  const [{ rows, total, totalAmount, pagination }, canManage] = await Promise.all([
    listExpenses(filters),
    hasPermission("expenses:manage"),
  ]);

  const serialised: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    const one = Array.isArray(value) ? value[0] : value;
    if (one) serialised[key] = one;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Pengeluaran</h1>
          <p className="text-sm text-muted-foreground">
            {formatNumber(total)} catatan · total {formatCurrency(totalAmount)}
          </p>
        </div>

        {canManage ? (
          <NewExpenseButton categories={EXPENSE_CATEGORY_LABEL} />
        ) : null}
      </div>

      <Card>
        <div className="border-b p-4">
          <form className="flex flex-wrap items-center gap-2" action="/expenses">
            <select
              name="category"
              defaultValue={filters.category ?? ""}
              aria-label="Kategori"
              className="h-9 rounded-md border border-input bg-transparent px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="">Semua kategori</option>
              {Object.entries(EXPENSE_CATEGORY_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>

            <input
              name="dateFrom"
              type="date"
              defaultValue={filters.dateFrom ?? ""}
              aria-label="Dari tanggal"
              className="h-9 rounded-md border border-input bg-transparent px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <input
              name="dateTo"
              type="date"
              defaultValue={filters.dateTo ?? ""}
              aria-label="Sampai tanggal"
              className="h-9 rounded-md border border-input bg-transparent px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />

            <Button type="submit" size="sm" variant="secondary">
              Terapkan
            </Button>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/expenses">Reset</Link>
            </Button>
          </form>
        </div>

        <CardContent className="px-0">
          {rows.length === 0 ? (
            <EmptyState
              icon={Banknote}
              title="Belum ada pengeluaran"
              description="Catat pengeluaran operasional agar laporan profit akurat."
            />
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tanggal</TableHead>
                    <TableHead>Kategori</TableHead>
                    <TableHead>Keterangan</TableHead>
                    <TableHead>Dicatat oleh</TableHead>
<TableHead className="text-right">Nominal</TableHead>
                    {canManage ? <TableHead className="w-10" /> : null}
                  </TableRow>
                </TableHeader>

                <TableBody>
                  {rows.map((expense) => (
                    <TableRow key={expense.id}>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatDate(expense.date)}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">
                          {EXPENSE_CATEGORY_LABEL[expense.category] ??
                            expense.category}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">
                        {expense.description ?? "-"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {expense.user.name}
                      </TableCell>
<TableCell className="tabular text-right font-medium">
                        {formatCurrency(expense.amount)}
                      </TableCell>
                      {canManage ? (
                        <TableCell>
                          <DeleteExpenseButton
                            expenseId={expense.id}
                            description={expense.description ?? ""}
                          />
                        </TableCell>
                      ) : null}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              <TablePagination
                pagination={{ ...pagination, total } as PaginationMeta}
                searchParams={serialised}
                total={total}
              />
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
