import type { Metadata } from "next";

import { requirePagePermission } from "@/lib/auth/session";
import { roleHasPermission } from "@/lib/rbac";
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

const [
    products,
    categories,
    loyalty,
    loyaltyOn,
    customers,
    storeInfo,
    taxRate,
    canApplyDiscount,
  ] =
    await Promise.all([
      listPosGrid({ take: 120 }),
      prisma.category.findMany({
        where: { isActive: true },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
      // Both settings in one read: the ratio earns, the value redeems.
      prisma.storeSetting.findMany({
        where: { key: { in: ["loyalty.ratio", "loyalty.pointValue"] } },
        select: { key: true, value: true },
      }),
      prisma.storeSetting.findUnique({
        where: { key: "loyalty.enabled" },
        select: { value: true },
      }),
      prisma.customer.findMany({
        where: { isActive: true },
        select: {
          id: true,
          name: true,
          phone: true,
          memberNumber: true,
          isMember: true,
          points: true,
        },
        orderBy: { name: "asc" },
        take: 500,
      }),
      // Receipt header comes from settings, so a shop that changes its address
      // gets correct receipts without anyone editing the UI.
      prisma.storeSetting.findMany({
        where: {
          key: {
            in: [
              "store.name",
              "store.address",
              "store.phone",
              "invoice.footer",
              "tax.enabled",
              "tax.rate",
            ],
          },
        },
        select: { key: true, value: true },
      }),
      // The client shows tax in its running total. Checkout recomputes this from
      // the same settings, so the preview and the charge always agree.
      getPosTaxRate(),
      // Discounting is a separate grant from selling; the terminal hides the
      // field when it is absent, and checkout refuses it either way.
      Promise.resolve(roleHasPermission(user.role, "pos:apply-discount")),
    ]);

  const storeByKey = new Map(storeInfo.map((row) => [row.key, row.value]));
  const loyaltyByKey = new Map(loyalty.map((row) => [row.key, row.value]));

  // Loyalty off means no accrual *and* no redemption, so the terminal hides both
  // rather than showing a balance the server will refuse to honour.
  const loyaltyEnabled = loyaltyOn?.value !== false;

  const ratio =
    typeof loyaltyByKey.get("loyalty.ratio") === "number"
      ? (loyaltyByKey.get("loyalty.ratio") as number)
      : 10_000;

  const pointValue =
    typeof loyaltyByKey.get("loyalty.pointValue") === "number"
      ? (loyaltyByKey.get("loyalty.pointValue") as number)
      : 0;

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
loyaltyRatio={loyaltyEnabled ? ratio : 0}
      pointValue={loyaltyEnabled ? pointValue : 0}
      taxRate={taxRate}
      cashierName={user.name}
      canApplyDiscount={canApplyDiscount}
      store={{
        name: String(storeByKey.get("store.name") ?? "Swalayaku"),
        address: String(storeByKey.get("store.address") ?? ""),
        phone: String(storeByKey.get("store.phone") ?? ""),
        footer: String(storeByKey.get("invoice.footer") ?? ""),
      }}
    />
  );
}
