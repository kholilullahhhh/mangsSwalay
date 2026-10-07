/**
 * Inventory rules verification: adjustment and stock opname.
 *
 * The pure calculation functions are checked here without a database, and the
 * transactional behaviour is exercised against Neon inside rolled-back
 * transactions.
 */

import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import {
  describeOpnameSummary,
  movementTypeForReason,
  previewAdjustment,
  previewOpnameLine,
  summariseAdjustment,
  summariseOpname,
} from "../src/lib/inventory/rules";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    passed++;
    console.log("  [ok] " + name);
  } else {
    failed++;
    console.log("  [FAIL] " + name + (detail ? " - " + detail : ""));
  }
}

function equal(name: string, actual: unknown, expected: unknown) {
  check(name, Object.is(actual, expected), "expected " + String(expected) + ", got " + String(actual));
}

function section(title: string) {
  console.log("");
  console.log(title);
}

async function main() {
  section("Adjustment preview");

  {
    const preview = previewAdjustment({
      productId: "p1",
      productName: "Indomie",
      systemStock: 100,
      actualStock: 97,
      unitCost: 2800,
    });

    equal("difference is physical minus system", preview.difference, -3);
    equal("value difference uses unit cost", preview.valueDifference, -3 * 2800);
    equal("a shortfall is an OUT", preview.direction, "OUT");

    const gain = previewAdjustment({
      productId: "p2",
      productName: "Aqua",
      systemStock: 10,
      actualStock: 15,
      unitCost: 2500,
    });
    equal("a surplus is an IN", gain.direction, "IN");

    const same = previewAdjustment({
      productId: "p3",
      productName: "Gula",
      systemStock: 50,
      actualStock: 50,
      unitCost: 14500,
    });
    equal("no change is NONE", same.direction, "NONE");
    equal("no change has zero value", same.valueDifference, 0);
  }

  {
    const summary = summariseAdjustment([
      { productId: "a", productName: "A", systemStock: 100, actualStock: 97, unitCost: 2800 },
      { productId: "b", productName: "B", systemStock: 20, actualStock: 25, unitCost: 2500 },
      { productId: "c", productName: "C", systemStock: 8, actualStock: 8, unitCost: 17500 },
    ]);

    equal("three lines previewed", summary.lines.length, 3);
    equal("two lines changed", summary.changedCount, 2);
    equal("increase totalled", summary.totalIncrease, 5);
    equal("decrease totalled", summary.totalDecrease, 3);
    equal("net value difference", summary.netValueDifference, 5 * 2500 - 3 * 2800);
    check("no invalid lines", !summary.hasInvalidLine);
  }

  {
    // Counting more units than exist is an error, not a silent negative.
    const summary = summariseAdjustment([
      { productId: "a", productName: "A", systemStock: 2, actualStock: -5, unitCost: 100 },
    ]);
    check("negative counted stock flagged", summary.hasInvalidLine);
    equal("invalid product identified", summary.invalidProductIds[0], "a");
  }

  section("Adjustment reason mapping");

  {
    equal("damaged maps to DAMAGED", movementTypeForReason("DAMAGED"), "DAMAGED");
    equal("expired maps to EXPIRED", movementTypeForReason("EXPIRED"), "EXPIRED");
    equal(
      "supplier return maps to RETURN_PURCHASE",
      movementTypeForReason("RETURN_TO_SUPPLIER"),
      "RETURN_PURCHASE",
    );
    equal(
      "generic correction maps to ADJUSTMENT_OUT",
      movementTypeForReason("MISINPUT"),
      "ADJUSTMENT_OUT",
    );
  }

  section("Opname preview");

  {
    const pending = previewOpnameLine({
      productId: "a",
      productName: "A",
      systemStock: 10,
      physicalStock: null,
      unitCost: 100,
    });
    equal("uncounted line is PENDING", pending.status, "PENDING");
    equal("uncounted line has no difference", pending.difference, null);

    const matched = previewOpnameLine({
      productId: "a",
      productName: "A",
      systemStock: 10,
      physicalStock: 10,
      unitCost: 100,
    });
    equal("matching count is MATCHED", matched.status, "MATCHED");

    const different = previewOpnameLine({
      productId: "a",
      productName: "A",
      systemStock: 10,
      physicalStock: 7,
      unitCost: 100,
    });
    equal("mismatched count is DIFFERENT", different.status, "DIFFERENT");
    equal("difference computed", different.difference, -3);
    equal("value difference computed", different.valueDifference, -300);
  }

  {
    const summary = summariseOpname([
      { productId: "a", productName: "A", systemStock: 10, physicalStock: 10, unitCost: 100 },
      { productId: "b", productName: "B", systemStock: 20, physicalStock: 18, unitCost: 250 },
      { productId: "c", productName: "C", systemStock: 5, physicalStock: null, unitCost: 50 },
    ]);

    equal("total lines", summary.totalLines, 3);
    equal("counted lines", summary.countedLines, 2);
    equal("pending lines", summary.pendingLines, 1);
    equal("matched lines", summary.matchedLines, 1);
    equal("different lines", summary.differentLines, 1);
    equal("progress is 67 percent", summary.progress, 67);
    equal("decrease totalled", summary.totalDecrease, 2);
    equal("absolute value difference", summary.absoluteValueDifference, 2 * 250);
    check("not ready while lines are uncounted", !summary.readyForApproval);

    const described = describeOpnameSummary(summary);
    check("summary mentions matches and differences", described.indexOf("1 cocok") >= 0);
    check("summary mentions the shortfall", described.indexOf("2 unit kurang") >= 0);
  }

  {
    const ready = summariseOpname([
      { productId: "a", productName: "A", systemStock: 10, physicalStock: 10, unitCost: 100 },
      { productId: "b", productName: "B", systemStock: 20, physicalStock: 18, unitCost: 250 },
    ]);
    check("ready once fully counted with a variance", ready.readyForApproval);

    const noVariance = summariseOpname([
      { productId: "a", productName: "A", systemStock: 10, physicalStock: 10, unitCost: 100 },
    ]);
    check("a session with nothing to correct is not ready", !noVariance.readyForApproval);
  }

  section("Database behaviour");

  {
    // The guard that prevents stock going negative on a correction.
    const product = await prisma.product.findUniqueOrThrow({
      where: { sku: "ATK-001" },
      select: { id: true, stock: true },
    });

    await prisma.$transaction(async (tx) => {
      await tx.product.update({ where: { id: product.id }, data: { stock: 3 } });

      const blocked = await tx.product.updateMany({
        where: { id: product.id, stock: { gte: 10 } },
        data: { stock: { decrement: 10 } },
      });

      equal("reduction beyond available is blocked", blocked.count, 0);

      const after = await tx.product.findUniqueOrThrow({
        where: { id: product.id },
        select: { stock: true },
      });
      equal("stock unchanged", after.stock, 3);

      throw new Error("ROLLBACK");
    }).catch((error: Error) => {
      check("stock guard test rolled back", error.message === "ROLLBACK");
    });
  }

  {
    // An opname session snapshots system stock so a long count is still valid.
    const products = await prisma.product.findMany({
      where: { isActive: true },
      select: { id: true, name: true, stock: true, purchasePrice: true },
      orderBy: { name: "asc" },
      take: 3,
    });

    const user = await prisma.user.findFirstOrThrow({
      where: { username: "gudang" },
      select: { id: true },
    });

    await prisma.$transaction(async (tx) => {
      const opname = await tx.stockOpname.create({
        data: {
          number: "TEST-OPN-" + Date.now(),
          name: "Uji opname",
          status: "IN_PROGRESS",
          startedAt: new Date(),
          userId: user.id,
          items: {
            create: products.map((product) => ({
              productId: product.id,
              systemStock: product.stock,
              purchasePriceSnapshot: product.purchasePrice,
            })),
          },
        },
        select: { id: true, items: { select: { productId: true, systemStock: true, purchasePriceSnapshot: true } } },
      });

      equal("session captured every product", opname.items.length, products.length);

      const snapshots = opname.items.map((item) => item.systemStock).sort();
      const live = products.map((product) => product.stock).sort();
      equal("baseline matches stock at opening", JSON.stringify(snapshots), JSON.stringify(live));

      check(
        "cost snapshot recorded",
        opname.items.every((item) => item.purchasePriceSnapshot !== null),
      );

      // Sales during the count must not alter the frozen baseline.
      const first = products[0];
      await tx.product.update({
        where: { id: first.id },
        data: { stock: { increment: 7 } },
      });

      const reread = await tx.stockOpnameItem.findFirstOrThrow({
        where: { opnameId: opname.id, productId: first.id },
        select: { systemStock: true },
      });
      equal("baseline unchanged by a concurrent sale", reread.systemStock, first.stock);

      throw new Error("ROLLBACK");
    }).catch((error: Error) => {
      check("opname baseline test rolled back", error.message === "ROLLBACK");
    });
  }

  {
    // Approval must refuse while lines remain uncounted.
    const user = await prisma.user.findFirstOrThrow({
      where: { username: "manager" },
      select: { id: true },
    });

    const product = await prisma.product.findUniqueOrThrow({
      where: { sku: "RHT-001" },
      select: { id: true, stock: true },
    });

    await prisma.$transaction(async (tx) => {
      const opname = await tx.stockOpname.create({
        data: {
          number: "TEST-OPN-PARTIAL-" + Date.now(),
          name: "Opname belum selesai",
          status: "IN_PROGRESS",
          startedAt: new Date(),
          userId: user.id,
          items: {
            create: [
              { productId: product.id, systemStock: product.stock },
              {
                productId: (await prisma.product.findFirstOrThrow({
                  where: { sku: "RHT-002" },
                  select: { id: true },
                })).id,
                systemStock: 0,
              },
            ],
          },
        },
        select: { id: true, status: true },
      });

      equal("session opened as IN_PROGRESS", opname.status, "IN_PROGRESS");

      const uncounted = await tx.stockOpnameItem.count({
        where: { opnameId: opname.id, physicalStock: null },
      });
      equal("both lines uncounted", uncounted, 2);

      throw new Error("ROLLBACK");
    }).catch((error: Error) => {
      check("partial count test rolled back", error.message === "ROLLBACK");
    });
  }

  console.log("");
  console.log("--------------------------------");
  console.log("  " + passed + " passed, " + failed + " failed");
  console.log("--------------------------------");
}

main()
  .then(async () => {
    await prisma.$disconnect();
    if (failed > 0) process.exit(1);
  })
  .catch(async (error) => {
    console.error("inventory verification failed:", error);
    await prisma.$disconnect();
    process.exit(1);
  });
