import "server-only";

import { prisma } from "@/lib/db";
import { BusinessRuleError, ValidationError } from "@/lib/error";
import { applyStockChanges, type TxClient } from "@/lib/inventory/stock";
import {
  movementTypeForReason,
  summariseAdjustment,
  summariseOpname,
  type AdjustmentReason,
  type AdjustmentLine,
  type OpnameLineInput,
} from "@/lib/inventory/rules";
import { withDocumentNumber } from "@/lib/documents";

/**
 * Inventory mutations: manual adjustment and stock opname.
 *
 * Both paths funnel through `applyStockChanges`, the single place allowed to
 * write `Product.stock`, so every correction is guarded against going negative
 * and lands in the ledger with before/after values.
 */

// ── Manual adjustment ──────────────────────────────────────────────────────

export interface AdjustmentInput {
  productId: string;
  /** The counted stock, not the delta. */
  actualStock: number;
  reason: AdjustmentReason;
  /** Required when the reason is OTHER or EXPIRED. */
  note?: string;
}

/**
 * Applies one correction per product.
 *
 * The operator supplies the *actual* stock rather than a delta, because a
 * physical count is an observation, not a calculation — asking for "-3" invites
 * arithmetic mistakes that a recount would catch immediately.
 */
export async function adjustStock(
  inputs: AdjustmentInput[],
  userId: string,
): Promise<{ changed: number; summary: ReturnType<typeof summariseAdjustment> }> {
  if (inputs.length === 0) {
    throw new ValidationError("Tidak ada perubahan stok untuk diterapkan.");
  }

  // Every correction needs a reason — an unexplained stock change is exactly
  // the kind of discrepancy an inventory ledger exists to prevent.
  for (const input of inputs) {
    if (!input.reason) {
      throw new ValidationError(
        "Alasan penyesuaian wajib diisi.",
        "reason",
      );
    }

    if (
      (input.reason === "OTHER" || input.reason === "EXPIRED") &&
      !input.note?.trim()
    ) {
      throw new ValidationError(
        `Catatan wajib diisi untuk alasan "${input.reason}".`,
        "note",
      );
    }

    if (!Number.isInteger(input.actualStock) || input.actualStock < 0) {
      throw new ValidationError(
        "Stok aktual harus bilangan bulat dan tidak boleh negatif.",
        "actualStock",
      );
    }
  }

  // Read current state so the caller sees the same numbers the operator did.
  const products = await prisma.product.findMany({
    where: { id: { in: inputs.map((input) => input.productId) } },
    select: { id: true, name: true, stock: true, purchasePrice: true },
  });

  const byId = new Map(products.map((product) => [product.id, product]));

  for (const input of inputs) {
    if (!byId.has(input.productId)) {
      throw new ValidationError("Produk tidak ditemukan.");
    }
  }

  const lines: AdjustmentLine[] = inputs.map((input) => {
    const product = byId.get(input.productId)!;

    return {
      productId: product.id,
      productName: product.name,
      systemStock: product.stock,
      actualStock: input.actualStock,
      unitCost: Number(product.purchasePrice),
    };
  });

  const summary = summariseAdjustment(lines);

  if (summary.hasInvalidLine) {
    throw new BusinessRuleError("Stok aktual tidak boleh negatif.");
  }

  if (summary.changedCount === 0) {
    throw new BusinessRuleError(
      "Tidak ada perubahan. Stok sistem sudah sama dengan hasil hitungan.",
    );
  }

  await prisma.$transaction(
    async (tx) => {
      // Type predicate, because `.filter(l => l.direction !== "NONE")` alone
      // leaves the array typed as including "NONE", which the ledger rejects.
      const changed = summary.lines.filter(
        (line): line is typeof line & { direction: "IN" | "OUT" } =>
          line.direction !== "NONE",
      );

      await applyStockChanges(
        tx,
        changed.map((line) => {
          const input = inputs.find(
            (entry) => entry.productId === line.productId,
          )!;

          return {
            productId: line.productId,
            quantity: Math.abs(line.difference),
            direction: line.direction,
            type: movementTypeForReason(input.reason),
            referenceType: "ADJUSTMENT",
            userId,
            note: input.note?.trim()
              ? `[${input.reason}] ${input.note.trim()}`
              : `[${input.reason}] ${line.systemStock} → ${line.actualStock}`,
          };
        }),
      );
    },
    { timeout: 15_000, maxWait: 5_000 },
  );

  return { changed: summary.changedCount, summary };
}

