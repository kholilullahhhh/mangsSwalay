"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { toActionError } from "@/lib/error";
import { importProducts, parseProductCsv } from "@/lib/products/import";

/**
 * CSV import actions.
 *
 * Parse and import are separate calls on purpose. Parsing writes nothing, so the
 * user can see every problem with the file at once and fix them in a single pass;
 * the import only runs once the parse came back clean.
 */

/** Refuses anything that is not a plausible CSV file before reading it. */
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

export interface ImportRowError {
  line: number;
  field: string;
  message: string;
}

async function readCsv(formData: FormData): Promise<string> {
  const file = formData.get("file");

  if (!(file instanceof File)) {
    throw new Error("Berkas CSV belum dipilih.");
  }

  if (file.size === 0) {
    throw new Error("Berkas CSV kosong.");
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error(
      "Ukuran berkas melebihi 5 MB. Impor dalam bagian yang lebih kecil.",
    );
  }

  return file.text();
}

export async function parseImportAction(formData: FormData): Promise<{
  rows?: number;
  total?: number;
  errors?: ImportRowError[];
  error?: string;
}> {
  await requirePermission("products:create");

  try {
    const result = await parseProductCsv(await readCsv(formData));

    return {
      rows: result.rows.length,
      total: result.totalLines,
      errors: result.errors,
    };
  } catch (error) {
    return { error: toActionError(error).error };
  }
}

export async function importProductsAction(formData: FormData): Promise<{
  imported?: number;
  error?: string;
}> {
  const user = await requirePermission("products:create");

  try {
    // Parsed again rather than trusting the client: the previous step validated
    // a file the browser held, and nothing guarantees it is the same one now.
    const parsed = await parseProductCsv(await readCsv(formData));

    if (parsed.errors.length > 0) {
      return {
        error:
          "Berkas masih memiliki " +
          parsed.errors.length +
          " masalah. Perbaiki dan unggah ulang.",
      };
    }

    const result = await importProducts(parsed.rows);

    await audit({
      userId: user.id,
      action: "PRODUCT_IMPORT",
      entity: "Product",
      newData: {
        imported: result.imported,
        totalLines: parsed.totalLines,
      },
    });

    revalidatePath("/products");
    revalidatePath("/dashboard");
    revalidatePath("/categories");

    return { imported: result.imported };
  } catch (error) {
    return { error: toActionError(error).error };
  }
}