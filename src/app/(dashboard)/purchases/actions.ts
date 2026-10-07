"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { toActionError } from "@/lib/error";
import {
  createPurchase,
  createSupplier,
  deactivateSupplier,
  deleteDraftPurchase,
  recordPurchasePayment,
  transitionPurchase,
  updateSupplier,
  type PurchaseLineInput,
  type SupplierInput,
} from "@/lib/purchases/mutations";
import type { PurchaseStatus } from "@/generated/prisma/enums";

/**
 * Purchase and supplier Server Actions.
 *
 * Every action re-checks permissions server-side and returns a plain result so
 * the calling form can render an inline message rather than throwing into an
 * error boundary.
 */

export interface PurchaseActionResult {
  error?: string;
  fieldErrors?: Record<string, string>;
  id?: string;
}

const VALID_STATUSES: PurchaseStatus[] = [
  "DRAFT",
  "ORDERED",
  "RECEIVED",
  "COMPLETED",
  "CANCELLED",
];

function fail(error: unknown): PurchaseActionResult {
  const actionError = toActionError(error);
  return {
    error: actionError.error,
    fieldErrors: actionError.field
      ? { [actionError.field]: actionError.error }
      : undefined,
  };
}

export async function createPurchaseAction(
  formData: FormData,
): Promise<PurchaseActionResult> {
  const user = await requirePermission("purchases:create");

  const rawLines = formData.getAll("line");

  const lines: PurchaseLineInput[] = rawLines
    .map((entry) => {
      if (typeof entry !== "string") return null;
      try {
        const parsed = JSON.parse(entry) as PurchaseLineInput;
        return parsed;
      } catch {
        return null;
      }
    })
    .filter((line): line is PurchaseLineInput => line !== null);

  const supplierId = String(formData.get("supplierId") ?? "");
  const dateRaw = String(formData.get("date") ?? "");

  if (!supplierId) {
    return { fieldErrors: { supplierId: "Pilih supplier." } };
  }

  if (lines.length === 0) {
    return { error: "Tambahkan minimal satu barang ke pembelian." };
  }

  const date = dateRaw ? new Date(dateRaw) : new Date();

  if (Number.isNaN(date.getTime())) {
    return { fieldErrors: { date: "Tanggal tidak valid." } };
  }

  try {
    const purchase = await createPurchase(
      {
        supplierId,
        date,
        discount: Number(formData.get("discount") ?? 0) || 0,
        tax: Number(formData.get("tax") ?? 0) || 0,
        shippingCost: Number(formData.get("shippingCost") ?? 0) || 0,
        amountPaid: Number(formData.get("amountPaid") ?? 0) || 0,
        notes: String(formData.get("notes") ?? ""),
        lines,
      },
      user.id,
    );

    await audit({
      userId: user.id,
      action: "PURCHASE_CREATE",
      entity: "Purchase",
      entityId: purchase.id,
      newData: { number: purchase.number, lines: lines.length },
    });

    revalidatePath("/purchases");
    return { id: purchase.id };
  } catch (error) {
    return fail(error);
  }
}

export async function transitionPurchaseAction(
  formData: FormData,
): Promise<PurchaseActionResult> {
  const id = String(formData.get("id") ?? "");
  const to = String(formData.get("status") ?? "") as PurchaseStatus;

  if (!id) {
    return { error: "ID pembelian tidak valid." };
  }

  if (!VALID_STATUSES.includes(to)) {
    return { error: "Status tidak valid." };
  }

  // Receiving is the permission that changes stock, so it is checked
  // separately from the other transitions.
  const user = await requirePermission(
    to === "RECEIVED" ? "purchases:receive" : "purchases:update",
  );

  try {
    const before = await prisma.purchase.findUnique({
      where: { id },
      select: { number: true, status: true },
    });

    await transitionPurchase(id, to, user.id);

    await audit({
      userId: user.id,
      action:
        to === "RECEIVED"
          ? "PURCHASE_RECEIVE"
          : to === "CANCELLED"
            ? "PURCHASE_CANCEL"
            : "PURCHASE_UPDATE",
      entity: "Purchase",
      entityId: id,
      oldData: before ? { status: before.status } : undefined,
      newData: { status: to },
    });

    revalidatePath("/purchases");
    revalidatePath(`/purchases/${id}`);
    revalidatePath("/inventory");

    return {};
  } catch (error) {
    return fail(error);
  }
}

