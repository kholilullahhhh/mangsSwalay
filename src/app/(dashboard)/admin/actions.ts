"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requirePermission } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { toActionError, ValidationError } from "@/lib/error";
import { getAllSettings } from "@/lib/queries/catalog";

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

// ── Notifications ──────────────────────────────────────────────────────────

/**
 * Marks one notification read.
 *
 * Scoped to `userId OR null` deliberately: a broadcast alert (userId null) is
 * shared, so "read" is tracked per user rather than by clearing the shared row.
 * Without that, the first person to open it would hide it from everyone else.
 */
export async function markNotificationReadAction(
  formData: FormData,
): Promise<CrudResult> {
  const user = await requirePermission("notifications:view");

  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "ID notifikasi tidak valid." };

  try {
    const updated = await prisma.notification.updateMany({
      where: {
        id,
        OR: [{ userId: user.id }, { userId: null }],
      },
      data: { isRead: true },
    });

    if (updated.count === 0) {
      return { error: "Notifikasi tidak ditemukan." };
    }

    revalidatePath("/notifications");
    return {};
  } catch (error) {
    return fail(error);
  }
}

export async function markAllNotificationsReadAction(): Promise<CrudResult> {
  const user = await requirePermission("notifications:view");

  try {
    await prisma.notification.updateMany({
      where: {
        isRead: false,
        OR: [{ userId: user.id }, { userId: null }],
      },
      data: { isRead: true },
    });

    revalidatePath("/notifications");
    return {};
  } catch (error) {
    return fail(error);
  }
}

export async function deleteNotificationAction(
  formData: FormData,
): Promise<CrudResult> {
  const user = await requirePermission("notifications:manage");

  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "ID notifikasi tidak valid." };

  try {
    const deleted = await prisma.notification.deleteMany({
      where: { id, OR: [{ userId: user.id }, { userId: null }] },
    });

    if (deleted.count === 0) {
      return { error: "Notifikasi tidak ditemukan." };
    }

    revalidatePath("/notifications");
    return {};
  } catch (error) {
    return fail(error);
  }
}

// ── Promotions ─────────────────────────────────────────────────────────────

/**
 * Parses a form value into the promotion's `value` field.
 *
 * The column means different things per type: a percentage for PERCENTAGE,
 * MINIMUM_PURCHASE, PRODUCT, and CATEGORY, but a rupiah amount for FIXED and a
 * meaningless zero for BUY_X_GET_Y (whose real parameters are the quantities).
 * Normalising here means the engine never has to guess.
 */
function readPromotionValue(type: string, raw: string): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return 0;

  switch (type) {
    case "PERCENTAGE":
    case "MINIMUM_PURCHASE":
    case "PRODUCT":
    case "CATEGORY":
      // Clamped: an over-100% promo would discount more than it is discounting,
      // and the engine would then reject it as misconfigured at checkout.
      return Math.min(Math.max(parsed, 0), 100);
    case "FIXED":
      return Math.max(parsed, 0);
    default:
      return 0;
  }
}

const promotionSchema = z.object({
  code: z
    .string()
    .trim()
    .min(3, "Kode promo minimal 3 karakter.")
    .max(20, "Kode promo maksimal 20 karakter.")
    .regex(/^[A-Z0-9-]+$/, "Kode hanya boleh huruf kapital, angka, dan tanda hubung."),
  name: z.string().trim().min(3, "Nama promo minimal 3 karakter.").max(100),
  description: z.string().trim().max(300).optional(),
  type: z.enum([
    "PERCENTAGE",
    "FIXED",
    "BUY_X_GET_Y",
    "PRODUCT",
    "CATEGORY",
    "MINIMUM_PURCHASE",
  ]),
  startDate: z.string().min(4, "Tanggal mulai wajib diisi."),
  endDate: z.string().min(4, "Tanggal berakhir wajib diisi."),
  isActive: z.boolean(),
});

function readPromotion(formData: FormData) {
  return {
    code: String(formData.get("code") ?? "").trim().toUpperCase(),
    name: String(formData.get("name") ?? "").trim(),
    description: String(formData.get("description") ?? "").trim(),
    type: String(formData.get("type") ?? ""),
    value: String(formData.get("value") ?? ""),
    minPurchaseAmount: String(formData.get("minPurchaseAmount") ?? ""),
    buyQuantity: String(formData.get("buyQuantity") ?? ""),
    getQuantity: String(formData.get("getQuantity") ?? ""),
    categoryId: String(formData.get("categoryId") ?? ""),
    startDate: String(formData.get("startDate") ?? ""),
    endDate: String(formData.get("endDate") ?? ""),
    usageLimit: String(formData.get("usageLimit") ?? ""),
    productIds: formData.getAll("productIds").map(String),
    isActive: formData.get("isActive") === "true",
  };
}

