import type { Metadata } from "next";
import { Wallet } from "lucide-react";

import { requirePagePermission, hasPermission } from "@/lib/auth/session";
import { getOpenShift, listShifts, getShiftComponents } from "@/lib/shifts/mutations";
import { expectedCash } from "@/lib/shifts/rules";
import { formatCurrency, formatDate, formatNumber, formatTime } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/data/empty-state";

import { ShiftControls } from "./controls";

export const metadata: Metadata = {
  title: "Shift Kasir",
};

/**
 * Cash register shifts.
 *
 * A cashier sees only their own shifts; a manager or admin sees the whole team,
 * because reconciling the drawer is a supervisory responsibility.
 */
export default async function ShiftsPage() {
  const user = await requirePagePermission("shifts:view-own");

  const canViewAll = await hasPermission("shifts:view-all");

  const openShift = await getOpenShift(user.id);

  const components = openShift
    ? await getShiftComponents(openShift.id)
    : null;

  const { rows, total } = await listShifts({
    userId: canViewAll ? undefined : user.id,
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Shift Kasir</h1>
        <p className="text-sm text-muted-foreground">
          {formatNumber(total)} shift
          {canViewAll ? " (semua kasir)" : ""}
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">
              {openShift ? "Shift Terbuka" : "Tidak Ada Shift Terbuka"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {openShift && components ? (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge>{openShift.number}</Badge>
                  <span className="text-xs text-muted-foreground">
                    dibuka {formatTime(openShift.openedAt)}
                  </span>
                </div>

                <dl className="grid gap-3 sm:grid-cols-2">
                  <Row label="Kas awal" value={formatCurrency(components.openingCash)} />
                  <Row
                    label="Penjualan tunai"
                    value={formatCurrency(components.cashSales)}
                    positive
                  />
                  <Row
                    label="Retur tunai"
                    value={formatCurrency(components.cashRefunds)}
                    negative={components.cashRefunds > 0}
                  />
                  <Row
                    label="Kas masuk"
                    value={formatCurrency(components.cashIn)}
                    positive={components.cashIn > 0}
                  />
                  <Row
                    label="Kas keluar"
                    value={formatCurrency(components.cashOut)}
                    negative={components.cashOut > 0}
                  />
                  <Row
                    label="Harapan saat tutup"
                    value={formatCurrency(expectedCash(components))}
                    emphasis
                  />
                </dl>

                <p className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
                  Saat menutup shift, masukkan jumlah kas fisik yang dihitung.
                  Selisih antara harapan dan hasil hitungan akan dicatat
                  otomatis beserta alasannya.
                </p>
              </div>
            ) : (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Buka shift sebelum menerima transaksi agar kas awal tercatat
                dan selisih dapat dihitung saat tutup.
              </p>
            )}

            <div className="mt-4">
              <ShiftControls
                shift={
                  openShift && components
                    ? {
                        id: openShift.id,
                        number: openShift.number,
                        expected: expectedCash(components),
                      }
                    : null
                }
                canManage={await hasPermission("shifts:close")}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Cara Kerja Shift</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <Step index={1} text="Buka shift dengan memasukkan kas awal yang tersedia di laci." />
            <Step index={2} text="Layani pelanggan. Penjualan tunai otomatis tercatat ke shift." />
            <Step index={3} text="Catat kas masuk atau keluar kecil dengan alasan." />
            <Step index={4} text="Tutup shift dengan menghitung kas fisik. Selisih otomatis dihitung." />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Riwayat Shift</CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          {rows.length === 0 ? (
            <EmptyState
              icon={Wallet}
              title="Belum ada shift"
              description="Riwayat shift akan muncul setelah shift pertama dibuka."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nomor</TableHead>
                  <TableHead>Kasir</TableHead>
                  <TableHead>Tanggal</TableHead>
                  <TableHead className="text-center">Transaksi</TableHead>
                  <TableHead className="text-right">Kas Awal</TableHead>
                  <TableHead className="text-right">Harapan</TableHead>
                  <TableHead className="text-right">Aktual</TableHead>
                  <TableHead className="text-right">Selisih</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>

              <TableBody>
                {rows.map((shift) => {
                  return (
                    <TableRow key={shift.id}>
                      <TableCell className="font-mono text-xs font-medium">
                        {shift.number}
                      </TableCell>
                      <TableCell className="text-sm">{shift.userName}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatDate(shift.openedAt)}
                        <br />
                        {formatTime(shift.openedAt)}
                      </TableCell>
                      <TableCell className="tabular text-center text-sm">
                        {formatNumber(shift.saleCount)}
                      </TableCell>
                      <TableCell className="tabular text-right">
                        {formatCurrency(shift.openingCash)}
                      </TableCell>
                      <TableCell className="tabular text-right">
                        {shift.expectedCash === null
                          ? "-"
                          : formatCurrency(shift.expectedCash)}
                      </TableCell>
                      <TableCell className="tabular text-right">
                        {shift.closingCash === null
                          ? "-"
                          : formatCurrency(shift.closingCash)}
                      </TableCell>
                      <TableCell className="text-right">
                        {shift.variance === null ? (
                          <span className="text-muted-foreground">-</span>
                        ) : shift.variance === 0 ? (
                          <span className="text-xs text-stock-ok">Seimbang</span>
                        ) : (
                          <span
                            className={
                              "tabular text-xs font-medium " +
                              (shift.variance < 0 ? "text-stock-out" : "text-stock-low")
                            }
                          >
                            {shift.variance > 0 ? "+" : ""}
                            {formatCurrency(shift.variance)}
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={shift.status === "OPEN" ? "default" : "outline"}>
                          {shift.status === "OPEN" ? "Terbuka" : "Ditutup"}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Row({
  label,
  value,
  positive,
  negative,
  emphasis,
}: {
  label: string;
  value: string;
  positive?: boolean;
  negative?: boolean;
  emphasis?: boolean;
}) {
  return (
    <div className={emphasis ? "sm:col-span-2 border-t pt-2" : ""}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd
        className={
          "tabular text-sm font-medium " +
          (negative
            ? "text-stock-out"
            : positive
              ? "text-stock-ok"
              : emphasis
                ? "text-base"
                : "")
        }
      >
        {value}
      </dd>
    </div>
  );
}

function Step({ index, text }: { index: number; text: string }) {
  return (
    <div className="flex gap-2">
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-brand-600 text-[10px] font-medium text-white">
        {index}
      </span>
      <span>{text}</span>
    </div>
  );
}


