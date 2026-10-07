import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, FileClock } from "lucide-react";

import { requirePagePermission, hasPermission } from "@/lib/auth/session";
import {
  getProductById,
  listBrandOptions,
  listCategoryOptions,
} from "@/lib/queries/products";
import { prisma } from "@/lib/db";
import { MOVEMENT_LABEL } from "@/lib/queries/inventory";
import {
  formatCurrency,
  formatDate,
  formatDateTime,
  formatNumber,
} from "@/lib/format";
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
import { StockBadge } from "@/components/data/stock-badge";
import { EmptyState } from "@/components/data/empty-state";

import { EditProductButton } from "./edit-button";

export const metadata: Metadata = {
  title: "Detail Produk",
};

const UNIT_LABEL: Record<string, string> = {
  PCS: "pcs", PACK: "kemasan", BOX: "dus", KG: "kg", G: "gram", L: "liter",
  ML: "ml", DOSE: "dosis", SACHET: "sachet", CAN: "kaleng", BOTTLE: "botol",
  ROLL: "roll", TUBE: "tube",
};

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requirePagePermission("products:view");

  const { id } = await params;
  const product = await getProductById(id);

  if (!product) {
    notFound();
  }

  const [categories, brands] = await Promise.all([
    listCategoryOptions(),
    listBrandOptions(),
  ]);

  // Read once per render pass on the server: the count-down to expiry must be
  // stable across the batch list, and `Date.now()` inside JSX would be called
  // again on any re-render, making rows disagree with each other.
  const now = new Date();

  const [movements, batches, salesAgg, canEdit] = await Promise.all([
    prisma.inventoryMovement.findMany({
      where: { productId: id },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 15,
      select: {
        id: true,
        type: true,
        quantity: true,
        previousStock: true,
        newStock: true,
        note: true,
        createdAt: true,
        user: { select: { name: true } },
      },
    }),
    prisma.productBatch.findMany({
      where: { productId: id, quantity: { gt: 0 } },
      orderBy: { expiryDate: "asc" },
      select: { id: true, batchNumber: true, expiryDate: true, quantity: true },
    }),
    prisma.saleItem.aggregate({
      where: { productId: id, sale: { status: { in: ["COMPLETED", "PARTIALLY_REFUNDED"] } } },
      _sum: { quantity: true, subtotal: true },
    }),
    hasPermission("products:update"),
  ]);

  const totalSold = salesAgg._sum.quantity ?? 0;
  const revenue = Number(salesAgg._sum.subtotal ?? 0);
  const margin =
    Number(product.sellingPrice) > 0
      ? Math.round(
          ((Number(product.sellingPrice) - Number(product.purchasePrice)) /
            Number(product.sellingPrice)) *
            100,
        )
      : 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            href="/products"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" aria-hidden />
            Kembali ke produk
          </Link>

          <h1 className="mt-1 flex flex-wrap items-center gap-2 text-lg font-semibold tracking-tight">
            {product.name}
            {!product.isActive ? (
              <Badge variant="destructive">Nonaktif</Badge>
            ) : product.isFeatured ? (
              <Badge variant="outline">Unggulan</Badge>
            ) : null}
          </h1>

          <p className="font-mono text-sm text-muted-foreground">{product.sku}</p>
        </div>

        {canEdit ? (
          <EditProductButton
            product={{
              id: product.id,
              name: product.name,
              sku: product.sku,
              barcode: product.barcode,
              categoryId: product.category.id,
              brandId: product.brand?.id ?? null,
              unit: product.unit,
              purchasePrice: Number(product.purchasePrice),
              sellingPrice: Number(product.sellingPrice),
              minSellingPrice:
                product.minSellingPrice === null
                  ? null
                  : Number(product.minSellingPrice),
              stock: product.stock,
              minStock: product.minStock,
              maxStock: product.maxStock,
              isActive: product.isActive,
              isFeatured: product.isFeatured,
              hasExpiry: product.hasExpiry,
              description: product.description,
            }}
            categories={categories}
            brands={brands}
          />
        ) : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Stok saat ini</p>
          <div className="mt-1 flex items-center gap-2">
            <span className="tabular text-xl font-semibold">
              {formatNumber(product.stock)}
            </span>
            <span className="text-xs text-muted-foreground">
              {UNIT_LABEL[product.unit] ?? product.unit}
            </span>
          </div>
          <div className="mt-1.5">
            <StockBadge
              stock={product.stock}
              minStock={product.minStock}
              unit={product.unit}
            />
          </div>
        </Card>

        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Harga jual</p>
          <p className="tabular mt-1 text-xl font-semibold">
            {formatCurrency(product.sellingPrice)}
          </p>
          <p className="text-xs text-muted-foreground">
            Modal {formatCurrency(product.purchasePrice)} · margin {margin}%
          </p>
        </Card>

        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Total terjual</p>
          <p className="tabular mt-1 text-xl font-semibold">
            {formatNumber(totalSold)}
          </p>
          <p className="text-xs text-muted-foreground">
            Pendapatan {formatCurrency(revenue)}
          </p>
        </Card>

        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Nilai persediaan</p>
          <p className="tabular mt-1 text-xl font-semibold">
            {formatCurrency(Number(product.purchasePrice) * product.stock)}
          </p>
          <p className="text-xs text-muted-foreground">
            Minimum {formatNumber(product.minStock)}
          </p>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Informasi</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Kategori</dt>
                <dd>
                  <Link
                    href={"/products?categoryId=" + product.category.id}
                    className="hover:underline"
                  >
                    {product.category.name}
                  </Link>
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Merek</dt>
                <dd>{product.brand?.name ?? "-"}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Barcode</dt>
                <dd className="font-mono text-xs">
                  {product.barcode ?? "-"}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Satuan</dt>
                <dd>{UNIT_LABEL[product.unit] ?? product.unit}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Stok maksimum</dt>
                <dd className="tabular">
                  {product.maxStock === null
                    ? "-"
                    : formatNumber(product.maxStock)}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Kedaluwarsa</dt>
                <dd>{product.hasExpiry ? "Ya, pakai batch" : "Tidak"}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Diperbarui</dt>
                <dd>{formatDateTime(product.updatedAt)}</dd>
              </div>
            </dl>

            {product.description ? (
              <p className="mt-3 rounded-md border bg-muted/40 p-3 text-sm">
                {product.description}
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <FileClock className="size-4" aria-hidden />
              Riwayat Stok Terakhir
            </CardTitle>
          </CardHeader>
          <CardContent className="px-0">
            {movements.length === 0 ? (
              <EmptyState
                title="Belum ada pergerakan stok"
                description="Riwayat akan terisi saat ada pembelian, penjualan, atau penyesuaian."
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Waktu</TableHead>
                    <TableHead>Jenis</TableHead>
                    <TableHead className="text-right">Jumlah</TableHead>
                    <TableHead className="text-right">Stok</TableHead>
                    <TableHead>Oleh</TableHead>
                  </TableRow>
                </TableHeader>

                <TableBody>
                  {movements.map((movement) => (
                    <TableRow key={movement.id}>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatDateTime(movement.createdAt)}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {MOVEMENT_LABEL[movement.type] ?? movement.type}
                        </Badge>
                      </TableCell>
                      <TableCell className="tabular text-right">
                        {formatNumber(movement.quantity)}
                      </TableCell>
                      <TableCell className="tabular text-right text-xs text-muted-foreground">
                        {movement.previousStock} → {movement.newStock}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {movement.user?.name ?? "Sistem"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      {batches.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Batch &amp; Kedaluwarsa</CardTitle>
          </CardHeader>
          <CardContent className="px-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nomor Batch</TableHead>
                  <TableHead>Kedaluwarsa</TableHead>
                  <TableHead className="text-right">Jumlah</TableHead>
                </TableRow>
              </TableHeader>

              <TableBody>
                {batches.map((batch) => {
                  const days = Math.ceil(
                    (batch.expiryDate.getTime() - now.getTime()) / 86_400_000,
                  );

                  return (
                    <TableRow key={batch.id}>
                      <TableCell className="font-mono text-xs">
                        {batch.batchNumber}
                      </TableCell>
                      <TableCell className="text-sm">
                        {formatDate(batch.expiryDate)}
                      </TableCell>
                      <TableCell className="text-right">
                        <span
                          className={
                            "text-xs " +
                            (days <= 0
                              ? "text-stock-out"
                              : days <= 30
                                ? "text-stock-expiring"
                                : "text-muted-foreground")
                          }
                        >
                          {days <= 0
                            ? "Kedaluwarsa"
                            : days + " hari lagi"}
                        </span>
                        <span className="tabular ml-2 text-sm">
                          {formatNumber(batch.quantity)}
                        </span>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

