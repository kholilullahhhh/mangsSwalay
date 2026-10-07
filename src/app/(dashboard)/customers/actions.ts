"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requirePermission } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { toActionError } from "@/lib/error";
import { EXPENSE_CATEGORIES } from "@/lib/queries/catalog";

export interface CrudResult {
  error?: string;
  fieldErrors?: Record<string, string>;
  id?: string;
}

function fail(error: unknown): CrudResult {
  const actionError = toActionError(error);
  return {
    error: actionError.error,
    fieldErrors: actionError.field
      ? { [actionError.field]: actionError.error }
      : undefined,
  };
}

// ── Customers ──────────────────────────────────────────────────────────────

const customerSchema = z.object({
  name: z.string().trim().min(2, "Nama minimal 2 karakter."),
  phone: z.string().trim().max(30).optional(),
  email: z.string().trim().email("Email tidak valid.").optional().or(z.literal("")),
  address: z.string().trim().max(300).optional(),
  isMember: z.coerce.boolean().default(false),
  notes: z.string().trim().max(500).optional(),
});

function readCustomer(formData: FormData) {
  return {
    name: String(formData.get("name") ?? ""),
    phone: String(formData.get("phone") ?? ""),
    email: String(formData.get("email") ?? ""),
    address: String(formData.get("address") ?? ""),
    isMember: formData.get("isMember") === "true",
    notes: String(formData.get("notes") ?? ""),
  };
}

export async function createCustomerAction(
  formData: FormData,
): Promise<CrudResult> {
  const user = await requirePermission("customers:manage");

  const parsed = customerSchema.safeParse(readCustomer(formData));

  if (!parsed.success) {
    return { fieldErrors: firstErrors(parsed.error) };
  }

  const input = parsed.data;

  try {
    // Duplicate phone means the same person; reuse the record rather than
    // creating a second identity that splits their purchase history.
    if (input.phone) {
      const existing = await prisma.customer.findFirst({
        where: { phone: input.phone },
        select: { id: true, name: true },
      });

      if (existing) {
        return {
          error:
            "Nomor telepon sudah terdaftar atas nama " +
            existing.name +
            ". Gunakan pelanggan yang sudah ada.",
        };
      }
    }

    // Member numbers are sequential so they can be read aloud over the phone.
    let memberNumber: string | null = null;

    if (input.isMember) {
      const last = await prisma.customer.findFirst({
        where: { memberNumber: { startsWith: "MBR-" } },
        orderBy: { memberNumber: "desc" },
        select: { memberNumber: true },
      });

      const lastNumber = last?.memberNumber
        ? Number(last.memberNumber.replace("MBR-", ""))
        : 0;

      memberNumber = "MBR-" + String(lastNumber + 1).padStart(4, "0");
    }

    const customer = await prisma.customer.create({
      data: {
        name: input.name,
        phone: input.phone || null,
        email: input.email || null,
        address: input.address || null,
        notes: input.notes || null,
        isMember: input.isMember,
        memberNumber,
      },
      select: { id: true },
    });

    await audit({
      userId: user.id,
      action: "CUSTOMER_CREATE",
      entity: "Customer",
      entityId: customer.id,
      newData: { name: input.name, memberNumber },
    });

    revalidatePath("/customers");
    return { id: customer.id };
  } catch (error) {
    return fail(error);
  }
}