/** Optional integer, rejecting the values that would break the rules. */
function optionalInt(raw: string): number | null | undefined {
  if (!raw.trim()) return null;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function buildPromotionData(raw: ReturnType<typeof readPromotion>) {
  const buyQuantity = optionalInt(raw.buyQuantity);
  const getQuantity = optionalInt(raw.getQuantity);
  const usageLimit = optionalInt(raw.usageLimit);

  if (buyQuantity === undefined || getQuantity === undefined || usageLimit === undefined) {
    return { error: "Jumlah harus berupa bilangan bulat non-negatif." };
  }

  const startDate = new Date(raw.startDate);
  const endDate = new Date(raw.endDate);

  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return { error: "Tanggal tidak valid." };
  }

  if (endDate < startDate) {
    return { error: "Tanggal berakhir tidak boleh lebih awal dari tanggal mulai." };
  }

  // BUY_X_GET_Y is parameterised by its quantities, and PRODUCT by its attached
  // products. Catching the missing case here means a broken promo can never be
  // created and then silently fail at the till.
  if (raw.type === "BUY_X_GET_Y" && (!buyQuantity || !getQuantity)) {
    return {
      error: "Promo beli- gratis- wajib mengisi jumlah beli dan jumlah gratis.",
    };
  }

  if (raw.type === "PRODUCT" && raw.productIds.length === 0) {
    return { error: "Pilih minimal satu produk untuk promo produk terpilih." };
  }

  const minPurchaseAmount = raw.minPurchaseAmount.trim()
    ? Number(raw.minPurchaseAmount)
    : null;

  if (minPurchaseAmount !== null && (!Number.isFinite(minPurchaseAmount) || minPurchaseAmount < 0)) {
    return { error: "Minimum belanja harus berupa nominal yang valid." };
  }

  return {
    data: {
      code: raw.code,
      name: raw.name,
      description: raw.description || null,
      type: raw.type as never,
      value: readPromotionValue(raw.type, raw.value),
      minPurchaseAmount,
      buyQuantity,
      getQuantity,
      categoryId: raw.type === "CATEGORY" ? raw.categoryId || null : null,
      startDate,
      // Exclusive-by-day end: a promo ending 2026-10-31 stays usable for the
      // whole day, matching the signage the customer read.
      endDate: new Date(endDate.getTime() + 86_400_000),
      usageLimit,
      isActive: raw.isActive,
      products: {
        deleteMany: {},
        create: raw.productIds.map((productId) => ({ productId })),
      },
    },
  };
}

export async function createPromotionAction(
  formData: FormData,
): Promise<CrudResult> {
  const user = await requirePermission("promotions:manage");

  const raw = readPromotion(formData);
  const parsed = promotionSchema.safeParse(raw);

  if (!parsed.success) return { fieldErrors: firstErrors(parsed.error) };

  const built = buildPromotionData(raw);
  if ("error" in built) return { error: built.error };

  try {
    const existing = await prisma.promotion.findUnique({
      where: { code: raw.code },
      select: { id: true },
    });

    if (existing) {
      return { fieldErrors: { code: "Kode promo sudah dipakai." } };
    }

    const promotion = await prisma.promotion.create({
      data: built.data,
      select: { id: true },
    });

    await audit({
      userId: user.id,
      action: "PROMOTION_CREATE",
      entity: "Promotion",
      entityId: promotion.id,
      newData: { code: raw.code, type: raw.type, value: built.data.value },
    });

    revalidatePath("/promotions");
    return { id: promotion.id };
  } catch (error) {
    return fail(error);
  }
}

