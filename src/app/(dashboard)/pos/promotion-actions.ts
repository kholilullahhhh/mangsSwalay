"use server";

import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/session";
import { evaluatePromotion } from "@/lib/promotions/engine";
import { z } from "zod";

/**
 * Promotion preview for the POS.
 *
 * The cashier types a code and needs to know immediately whether it works and
 * what it is worth. That answer must come from the same rules checkout uses, so
 * this action runs the engine against the current promotion row rather than
 * duplicating the logic on the client. The result is a preview only: checkout
 * re-evaluates it inside the transaction, so nothing here is trusted for money.
 */

const previewSchema = z.object({
  code: z.string().trim().min(1).max(40),
  lines: z
    .array(
      z.object({
        productId: z.string().min(1),
        name: z.string().min(1),
        categoryId: z.string(),
        quantity: z.coerce.number().int().min(1),
        unitPrice: z.coerce.number().min(0),
      }),
    )
    .min(1, "Keranjang masih kosong."),
});

export interface PromotionPreviewResult {
  ok: true;
  code: string;
  name: string;
  /** Integer rupiah. */
  discount: number;
  reason: string;
}

export async function previewPromotionAction(input: {
  code: string;
  lines: Array<{
    productId: string;
    name: string;
    categoryId: string;
    quantity: number;
    unitPrice: number;
  }>;
}): Promise<PromotionPreviewResult | { ok: false; error: string }> {
  await requirePermission("pos:use");

  const parsed = previewSchema.safeParse(input);

  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Data promo tidak valid.",
    };
  }

  const code = parsed.data.code.toUpperCase();

  const promotion = await prisma.promotion.findUnique({
    where: { code },
    include: { products: { select: { productId: true } } },
  });

  if (!promotion) {
    return { ok: false, error: `Kode promo "${code}" tidak ditemukan.` };
  }

  const verdict = evaluatePromotion(
    {
      id: promotion.id,
      code: promotion.code,
      name: promotion.name,
      type: promotion.type,
      value:
        promotion.type === "FIXED" || promotion.type === "BUY_X_GET_Y"
          ? Number(promotion.value)
          : Number(promotion.value) / 100,
      minPurchaseAmount: promotion.minPurchaseAmount
        ? Number(promotion.minPurchaseAmount)
        : null,
      buyQuantity: promotion.buyQuantity,
      getQuantity: promotion.getQuantity,
      categoryId: promotion.categoryId,
      startDate: promotion.startDate,
      endDate: promotion.endDate,
      usageLimit: promotion.usageLimit,
      usedCount: promotion.usedCount,
      isActive: promotion.isActive,
      productIds: promotion.products.map((entry) => entry.productId),
    },
    parsed.data.lines,
    new Date(),
  );

  if (!verdict.valid) {
    return { ok: false, error: verdict.reason };
  }

  return {
    ok: true,
    code: promotion.code,
    name: promotion.name,
    discount: verdict.discount,
    reason: verdict.reason,
  };
}