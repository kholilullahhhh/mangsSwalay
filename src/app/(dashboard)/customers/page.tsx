import type { Metadata } from "next";
import Link from "next/link";
import { Coins, Users } from "lucide-react";

import { requirePagePermission, hasPermission } from "@/lib/auth/session";
import { listCustomers, listTopMembers } from "@/lib/queries/catalog";
import { formatCurrency, formatDate, formatNumber } from "@/lib/format";
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
import {
  TablePagination,
  type PaginationMeta,
} from "@/components/data/table-pagination";
import { EmptyState } from "@/components/data/empty-state";

import { CustomerDialog } from "./new-customer-button";

export const metadata: Metadata = {
  title: "Pelanggan",
};

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePagePermission("customers:view");

  const params = await searchParams;
  const single = (v: string | string[] | undefined) =>
    Array.isArray(v) ? v[0] : v || undefined;

  const memberParam = single(params.isMember);

  const filters: {
    search?: string;
    isMember?: "true" | "false" | "all";
    page?: string;
    perPage?: string;
  } = {
    search: single(params.search),
    isMember:
      memberParam === "true"
        ? "true"
        : memberParam === "false"
          ? "false"
          : "all",
    page: single(params.page),
    perPage: single(params.perPage),
  };

  const [{ rows, total, pagination }, topMembers, canManage] = await Promise.all([
    listCustomers(filters),
    listTopMembers(5),
    hasPermission("customers:manage"),
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
          <h1 className="text-lg font-semibold tracking-tight">Pelanggan</h1>
          <p className="text-sm text-muted-foreground">
            {formatNumber(total)} pelanggan
          </p>
        </div>

        {canManage ? <CustomerDialog /> : null}
      </div>

      <Card>
        <div className="border-b p-4">
          <form className="flex flex-wrap items-center gap-2" action="/customers">
            <input
              name="search"
              type="search"
              defaultValue={filters.search ?? ""}
              placeholder="Cari nama, telepon, atau nomor member..."
              aria-label="Cari pelanggan"
              className="h-9 min-w-56 flex-1 rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring sm:max-w-sm"
            />
            <select
              name="isMember"
              defaultValue={filters.isMember}
              aria-label="Status member"
              className="h-9 rounded-md border border-input bg-transparent px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="all">Semua pelanggan</option>
              <option value="true">Member saja</option>
              <option value="false">Non-member</option>
            </select>
            <Button type="submit" size="sm" variant="secondary">
              Cari
            </Button>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/customers">Reset</Link>
            </Button>
          </form>
        </div>

        {rows.length === 0 ? (
          <EmptyState
            icon={Users}
            title={
              filters.search ? "Pelanggan tidak ditemukan" : "Belum ada pelanggan"
            }
            description={
              filters.search
                ? "Coba kata kunci lain."
                : "Pelanggan bisa ditambahkan di kasir atau di halaman ini."
            }
          />
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nama</TableHead>
                  <TableHead>Kontak</TableHead>
                  <TableHead>Member</TableHead>
<TableHead className="text-right">Transaksi</TableHead>
                  <TableHead className="text-right">Poin</TableHead>
                  <TableHead>Bergabung</TableHead>
                  {canManage ? <TableHead className="w-10" /> : null}
                </TableRow>
              </TableHeader>

              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <Link
                        href={"/customers/" + row.id}
                        className="font-medium hover:underline"
                      >
                        {row.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-sm">
                      {row.phone ?? "-"}
                      {row.email ? (
                        <p className="text-xs text-muted-foreground">
                          {row.email}
                        </p>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      {row.isMember ? (
                        <Badge variant="secondary">{row.memberNumber}</Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell className="tabular text-right">
                      {formatNumber(row.totalPurchases)}
                    </TableCell>
                    <TableCell className="tabular text-right">
                      {formatNumber(row.points)}
                    </TableCell>
<TableCell className="text-xs text-muted-foreground">
                      {formatDate(row.createdAt)}
                    </TableCell>
                    {canManage ? (
                      <TableCell>
                        <CustomerDialog
                          trigger="icon"
                          customer={{
                            id: row.id,
                            name: row.name,
                            phone: row.phone,
                            email: row.email,
                            address: row.address,
                            notes: row.notes,
                            isMember: row.isMember,
                            isActive: row.isActive,
                          }}
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
      </Card>

      {topMembers.length > 0 ? (
        <Card>
          <div className="border-b p-4">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Coins className="size-4 text-brand-600" aria-hidden />
              Member paling aktif
            </h2>
            <p className="text-xs text-muted-foreground">
              Berdasarkan total belanja sepanjang waktu.
            </p>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nama</TableHead>
                <TableHead>Member</TableHead>
                <TableHead className="text-right">Transaksi</TableHead>
                <TableHead className="text-right">Poin</TableHead>
                <TableHead className="text-right">Total Belanja</TableHead>
              </TableRow>
            </TableHeader>

            <TableBody>
              {topMembers.map((member) => (
                <TableRow key={member.id}>
                  <TableCell>
                    <Link
                      href={"/customers/" + member.id}
                      className="font-medium hover:underline"
                    >
                      {member.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {member.memberNumber}
                  </TableCell>
                  <TableCell className="tabular text-right">
                    {formatNumber(member.totalPurchases)}
                  </TableCell>
                  <TableCell className="tabular text-right">
                    {formatNumber(member.points)}
                  </TableCell>
                  <TableCell className="tabular text-right font-medium">
                    {formatCurrency(member.lifetimeSpend)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      ) : null}
    </div>
  );
}