export async function updatePromotionAction(
  formData: FormData,
): Promise<CrudResult> {
  const user = await requirePermission("promotions:manage");

  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "ID promo tidak valid." };

  const raw = readPromotion(formData);
  const parsed = promotionSchema.safeParse(raw);

  if (!parsed.success) return { fieldErrors: firstErrors(parsed.error) };

  const built = buildPromotionData(raw);
  if ("error" in built) return { error: built.error };

  try {
    const existing = await prisma.promotion.findUnique({
      where: { id },
      select: { id: true, usedCount: true },
    });

    if (!existing) return { error: "Promo tidak ditemukan." };

    // Lowering the cap below what has already been used would leave the promo
    // permanently exhausted with no way to tell how many uses remain.
    if (
      built.data.usageLimit !== null &&
      built.data.usageLimit < existing.usedCount
    ) {
      return {
        error:
          "Batas pemakaian (" +
          built.data.usageLimit +
          ") tidak boleh lebih kecil dari pemakaian saat ini (" +
          existing.usedCount +
          ").",
      };
    }

    const conflict = await prisma.promotion.findFirst({
      where: { code: raw.code, NOT: { id } },
      select: { id: true },
    });

    if (conflict) {
      return { fieldErrors: { code: "Kode promo sudah dipakai." } };
    }

    await prisma.promotion.update({ where: { id }, data: built.data });

    await audit({
      userId: user.id,
      action: "PROMOTION_UPDATE",
      entity: "Promotion",
      entityId: id,
      newData: { code: raw.code, isActive: built.data.isActive },
    });

    revalidatePath("/promotions");
    return {};
  } catch (error) {
    return fail(error);
  }
}

export async function togglePromotionAction(
  formData: FormData,
): Promise<CrudResult> {
  const user = await requirePermission("promotions:manage");

  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "ID promo tidak valid." };

  try {
    const promotion = await prisma.promotion.findUnique({
      where: { id },
      select: { isActive: true },
    });

    if (!promotion) return { error: "Promo tidak ditemukan." };

    await prisma.promotion.update({
      where: { id },
      data: { isActive: !promotion.isActive },
    });

    await audit({
      userId: user.id,
      action: "PROMOTION_UPDATE",
      entity: "Promotion",
      entityId: id,
      newData: { isActive: !promotion.isActive },
    });

    revalidatePath("/promotions");
    return {};
  } catch (error) {
    return fail(error);
  }
}

/**
 * Deletes a promotion only when it has never been used.
 *
 * A used promo is deactivated instead: sales reference it by code, and deleting
 * it would leave historical invoices describing a discount nobody can explain.
 */
export async function deletePromotionAction(
  formData: FormData,
): Promise<CrudResult> {
  const user = await requirePermission("promotions:manage");

  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "ID promo tidak valid." };

  try {
    const promotion = await prisma.promotion.findUnique({
      where: { id },
      select: { usedCount: true, code: true },
    });

    if (!promotion) return { error: "Promo tidak ditemukan." };

    if (promotion.usedCount > 0) {
      await prisma.promotion.update({
        where: { id },
        data: { isActive: false },
      });

      revalidatePath("/promotions");
      return {
        error:
          "Promo sudah pernah dipakai " +
          promotion.usedCount +
          " kali sehingga tidak dihapus, tapi dinonaktifkan.",
      };
    }

    await prisma.promotion.delete({ where: { id } });

    await audit({
      userId: user.id,
      action: "PROMOTION_DELETE",
      entity: "Promotion",
      entityId: id,
      oldData: { code: promotion.code },
    });

    revalidatePath("/promotions");
    return {};
  } catch (error) {
    return fail(error);
  }
}

// ── Settings ───────────────────────────────────────────────────────────────

/**
 * Keys the settings screen is allowed to write.
 *
 * An allow-list rather than a deny-list: this endpoint takes arbitrary keys from
 * a form, and anything not named here would let a form post write to a column
 * nobody intended to expose. Adding a setting means adding it here on purpose.
 */
const EDITABLE_SETTINGS = new Set([
  "store.name",
  "store.tagline",
  "store.address",
  "store.phone",
  "store.whatsapp",
  "store.email",
  "store.openTime",
  "store.closeTime",
  "store.about",
  "loyalty.enabled",
  "loyalty.ratio",
  "loyalty.pointValue",
  "tax.enabled",
  "tax.rate",
  "expiry.warningDays",
  "invoice.footer",
]);

