"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { toActionError } from "@/lib/error";
import {
  createProduct,
  deactivateProduct,
  bulkUpdateProducts,
  bulkSetCategory,
  productSchema,
  updateProduct,
  type ProductData,
} from "@/lib/products/mutations";

/**
 * Product Server Actions.
 *
 * Each one re-checks permissions on the server. The form already hides controls
 * the role cannot use, but these checks are the actual enforcement — a client
 * can always call an action directly.
 *
 * Actions return a plain result object rather than throwing, so the calling form
 * can render validation errors inline without an error boundary.
 */

export interface ProductActionResult {
  error?: string;
  fieldErrors?: Record<string, string>;
}

/** Flattens a Zod error into a field-name → first-message map. */
function fieldErrorsFrom(error: {
  flatten: () => {
    fieldErrors: Record<string, string[] | undefined>;
  };
}): Record<string, string> {
  const flattened = error.flatten().fieldErrors;
  const output: Record<string, string> = {};

  for (const [field, messages] of Object.entries(flattened)) {
    if (messages?.[0]) {
      output[field] = messages[0];
    }
  }

  return output;
}

function formDataToInput(formData: FormData) {
  return {
    name: formData.get("name"),
    sku: formData.get("sku"),
    barcode: formData.get("barcode") ?? "",
    description: formData.get("description") ?? "",
    categoryId: formData.get("categoryId"),
    brandId: formData.get("brandId") ?? "",
    unit: formData.get("unit"),
    purchasePrice: formData.get("purchasePrice"),
    sellingPrice: formData.get("sellingPrice"),
    minSellingPrice: formData.get("minSellingPrice") ?? "",
    stock: formData.get("stock"),
    minStock: formData.get("minStock") ?? "0",
    maxStock: formData.get("maxStock") ?? "",
    hasExpiry: formData.get("hasExpiry") === "true",
    isFeatured: formData.get("isFeatured") === "true",
    isActive: formData.get("isActive") === "true",
    image: formData.get("image") ?? "",
  };
}

export async function createProductAction(
  formData: FormData,
): Promise<ProductActionResult> {
  const user = await requirePermission("products:create");

  const parsed = productSchema.safeParse(formDataToInput(formData));

  if (!parsed.success) {
    return { fieldErrors: fieldErrorsFrom(parsed.error) };
  }

  try {
    const product = await createProduct(parsed.data as ProductData);

    await audit({
      userId: user.id,
      action: "PRODUCT_CREATE",
      entity: "Product",
      entityId: product.id,
      newData: parsed.data,
    });

    revalidatePath("/products");

    return {};
  } catch (error) {
    const actionError = toActionError(error);
    return {
      error: actionError.error,
      fieldErrors: actionError.field
        ? { [actionError.field]: actionError.error }
        : undefined,
    };
  }
}

export async function updateProductAction(
  id: string,
  formData: FormData,
): Promise<ProductActionResult> {
  const user = await requirePermission("products:update");

  const parsed = productSchema.safeParse(formDataToInput(formData));

  if (!parsed.success) {
    return { fieldErrors: fieldErrorsFrom(parsed.error) };
  }

  try {
    const before = await prisma_productForAudit(id);
    const product = await updateProduct(id, parsed.data as ProductData);

    await audit({
      userId: user.id,
      action: "PRODUCT_UPDATE",
      entity: "Product",
      entityId: product.id,
      oldData: before,
      newData: parsed.data,
    });

    revalidatePath("/products");
    revalidatePath(`/products/${id}`);

    return {};
  } catch (error) {
    const actionError = toActionError(error);
    return {
      error: actionError.error,
      fieldErrors: actionError.field
        ? { [actionError.field]: actionError.error }
        : undefined,
    };
  }
}

export async function deactivateProductAction(
  id: string,
): Promise<ProductActionResult> {
  const user = await requirePermission("products:delete");

  try {
    await deactivateProduct(id);

    await audit({
      userId: user.id,
      action: "PRODUCT_DELETE",
      entity: "Product",
      entityId: id,
    });

    revalidatePath("/products");
    return {};
  } catch (error) {
    return { error: toActionError(error).error };
  }
}

export async function bulkProductAction(
  formData: FormData,
): Promise<ProductActionResult> {
  const action = String(formData.get("action") ?? "");

  if (action !== "activate" && action !== "deactivate") {
    return { error: "Aksi tidak valid." };
  }

  const user = await requirePermission("products:update");

  const ids = formData
    .getAll("ids")
    .map(String)
    .filter(Boolean);

  if (ids.length === 0) {
    return { error: "Pilih minimal satu produk." };
  }

  const count = await bulkUpdateProducts(ids, action);

  await audit({
    userId: user.id,
    action: "PRODUCT_UPDATE",
    entity: "Product",
    newData: { bulkAction: action, count },
  });

  revalidatePath("/products");
  return {};
}

export async function bulkSetCategoryAction(
  formData: FormData,
): Promise<ProductActionResult> {
  const user = await requirePermission("products:update");

  const categoryId = String(formData.get("categoryId") ?? "");

  if (!categoryId) {
    return {
      error: "Pilih kategori tujuan.",
      fieldErrors: { categoryId: "Pilih kategori tujuan." },
    };
  }

  const ids = formData.getAll("ids").map(String).filter(Boolean);

  if (ids.length === 0) {
    return { error: "Pilih minimal satu produk." };
  }

  try {
    const count = await bulkSetCategory(ids, categoryId);

    await audit({
      userId: user.id,
      action: "PRODUCT_UPDATE",
      entity: "Product",
      newData: { categoryId, count },
    });

    revalidatePath("/products");
    return {};
  } catch (error) {
    const actionError = toActionError(error);
    return {
      error: actionError.error,
      fieldErrors: actionError.field
        ? { [actionError.field]: actionError.error }
        : undefined,
    };
  }
}

/** Reads the current row so the audit log can record what changed. */
async function prisma_productForAudit(id: string) {
  const product = await prisma.product.findUnique({
    where: { id },
    select: {
      name: true,
      sku: true,
      barcode: true,
      sellingPrice: true,
      purchasePrice: true,
      minStock: true,
      isActive: true,
      categoryId: true,
    },
  });

  return product;
}