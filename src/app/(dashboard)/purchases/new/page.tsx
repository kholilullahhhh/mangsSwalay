import type { Metadata } from "next";

import { requirePagePermission } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { NewPurchaseButton } from "../new-purchase-button";

export const metadata: Metadata = {
  title: "Pembelian Baru",
};

/**
 * Dedicated purchase-creation page.
 *
 * The same dialog the purchases list opens, reachable on its own URL. That exists
 * because entering a multi-line purchase order through a modal loses the lines on
 * an accidental Escape or a refresh, and a half-typed order is easy to lose.
 * Opening this page directly is also what the dashboard's quick action links to.
 */
export default async function NewPurchasePage() {
  await requirePagePermission("purchases:create");

  const suppliers = await prisma.supplier.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  // The order has to name products, not paste internal ids: a cuid in a free-text
  // field is a transcription error waiting to happen, and an unresolvable one
  // turns into a 500 rather than a "product not found" message.
  const products = await prisma.product.findMany({
    where: { isActive: true },
    select: {
      id: true,
      sku: true,
      name: true,
      hasExpiry: true,
      purchasePrice: true,
    },
    orderBy: { name: "asc" },
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">
          Pembelian Baru
        </h1>
        <p className="text-sm text-muted-foreground">
          Pesanan disimpan sebagai Draft. Stok hanya bertambah setelah barang
          diterima dan dikonfirmasi.
        </p>
      </div>

      {suppliers.length === 0 ? (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          Belum ada supplier aktif. Tambahkan supplier terlebih dahulu sebelum
          membuat pesanan pembelian.
        </p>
      ) : (
        <NewPurchaseButton
          suppliers={suppliers}
          products={products.map((product) => ({
            id: product.id,
            sku: product.sku,
            name: product.name,
            hasExpiry: product.hasExpiry,
            purchasePrice: Number(product.purchasePrice),
          }))}
          defaultOpen
        />
      )}
    </div>
  );
}