import "server-only";

import { z } from "zod";

import { prisma } from "@/lib/db";
import { ValidationError } from "@/lib/error";
import type { TxClient } from "@/lib/db-client";

/** Model delegates product creation needs; the global client and a transaction both fit. */
export type ProductClient = Pick<
  TxClient,
  "product" | "inventoryMovement" | "category"
>;

/**
 * Product mutations.
 *
 * Server-side validation and duplication checks live here rather than in the
 * form, because the form is only a convenience — the Server Action is the
 * trust boundary and re-validates everything it receives.
 */

/** Normalises a form value into a trimmed string. */
const trimmed = z.string().trim();

/**
 * Barcode rules.
 *
 * Optional, but must be digits only and 8-14 characters when present: UPC-A is
 * 12, EAN-13 is 13, and internal codes are commonly shorter.
 */
const barcodeSchema = trimmed
  .regex(/^[0-9]{8,14}$/, "Barcode harus 8-14 digit angka.")
  .optional()
  .or(trimmed.length(0).transform(() => undefined))
  .or(z.literal("").transform(() => undefined));

/**
 * An optional number that may arrive from a form as an empty string.
 *
 * `z.coerce.number().optional()` looks like it handles "field left blank", but it
 * does not: coercion runs first and turns `""` into `0`, so the `.optional()`
 * never sees a missing value. That made `maxStock` come through as `0`, which
 * then failed the "maximum must exceed minimum" rule for every product with a
 * non-zero minimum stock — a form the user had filled in correctly was rejected.
 *
 * Mapping the empty string to `undefined` before coercion is what actually makes
 * the field optional.
 */
const optionalNumber = z.preprocess(
  (value) =>
    typeof value === "string" && value.trim() === "" ? undefined : value,
  z.coerce.number({ error: "Nilai harus berupa angka." }).min(0, "Nilai tidak boleh negatif.").optional(),
);

export const productSchema = z
  .object({
    name: trimmed
      .min(2, "Nama produk minimal 2 karakter.")
      .max(150, "Nama produk maksimal 150 karakter."),
    sku: trimmed
      .min(1, "SKU wajib diisi.")
      .max(50, "SKU maksimal 50 karakter.")
      .regex(/^[A-Za-z0-9._-]+$/, "SKU hanya boleh huruf, angka, titik, strip, dan underscore."),
    barcode: barcodeSchema,
    description: trimmed.max(2000, "Deskripsi terlalu panjang.").optional(),
    categoryId: trimmed.min(1, "Kategori wajib dipilih."),
    brandId: trimmed.optional(),
    unit: z.enum(
      ["PCS", "PACK", "BOX", "KG", "G", "L", "ML", "DOSE", "SACHET", "CAN", "BOTTLE", "ROLL", "TUBE"],
      { error: "Satuan tidak valid." },
    ),
    purchasePrice: z.coerce
      .number({ error: "Harga beli harus berupa angka." })
      .min(0, "Harga beli tidak boleh negatif.")
      .max(1_000_000_000, "Harga beli terlalu besar."),
    sellingPrice: z.coerce
      .number({ error: "Harga jual harus berupa angka." })
      .min(0, "Harga jual tidak boleh negatif.")
      .max(1_000_000_000, "Harga jual terlalu besar."),
    minSellingPrice: optionalNumber,
    stock: z.coerce
      .number({ error: "Stok harus berupa angka." })
      .int("Stok harus bilangan bulat.")
      .min(0, "Stok tidak boleh negatif."),
    minStock: z.coerce
      .number()
      .int("Stok minimum harus bilangan bulat.")
      .min(0, "Stok minimum tidak boleh negatif.")
      .default(0),
    maxStock: optionalNumber.refine(
      (value) => value === undefined || Number.isInteger(value),
      "Stok maksimum harus bilangan bulat.",
    ),
    hasExpiry: z.coerce.boolean().default(false),
    isFeatured: z.coerce.boolean().default(false),
    isActive: z.coerce.boolean().default(true),
    image: trimmed.optional().or(z.literal("").transform(() => undefined)),
  })
  .superRefine((data, ctx) => {
    // Selling below cost is legal (clearance) but must be a deliberate choice,
    // so it's flagged rather than blocked.
    if (data.sellingPrice > 0 && data.sellingPrice < data.purchasePrice) {
      ctx.addIssue({
        code: "custom",
        path: ["sellingPrice"],
        message:
          "Harga jual lebih rendah dari harga beli. Pastikan ini disengaja (promo/clearance).",
      });
    }

    if (data.maxStock !== undefined && data.maxStock < data.minStock) {
      ctx.addIssue({
        code: "custom",
        path: ["maxStock"],
        message: "Stok maksimum harus lebih besar dari stok minimum.",
      });
    }

    if (
      data.minSellingPrice !== undefined &&
      data.sellingPrice > 0 &&
      data.sellingPrice < data.minSellingPrice
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["sellingPrice"],
        message: "Harga jual di bawah harga minimum yang ditetapkan.",
      });
    }
  });

