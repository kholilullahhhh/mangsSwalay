"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { toActionError } from "@/lib/error";
import {
  adjustStock,
  approveOpname,
  cancelOpname,
  createOpname,
  recordOpnameCount,
  type AdjustmentInput,
} from "@/lib/inventory/mutations";
import {
  ADJUSTMENT_REASONS,
  type AdjustmentReason,
} from "@/lib/inventory/rules";
import type { Prisma } from "@/generated/prisma/client";

/**
 * Inventory Server Actions.
 *
 * Adjustment and opname both write to stock, so both re-check permission on the
 * server and return a plain result so forms can render the message inline.
 */

export interface InventoryActionResult {
  error?: string;
  fieldErrors?: Record<string, string>;
  id?: string;
}

function fail(error: unknown): InventoryActionResult {
  const actionError = toActionError(error);
  return {
    error: actionError.error,
    fieldErrors: actionError.field
      ? { [actionError.field]: actionError.error }
      : undefined,
  };
}

const VALID_REASONS = new Set<string>(
  ADJUSTMENT_REASONS.map((reason) => reason.value),
);

/**
 * Applies stock corrections.
 *
 * The operator enters the counted stock rather than a delta, and the payload
 * arrives as parallel arrays from a multi-row form.
 */
export async function adjustStockAction(
  formData: FormData,
): Promise<InventoryActionResult> {
  const user = await requirePermission("stock:adjust");

  const productIds = formData.getAll("productId").map(String).filter(Boolean);
  const actualStocks = formData.getAll("actualStock").map(String);
  const reasons = formData.getAll("reason").map(String);
  const notes = formData.getAll("note").map(String);

  if (productIds.length === 0) {
    return { error: "Pilih minimal satu produk untuk dikoreksi." };
  }

  const reason = reasons[0] ?? "";

  if (!VALID_REASONS.has(reason)) {
    return {
      error: "Alasan penyesuaian wajib dipilih.",
      fieldErrors: { reason: "Wajib dipilih." },
    };
  }

  const inputs: AdjustmentInput[] = productIds.map((productId, index) => ({
    productId,
    actualStock: Number.parseInt(actualStocks[index] ?? "", 10),
    reason: reason as AdjustmentReason,
    note: notes[index] ?? "",
  }));

  // Blank or unparseable quantities are caught here rather than silently
  // becoming NaN and producing a meaningless ledger entry.
  for (const input of inputs) {
    if (!Number.isFinite(input.actualStock)) {
      return {
        error: "Stok aktual harus berupa angka.",
        fieldErrors: { actualStock: "Wajib diisi dengan angka." },
      };
    }
  }

  try {
    const result = await adjustStock(inputs, user.id);

    await audit({
      userId: user.id,
      action: "STOCK_ADJUSTMENT",
      entity: "Product",
      newData: {
        reason,
        changed: result.changed,
        netValueDifference: result.summary.netValueDifference,
      },
    });

    revalidatePath("/inventory");
    revalidatePath("/inventory/movements");
    revalidatePath("/dashboard");

    return {};
  } catch (error) {
    return fail(error);
  }
}

export async function createOpnameAction(
  formData: FormData,
): Promise<InventoryActionResult> {
  const user = await requirePermission("stock:opname");

  const name = String(formData.get("name") ?? "").trim();

  if (name.length < 3) {
    return { fieldErrors: { name: "Nama sesi minimal 3 karakter." } };
  }

  const productIds = formData
    .getAll("productIds")
    .map(String)
    .filter(Boolean);

  try {
    const opname = await createOpname(
      {
        name,
        notes: String(formData.get("notes") ?? ""),
        categoryId: String(formData.get("categoryId") ?? "") || undefined,
        productIds: productIds.length > 0 ? productIds : undefined,
      },
      user.id,
    );

    await audit({
      userId: user.id,
      action: "STOCK_OPNAME_CREATE",
      entity: "StockOpname",
      entityId: opname.id,
      newData: { number: opname.number, itemCount: opname.itemCount },
    });

    revalidatePath("/inventory/opname");

    return { id: opname.id };
  } catch (error) {
    return fail(error);
  }
}

export async function recordCountAction(
  formData: FormData,
): Promise<InventoryActionResult> {
await requirePermission("stock:opname");

  const opnameId = String(formData.get("opnameId") ?? "");
  const productId = String(formData.get("productId") ?? "");
  const physicalStock = Number.parseInt(
    String(formData.get("physicalStock") ?? ""),
    10,
  );

  if (!opnameId || !productId) {
    return { error: "Data tidak lengkap." };
  }

  if (!Number.isFinite(physicalStock)) {
    return {
      error: "Jumlah fisik harus berupa angka.",
      fieldErrors: { physicalStock: "Wajib diisi dengan angka." },
    };
  }

  try {
    await recordOpnameCount(opnameId, productId, physicalStock);
    revalidatePath(`/inventory/opname/${opnameId}`);
    return {};
  } catch (error) {
    return fail(error);
  }
}

/**
 * Approves an opname.
 *
 * Approval writes the ledger and adjusts stock, so it needs the higher
 * approval permission rather than the counting one.
 */
export async function approveOpnameAction(
  formData: FormData,
): Promise<InventoryActionResult> {
  const user = await requirePermission("stock:opname-approve");

  const opnameId = String(formData.get("opnameId") ?? "");

  if (!opnameId) {
    return { error: "ID sesi tidak valid." };
  }

  try {
    const result = await approveOpname(opnameId, user.id);

    await audit({
      userId: user.id,
      action: "STOCK_OPNAME_APPROVE",
      entity: "StockOpname",
      entityId: opnameId,
      newData: { adjusted: result.adjusted },
    });

    revalidatePath("/inventory");
    revalidatePath("/inventory/opname");
    revalidatePath(`/inventory/opname/${opnameId}`);
    revalidatePath("/dashboard");

    return {};
  } catch (error) {
    return fail(error);
  }
}

export async function cancelOpnameAction(
  formData: FormData,
): Promise<InventoryActionResult> {
  const user = await requirePermission("stock:opname");

  const opnameId = String(formData.get("opnameId") ?? "");

  if (!opnameId) {
    return { error: "ID sesi tidak valid." };
  }

  try {
    await cancelOpname(opnameId);

    await audit({
      userId: user.id,
      action: "STOCK_OPNAME_CREATE",
      entity: "StockOpname",
      entityId: opnameId,
      newData: { cancelled: true },
    });

    revalidatePath("/inventory/opname");
    return {};
  } catch (error) {
    return fail(error);
  }
}

export type { Prisma };
