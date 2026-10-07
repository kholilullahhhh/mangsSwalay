import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Coins } from "lucide-react";

import { requirePagePermission } from "@/lib/auth/session";
import { listTopMembers, getSetting } from "@/lib/queries/catalog";
import { formatCurrency, formatNumber } from "@/lib/format";
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

export const metadata: Metadata = {
  title: "Member & Loyalty",
};

/**
 * Loyalty overview.
 *
 * The earn ratio is read from StoreSetting rather than hardcoded, so changing
 * "Rp10.000 = 1 point" in settings takes effect here without a deploy.
 */
export default async function LoyaltyPage() {
  await requirePagePermission("customers:view");

  const [members, ratio] = await Promise.all([
    listTopMembers(50),
    getSetting<number>("loyalty.ratio", 10_000),
    getSetting<boolean>("loyalty.enabled", true),
  ]);

  const totalPoints = members.reduce((sum, m) => sum + m.points, 0);
  const totalSpend = members.reduce((sum, m) => sum + m.lifetimeSpend, 0);

  return (
    <div className="space-y-4">
      <div>
        <Link
          href="/customers"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Kembali ke pelanggan
        </Link>

        <h1 className="mt-1 text-lg font-semibold tracking-tight">
          Member &amp; Loyalty
        </h1>
        <p className="text-sm text-muted-foreground">
          Setiap {formatCurrency(ratio)} belanja = 1 poin
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Member aktif</p>
          <p className="tabular mt-1 text-xl font-semibold">
            {formatNumber(members.length)}
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Total poin beredar</p>
          <p className="tabular mt-1 text-xl font-semibold text-brand-600">
            {formatNumber(totalPoints)}
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Total belanja member</p>
          <p className="tabular mt-1 text-xl font-semibold">
            {formatCurrency(totalSpend)}
          </p>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Peringkat Member</CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          {members.length === 0 ? (
            <EmptyState
              icon={Coins}
              title="Belum ada member"
              description="Pelanggan member akan muncul di sini setelah mendapat poin."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">#</TableHead>
                  <TableHead>Nama</TableHead>
                  <TableHead>Nomor</TableHead>
                  <TableHead className="text-right">Transaksi</TableHead>
                  <TableHead className="text-right">Poin</TableHead>
                  <TableHead className="text-right">Total Belanja</TableHead>
                </TableRow>
              </TableHeader>

              <TableBody>
                {members.map((member, index) => (
                  <TableRow key={member.id}>
                    <TableCell className="tabular text-muted-foreground">
                      {index + 1}
                    </TableCell>
                    <TableCell>
                      <Link
                        href={"/customers/" + member.id}
                        className="font-medium hover:underline"
                      >
                        {member.name}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{member.memberNumber}</Badge>
                    </TableCell>
                    <TableCell className="tabular text-right">
                      {formatNumber(member.totalPurchases)}
                    </TableCell>
                    <TableCell className="tabular text-right font-medium">
                      {formatNumber(member.points)}
                    </TableCell>
                    <TableCell className="tabular text-right">
                      {formatCurrency(member.lifetimeSpend)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