export type ProductInput = z.input<typeof productSchema>;
export type ProductData = z.output<typeof productSchema>;

function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 120);
}

/** Builds a slug that is unique among products, appending -2, -3, ... */
async function uniqueSlug(
  base: string,
  excludeId?: string,
  client: ProductClient = prisma,
): Promise<string> {
  const root = slugify(base) || "produk";

  let candidate = root;
  let suffix = 1;

  // Bounded loop: the catalogue cannot realistically hold 50 colliding slugs,
  // and the cap prevents an infinite loop if it somehow did.
  while (suffix < 50) {
    const existing = await client.product.findUnique({
      where: { slug: candidate },
      select: { id: true },
    });

    if (!existing || existing.id === excludeId) {
      return candidate;
    }

    suffix += 1;
    candidate = `${root}-${suffix}`;
  }

  return `${root}-${Date.now()}`;
}

/**
 * Rejects duplicate SKU / barcode before the write.
 *
 * Checked here for a clear message, and still guarded by the database unique
 * constraint underneath — two concurrent creates can both pass this check, and
 * the constraint is what actually guarantees uniqueness.
 */
async function assertUnique(
  data: { sku: string; barcode?: string },
  excludeId?: string,
  client: ProductClient = prisma,
): Promise<void> {
  const [skuConflict, barcodeConflict] = await Promise.all([
    client.product.findUnique({
      where: { sku: data.sku },
      select: { id: true, name: true },
    }),
    data.barcode
      ? client.product.findUnique({
          where: { barcode: data.barcode },
          select: { id: true, name: true },
        })
      : Promise.resolve(null),
  ]);

  if (skuConflict && skuConflict.id !== excludeId) {
    throw new ValidationError(
      `SKU "${data.sku}" sudah digunakan oleh produk "${skuConflict.name}".`,
      "sku",
    );
  }

  if (barcodeConflict && barcodeConflict.id !== excludeId) {
    throw new ValidationError(
      `Barcode ${data.barcode} sudah digunakan oleh produk "${barcodeConflict.name}".`,
      "barcode",
    );
  }
}

export async function createProduct(
  data: ProductData,
): Promise<{ id: string; slug: string }> {
  return createProductWithClient(prisma, data);
}

/**
 * Product creation against an explicit client.
 *
 * Exists so the CSV importer can create every row inside one transaction: a
 * bulk import that leaves 40 of 50 products behind after failing on row 41 is
 * worse than one that imports nothing, because the store has to work out which
 * half arrived. The single-product path just passes the default client.
 */
