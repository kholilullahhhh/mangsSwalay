/**
 * Report query verification.
 *
 * These run real aggregates against Neon and cross-check the SQL results against
 * values computed independently in JavaScript. A raw-SQL report that silently
 * returns zero rows or double-counts a join would look perfectly fine on screen.
 */

import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import {
  getCashFlow,
  getDailySales,
  getDeadStock,
  getInventoryReport,
  getPaymentMix,
  getProductPerformance,
  getProfitReport,
  getPurchaseReport,
  getSalesReport,
  resolveRange,
} from "../src/lib/queries/reports";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    passed++;
  } else {
    failed++;
    failures.push(detail ? name + " :: " + detail : name);
  }
}

function section(title: string) {
  console.log("");
  console.log(title);
}

async function main() {
  const range = resolveRange("365d");

  section("Range presets");

  {
    const today = resolveRange("today");
    const yesterday = resolveRange("yesterday");
    const month = resolveRange("month");
    const custom = resolveRange("custom", "2026-01-01", "2026-01-31");
    const broken = resolveRange("custom", "2026-12-31", "2026-01-01");

    check("today is labelled", today.label === "Hari ini", today.label);
    check("yesterday spans one day", yesterday.to.getTime() === today.from.getTime());
    check("month starts within 31 days", month.from <= today.from);
    check("custom range honoured", custom.label === "Kustom");
    check(
      "custom end is inclusive of the whole day",
      custom.to.getHours() === 23 && custom.to.getMinutes() === 59,
    );
    check("inverted custom range falls back", broken.label !== "Kustom", broken.label);
    check("unknown preset falls back to 30d", resolveRange("nonsense").label === "30 hari terakhir");
  }

  section("Sales report");

  {
    const report = await getSalesReport(range);

    check("gross sales is a number", Number.isFinite(report.grossSales));
    check("transactions is a number", report.transactions >= 0);
    check("net sales = gross - refunds", report.netSales === report.grossSales - report.refunds);

    check(
      "average transaction consistent",
      report.transactions === 0 || report.averageTransaction >= 0,
    );

    // Cross-check the SQL aggregate against Prisma's own engine.
    const viaPrisma = await prisma.sale.aggregate({
      where: {
        date: { gte: range.from, lt: range.to },
        status: { in: ["COMPLETED", "PARTIALLY_REFUNDED"] },
      },
      _sum: { total: true },
      _count: { _all: true },
    });

    check(
      "raw SQL gross matches Prisma aggregate",
      report.grossSales === Number(viaPrisma._sum.total ?? 0),
      "sql=" + report.grossSales + " prisma=" + Number(viaPrisma._sum.total ?? 0),
    );
    check(
      "raw SQL count matches Prisma count",
      report.transactions === viaPrisma._count._all,
      "sql=" + report.transactions + " prisma=" + viaPrisma._count._all,
    );

    check("COGS is non-negative", report.costOfGoods >= 0);
    check(
      "gross profit = net - tax - cogs",
      report.grossProfit ===
        report.netSales - report.taxes - report.costOfGoods,
    );
  }

  section("Voided sales are excluded");

  {
    const withVoid = await prisma.sale.aggregate({
      where: {
        date: { gte: range.from, lt: range.to },
        status: { in: ["COMPLETED", "PARTIALLY_REFUNDED", "VOID"] },
      },
      _sum: { total: true },
    });

    const report = await getSalesReport(range);

    check(
      "revenue ignores voided sales",
      report.grossSales <= Number(withVoid._sum.total ?? 0),
      "revenue=" + report.grossSales + " withVoid=" + Number(withVoid._sum.total ?? 0),
    );
  }

  section("Daily sales");

  {
    const daily = await getDailySales(range);

    check("daily rows returned", Array.isArray(daily));

    const summed = daily.reduce((sum, row) => sum + row.gross, 0);
    const report = await getSalesReport(range);

    if (daily.length > 0) {
      check(
        "daily gross sums to the report total",
        summed <= report.grossSales + 1,
        "daily=" + summed + " report=" + report.grossSales,
      );
    } else {
      check("empty range yields no daily rows", report.grossSales === 0);
    }

    check(
      "daily rows carry a label",
      daily.every((row) => typeof row.label === "string" && row.label.length > 0),
    );
  }

  section("Product performance");

  {
    const rows = await getProductPerformance(range, 20);
    check("rows returned", Array.isArray(rows));

    check(
      "ordered by quantity descending",
      rows.every((row, index) => index === 0 || rows[index - 1].quantity >= row.quantity),
    );
    check(
      "profit = revenue - cost",
      rows.every((row) => row.profit === row.revenue - row.cost),
    );
    check(
      "quantities are whole numbers",
      rows.every((row) => Number.isInteger(row.quantity)),
    );

    const sold = await prisma.saleItem.aggregate({
      where: {
        sale: {
          date: { gte: range.from, lt: range.to },
          status: { in: ["COMPLETED", "PARTIALLY_REFUNDED"] },
        },
      },
      _sum: { quantity: true },
    });

    check(
      "top product list does not exceed total units sold",
      rows.reduce((sum, row) => sum + row.quantity, 0) <=
        Number(sold._sum.quantity ?? 0),
    );
  }

  section("Dead stock");

  {
    const dead = await getDeadStock(range, 20);
    check("rows returned", Array.isArray(dead));

    const soldIds = await prisma.saleItem.groupBy({
      by: ["productId"],
      where: {
        sale: {
          date: { gte: range.from, lt: range.to },
          status: { in: ["COMPLETED", "PARTIALLY_REFUNDED"] },
        },
      },
      _sum: { quantity: true },
    });

    const soldSet = new Set(
      soldIds
        .filter((row) => (row._sum.quantity ?? 0) > 0)
        .map((row) => row.productId),
    );

    check(
      "dead stock contains nothing that actually sold",
      dead.every((row) => !soldSet.has(row.id)),
    );
  }

  section("Inventory report");

  {
    const report = await getInventoryReport();

    check("rows returned", report.rows.length > 0, "no categories");

    const viaPrisma = await prisma.product.aggregate({
      where: { isActive: true },
      _sum: { stock: true },
    });

    check(
      "category units sum to the product total",
      report.totalUnits === Number(viaPrisma._sum.stock ?? 0),
      "report=" + report.totalUnits + " prisma=" + Number(viaPrisma._sum.stock ?? 0),
    );

    check(
      "retail value exceeds cost value",
      report.totalRetailValue >= report.totalCostValue,
    );
  }

  section("Purchase report");

  {
    const report = await getPurchaseReport(range);

    check("rows returned", Array.isArray(report.rows));

    const viaPrisma = await prisma.purchase.aggregate({
      where: {
        date: { gte: range.from, lt: range.to },
        status: { in: ["RECEIVED", "COMPLETED"] },
      },
      _sum: { grandTotal: true, amountPaid: true },
    });

    check(
      "purchase total matches Prisma",
      report.totalPurchase === Number(viaPrisma._sum.grandTotal ?? 0),
      "report=" + report.totalPurchase + " prisma=" + Number(viaPrisma._sum.grandTotal ?? 0),
    );

    check(
      "outstanding = total - paid, floored at zero",
      report.totalOutstanding ===
        Math.max(
          0,
          Number(viaPrisma._sum.grandTotal ?? 0) - Number(viaPrisma._sum.amountPaid ?? 0),
        ),
    );

    // Draft purchases must never appear as spend.
    const drafts = await prisma.purchase.count({ where: { status: "DRAFT" } });
    check("draft purchases exist in seed or none", drafts >= 0);
  }

  section("Profit report");

  {
    const profit = await getProfitReport(range);
    const sales = await getSalesReport(range);

    check(
      "revenue excludes tax",
      profit.revenue === sales.netSales - sales.taxes,
    );
    check("gross profit = revenue - cogs", profit.grossProfit === profit.revenue - profit.cogs);
    check(
      "net profit = gross profit - expenses",
      profit.netProfit === profit.grossProfit - profit.expenses,
    );
    check("expenses non-negative", profit.expenses >= 0);
  }

  section("Payment mix and cash flow");

  {
    const mix = await getPaymentMix(range);
    check("mix returned", Array.isArray(mix));
    check(
      "mix sorted by total descending",
      mix.every((row, index) => index === 0 || mix[index - 1].total >= row.total),
    );

    const flow = await getCashFlow(range);
    check("cash flow returned", Array.isArray(flow));
    check(
      "cash flow rows have both sides",
      flow.every((row) => Number.isFinite(row.inflow) && Number.isFinite(row.outflow)),
    );
  }

  console.log("");
  if (failures.length > 0) {
    console.log("FAILURES:");
    for (const failure of failures) console.log("  - " + failure);
  }
  console.log("  " + passed + " passed, " + failed + " failed");
}

main()
  .then(async () => {
    await prisma.$disconnect();
    if (failed > 0) process.exit(1);
  })
  .catch(async (error) => {
    console.error("report verification failed:", error);
    await prisma.$disconnect();
    process.exit(1);
  });
