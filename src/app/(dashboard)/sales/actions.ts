"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { toActionError } from "@/lib/error";
import { voidSale, refundSale } from "@/lib/sales/mutations";
import {
  closeShift,
  openShift,
  recordCashMovement,
} from "@/lib/shifts/mutations";
import type { RefundLineInput } from "@/lib/sales/rules";

/** Sale and shift Server Actions. */

export interface SalesActionResult {
  error?: string;
  fieldErrors?: Record<string, string>;
  id?: string;
  reference?: string;
}

function fail(error: unknown): SalesActionResult {
  const actionError = toActionError(error);
  return {
    error: actionError.error,
    fieldErrors: actionError.field
      ? { [actionError.field]: actionError.error }
      : undefined,
  };
}

export async function voidSaleAction(
  formData: FormData,
): Promise<SalesActionResult> {
  const user = await requirePermission("sales:void");

  const id = String(formData.get("id") ?? "");
  const reason = String(formData.get("reason") ?? "");

  if (!id) {
    return { error: "ID transaksi tidak valid." };
  }

  try {
    await voidSale(id, user.id, reason);

    await audit({
      userId: user.id,
      action: "SALE_VOID",
      entity: "Sale",
      entityId: id,
      newData: { reason },
    });

    revalidatePath("/sales");
    revalidatePath(`/sales/${id}`);
    revalidatePath("/inventory");

    return {};
  } catch (error) {
    return fail(error);
  }
}

/**
 * Refunds items from a sale.
 *
 * Rows arrive as parallel arrays from the multi-row form, with a `condition`
 * field per row so the operator can mark damaged units as they go.
 */
export async function refundSaleAction(
  formData: FormData,
): Promise<SalesActionResult> {
  const user = await requirePermission("sales:refund");

  const saleId = String(formData.get("saleId") ?? "");
  const reason = String(formData.get("reason") ?? "");

  if (!saleId) {
    return { error: "ID transaksi tidak valid." };
  }

  const saleItemIds = formData.getAll("saleItemId").map(String);
  const quantities = formData.getAll("quantity").map(String);
  const conditions = formData.getAll("condition").map(String);

  const requested: RefundLineInput[] = [];

  for (let index = 0; index < saleItemIds.length; index++) {
    const saleItemId = saleItemIds[index];
    if (!saleItemId) continue;

    const quantity = Number.parseInt(quantities[index] ?? "0", 10);

    // A zero or blank row means the operator did not select that item.
    if (!Number.isFinite(quantity) || quantity <= 0) continue;

    requested.push({
      saleItemId,
      quantity,
      condition: conditions[index] === "DAMAGED" ? "DAMAGED" : "GOOD",
    });
  }

  if (requested.length === 0) {
    return { error: "Pilih minimal satu barang yang akan diretur." };
  }

  try {
    const result = await refundSale(saleId, requested, reason, user.id);

    await audit({
      userId: user.id,
      action: "SALE_REFUND",
      entity: "Sale",
      entityId: saleId,
      newData: {
        refundNumber: result.refundNumber,
        totalRefund: result.totalRefund,
        restocked: result.restocked,
        reason,
      },
    });

    revalidatePath("/sales");
    revalidatePath(`/sales/${saleId}`);
    revalidatePath("/sales/returns");
    revalidatePath("/inventory");

    return { reference: result.refundNumber };
  } catch (error) {
    return fail(error);
  }
}

// ── Shifts ─────────────────────────────────────────────────────────────────

export async function openShiftAction(
  formData: FormData,
): Promise<SalesActionResult> {
  const user = await requirePermission("shifts:open");

  const openingCash = Number(formData.get("openingCash") ?? 0);

  try {
    const shift = await openShift(user.id, openingCash);

    await audit({
      userId: user.id,
      action: "SHIFT_OPEN",
      entity: "CashShift",
      entityId: shift.id,
      newData: { number: shift.number, openingCash },
    });

    revalidatePath("/shifts");
    revalidatePath("/pos");

    return { id: shift.id, reference: shift.number };
  } catch (error) {
    return fail(error);
  }
}

export async function closeShiftAction(
  formData: FormData,
): Promise<SalesActionResult> {
  const user = await requirePermission("shifts:close");

  const shiftId = String(formData.get("shiftId") ?? "");
  const actualCash = Number(formData.get("actualCash") ?? 0);
  const notes = String(formData.get("notes") ?? "");

  if (!shiftId) {
    return { error: "ID shift tidak valid." };
  }

  try {
    const result = await closeShift(shiftId, user.id, actualCash, notes);

    await audit({
      userId: user.id,
      action: "SHIFT_CLOSE",
      entity: "CashShift",
      entityId: shiftId,
      newData: {
        expected: result.expected,
        actual: result.actual,
        variance: result.variance,
        direction: result.direction,
      },
    });

    revalidatePath("/shifts");
    revalidatePath("/pos");

    return {};
  } catch (error) {
    return fail(error);
  }
}

export async function cashMovementAction(
  formData: FormData,
): Promise<SalesActionResult> {
  const user = await requirePermission("shifts:open");

  const shiftId = String(formData.get("shiftId") ?? "");
  const type = String(formData.get("type") ?? "");
  const amount = Number(formData.get("amount") ?? 0);
  const reason = String(formData.get("reason") ?? "");

  if (!shiftId) {
    return { error: "ID shift tidak valid." };
  }

  if (type !== "CASH_IN" && type !== "CASH_OUT") {
    return { error: "Jenis movements kas tidak valid." };
  }

  try {
    await recordCashMovement(shiftId, user.id, type, amount, reason);

    await audit({
      userId: user.id,
      action: type === "CASH_IN" ? "CASH_IN" : "CASH_OUT",
      entity: "CashShift",
      entityId: shiftId,
      newData: { amount, reason },
    });

    revalidatePath("/shifts");
    return {};
  } catch (error) {
    return fail(error);
  }
}