export async function createProductWithClient(
  client: ProductClient,
  data: ProductData,
): Promise<{ id: string; slug: string }> {
  await assertUnique(data, undefined, client);

  const slug = await uniqueSlug(data.name, undefined, client);

  const product = await client.product.create({
    data: {
      sku: data.sku,
      barcode: data.barcode ?? null,
      name: data.name,
      slug,
      description: data.description || null,
      image: data.image || null,
      categoryId: data.categoryId,
      brandId: data.brandId || null,
      unit: data.unit,
      purchasePrice: data.purchasePrice,
      sellingPrice: data.sellingPrice,
      minSellingPrice: data.minSellingPrice ?? null,
      stock: data.stock,
      minStock: data.minStock,
      maxStock: data.maxStock ?? null,
      hasExpiry: data.hasExpiry,
      isFeatured: data.isFeatured,
      isActive: data.isActive,
    },
    select: { id: true, slug: true },
  });

  // A product created with opening stock gets a ledger row, so the inventory
  // history explains where that stock came from rather than starting at a
  // mystery non-zero number.
  if (data.stock > 0) {
    await client.inventoryMovement.create({
      data: {
        productId: product.id,
        type: "ADJUSTMENT_IN",
        quantity: data.stock,
        previousStock: 0,
        newStock: data.stock,
        referenceType: "PRODUCT_CREATE",
        referenceId: product.id,
        note: "Stok awal saat produk dibuat",
      },
    });
  }

  return product;
}

export async function updateProduct(
  id: string,
  data: ProductData,
): Promise<{ id: string; slug: string }> {
  const existing = await prisma.product.findUnique({
    where: { id },
    select: { id: true, name: true, slug: true },
  });

  if (!existing) {
    throw new ValidationError("Produk tidak ditemukan.");
  }

  await assertUnique(data, id);

  // Only regenerate the slug when the name actually changed, so existing links
  // to the product stay valid across unrelated edits.
  const slug =
    data.name !== existing.name ? await uniqueSlug(data.name, id) : existing.slug;

  const product = await prisma.product.update({
    where: { id },
    data: {
      sku: data.sku,
      barcode: data.barcode ?? null,
      name: data.name,
      slug,
      description: data.description || null,
      image: data.image || null,
      categoryId: data.categoryId,
      brandId: data.brandId || null,
      unit: data.unit,
      purchasePrice: data.purchasePrice,
      sellingPrice: data.sellingPrice,
      minSellingPrice: data.minSellingPrice ?? null,
      // Stock is intentionally NOT updated here. Stock changes only through
      // purchases, sales, and adjustments — never through a form field — so
      // the ledger stays the single source of truth for stock movements.
      minStock: data.minStock,
      maxStock: data.maxStock ?? null,
      hasExpiry: data.hasExpiry,
      isFeatured: data.isFeatured,
      isActive: data.isActive,
    },
    select: { id: true, slug: true },
  });

  return product;
}

/**
 * Deactivates a product rather than deleting it.
 *
 * Products referenced by sales or purchases must remain queryable so historical
 * invoices keep rendering. Hard deletion is reserved for products with no
 * transaction history, which in practice means only ones just created by mistake.
 */
export async function deactivateProduct(id: string): Promise<void> {
  const usage = await prisma.saleItem.count({ where: { productId: id } });

  if (usage === 0) {
    const purchaseUsage = await prisma.purchaseItem.count({
      where: { productId: id },
    });

    if (purchaseUsage === 0) {
      await prisma.product.delete({ where: { id } });
      return;
    }
  }

  await prisma.product.update({
    where: { id },
    data: { isActive: false },
  });
}

export async function bulkUpdateProducts(
  ids: string[],
  action: "activate" | "deactivate",
): Promise<number> {
  const result = await prisma.product.updateMany({
    where: { id: { in: ids } },
    data: { isActive: action === "activate" },
  });

  return result.count;
}

/** Moves products into a category in one statement. */
export async function bulkSetCategory(
  ids: string[],
  categoryId: string,
): Promise<number> {
  const category = await prisma.category.findUnique({
    where: { id: categoryId },
    select: { id: true },
  });

  if (!category) {
    throw new ValidationError("Kategori tidak ditemukan.", "categoryId");
  }

  const result = await prisma.product.updateMany({
    where: { id: { in: ids } },
    data: { categoryId },
  });

  return result.count;
}

export { slugify };