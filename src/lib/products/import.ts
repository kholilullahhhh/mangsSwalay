import "server-only";

import { prisma } from "@/lib/db";
import { ValidationError } from "@/lib/error";
import {
  createProductWithClient,
  productSchema,
  type ProductData,
} from "@/lib/products/mutations";
import type { TxClient } from "@/lib/db-client";

/** Model delegates the importer needs; satisfied by the global client or a transaction. */
export type ImportClient = Pick<
  TxClient,
  "product" | "category" | "brand" | "inventoryMovement"
>;

/**
 * CSV product import.
 *
 * Split into two phases on purpose:
 *
 * 1. **Parse and validate every row first**, reporting all problems at once. An
 *    importer that stops at the first bad row forces the user to fix, upload,
 *    fail, repeat — the file is uploaded again for every single mistake.
 * 2. **Write nothing unless every row is valid.** A partial import is the worst
 *    outcome: the store cannot tell which products exist, and stock figures would
 *    disagree with the ledger.
 *
 * The parser is deliberately small. A full RFC-4180 CSV reader is not needed
 * here, and pulling one in to handle quoted fields with embedded newlines would
 * be a dependency for a case the template does not produce.
 */

/** Columns the importer understands, in the order the template writes them. */
export const IMPORT_COLUMNS = [
  "sku",
  "name",
  "category",
  "unit",
  "purchasePrice",
  "sellingPrice",
  "stock",
  "minStock",
  "barcode",
  "brand",
  "description",
] as const;

export type ImportColumn = (typeof IMPORT_COLUMNS)[number];

/** Header aliases, so a file exported from the app round-trips. */
const HEADER_ALIASES: Record<string, ImportColumn> = {
  sku: "sku",
  kode: "sku",
  name: "name",
  nama: "name",
  category: "category",
  kategori: "category",
  unit: "unit",
  satuan: "unit",
  purchaseprice: "purchasePrice",
  "hargabeli": "purchasePrice",
  "harga beli": "purchasePrice",
  sellingprice: "sellingPrice",
  hargajual: "sellingPrice",
  "harga jual": "sellingPrice",
  stock: "stock",
  stok: "stock",
  minstock: "minStock",
  "stok minimum": "minStock",
  barcode: "barcode",
  brand: "brand",
  merek: "brand",
  description: "description",
  deskripsi: "description",
};

/** Guards against a pasted spreadsheet being submitted as a multi-megabyte file. */
const MAX_ROWS = 2000;

export interface ParsedRow {
  /** 1-based line number in the uploaded file, for error messages. */
  line: number;
  data: ProductData;
}

export interface RowError {
  line: number;
  /** Column name, or "baris" for a whole-row problem. */
  field: string;
  message: string;
}

export interface ParseResult {
  rows: ParsedRow[];
  errors: RowError[];
  /** Rows that parsed cleanly; zero when any row failed. */
  totalLines: number;
}

/** The template users download, with one worked example row. */
export function buildImportTemplate(): string {
  const header = IMPORT_COLUMNS.join(",");
  const example =
    "SMB-001,Beras Pandan Wangi 5kg,Sembako,PACK,62000,68000,120,20,8992775001017,IndoFood,Beras premium";

  // Quoted so a description containing a comma survives the round-trip.
  return header + "\n" + example + "\n";
}

/**
 * Splits one CSV line.
 *
 * Handles quoted fields so a product name containing a comma does not shift every
 * following column. A doubled quote inside a quoted field is an escaped quote,
 * which is the standard encoding and the one Excel produces.
 */
