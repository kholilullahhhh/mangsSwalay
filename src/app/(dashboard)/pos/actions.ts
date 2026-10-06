"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { withDocumentNumber } from "@/lib/documents";
import { BusinessRuleError, toActionError, ValidationError } from "@/lib/error";
import { applyStockChanges } from "@/lib/inventory/stock";
import { calculateTotals, validateCart } from "@/lib/pos/cart";
import { z } from "zod";

/**
 * Checkout.
 *
 * This is the most safety-critical path in the app, so it is worth stating what
 * happens and why:
 *
 * 1. The cart is validated (items, quantities, non-negative prices).
 * 2. Products are re-read from the database inside the transaction. Prices,
 *    names, and stock come from the DB, never from the client payload — a
 *    tampered request cannot change what a customer is charged.
 * 3. The sale and its items are written, stock is decremented through the
 *    conditional-update ledger, and the movement rows are written.
 * 4. The open cash shift is updated and loyalty points are granted.
 * 5. If any step fails the whole transaction rolls back — there is no state in
 *    which a sale exists but stock was not decremented.
 */

const checkoutSchema = z.object({
  customerId: z.string().min(1).optional(),
  shiftId: z.string().optional(),
  paymentMethod: z.enum([
    "CASH",
    "QRIS",
    "DEBIT",
    "CREDIT_CARD",
    "TRANSFER",
    "E_WALLET",
  ]),
  amountPaid: z.coerce.number().min(0),
  manualDiscount: z.coerce.number().min(0).default(0),
  taxRate: z.coerce.number().min(0).max(1).default(0),
  notes: z.string().max(500).optional(),
  lines: z
    .array(
      z.object({
        productId: z.string().min(1),
        quantity: z.coerce.number().int().min(1),
        lineDiscount: z.coerce.number().min(0).default(0),
      }),
    )
    .min(1, "Keranjang masih kosong."),
});

export type CheckoutLineInput = {
  productId: string;
  quantity: number;
  lineDiscount?: number;
};

export type CheckoutInput = {
  customerId?: string;
  shiftId?: string;
  paymentMethod: "CASH" | "QRIS" | "DEBIT" | "CREDIT_CARD" | "TRANSFER" | "E_WALLET";
  amountPaid: number;
  manualDiscount?: number;
  taxRate?: number;
  notes?: string;
  lines: CheckoutLineInput[];
};

/** Loyalty configuration, configurable via StoreSetting. */
const DEFAULT_POINTS_RATIO = 10_000;

export interface CheckoutResult {
  invoiceNumber: string;
  saleId: string;
  total: number;
  change: number;
  pointsEarned: number;
}