/** Preview of a correction, for showing the operator the impact before saving. */
export async function previewStockAdjustment(
  inputs: AdjustmentInput[],
): Promise<ReturnType<typeof summariseAdjustment>> {
  const products = await prisma.product.findMany({
    where: { id: { in: inputs.map((input) => input.productId) } },
    select: { id: true, name: true, stock: true, purchasePrice: true },
  });

  const byId = new Map(products.map((product) => [product.id, product]));

  return summariseAdjustment(
    inputs.map((input) => {
      const product = byId.get(input.productId);

      return {
        productId: input.productId,
        productName: product?.name ?? "Produk tidak ditemukan",
        systemStock: product?.stock ?? 0,
        actualStock: input.actualStock,
        unitCost: Number(product?.purchasePrice ?? 0),
      };
    }),
  );
}

// ── Stock opname ───────────────────────────────────────────────────────────

export interface CreateOpnameInput {
  name: string;
  notes?: string;
  /** Restrict the count to one category. */
  categoryId?: string;
  /** Only include these products when provided. */
  productIds?: string[];
}

/**
 * Opens a counting session.
 *
 * `systemStock` is snapshotted at creation time, not read live. That matters:
 * if the count took two hours and sales continued meanwhile, comparing against a
 * moving target would report phantom variances for everything sold in that
 * window. A frozen baseline is what makes the difference meaningful.
 */
export async function createOpname(
  input: CreateOpnameInput,
  userId: string,
): Promise<{ id: string; number: string; itemCount: number }> {
  const products = await prisma.product.findMany({
    where: {
      isActive: true,
      ...(input.categoryId ? { categoryId: input.categoryId } : {}),
      ...(input.productIds?.length ? { id: { in: input.productIds } } : {}),
    },
    select: { id: true, name: true, stock: true, purchasePrice: true },
    orderBy: { name: "asc" },
    // A count of thousands of SKUs is a multi-day job; 500 keeps one session
    // workable and the operator can open a second session for the rest.
    take: 500,
  });

  if (products.length === 0) {
    throw new ValidationError(
      "Tidak ada produk untuk diopname. Periksa filter kategori.",
    );
  }

  return prisma.$transaction(async (tx) => {
    const opname = await withDocumentNumber("OPN", new Date(), async (number) =>
      tx.stockOpname.create({
        data: {
          number,
          name: input.name,
          status: "IN_PROGRESS",
          notes: input.notes || null,
          startedAt: new Date(),
          userId,
          items: {
            create: products.map((product) => ({
              productId: product.id,
              systemStock: product.stock,
              purchasePriceSnapshot: product.purchasePrice,
            })),
          },
        },
        select: { id: true, number: true },
      }),
    );

    return { ...opname, itemCount: products.length };
  });
}

/** Records a physical count for one line. */
export async function recordOpnameCount(
  opnameId: string,
  productId: string,
  physicalStock: number,
): Promise<void> {
  if (!Number.isInteger(physicalStock) || physicalStock < 0) {
    throw new ValidationError(
      "Jumlah fisik harus bilangan bulat dan tidak boleh negatif.",
      "physicalStock",
    );
  }

  const item = await prisma.stockOpnameItem.findUnique({
    where: { opnameId_productId: { opnameId, productId } },
    select: { id: true },
  });

  if (!item) {
    throw new ValidationError(
      "Produk ini bukan bagian dari sesi opname tersebut.",
    );
  }

  const opname = await prisma.stockOpname.findUnique({
    where: { id: opnameId },
    select: { status: true },
  });

  if (!opname) {
    throw new ValidationError("Sesi opname tidak ditemukan.");
  }

  // Counting is only meaningful while the session is open.
  if (opname.status !== "IN_PROGRESS") {
    throw new BusinessRuleError(
      "Sesi opname sudah tidak aktif, hitungan tidak bisa diubah.",
    );
  }

  await prisma.stockOpnameItem.update({
    where: { id: item.id },
    data: { physicalStock },
  });
}

/** Summary of an opname session, for the review screen. */
export async function getOpnameSummary(opnameId: string) {
  const opname = await prisma.stockOpname.findUnique({
    where: { id: opnameId },
    select: {
      id: true,
      number: true,
      name: true,
      status: true,
      notes: true,
      createdAt: true,
      startedAt: true,
      finishedAt: true,
      approvedAt: true,
      user: { select: { id: true, name: true } },
      approver: { select: { id: true, name: true } },
      items: {
        select: {
          id: true,
          productId: true,
          systemStock: true,
          physicalStock: true,
          note: true,
          purchasePriceSnapshot: true,
          product: { select: { name: true, sku: true, unit: true } },
        },
        orderBy: { product: { name: "asc" } },
      },
    },
  });

  if (!opname) {
    return null;
  }

  const summary = summariseOpname(
    opname.items.map((item) => ({
      productId: item.productId,
      productName: item.product.name,
      systemStock: item.systemStock,
      physicalStock: item.physicalStock,
      unitCost: Number(item.purchasePriceSnapshot ?? 0),
    })),
  );

  return { opname, summary };
}

