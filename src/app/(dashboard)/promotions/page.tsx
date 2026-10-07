import type { Metadata } from "next";
import { Plus } from "lucide-react";

import { hasPermission, requirePagePermission } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { listPromotions } from "@/lib/queries/catalog";
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
import { EmptyState } from "@/components/data/empty-state";
import { PromotionDialog } from "@/components/admin/promotion-dialog";
import { PromotionRowActions } from "@/components/admin/promotion-row-actions";

export const metadata: Metadata = {
  title: "Promo",
};

/** Human-readable summary of what a promotion actually does. */
function describePromotion(promotion: {
  type: string;
  value: unknown;
  minPurchaseAmount: unknown;
  buyQuantity: number | null;
  getQuantity: number | null;
  category: { name: string } | null;
  _count: { products: number };
}): string {
  const value = Number(promotion.value);

  switch (promotion.type) {
    case "PERCENTAGE":
      return Number.isFinite(value) ? value + "% dari total belanja" : "-";
    case "FIXED":
      return formatCurrency(value);
    case "MINIMUM_PURCHASE":
      return (
        value +
        "% untuk belanja di atas " +
        formatCurrency(Number(promotion.minPurchaseAmount ?? 0))
      );
    case "BUY_X_GET_Y":
      return "Beli " + promotion.buyQuantity + ", gratis " + promotion.getQuantity;
    case "CATEGORY":
      return (
        value + "% untuk kategori " + (promotion.category?.name ?? "(tidak dipilih)")
      );
    case "PRODUCT":
      return value + "% untuk " + promotion._count.products + " produk terpilih";
    default:
      return "-";
  }
}

/** Whether the promo is usable right now, and why not if it is not. */
function currentStatus(promotion: {
  isActive: boolean;
  startDate: Date;
  endDate: Date;
  usageLimit: number | null;
  usedCount: number;
}): { label: string; variant: "default" | "secondary" | "destructive" | "outline" } {
  const now = Date.now();

  if (!promotion.isActive) {
    return { label: "Nonaktif", variant: "outline" };
  }

  if (now < promotion.startDate.getTime()) {
    return { label: "Belum mulai", variant: "secondary" };
  }

  if (now > promotion.endDate.getTime()) {
    return { label: "Berakhir", variant: "outline" };
  }

  if (promotion.usageLimit !== null && promotion.usedCount >= promotion.usageLimit) {
    return { label: "Habis", variant: "destructive" };
  }

  return { label: "Aktif", variant: "default" };
}

const TYPE_LABEL: Record<string, string> = {
  PERCENTAGE: "Persentase",
  FIXED: "Nominal Tetap",
  BUY_X_GET_Y: "Beli Gratis",
  PRODUCT: "Produk Tertentu",
  CATEGORY: "Kategori",
  MINIMUM_PURCHASE: "Minimum Belanja",
};

export default async function PromotionsPage() {
  await requirePagePermission("promotions:view");
  const canManage = await hasPermission("promotions:manage");

  const [promotions, categories, products] = await Promise.all([
    listPromotions(),
    // The dialog is one client component that renders every promotion type, so
    // both option lists are always fetched rather than per type: conditional
    // props would mean a different dialog shape each time it opens.
    prisma.category.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.product.findMany({
      where: { isActive: true },
      select: { id: true, name: true, sku: true },
      orderBy: { name: "asc" },
      take: 500,
    }),
  ]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Promo</h1>
          <p className="text-sm text-muted-foreground">
            Voucher dan diskon yang bisa dipakai kasir di kasir. Promo dipakai
            satu per transaksi.
          </p>
        </div>

        {canManage ? (
          <PromotionDialog
            categories={categories}
            products={products}
            trigger={
              <Button>
                <Plus aria-hidden className="size-4" />
                Tambah Promo
              </Button>
            }
          />
        ) : null}
      </div>

      <Card>
        <CardContent className="px-0">
          {promotions.length === 0 ? (
            <EmptyState
              title="Belum ada promo"
              description="Tambahkan promo untuk memberi diskon di kasir."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Kode</TableHead>
                  <TableHead>Promo</TableHead>
                  <TableHead>Jenis</TableHead>
                  <TableHead>Periode</TableHead>
                  <TableHead className="text-right">Pemakaian</TableHead>
                  <TableHead>Status</TableHead>
                  {canManage ? <TableHead className="text-right">Aksi</TableHead> : null}
                </TableRow>
              </TableHeader>

              <TableBody>
                {promotions.map((promotion) => {
                  const status = currentStatus(promotion);

                  return (
                    <TableRow key={promotion.id}>
                      <TableCell>
                        <span className="font-mono font-medium">
                          {promotion.code}
                        </span>
                      </TableCell>

                      <TableCell>
                        <p className="font-medium">{promotion.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {describePromotion(promotion)}
                        </p>
                      </TableCell>

                      <TableCell className="text-sm">
                        {TYPE_LABEL[promotion.type] ?? promotion.type}
                      </TableCell>

                      <TableCell className="text-xs">
                        <p>{formatDate(promotion.startDate)}</p>
                        <p className="text-muted-foreground">
                          s/d {formatDate(promotion.endDate)}
                        </p>
                      </TableCell>

                      <TableCell className="tabular text-right text-sm">
                        {promotion.usageLimit === null
                          ? formatNumber(promotion.usedCount) + " / ∞"
                          : formatNumber(promotion.usedCount) +
                            " / " +
                            formatNumber(promotion.usageLimit)}
                      </TableCell>

                      <TableCell>
                        <Badge variant={status.variant}>{status.label}</Badge>
                      </TableCell>

                      {canManage ? (
                        <TableCell className="text-right">
                          <PromotionRowActions
                            promotion={{
                              id: promotion.id,
                              code: promotion.code,
                              name: promotion.name,
                              description: promotion.description,
                              type: promotion.type,
                              value: Number(promotion.value),
                              minPurchaseAmount: promotion.minPurchaseAmount
                                ? Number(promotion.minPurchaseAmount)
                                : null,
                              buyQuantity: promotion.buyQuantity,
                              getQuantity: promotion.getQuantity,
                              categoryId: promotion.categoryId,
                              startDate: formatDate(promotion.startDate),
                              endDate: formatDate(promotion.endDate),
                              usageLimit: promotion.usageLimit,
                              usedCount: promotion.usedCount,
                              isActive: promotion.isActive,
                              productIds: promotion.productIds,
                            }}
                            categories={categories}
                            products={products}
                          />
                        </TableCell>
                      ) : null}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Aturan promo dihitung ulang di server setiap transaksi, jadi nominal yang
        terlihat di kasir selalu sama dengan yang tercatat di invoice.
      </p>
    </div>
  );
}