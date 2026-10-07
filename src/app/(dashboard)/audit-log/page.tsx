import type { Metadata } from "next";

import { requirePagePermission } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { ROLE_LABELS } from "@/lib/rbac";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TablePagination } from "@/components/data/table-pagination";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/data/empty-state";
import { listAuditActions, listAuditLogs } from "@/lib/queries/catalog";
import { AuditFilters } from "./filters";

export const metadata: Metadata = {
  title: "Log Audit",
};

/**
 * Immutable record of who changed what.
 *
 * Payloads are shown as a field-level diff rather than raw JSON: the log's job is
 * to answer "what changed and who did it", and dumping two blobs side by side
 * makes the reader do that work by eye.
 */
export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePagePermission("audit-log:view");

  const params = await searchParams;
  const single = (value: string | string[] | undefined) =>
    Array.isArray(value) ? value[0] : value || undefined;

  const filters = {
    action: single(params.action),
    entity: single(params.entity),
    userId: single(params.userId),
    search: single(params.search),
    dateFrom: single(params.dateFrom),
    dateTo: single(params.dateTo),
    page: single(params.page),
    perPage: single(params.perPage),
  };

  const [log, actions, users] = await Promise.all([
    listAuditLogs(filters),
    listAuditActions(),
    prisma.user.findMany({
      select: { id: true, name: true, username: true, role: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Log Audit</h1>
        <p className="text-sm text-muted-foreground">
          Setiap perubahan data toko tercatat di sini dan tidak bisa diubah.
        </p>
      </div>

      <AuditFilters
        actions={actions}
        users={users}
        current={filters}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {log.total.toLocaleString("id-ID")} catatan
          </CardTitle>
        </CardHeader>

        <CardContent className="px-0">
          {log.rows.length === 0 ? (
            <EmptyState
              title="Tidak ada catatan"
              description="Belum ada aktivitas yang cocok dengan filter ini."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Waktu</TableHead>
                  <TableHead>Pengguna</TableHead>
                  <TableHead>Aksi</TableHead>
                  <TableHead>Entitas</TableHead>
                  <TableHead>Perubahan</TableHead>
                </TableRow>
              </TableHeader>

              <TableBody>
                {log.rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="whitespace-nowrap text-xs">
                      {formatDateTime(row.createdAt)}
                      {row.ipAddress ? (
                        <p className="font-mono text-muted-foreground">
                          {row.ipAddress}
                        </p>
                      ) : null}
                    </TableCell>

                    <TableCell>
                      <p className="text-sm font-medium">
                        {row.user?.name ?? "Sistem"}
                      </p>
                      {row.user ? (
                        <p className="text-xs text-muted-foreground">
                          {row.user.username} ·{" "}
                          {ROLE_LABELS[row.user.role] ?? row.user.role}
                        </p>
                      ) : null}
                    </TableCell>

                    <TableCell>
                      <Badge variant="secondary" className="font-mono text-[10px]">
                        {row.action}
                      </Badge>
                    </TableCell>

                    <TableCell className="text-xs">
                      <p className="font-medium">{row.entity}</p>
                      {row.entityId ? (
                        <p className="max-w-32 truncate font-mono text-muted-foreground">
                          {row.entityId}
                        </p>
                      ) : null}
                    </TableCell>

                    <TableCell>
                      <ChangeSummary
                        oldData={row.oldData}
                        newData={row.newData}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>

        <TablePagination
          pagination={log.pagination}
          searchParams={params}
          total={log.total}
        />
      </Card>
    </div>
  );
}

/**
 * The changed fields of one audit entry.
 *
 * Collapsed by default with the count of changed fields as the summary, so the
 * table stays scannable; a full-page dump of JSON per row would bury the action
 * and user columns that are the reason to open this screen.
 */
function ChangeSummary({
  oldData,
  newData,
}: {
  oldData: unknown;
  newData: unknown;
}) {
  const before = isRecord(oldData) ? oldData : {};
  const after = isRecord(newData) ? newData : {};

  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];

  if (keys.length === 0) {
    return <span className="text-xs text-muted-foreground">-</span>;
  }

  // Only fields that genuinely differ are listed: the audit payload often
  // carries the whole submitted form, most of which is unchanged.
  const changed = keys.filter(
    (key) => formatValue(before[key]) !== formatValue(after[key]),
  );

  if (changed.length === 0) {
    return <span className="text-xs text-muted-foreground">tidak berubah</span>;
  }

  return (
    <details className="max-w-sm">
      <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
        {changed.length} field berubah
      </summary>

      <dl className="mt-1.5 space-y-0.5">
        {changed.map((key) => (
          <div key={key} className="flex gap-1 text-xs">
            <dt className="shrink-0 font-medium">{key}:</dt>
            <dd className="min-w-0 flex-1 truncate text-muted-foreground">
              {formatValue(before[key])} → {formatValue(after[key])}
            </dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * One-line rendering of an audit value.
 *
 * Objects become a compact JSON fragment rather than "[object Object]", which is
 * what a naive String() would produce and is useless in a log.
 */
function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "kosong";
  if (typeof value === "boolean") return value ? "ya" : "tidak";

  const text = typeof value === "object" ? JSON.stringify(value) : String(value);

  return text.length > 60 ? text.slice(0, 60) + "…" : text;
}