export async function updateCustomerAction(
  formData: FormData,
): Promise<CrudResult> {
  const user = await requirePermission("customers:manage");

  const id = String(formData.get("id") ?? "");
  const parsed = customerSchema.safeParse(readCustomer(formData));

  if (!id) return { error: "ID pelanggan tidak valid." };
  if (!parsed.success) return { fieldErrors: firstErrors(parsed.error) };

  try {
    const existing = await prisma.customer.findUnique({
      where: { id },
      select: { id: true, isMember: true, memberNumber: true },
    });

    if (!existing) return { error: "Pelanggan tidak ditemukan." };

    const input = parsed.data;

    if (input.phone) {
      const conflict = await prisma.customer.findFirst({
        where: { phone: input.phone, NOT: { id } },
        select: { name: true },
      });

      if (conflict) {
        return { error: "Nomor telepon sudah digunakan pelanggan lain." };
      }
    }

    // Promote to member lazily so an existing customer can be enrolled without
    // losing their purchase history.
    let memberNumber = existing.memberNumber;

    if (input.isMember && !existing.isMember) {
      const last = await prisma.customer.findFirst({
        where: { memberNumber: { startsWith: "MBR-" } },
        orderBy: { memberNumber: "desc" },
        select: { memberNumber: true },
      });

      const lastNumber = last?.memberNumber
        ? Number(last.memberNumber.replace("MBR-", ""))
        : 0;

      memberNumber = "MBR-" + String(lastNumber + 1).padStart(4, "0");
    }

    await prisma.customer.update({
      where: { id },
      data: {
        name: input.name,
        phone: input.phone || null,
        email: input.email || null,
        address: input.address || null,
        notes: input.notes || null,
        isMember: input.isMember,
        memberNumber,
      },
    });

    await audit({
      userId: user.id,
      action: "CUSTOMER_UPDATE",
      entity: "Customer",
      entityId: id,
      newData: { name: input.name, isMember: input.isMember },
    });

    revalidatePath("/customers");
    revalidatePath("/customers/" + id);
    return {};
  } catch (error) {
    return fail(error);
  }
}

/**
 * Deactivates rather than deletes a customer who has purchase history, so past
 * invoices keep resolving to a name.
 */
export async function deactivateCustomerAction(
  formData: FormData,
): Promise<CrudResult> {
  const user = await requirePermission("customers:manage");

  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "ID pelanggan tidak valid." };

  try {
    const sales = await prisma.sale.count({ where: { customerId: id } });

    if (sales === 0) {
      await prisma.customer.delete({ where: { id } });
    } else {
      await prisma.customer.update({
        where: { id },
        data: { isActive: false },
      });
    }

    await audit({
      userId: user.id,
      action: "CUSTOMER_DELETE",
      entity: "Customer",
      entityId: id,
      newData: { sales },
    });

    revalidatePath("/customers");
    return {};
  } catch (error) {
    return fail(error);
  }
}

// ── Categories ─────────────────────────────────────────────────────────────

export async function createCategoryAction(
  formData: FormData,
): Promise<CrudResult> {
  const user = await requirePermission("categories:manage");

  const name = String(formData.get("name") ?? "").trim();

  if (name.length < 2) {
    return { fieldErrors: { name: "Nama kategori minimal 2 karakter." } };
  }

  try {
    const slug = slugify(name);
    const exists = await prisma.category.findUnique({
      where: { slug },
      select: { id: true },
    });

    if (exists) {
      return { fieldErrors: { name: "Kategori dengan nama serupa sudah ada." } };
    }

    const category = await prisma.category.create({
      data: {
        name,
        slug,
        description: String(formData.get("description") ?? "") || null,
        icon: String(formData.get("icon") ?? "") || null,
        image: String(formData.get("image") ?? "") || null,
      },
      select: { id: true },
    });

    await audit({
      userId: user.id,
      action: "CATEGORY_CREATE",
      entity: "Category",
      entityId: category.id,
      newData: { name },
    });

    revalidatePath("/categories");
    revalidatePath("/products");
    return { id: category.id };
  } catch (error) {
    return fail(error);
  }
}

export async function updateCategoryAction(
  formData: FormData,
): Promise<CrudResult> {
  const user = await requirePermission("categories:manage");

  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const isActive = formData.get("isActive") === "true";

  if (!id) return { error: "ID kategori tidak valid." };
  if (name.length < 2) {
    return { fieldErrors: { name: "Nama kategori minimal 2 karakter." } };
  }

  try {
    // A category with products is deactivated rather than deleted, so product
    // rows never end up pointing at a category that no longer exists.
    const productCount = await prisma.product.count({ where: { categoryId: id } });

    await prisma.category.update({
      where: { id },
      data: {
        name,
        description: String(formData.get("description") ?? "") || null,
        // The slug is left alone once products reference the category, so
        // existing product URLs keep resolving.
        ...(productCount === 0 ? { slug: slugify(name) } : {}),
        isActive,
      },
    });

    await audit({
      userId: user.id,
      action: "CATEGORY_UPDATE",
      entity: "Category",
      entityId: id,
      newData: { name, isActive },
    });

    revalidatePath("/categories");
    return {};
  } catch (error) {
    return fail(error);
  }
}

