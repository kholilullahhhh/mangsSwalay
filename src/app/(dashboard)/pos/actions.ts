"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/db";
import { findProductByBarcode, searchProductsForPos } from "@/lib/queries/products";
import { requirePermission } from "@/lib/auth/session";
import { roleHasPermission } from "@/lib/rbac";
import { audit } from "@/lib/audit";
import { BusinessRuleError, toActionError, ValidationError } from "@/lib/error";
import { checkoutSale } from "@/lib/sales/checkout";
import { generateStockNotifications } from "@/lib/notifications/generate";

/**
 * Checkout Server Action.
 *
 * A thin shell around `lib/sales/checkout`: this file is responsible for the
 * three things that are about *this request* — who is calling, what to audit,
 * and which caches to invalidate — and nothing else. The transaction itself lives
 * in the lib module so it can be verified against a real database without going
 * through React's action encoding.
 *
 * Validation errors are returned rather than thrown so the POS can show them
 * inline without tripping an error boundary.
 */

export type {
  CheckoutInput,
  CheckoutLineInput,
  CheckoutLineResult,
  CheckoutResult,
} from "@/lib/sales/checkout";

export async function checkoutAction(
  input: Parameters<typeof checkoutSale>[0],
): Promise<{ ok: true; data: Awaited<ReturnType<typeof checkoutSale>> } | { ok: false; error: string }> {
  const user = await requirePermission("sales:create");

  // Discounting is a separate grant from selling. `pos:apply-discount` exists so
  // a cashier can ring up a sale but not decide how much of it to give away —
  // without this the field is free text on the POS screen and any role that can
  // take money can take all of it.
  const canApplyDiscount = roleHasPermission(user.role, "pos:apply-discount");

  try {
    const result = await checkoutSale(
      input,
      { id: user.id, name: user.name },
      { canApplyDiscount },
    );

    await audit({
      userId: user.id,
      action: "SALE_CREATE",
      entity: "Sale",
      entityId: result.saleId,
      newData: {
        invoiceNumber: result.invoiceNumber,
        total: result.total,
        paymentMethod: result.paymentMethod,
        promotionCode: result.promotionCode,
        items: result.lines.length,
      },
    });

    revalidatePath("/dashboard");
    revalidatePath("/sales");
    revalidatePath("/inventory");
    revalidatePath("/promotions");
    revalidatePath("/notifications");

    // Alerts are derived from stock state, so they are re-derived here rather
    // than waiting for someone to open the notification screen. The generator is
    // idempotent and this runs after the transaction commits, so it can never
    // roll back a completed sale.
    void generateStockNotifications().catch(() => {});

    return { ok: true, data: result };
  } catch (error) {
    // Refusals carry a message written for the cashier, so they surface as-is.
    if (error instanceof BusinessRuleError || error instanceof ValidationError) {
      return { ok: false, error: error.message };
    }

    return { ok: false, error: toActionError(error).error };
  }
}

/**
 * Re-exported so the POS page can pass the live tax rate to the client preview.
 *
 * The client value is a preview only — checkout recomputes from settings — but
 * showing a total without tax when the store charges tax is confusing enough to
 * be worth reading.
 */
export async function getPosTaxRate(): Promise<number> {
  await requirePermission("pos:use");

  const [enabled, rate] = await Promise.all([
    prisma.storeSetting.findUnique({
      where: { key: "tax.enabled" },
      select: { value: true },
    }),
    prisma.storeSetting.findUnique({
      where: { key: "tax.rate" },
      select: { value: true },
    }),
  ]);

  if (enabled?.value !== true) return 0;

  const value = typeof rate?.value === "number" ? rate.value : 0;

  return Number.isFinite(value) && value > 0 ? Math.min(value, 1) : 0;
}

/**
 * Barcode lookup, resolved against the whole catalogue.
 *
 * The POS grid only ships a slice of the catalogue to the browser, so resolving
 * a scan against that slice makes every product outside it unscannable — the
 * scanner would report "not found" for an item sitting on the shelf. Asking the
 * database is what makes scanning reliable regardless of catalogue size.
 *
 * Read-only, and priced server-side: the client cannot influence what a scanned
 * item costs, because checkout re-reads the price regardless.
 */
export async function lookupPosBarcodeAction(barcode: string) {
  await requirePermission("pos:use");

  const product = await findProductByBarcode(barcode);

  if (!product) {
    return null;
  }

  return {
    id: product.id,
    sku: product.sku,
    barcode: product.barcode,
    name: product.name,
    unit: product.unit,
    categoryId: product.categoryId,
    sellingPrice: Number(product.sellingPrice),
    stock: product.stock,
    isActive: product.isActive,
  };
}

/**
 * Catalogue search for the POS, so a cashier can find a product the initial grid
 * did not include.
 */
export async function searchPosProductsAction(input: {
  query: string;
  categoryId?: string;
}) {
  await requirePermission("pos:use");

  const rows = await searchProductsForPos(input.query, {
    categoryId: input.categoryId === "all" ? undefined : input.categoryId,
    take: 24,
  });

  return rows.map((row) => ({
    id: row.id,
    sku: row.sku,
    barcode: row.barcode,
    name: row.name,
    unit: row.unit,
    categoryId: row.categoryId,
    sellingPrice: Number(row.sellingPrice),
    stock: row.stock,
  }));
}