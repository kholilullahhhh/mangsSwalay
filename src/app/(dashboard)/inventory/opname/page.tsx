import type { Metadata } from "next";
import Link from "next/link";
import { ClipboardList } from "lucide-react";

import { requirePagePermission, hasPermission } from "@/lib/auth/session";
import { listOpnames } from "@/lib/inventory/mutations";
import { listCategoryOptions } from "@/lib/queries/products";
import { formatDateTime, formatNumber } from "@/lib/format";
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
import { EmptyState } from "@/components/data/empty-state";

import { NewOpnameButton } from "./new-opname-button";

export const metadata: Metadata = {
  title: "Stock Opname",
};

const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Draft",
  IN_PROGRESS: "Berjalan",
  REVIEW: "Ditinjau",
  APPROVED: "Disetujui",
  CANCELLED: "Dibatalkan",
};

const STATUS_VARIANT: Record<string, "outline" | "secondary" | "default" | "destructive"> = {
  DRAFT: "outline",
  IN_PROGRESS: "default",
  REVIEW: "secondary",
  APPROVED: "secondary",
  CANCELLED: "destructive",
};

/**
 * Stock opname sessions.
 *
 * A session freezes the system stock at opening so the physical count stays
 * meaningful even while sales continue during the count.
 */
export default async function OpnameListPage() {
  await requirePagePermission("stock:view");

  const [sessions, categories, canCreate] = await Promise.all([
    listOpnames(),
    listCategoryOptions(),
    hasPermission("stock:opname"),
  ]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Stock Opname</h1>
          <p className="text-sm text-muted-foreground">
            {formatNumber(sessions.length)} sesi
          </p>
        </div>

        {canCreate ? <NewOpnameButton categories={categories} /> : null}
      </div>

      <Card>
        {sessions.length === 0 ? (
          <EmptyState
            icon={ClipboardList}
            title="Belum ada sesi opname"
            description="Buat sesi untuk menghitung stok fisik dan mencocokkannya dengan sistem."
            action={
              canCreate ? (
                <NewOpnameButton
                  categories={categories}
                  label="Buat Sesi Opname"
                />
              ) : null
            }
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nomor</TableHead>
                <TableHead>Nama Sesi</TableHead>
                <TableHead className="text-center">Item</TableHead>
                <TableHead>Dibuat</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>

            <TableBody>
              {sessions.map((session) => (
                <TableRow key={session.id}>
                  <TableCell className="font-mono text-xs font-medium">
                    {session.number}
                  </TableCell>

                  <TableCell>
                    <span className="text-sm font-medium">{session.name}</span>
                    <p className="text-xs text-muted-foreground">
                      oleh {session.user.name}
                    </p>
                  </TableCell>

                  <TableCell className="tabular text-center text-sm">
                    {formatNumber(session._count.items)}
                  </TableCell>

                  <TableCell className="text-xs text-muted-foreground">
                    {formatDateTime(session.createdAt)}
                  </TableCell>

                  <TableCell>
                    <Badge variant={STATUS_VARIANT[session.status] ?? "outline"}>
                      {STATUS_LABEL[session.status] ?? session.status}
                    </Badge>
                  </TableCell>

                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm" asChild>
                      <Link href={"/inventory/opname/" + session.id}>
                        {session.status === "IN_PROGRESS"
                          ? "Lanjutkan"
                          : "Lihat"}
                      </Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}


