import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Search } from "lucide-react";

import { requirePagePermission } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { ADJUSTMENT_REASONS } from "@/lib/inventory/rules";
import { formatNumber } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

import { AdjustmentForm } from "./form";

export const metadata: Metadata = {
  title: "Adjustment Stok",
};

/**
 * Manual stock correction.
 *
 * The operator picks products and enters the stock they actually observe. The
 * reason is mandatory, and the form shows the resulting difference before
 * saving so nobody corrects a number they misread.
 */
export default async function AdjustmentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePagePermission("stock:adjust");

  const params = await searchParams;
  const query = Array.isArray(params.search) ? params.search[0] : params.search;
  const categoryId = Array.isArray(params.categoryId)
    ? params.categoryId[0]
    : params.categoryId;

  // Candidates are limited: this is a correction screen, not a catalogue
  // browser, so a bounded searchable set is the right shape.
  const products = await prisma.product.findMany({
    where: {
      isActive: true,
      ...(categoryId ? { categoryId } : {}),
      ...(query
        ? {
            OR: [
              { name: { contains: query, mode: "insensitive" as const } },
              { sku: { contains: query, mode: "insensitive" as const } },
            ],
          }
        : {}),
    },
    select: {
      id: true,
      sku: true,
      name: true,
      unit: true,
      stock: true,
      purchasePrice: true,
      category: { select: { name: true } },
    },
    orderBy: { name: "asc" },
    take: 100,
  });

  return (
    <div className="space-y-4">
      <div>
        <Button variant="ghost" size="sm" asChild className="-ml-2 mb-1">
          <Link href="/inventory">
            <ArrowLeft className="size-4" aria-hidden />
            Kembali ke stok
          </Link>
        </Button>

        <h1 className="text-lg font-semibold tracking-tight">
          Adjustment Stok
        </h1>
        <p className="text-sm text-muted-foreground">
          Masukkan stok fisik yang sebenarnya. Selisihnya akan tercatat di
          riwayat stok beserta alasan.
        </p>
      </div>

      <Card className="p-4">
        <form className="flex flex-wrap items-center gap-2" action="/inventory/adjustment">
          <div className="relative min-w-56 flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <input
              name="search"
              type="search"
              defaultValue={query ?? ""}
              placeholder="Cari produk untuk dikoreksi..."
              aria-label="Cari produk"
              className="h-9 w-full rounded-md border border-input bg-transparent pl-9 pr-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          <Button type="submit" size="sm" variant="secondary">
            Cari
          </Button>
          <p className="text-xs text-muted-foreground">
            {formatNumber(products.length)} produk ditampilkan
          </p>
        </form>
      </Card>

      <AdjustmentForm
        products={products.map((product) => ({
          id: product.id,
          sku: product.sku,
          name: product.name,
          unit: product.unit,
          stock: product.stock,
          cost: Number(product.purchasePrice),
          category: product.category.name,
        }))}
        reasons={ADJUSTMENT_REASONS.map((reason) => ({
          value: reason.value,
          label: reason.label,
        }))}
      />
    </div>
  );
}