export async function deleteCategoryAction(
  formData: FormData,
): Promise<CrudResult> {
  const user = await requirePermission("categories:manage");

  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "ID kategori tidak valid." };

  try {
    const productCount = await prisma.product.count({ where: { categoryId: id } });

    if (productCount > 0) {
      return {
        error:
          "Kategori masih memiliki " +
          productCount +
          " produk. Nonaktifkan kategori, atau pindahkan produknya dulu.",
      };
    }

    await prisma.category.delete({ where: { id } });

    await audit({
      userId: user.id,
      action: "CATEGORY_DELETE",
      entity: "Category",
      entityId: id,
    });

    revalidatePath("/categories");
    return {};
  } catch (error) {
    return fail(error);
  }
}

// ── Expenses ───────────────────────────────────────────────────────────────

const expenseSchema = z.object({
  category: z.enum(
    EXPENSE_CATEGORIES as [string, ...string[]],
    { error: "Kategori pengeluaran tidak valid." },
  ),
  amount: z.coerce.number().positive("Nominal harus lebih dari nol."),
  description: z.string().trim().max(300).optional(),
  date: z.string().min(4, "Tanggal wajib diisi."),
});

export async function createExpenseAction(
  formData: FormData,
): Promise<CrudResult> {
  const user = await requirePermission("expenses:manage");

  const parsed = expenseSchema.safeParse({
    category: String(formData.get("category") ?? ""),
    amount: formData.get("amount"),
    description: String(formData.get("description") ?? ""),
    date: String(formData.get("date") ?? ""),
  });

  if (!parsed.success) {
    return { fieldErrors: firstErrors(parsed.error) };
  }

  try {
    const date = new Date(parsed.data.date);
    if (Number.isNaN(date.getTime())) {
      return { fieldErrors: { date: "Tanggal tidak valid." } };
    }

    const expense = await prisma.expense.create({
      data: {
        category: parsed.data.category as never,
        amount: parsed.data.amount,
        description: parsed.data.description || null,
        date,
        userId: user.id,
      },
      select: { id: true },
    });

    await audit({
      userId: user.id,
      action: "EXPENSE_CREATE",
      entity: "Expense",
      entityId: expense.id,
      newData: {
        category: parsed.data.category,
        amount: parsed.data.amount,
      },
    });

    revalidatePath("/expenses");
    revalidatePath("/dashboard");
    return { id: expense.id };
  } catch (error) {
    return fail(error);
  }
}

export async function deleteExpenseAction(
  formData: FormData,
): Promise<CrudResult> {
  const user = await requirePermission("expenses:manage");

  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "ID pengeluaran tidak valid." };

  try {
    const before = await prisma.expense.findUnique({
      where: { id },
      select: { amount: true, category: true },
    });

    if (!before) return { error: "Pengeluaran tidak ditemukan." };

    await prisma.expense.delete({ where: { id } });

    await audit({
      userId: user.id,
      action: "EXPENSE_DELETE",
      entity: "Expense",
      entityId: id,
      oldData: { amount: Number(before.amount), category: before.category },
    });

    revalidatePath("/expenses");
    revalidatePath("/dashboard");
    return {};
  } catch (error) {
    return fail(error);
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function firstErrors(error: {
  flatten: () => { fieldErrors: Record<string, string[] | undefined> };
}): Record<string, string> {
  const flattened = error.flatten().fieldErrors;
  const output: Record<string, string> = {};

  for (const [field, messages] of Object.entries(flattened)) {
    if (messages?.[0]) output[field] = messages[0];
  }

  return output;
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80);
}
