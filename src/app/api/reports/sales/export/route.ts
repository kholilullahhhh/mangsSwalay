import { type NextRequest, NextResponse } from "next/server";

import { requirePermission } from "@/lib/auth/session";
import { toErrorResponse } from "@/lib/error";
import { getSalesReport, resolveRange } from "@/lib/queries/reports";
import { formatDate } from "@/lib/format";
import { csvCell } from "@/lib/csv";

/**
 * CSV export of the sales report.
 *
 * The screen offers "Export CSV" next to the numbers it renders, so the download
 * has to be the same figures over the same period — recomputed here from the same
 * query, not re-typed from the page.
 *
 * Authorisation is the route's own concern: a Route Handler is a public HTTP
 * endpoint and the page's permission check protects nothing here.
 */

/** Refuses to stream more than this many sales into one file. */
const MAX_ROWS = 20_000;

export async function GET(request: NextRequest) {
  try {
    await requirePermission("reports:sales");

    const { prisma } = await import("@/lib/db");

    const params = request.nextUrl.searchParams;
    const preset = params.get("range") ?? "30d";
    const range = resolveRange(
      preset,
      params.get("from") ?? undefined,
      params.get("to") ?? undefined,
    );

    const sales = await prisma.sale.findMany({
      where: {
        date: { gte: range.from, lt: range.to },
        status: { in: ["COMPLETED", "PARTIALLY_REFUNDED"] },
      },
      orderBy: { date: "asc" },
      take: MAX_ROWS + 1,
      select: {
        invoiceNumber: true,
        date: true,
        status: true,
        paymentMethod: true,
        subtotal: true,
        discount: true,
        tax: true,
        total: true,
        customer: { select: { name: true } },
        user: { select: { name: true } },
        items: { select: { quantity: true } },
      },
    });

    const truncated = sales.length > MAX_ROWS;
    const rows = truncated ? sales.slice(0, MAX_ROWS) : sales;

    const header = [
      "No Invoice",
      "Tanggal",
      "Kasir",
      "Pelanggan",
      "Metode Bayar",
      "Status",
      "Subtotal",
      "Diskon",
      "Pajak",
      "Total",
      "Jumlah Item",
    ];

    const body = rows.map((sale) =>
      [
        sale.invoiceNumber,
        formatDate(sale.date),
        sale.user.name,
        sale.customer?.name ?? "",
        sale.paymentMethod,
        sale.status,
        Number(sale.subtotal),
        Number(sale.discount),
        Number(sale.tax),
        Number(sale.total),
        sale.items.reduce((sum, item) => sum + item.quantity, 0),
      ]
        // Quoted so a comma in a name cannot shift the columns, and
        // formula-safe so a customer or cashier name cannot execute in the
        // reader's spreadsheet — that is a cross-role escalation path here,
        // since a cashier who may create a customer is not the person who opens
        // the export.
        .map(csvCell)
        .join(","),
    );

    const report = await getSalesReport(range);
    const summary = [
      "",
      "Ringkasan",
      "Periode",
      range.label,
      "",
      "Omzet kotor",
      report.grossSales,
      "Retur",
      report.refunds,
      "Pajak",
      report.taxes,
      "Omzet bersih",
      report.netSales,
      "Transaksi",
      report.transactions,
    ];

    // BOM so Excel opens UTF-8 without mangling the Indonesian copy.
    const csv = "﻿" + [...header, ...body, ...summary].join("\r\n");

    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="laporan-penjualan-${range.label.replace(/[^\w-]+/g, "-")}.csv"`,
        "X-Row-Count": String(rows.length),
        ...(truncated ? { "X-Truncated": "true" } : {}),
      },
    });
  } catch (error) {
    return NextResponse.json(toErrorResponse(error).body, {
      status: toErrorResponse(error).status,
    });
  }
}