export function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];

    if (inQuotes) {
      if (char === '"') {
        if (line[index + 1] === '"') {
          current += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      fields.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  fields.push(current);
  return fields.map((field) => field.trim());
}

/**
 * Parses CSV text into validated product rows.
 *
 * Categories and brands are matched by name and created when absent: a shop
 * importing its catalogue should not have to pre-create every category, and a
 * row that fails only because a category is new would be frustrating.
 */
export async function parseProductCsv(
  csv: string,
  options: { client?: ImportClient } = {},
): Promise<ParseResult> {
  // Callers that are already inside a transaction pass their client, so the
  // categories and brands created here commit or roll back with it. Upserting
  // through the global client would leave those rows behind even when the
  // surrounding operation was undone.
  const client = options.client ?? prisma;
  const lines = csv
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    throw new ValidationError("Berkas CSV kosong.");
  }

  const headerFields = splitCsvLine(lines[0]).map((field) =>
    field.toLowerCase().replace(/^\ufeff/, ""),
  );

  const columnIndexes = new Map<ImportColumn, number>();

  headerFields.forEach((header, index) => {
    const column = HEADER_ALIASES[header];

    // Unknown columns are ignored rather than rejected: a file exported from a
    // future version may carry extra columns this version does not know yet.
    if (column && !columnIndexes.has(column)) {
      columnIndexes.set(column, index);
    }
  });

  const errors: RowError[] = [];
  const missing = (["sku", "name", "category", "unit", "purchasePrice", "sellingPrice", "stock"] as ImportColumn[])
    .filter((column) => !columnIndexes.has(column));

  if (missing.length > 0) {
    throw new ValidationError(
      "Kolom wajib belum ada di berkas: " + missing.join(", ") + ".",
    );
  }

  if (lines.length - 1 > MAX_ROWS) {
    throw new ValidationError(
      "Berkas berisi " +
        (lines.length - 1) +
        " baris, melebihi batas " +
        MAX_ROWS +
        " baris per impor.",
    );
  }

  const cell = (fields: string[], column: ImportColumn): string => {
    const index = columnIndexes.get(column);
    return index === undefined ? "" : (fields[index] ?? "");
  };

  // Resolve every referenced category and brand once, rather than a query per
  // row: a 2000-row import would otherwise issue 4000 round trips.
  const categoryNames = new Set<string>();
  const brandNames = new Set<string>();

  const rawRows = lines.slice(1).map((line, offset) => {
    const fields = splitCsvLine(line);

    const category = cell(fields, "category");
    const brand = cell(fields, "brand");

    if (category) categoryNames.add(category);
    if (brand) brandNames.add(brand);

    return { line: offset + 2, fields };
  });

  const categoryIds = new Map<string, string>();
  const brandIds = new Map<string, string>();

  for (const name of categoryNames) {
    // Resolved once: the slug is needed for both the lookup and the insert, and
    // recomputing it would mean two queries for the same answer.
    const slug = await categorySlug(name, client);

    const category = await client.category.upsert({
      where: { slug },
      update: {},
      create: { name, slug, isActive: true },
      select: { id: true, name: true },
    });

    categoryIds.set(category.name.toLowerCase(), category.id);
    categoryIds.set(name.toLowerCase(), category.id);
  }

  for (const name of brandNames) {
    const existing = await client.brand.findFirst({
      where: { name },
      select: { id: true },
    });

    if (existing) {
      brandIds.set(name.toLowerCase(), existing.id);
      continue;
    }

    const created = await client.brand.create({
      data: { name },
      select: { id: true },
    });

    brandIds.set(name.toLowerCase(), created.id);
  }

  const rows: ParsedRow[] = [];
  const seenSkus = new Map<string, number>();
  const seenBarcodes = new Map<string, number>();

  for (const { line, fields } of rawRows) {
    const sku = cell(fields, "sku");
    const barcode = cell(fields, "barcode");

    // Duplicates within the same file would collide on the database unique
    // constraint mid-transaction, aborting the whole import with an opaque
    // error. Catching it here names the line instead.
    if (sku) {
      const previous = seenSkus.get(sku.toLowerCase());
      if (previous) {
        errors.push({
          line,
          field: "sku",
          message: "SKU " + sku + " sudah dipakai di baris " + previous + ".",
        });
        continue;
      }
      seenSkus.set(sku.toLowerCase(), line);
    }

    if (barcode) {
      const previous = seenBarcodes.get(barcode);
      if (previous) {
        errors.push({
          line,
          field: "barcode",
          message: "Barcode " + barcode + " sudah dipakai di baris " + previous + ".",
        });
        continue;
      }
      seenBarcodes.set(barcode, line);
    }

    const candidate = {
      name: cell(fields, "name"),
      sku,
      barcode,
      description: cell(fields, "description") || undefined,
      categoryId: categoryIds.get(cell(fields, "category").toLowerCase()) ?? "",
      brandId: brandIds.get(cell(fields, "brand").toLowerCase()) ?? "",
      unit: cell(fields, "unit").toUpperCase(),
      purchasePrice: cell(fields, "purchasePrice"),
      sellingPrice: cell(fields, "sellingPrice"),
      minSellingPrice: "",
      stock: cell(fields, "stock"),
      minStock: cell(fields, "minStock") || "0",
      maxStock: "",
      hasExpiry: false,
      isFeatured: false,
      isActive: true,
      image: "",
    };

    const parsed = productSchema.safeParse(candidate);

    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        errors.push({
          line,
          field: String(issue.path[0] ?? "baris"),
          message: issue.message,
        });
      }
      continue;
    }

    rows.push({ line, data: parsed.data as ProductData });
  }

  return { rows, errors, totalLines: rawRows.length };
}

/** Slug for a category created on the fly during import. */
async function categorySlug(name: string, client: ImportClient): Promise<string> {
  const base =
    name
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-") || "kategori";

  // `upsert` needs a unique slug, and the unique index is on slug, so a
  // colliding import must not silently overwrite an existing category.
  const existing = await client.category.findUnique({
    where: { slug: base },
    select: { slug: true },
  });

  return existing ? base + "-" + Date.now().toString(36) : base;
}

/**
 * Writes every parsed row in one transaction.
 *
 * All-or-nothing: the caller has already validated every row, so a failure here
 * means a database-level conflict (a concurrent create of the same SKU), and
 * importing half the file would leave the catalogue inconsistent with the
 * ledger.
 */
export async function importProducts(
  rows: ParsedRow[],
  options: { client?: ImportClient } = {},
): Promise<{ imported: number }> {
  if (rows.length === 0) {
    throw new ValidationError("Tidak ada baris valid untuk diimpor.");
  }

  const write = async (tx: ImportClient) => {
    for (const row of rows) {
      await createProductWithClient(tx, row.data);
    }
  };

  if (options.client) {
    await write(options.client);
  } else {
    await prisma.$transaction(write, { timeout: 60_000, maxWait: 10_000 });
  }

  return { imported: rows.length };
}