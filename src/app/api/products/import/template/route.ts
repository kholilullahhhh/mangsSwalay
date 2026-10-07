import { NextResponse } from "next/server";

import { requirePermission } from "@/lib/auth/session";
import { toErrorResponse } from "@/lib/error";
import { buildImportTemplate } from "@/lib/products/import";

/**
 * GET /api/products/import/template
 *
 * Serves the CSV template with the exact column headers the importer expects, so
 * the file always matches the parser. Hardcoding the header list in the UI would
 * drift from the parser the first time a column is added.
 */
export async function GET(): Promise<NextResponse> {
  try {
    await requirePermission("products:create");

    // The BOM makes Excel open the file as UTF-8 instead of the local ANSI
    // codepage, which would mangle Indonesian characters in product names.
    const body = "﻿" + buildImportTemplate();

    return new NextResponse(body, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition":
          'attachment; filename="template-impor-produk.csv"',
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}