/** Coerces the raw form string into the type the existing setting already has. */
function coerceSettingValue(
  key: string,
  raw: string,
  existing: unknown,
): unknown {
  // `tax.rate` is stored as a percentage but consumed as a fraction.
  const asNumber = () =>
    key === "tax.rate" ? Number(raw) / 100 : Number(raw);

  if (typeof existing === "number") {
    const parsed = asNumber();

    if (!Number.isFinite(parsed)) {
      throw new ValidationError("Nilai harus berupa angka.", key);
    }

    return parsed;
  }

  if (typeof existing === "boolean") {
    return raw === "true";
  }

  return raw;
}

export async function updateSettingsAction(
  formData: FormData,
): Promise<CrudResult> {
  const user = await requirePermission("settings:manage");

  try {
    const existingRows = await getAllSettings();
    const existingByKey = new Map(
      existingRows.map((row) => [row.key, row.value]),
    );

    const updates: Array<{ key: string; value: unknown }> = [];

    for (const key of EDITABLE_SETTINGS) {
      if (!formData.has(key)) continue;

      const raw = String(formData.get(key) ?? "").trim();

      if (!existingByKey.has(key)) {
        throw new ValidationError(
          "Pengaturan " + key + " tidak dikenal.",
          key,
        );
      }

      updates.push({
        key,
        value: coerceSettingValue(key, raw, existingByKey.get(key)),
      });
    }

    if (updates.length === 0) {
      return { error: "Tidak ada pengaturan yang diubah." };
    }

    // Each key is its own statement so one malformed row cannot roll back the
    // rest of a legitimate multi-field edit.
    for (const update of updates) {
      await prisma.storeSetting.update({
        where: { key: update.key },
        data: { value: update.value as never },
      });
    }

    await audit({
      userId: user.id,
      action: "SETTINGS_UPDATE",
      entity: "StoreSetting",
      newData: Object.fromEntries(
        updates.map((update) => [update.key, update.value]),
      ),
    });

    revalidatePath("/settings");
    revalidatePath("/");
    revalidatePath("/pos");
    return {};
  } catch (error) {
    return fail(error);
  }
}

// ── Users ──────────────────────────────────────────────────────────────────

const userSchema = z.object({
  name: z.string().trim().min(2, "Nama minimal 2 karakter.").max(100),
  username: z
    .string()
    .trim()
    .min(3, "Username minimal 3 karakter.")
    .max(40)
    .regex(
      /^[a-z0-9._-]+$/,
      "Username hanya boleh huruf kecil, angka, titik, garis bawah, dan tanda hubung.",
    ),
  // `User.email` is required and unique, so an account always has a login
  // identity. This is also the address used by the staff list.
  email: z.string().trim().email("Email wajib diisi dan harus valid."),
  phone: z.string().trim().max(30).optional(),
  role: z.enum([
    "SUPER_ADMIN",
    "ADMIN",
    "MANAGER",
    "CASHIER",
    "STOCK_OPERATOR",
  ]),
  isActive: z.boolean(),
  password: z.string().min(8, "Password minimal 8 karakter.").optional(),
});

function readUser(formData: FormData) {
  return {
    id: String(formData.get("id") ?? ""),
    name: String(formData.get("name") ?? ""),
    username: String(formData.get("username") ?? "").trim().toLowerCase(),
    email: String(formData.get("email") ?? ""),
    phone: String(formData.get("phone") ?? ""),
    role: String(formData.get("role") ?? ""),
    isActive: formData.get("isActive") === "true",
    password: String(formData.get("password") ?? ""),
  };
}

/** Rejects a change that would remove the last usable administrator. */
async function assertNotLastAdmin(
  userId: string,
  next: { role: string; isActive: boolean },
): Promise<void> {
  if (next.role !== "SUPER_ADMIN" || !next.isActive) return;

  const current = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, isActive: true },
  });

  if (current?.role !== "SUPER_ADMIN") return;

  const remaining = await prisma.user.count({
    where: {
      role: "SUPER_ADMIN",
      isActive: true,
      NOT: { id: userId },
    },
  });

  if (remaining === 0) {
    throw new ValidationError(
      "Ini super admin aktif terakhir. Promosikan pengguna lain terlebih dahulu.",
      "role",
    );
  }
}

