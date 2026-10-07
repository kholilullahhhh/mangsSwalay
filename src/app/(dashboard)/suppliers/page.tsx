import type { Metadata } from "next";
import Link from "next/link";
import { Truck } from "lucide-react";

import { requirePagePermission, hasPermission } from "@/lib/auth/session";
import { listSuppliers } from "@/lib/queries/purchases";
import { formatNumber } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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

import { NewSupplierButton } from "./new-supplier-button";

export const metadata: Metadata = {
  title: "Supplier",
};

/**
 * Supplier list with server-side search, filtering, and pagination.
 */
export default async function SuppliersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePagePermission("suppliers:view");

  const params = await searchParams;

  const search = single(params.search);
  const isActiveParam = single(params.isActive);

  const { rows, total, pagination } = await listSuppliers({
    search,
    isActive:
      isActiveParam === "false"
        ? "false"
        : isActiveParam === "all"
          ? "all"
          : "true",
    sort: single(params.sort),
    direction: single(params.direction),
    page: single(params.page),
    perPage: single(params.perPage),
  });

  const canManage = await hasPermission("suppliers:manage");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Supplier</h1>
          <p className="text-sm text-muted-foreground">
            {formatNumber(total)} supplier terdaftar
          </p>
        </div>

        {canManage ? <NewSupplierButton /> : null}
      </div>

      <Card>
        <div className="border-b p-4">
          <form
            className="flex flex-wrap items-center gap-2"
            action="/suppliers"
          >
            <Input
              name="search"
              type="search"
              defaultValue={search ?? ""}
              placeholder="Cari nama, kode, atau kontak supplier…"
              className="min-w-48 flex-1 sm:max-w-sm"
              aria-label="Cari supplier"
            />
            <Button type="submit" size="sm" variant="secondary">
              Cari
            </Button>

            {isActiveParam && isActiveParam !== "true" ? (
              <Button variant="ghost" size="sm" asChild>
                <Link href="/suppliers">Tampilkan semua</Link>
              </Button>
            ) : (
              <Button variant="ghost" size="sm" asChild>
                <Link href="/suppliers?isActive=all">
                  Tampilkan nonaktif
                </Link>
              </Button>
            )}
          </form>
        </div>

        {rows.length === 0 ? (
          <EmptyState
            icon={Truck}
            title={search ? "Supplier tidak ditemukan" : "Belum ada supplier"}
            description={
              search
                ? "Coba kata kunci lain."
                : "Tambahkan supplier untuk membuat pesanan pembelian."
            }
          />
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Kode</TableHead>
                  <TableHead>Nama</TableHead>
                  <TableHead>Kontak</TableHead>
                  <TableHead className="text-center">Pembelian</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>

              <TableBody>
                {rows.map((supplier) => (
                  <TableRow key={supplier.id}>
                    <TableCell className="font-mono text-xs">
                      {supplier.code}
                    </TableCell>

                    <TableCell>
                      <Link
                        href={`/suppliers/${supplier.id}`}
                        className="font-medium hover:underline"
                      >
                        {supplier.name}
                      </Link>
                      {supplier.company &&
                      supplier.company !== supplier.name ? (
                        <p className="text-xs text-muted-foreground">
                          {supplier.company}
                        </p>
                      ) : null}
                    </TableCell>

                    <TableCell className="text-sm">
                      {supplier.contactPerson ? (
                        <p>{supplier.contactPerson}</p>
                      ) : null}
                      {supplier.phone ? (
                        <p className="text-xs text-muted-foreground">
                          {supplier.phone}
                        </p>
                      ) : null}
                      {!supplier.contactPerson && !supplier.phone ? (
                        <span className="text-muted-foreground">—</span>
                      ) : null}
                    </TableCell>

                    <TableCell className="text-center tabular text-sm">
                      {formatNumber(supplier.purchaseCount)}
                    </TableCell>

                    <TableCell>
                      {supplier.isActive ? (
                        <Badge variant="outline" className="text-stock-ok">
                          Aktif
                        </Badge>
                      ) : (
                        <Badge variant="destructive">Nonaktif</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            <TablePagination
              pagination={{ ...pagination, total } as PaginationMeta}
              searchParams={serialise(params)}
              total={total}
            />
          </>
        )}
      </Card>
    </div>
  );
}

function single(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value || undefined;
}

function serialise(
  params: Record<string, string | string[] | undefined>,
): Record<string, string> {
  const output: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    const one = Array.isArray(value) ? value[0] : value;
    if (one) output[key] = one;
  }
  return output;
}
