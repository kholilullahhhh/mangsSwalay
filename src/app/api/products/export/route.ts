import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/session";
import { toErrorResponse } from "@/lib/error";
import { formatCurrency } from "@/lib/format";
import { buildProductWhere } from "@/lib/queries/products";

/**
 * GET /api/products/export
 *
 * Streams the product list as CSV, honouring the same filters as the on-screen
 * table so an export matches what the user is looking at.
 *
 * Exported rows are streamed with a hard cap: a full catalogue is legitimate for
 * a small minimarket, but an unbounded export on a serverless function would run
 * past the execution timeout. The cap is surfaced in a header so the caller
 * knows if the file was truncated.
 */

const MAX_EXPORT_ROWS = 10_000;

export async function GET(request: Request): Promise<NextResponse> {
  try {
    await requirePermission("products:export");

    const url = new URL(request.url);
    const params = url.searchParams;

    const stockParam = params.get("stock");
    const stock =
      stockParam === "low" || stockParam === "out" || stockParam === "in"
        ? stockParam
        : undefined;

    const activeParam = params.get("isActive");

    const where = buildProductWhere({
      search: params.get("search") ?? undefined,
      categoryId: params.get("categoryId") ?? undefined,
      brandId: params.get("brandId") ?? undefined,
      stock,
      isActive:
        activeParam === "false"
          ? "false"
          : activeParam === "all"
            ? "all"
            : undefined,
    });

    const products = await prisma.product.findMany({
      where,
      take: MAX_EXPORT_ROWS + 1,
      orderBy: { name: "asc" },
      select: {
        sku: true,
        barcode: true,
        name: true,
        category: { select: { name: true } },
        brand: { select: { name: true } },
        unit: true,
        purchasePrice: true,
        sellingPrice: true,
        stock: true,
        minStock: true,
        isActive: true,
        isFeatured: true,
      },
    });

    const truncated = products.length > MAX_EXPORT_ROWS;
    const rows = truncated ? products.slice(0, MAX_EXPORT_ROWS) : products;

    const header = [
      "SKU",
      "Barcode",
      "Nama",
      "Kategori",
      "Merek",
      "Satuan",
      "Harga Beli",
      "Harga Jual",
      "Stok",
      "Stok Minimum",
      "Aktif",
      "Unggulan",
    ];

    const lines = [
      header.join(","),
      ...rows.map((product) =>
        [
          product.sku,
          product.barcode ?? "",
          product.name,
          product.category.name,
          product.brand?.name ?? "",
          product.unit,
          formatCurrency(product.purchasePrice).replace(/[^\d]/g, ""),
          formatCurrency(product.sellingPrice).replace(/[^\d]/g, ""),
          String(product.stock),
          String(product.minStock),
          product.isActive ? "Ya" : "Tidak",
          product.isFeatured ? "Ya" : "Tidak",
        ]
          // Quote every field and escape embedded quotes so commas and
          // newlines inside product names cannot corrupt the file.
          .map((value) => `"${value.replace(/"/g, '""')}"`)
          .join(","),
      ),
    ];

    // BOM so Excel detects UTF-8 and renders Indonesian characters correctly.
    const csv = `﻿${lines.join("\r\n")}`;

    const stamp = new Date().toISOString().slice(0, 10);

    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="produk-${stamp}.csv"`,
        "X-Row-Count": String(rows.length),
        ...(truncated ? { "X-Truncated": "true" } : {}),
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}