export async function createUserAction(formData: FormData): Promise<CrudResult> {
  const actor = await requirePermission("users:manage");

  const raw = readUser(formData);
  const parsed = userSchema.safeParse({ ...raw, password: raw.password || undefined });

  if (!parsed.success) return { fieldErrors: firstErrors(parsed.error) };

  const input = parsed.data;

  try {
    // New accounts get a real password. Creating an account with no usable
    // credential would lock the user out of their own role.
    const existing = await prisma.user.findFirst({
      where: { OR: [{ username: input.username }] },
      select: { id: true },
    });

    if (existing) {
      return { fieldErrors: { username: "Username sudah dipakai." } };
    }

    const { hashPassword } = await import("@/lib/auth/password");
    const passwordHash = await hashPassword(input.password!);

    const created = await prisma.user.create({
      data: {
        name: input.name,
        username: input.username,
        email: input.email,
        phone: input.phone || null,
        role: input.role as never,
        isActive: input.isActive,
        passwordHash,
      },
      select: { id: true },
    });

    await audit({
      userId: actor.id,
      action: "USER_CREATE",
      entity: "User",
      entityId: created.id,
      newData: { username: input.username, role: input.role },
    });

    revalidatePath("/users");
    return { id: created.id };
  } catch (error) {
    return fail(error);
  }
}

export async function updateUserAction(formData: FormData): Promise<CrudResult> {
  const actor = await requirePermission("users:manage");

  const raw = readUser(formData);
  if (!raw.id) return { error: "ID pengguna tidak valid." };

  const parsed = userSchema.safeParse({ ...raw, password: raw.password || undefined });

  if (!parsed.success) return { fieldErrors: firstErrors(parsed.error) };

  const input = parsed.data;

  try {
    const target = await prisma.user.findUnique({
      where: { id: raw.id },
      select: { id: true, role: true, isActive: true },
    });

    if (!target) return { error: "Pengguna tidak ditemukan." };

    // A super admin cannot edit themselves: it would let the last account
    // demote or disable itself and leave the app with no way back in.
    if (target.id === actor.id && target.role === "SUPER_ADMIN") {
      return {
        error: "Super admin tidak dapat mengubah akunnya sendiri.",
      };
    }

    await assertNotLastAdmin(raw.id, input);

    const conflict = await prisma.user.findFirst({
      where: { username: input.username, NOT: { id: raw.id } },
      select: { id: true },
    });

    if (conflict) {
      return { fieldErrors: { username: "Username sudah dipakai." } };
    }

    const data: Record<string, unknown> = {
      name: input.name,
      username: input.username,
      email: input.email,
      phone: input.phone || null,
      role: input.role,
      isActive: input.isActive,
    };

    // Changing a password invalidates existing sessions, otherwise a user whose
    // credentials were reset could still be operating on an old cookie.
    if (input.password) {
      const { hashPassword } = await import("@/lib/auth/password");
      data.passwordHash = await hashPassword(input.password);

      await prisma.session.deleteMany({ where: { userId: raw.id } });
    }

    // Deactivating must also end any live session, for the same reason.
    if (input.isActive === false && target.isActive) {
      await prisma.session.deleteMany({ where: { userId: raw.id } });
    }

    await prisma.user.update({ where: { id: raw.id }, data });

    await audit({
      userId: actor.id,
      action: "USER_UPDATE",
      entity: "User",
      entityId: raw.id,
      newData: {
        username: input.username,
        role: input.role,
        isActive: input.isActive,
        ...(input.password ? { passwordReset: true } : {}),
      },
    });

    revalidatePath("/users");
    return {};
  } catch (error) {
    return fail(error);
  }
}

/**
 * Deactivates a user instead of deleting them.
 *
 * Sales, shifts, and refunds all reference the cashier who made them; deleting
 * the row would either block on those constraints or break the audit trail.
 */
export async function deactivateUserAction(
  formData: FormData,
): Promise<CrudResult> {
  const actor = await requirePermission("users:manage");

  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "ID pengguna tidak valid." };

  try {
    if (id === actor.id) {
      return { error: "Anda tidak dapat menonaktifkan akun sendiri." };
    }

    const target = await prisma.user.findUnique({
      where: { id },
      select: { role: true },
    });

    if (!target) return { error: "Pengguna tidak ditemukan." };

    await assertNotLastAdmin(id, { role: target.role, isActive: false });

    await prisma.user.update({ where: { id }, data: { isActive: false } });
    await prisma.session.deleteMany({ where: { userId: id } });

    await audit({
      userId: actor.id,
      action: "USER_DELETE",
      entity: "User",
      entityId: id,
    });

    revalidatePath("/users");
    return {};
  } catch (error) {
    return fail(error);
  }
}