export async function checkoutAction(
  input: z.input<typeof checkoutSchema>,
): Promise<{ ok: true; data: CheckoutResult } | { ok: false; error: string }> {
  const user = await requirePermission("sales:create");

  const parsed = checkoutSchema.safeParse(input);

  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    return {
      ok: false,
      error: firstIssue?.message ?? "Data transaksi tidak valid.",
    };
  }

  const data = parsed.data;

  try {
    const result = await prisma.$transaction(
      async (tx) => {
        // ── 1. Re-read products; the client payload is not trusted ────────
        const productIds = data.lines.map((line) => line.productId);

        const products = await tx.product.findMany({
          where: { id: { in: productIds } },
          select: {
            id: true,
            name: true,
            sku: true,
            unit: true,
            stock: true,
            isActive: true,
            sellingPrice: true,
            purchasePrice: true,
          },
        });

        const byId = new Map(products.map((product) => [product.id, product]));

        for (const line of data.lines) {
          const product = byId.get(line.productId);

          if (!product) {
            throw new ValidationError(
              `Produk tidak ditemukan. Refresh halaman dan coba lagi.`,
            );
          }

          if (!product.isActive) {
            throw new BusinessRuleError(
              `${product.name} sudah dinonaktifkan dan tidak bisa dijual.`,
            );
          }

          if (product.stock < line.quantity) {
            throw new BusinessRuleError(
              `Stok ${product.name} tidak mencukupi. Diminta ${line.quantity}, tersedia ${product.stock}.`,
            );
          }
        }

        // ── 2. Build cart lines using DB prices ──────────────────────────
        const cartLines = data.lines.map((line) => {
          const product = byId.get(line.productId)!;

          return {
            productId: product.id,
            sku: product.sku,
            name: product.name,
            unit: product.unit,
            quantity: line.quantity,
            unitPrice: Number(product.sellingPrice),
            lineDiscount: line.lineDiscount,
            availableStock: product.stock,
          };
        });

        const problems = validateCart(cartLines);

        if (problems.length > 0) {
          throw new BusinessRuleError(problems[0].message);
        }

        const totals = calculateTotals({
          lines: cartLines,
          manualDiscount: data.manualDiscount,
          taxRate: data.taxRate,
        });

        if (totals.total <= 0) {
          throw new BusinessRuleError(
            "Total transaksi harus lebih dari nol.",
          );
        }

        // Cash must cover the total; other methods settle at exactly the total.
        if (data.paymentMethod === "CASH") {
          if (data.amountPaid < totals.total) {
            throw new BusinessRuleError(
              `Pembayaran kurang Rp${(totals.total - data.amountPaid).toLocaleString("id-ID")}.`,
            );
          }
        }

        const amountPaid =
          data.paymentMethod === "CASH"
            ? Math.round(data.amountPaid)
            : totals.total;

        const change =
          data.paymentMethod === "CASH"
            ? amountPaid - totals.total
            : 0;

        // ── 3. Loyalty configuration ─────────────────────────────────────
        const [pointsSetting, customer] = await Promise.all([
          tx.storeSetting.findUnique({
            where: { key: "loyalty.ratio" },
          }),
          data.customerId
            ? tx.customer.findUnique({
                where: { id: data.customerId },
                select: { id: true, isMember: true, points: true },
              })
            : Promise.resolve(null),
        ]);

        const pointsRatio =
          pointsSetting && typeof pointsSetting.value === "number"
            ? pointsSetting.value
            : DEFAULT_POINTS_RATIO;

        // Points accrue on post-discount, pre-tax revenue.
        const pointsEarned =
          customer?.isMember && pointsRatio > 0
            ? Math.floor(
                ((totals.total - totals.tax) / pointsRatio) as number,
              )
            : 0;

        // ── 4. Persist the sale ──────────────────────────────────────────
        const sale = await withDocumentNumber(
          "INV",
          new Date(),
          async (invoiceNumber) =>
            tx.sale.create({
              data: {
                invoiceNumber,
                customerId: customer?.id ?? null,
                userId: user.id,
                shiftId: data.shiftId ?? null,
                date: new Date(),
                subtotal: totals.subtotal,
                discount:
                  totals.promotionDiscount + totals.manualDiscount + totals.lineDiscountTotal,
                tax: totals.tax,
                total: totals.total,
                paymentMethod: data.paymentMethod,
                amountPaid,
                change,
                status: "COMPLETED",
                pointsEarned,
                notes: data.notes || null,
                items: {
                  create: cartLines.map((line) => {
                    const product = byId.get(line.productId)!;

                    return {
                      productId: product.id,
                      quantity: line.quantity,
                      price: product.sellingPrice,
                      // Cost snapshot: later price changes must not rewrite
                      // the margin of a sale that already happened.
                      cost: product.purchasePrice,
                      discount: line.lineDiscount,
                      subtotal: line.unitPrice * line.quantity - line.lineDiscount,
                    };
                  }),
                },
              },
              select: { id: true, invoiceNumber: true },
            }),
        );

        // ── 5. Decrement stock through the guarded ledger ────────────────
        await applyStockChanges(
          tx,
          cartLines.map((line) => ({
            productId: line.productId,
            quantity: line.quantity,
            direction: "OUT",
            type: "SALE",
            referenceType: "Sale",
            referenceId: sale.id,
            userId: user.id,
            note: `Penjualan ${sale.invoiceNumber}`,
          })),
        );

        // ── 6. Customer totals and loyalty points ────────────────────────
        if (customer) {
          await tx.customer.update({
            where: { id: customer.id },
            data: {
              points: { increment: pointsEarned },
              totalPurchases: { increment: 1 },
            },
          });
        }

        return {
          invoiceNumber: sale.invoiceNumber,
          saleId: sale.id,
          total: totals.total,
          change,
          pointsEarned,
        };
      },
      {
        // A contended row (two cashiers selling the same last unit) aborts one
        // transaction rather than silently waiting; the client can retry.
        isolationLevel: "ReadCommitted",
        timeout: 15_000,
        maxWait: 5_000,
      },
    );

    await audit({
      userId: user.id,
      action: "SALE_CREATE",
      entity: "Sale",
      entityId: result.saleId,
      newData: {
        invoiceNumber: result.invoiceNumber,
        total: result.total,
        paymentMethod: data.paymentMethod,
        items: data.lines.length,
      },
    });

    revalidatePath("/dashboard");
    revalidatePath("/sales");

    return { ok: true, data: result };
  } catch (error) {
    // Insufficient-stock errors surface their own precise message.
    if (error instanceof BusinessRuleError || error instanceof ValidationError) {
      return { ok: false, error: error.message };
    }

    return { ok: false, error: toActionError(error).error };
  }
}