"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { BusinessRuleError, toActionError, ValidationError } from "@/lib/error";
import { checkoutSale } from "@/lib/sales/checkout";

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

  try {
    const result = await checkoutSale(input, { id: user.id, name: user.name });

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