export async function recordPaymentAction(
  formData: FormData,
): Promise<PurchaseActionResult> {
  const user = await requirePermission("purchases:update");

  const id = String(formData.get("id") ?? "");
  const amount = Number(formData.get("amount") ?? 0);

  if (!id) {
    return { error: "ID pembelian tidak valid." };
  }

  try {
    await recordPurchasePayment(id, amount);

    await audit({
      userId: user.id,
      action: "PURCHASE_UPDATE",
      entity: "Purchase",
      entityId: id,
      newData: { payment: amount },
    });

    revalidatePath(`/purchases/${id}`);
    revalidatePath("/purchases");
    return {};
  } catch (error) {
    return fail(error);
  }
}

export async function deleteDraftPurchaseAction(
  formData: FormData,
): Promise<PurchaseActionResult> {
  const user = await requirePermission("purchases:cancel");

  const id = String(formData.get("id") ?? "");

  if (!id) {
    return { error: "ID pembelian tidak valid." };
  }

  try {
    await deleteDraftPurchase(id);

    await audit({
      userId: user.id,
      action: "PURCHASE_CANCEL",
      entity: "Purchase",
      entityId: id,
      newData: { deleted: true },
    });

    revalidatePath("/purchases");
    return {};
  } catch (error) {
    return fail(error);
  }
}

/**
 * Server Action wrapper for a plain `<form action={...}>`.
 *
 * React only accepts form actions returning `void`, while `recordPaymentAction`
 * returns a result so client components can render inline errors. This thin
 * wrapper bridges the two without changing the shared signature.
 */
export async function recordPaymentFormAction(formData: FormData): Promise<void> {
  const result = await recordPaymentAction(formData);

  if (result.error) {
    // The page re-renders with the outstanding balance still shown; the failure
    // is logged here because this form has no client-side error slot.
    console.error("[purchase] payment not recorded:", result.error);
  }
}

// ── Suppliers ─────────────────────────────────────────────────────────────

function readSupplierForm(formData: FormData): SupplierInput {
  return {
    code: String(formData.get("code") ?? "").trim() || undefined,
    name: String(formData.get("name") ?? "").trim(),
    company: String(formData.get("company") ?? "").trim() || undefined,
    phone: String(formData.get("phone") ?? "").trim() || undefined,
    email: String(formData.get("email") ?? "").trim() || undefined,
    address: String(formData.get("address") ?? "").trim() || undefined,
    contactPerson: String(formData.get("contactPerson") ?? "").trim() || undefined,
    notes: String(formData.get("notes") ?? "").trim() || undefined,
  };
}

export async function createSupplierAction(
  formData: FormData,
): Promise<PurchaseActionResult> {
  const user = await requirePermission("suppliers:manage");

  const input = readSupplierForm(formData);

  if (input.name.length < 2) {
    return { fieldErrors: { name: "Nama supplier minimal 2 karakter." } };
  }

  try {
    const supplier = await createSupplier(input);

    await audit({
      userId: user.id,
      action: "SUPPLIER_CREATE",
      entity: "Supplier",
      entityId: supplier.id,
      newData: { name: input.name, code: supplier.code },
    });

    revalidatePath("/suppliers");
    return { id: supplier.id };
  } catch (error) {
    return fail(error);
  }
}

export async function updateSupplierAction(
  formData: FormData,
): Promise<PurchaseActionResult> {
  const user = await requirePermission("suppliers:manage");

  const id = String(formData.get("id") ?? "");
  const input = readSupplierForm(formData);

  if (!id) {
    return { error: "ID supplier tidak valid." };
  }

  if (input.name.length < 2) {
    return { fieldErrors: { name: "Nama supplier minimal 2 karakter." } };
  }

  try {
    await updateSupplier(id, input);

    await audit({
      userId: user.id,
      action: "SUPPLIER_UPDATE",
      entity: "Supplier",
      entityId: id,
      newData: input,
    });

    revalidatePath("/suppliers");
    revalidatePath(`/suppliers/${id}`);
    return {};
  } catch (error) {
    return fail(error);
  }
}

export async function deactivateSupplierAction(
  formData: FormData,
): Promise<PurchaseActionResult> {
  const user = await requirePermission("suppliers:manage");

  const id = String(formData.get("id") ?? "");

  if (!id) {
    return { error: "ID supplier tidak valid." };
  }

  try {
    await deactivateSupplier(id);

    await audit({
      userId: user.id,
      action: "SUPPLIER_DELETE",
      entity: "Supplier",
      entityId: id,
    });

    revalidatePath("/suppliers");
    return {};
  } catch (error) {
    return fail(error);
  }
}