/**
 * Approves an opname and applies the differences as stock corrections.
 *
 * The whole approval is one transaction: every line that differs is written to
 * the ledger and the counter updated, or nothing is. A partially applied count
 * would leave the ledger disagreeing with the counted reality.
 */
export async function approveOpname(
  opnameId: string,
  userId: string,
): Promise<{ adjusted: number }> {
  return prisma.$transaction(
    async (tx) => {
      const opname = await tx.stockOpname.findUnique({
        where: { id: opnameId },
        select: {
          id: true,
          number: true,
          status: true,
          items: {
            select: {
              productId: true,
              systemStock: true,
              physicalStock: true,
              purchasePriceSnapshot: true,
              product: { select: { name: true } },
            },
          },
        },
      });

      if (!opname) {
        throw new ValidationError("Sesi opname tidak ditemukan.");
      }

      if (opname.status !== "IN_PROGRESS" && opname.status !== "REVIEW") {
        throw new BusinessRuleError(
          `Sesi opname berstatus ${opname.status} dan tidak bisa disetujui lagi.`,
        );
      }

      const uncounted = opname.items.filter(
        (item) => item.physicalStock === null,
      );

      if (uncounted.length > 0) {
        throw new BusinessRuleError(
          `Masih ada ${uncounted.length} produk yang belum dihitung. Selesaikan hitungan terlebih dahulu.`,
        );
      }

      const summary = summariseOpname(
        opname.items.map((item) => ({
          productId: item.productId,
          productName: item.product.name,
          systemStock: item.systemStock,
          physicalStock: item.physicalStock,
          unitCost: Number(item.purchasePriceSnapshot),
        })),
      );

      // Only counted lines that differ are applied; uncounted lines have a null
      // difference and are rejected above if any remain.
      const differing = summary.lines.filter(
        (line): line is typeof line & {
          direction: "IN" | "OUT";
          difference: number;
        } => line.direction !== "NONE" && line.difference !== null,
      );

      if (differing.length === 0) {
        // Nothing to correct: close the session as approved without writing
        // zero-value ledger rows.
        await tx.stockOpname.update({
          where: { id: opnameId },
          data: { status: "APPROVED", approvedAt: new Date(), finishedAt: new Date() },
        });

        return { adjusted: 0 };
      }

      await applyStockChanges(
        tx as TxClient,
        differing.map((line) => ({
          productId: line.productId,
          quantity: Math.abs(line.difference),
          direction: line.direction,
          type: "OPNAME" as const,
          referenceType: "StockOpname",
          referenceId: opnameId,
          userId,
          note: `Stock opname ${opname.number}: sistem ${line.systemStock}, fisik ${line.physicalStock}`,
        })),
      );

      // Freeze the counted figures onto the session so the result is auditable
      // after approval.
      for (const line of differing) {
        await tx.stockOpnameItem.updateMany({
          where: { opnameId, productId: line.productId },
          data: { difference: line.difference, valueDiff: line.valueDifference },
        });
      }

      await tx.stockOpname.update({
        where: { id: opnameId },
        data: {
          status: "APPROVED",
          approvedAt: new Date(),
          finishedAt: new Date(),
          approvedById: userId,
        },
      });

      return { adjusted: differing.length };
    },
    { timeout: 30_000, maxWait: 5_000 },
  );
}

/** Abandons an in-progress count without touching stock. */
export async function cancelOpname(
  opnameId: string,
): Promise<void> {
  const opname = await prisma.stockOpname.findUnique({
    where: { id: opnameId },
    select: { status: true },
  });

  if (!opname) {
    throw new ValidationError("Sesi opname tidak ditemukan.");
  }

  if (opname.status === "APPROVED") {
    throw new BusinessRuleError(
      "Sesi opname yang sudah disetujui tidak bisa dibatalkan. Buat adjustment baru jika ada koreksi.",
    );
  }

  await prisma.stockOpname.update({
    where: { id: opnameId },
    data: { status: "CANCELLED", finishedAt: new Date() },
  });
}

/** Lists opname sessions, newest first. */
export async function listOpnames(take = 50) {
  return prisma.stockOpname.findMany({
    take,
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      number: true,
      name: true,
      status: true,
      startedAt: true,
      finishedAt: true,
      approvedAt: true,
      createdAt: true,
      user: { select: { name: true } },
      _count: { select: { items: true } },
    },
  });
}

export { summariseAdjustment, summariseOpname };
export type { OpnameLineInput, AdjustmentLine };
