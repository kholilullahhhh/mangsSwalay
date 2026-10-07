import type { Metadata } from "next";

import { requirePagePermission } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { listPosGrid } from "@/lib/queries/products";
import { PosTerminal } from "./terminal";
import { getPosTaxRate } from "./actions";

export const metadata: Metadata = {
  title: "POS / Kasir",
};

/**
 * Point of Sale.
 *
 * The page only assembles the initial data — the product grid, the cashier's open
 * shift, and loyalty settings — and hands it to the client terminal. All
 * business rules (pricing, stock, payment validation) live on the server and are
 * re-evaluated at checkout; the client never decides what a sale costs.
 */
export default async function PosPage() {
  const user = await requirePagePermission("pos:use");

  // A shift must be open before any cash can be taken. Rather than blocking the
  // POS entirely, we surface the requirement in the UI and refuse cash payments
  // server-side until one is open.
  const openShift = await prisma.cashShift.findFirst({
    where: { userId: user.id, status: "OPEN" },
    select: { id: true, number: true, openedAt: true, openingCash: true },
  });

const [products, categories, loyaltyRatio, customers, storeInfo, taxRate] =
    await Promise.all([
      listPosGrid({ take: 120 }),
      prisma.category.findMany({
        where: { isActive: true },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
      prisma.storeSetting.findUnique({ where: { key: "loyalty.ratio" } }),
      prisma.customer.findMany({
        where: { isActive: true },
        select: { id: true, name: true, phone: true, memberNumber: true, isMember: true },
        orderBy: { name: "asc" },
        take: 500,
      }),
      // Receipt header comes from settings, so a shop that changes its address
      // gets correct receipts without anyone editing the UI.
      prisma.storeSetting.findMany({
        where: {
          key: {
            in: ["store.name", "store.address", "store.phone", "tax.enabled", "tax.rate"],
          },
        },
        select: { key: true, value: true },
      }),
      // The client shows tax in its running total. Checkout recomputes this from
      // the same settings, so the preview and the charge always agree.
      getPosTaxRate(),
    ]);

  const storeByKey = new Map(storeInfo.map((row) => [row.key, row.value]));

  const ratio =
    loyaltyRatio && typeof loyaltyRatio.value === "number"
      ? loyaltyRatio.value
      : 10_000;

  return (
    <PosTerminal
      initialProducts={products.map((product) => ({
        id: product.id,
        sku: product.sku,
        barcode: product.barcode,
        name: product.name,
        unit: product.unit,
        categoryId: product.categoryId,
        sellingPrice: Number(product.sellingPrice),
        stock: product.stock,
      }))}
      categories={categories}
      customers={customers}
      shift={openShift
        ? {
            id: openShift.id,
            number: openShift.number,
            openingCash: Number(openShift.openingCash),
          }
        : null}
loyaltyRatio={ratio}
      taxRate={taxRate}
      cashierName={user.name}
      store={{
        name: String(storeByKey.get("store.name") ?? "Swalayaku"),
        address: String(storeByKey.get("store.address") ?? ""),
        phone: String(storeByKey.get("store.phone") ?? ""),
      }}
    />
  );
}
