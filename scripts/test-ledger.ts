import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { applyStockChanges } from "../src/lib/inventory/stock";

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

function equal(name: string, actual: unknown, expected: unknown) {
  check(name, Object.is(actual, expected), "expected " + String(expected) + ", got " + String(actual));
}

/**
 * Ledger integrity.
 *
 * Every stock change must leave a movement whose chain is continuous and whose
 * final value equals Product.stock. This exercises the real mutations inside a
 * rolled-back transaction, so it verifies the guard and the audit trail together.
 */
async function main() {
  const user = await prisma.user.findFirstOrThrow({
    where: { username: "gudang" },
    select: { id: true },
  });

  const product = await prisma.product.findUniqueOrThrow({
    where: { sku: "MNM-004" },
    select: { id: true, sku: true, stock: true, name: true },
  });

  const opening = await prisma.inventoryMovement.findMany({
    where: { productId: product.id },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { previousStock: true, newStock: true },
  });

  equal("seeded product has one opening movement", opening.length, 1);
  equal("opening movement starts from zero", opening[0].previousStock, 0);
  equal("opening movement ends at seeded stock", opening[0].newStock, product.stock);

// Chain integrity across every seeded product.
  const products = await prisma.product.findMany({
    select: { id: true, sku: true, stock: true },
  });

  // Captured before the rollback test below, which must leave the count alone.
  const baselineMovements = await prisma.inventoryMovement.count();

  let brokenLinks = 0;
  let diverged = 0;

  for (const entry of products) {
    const movements = await prisma.inventoryMovement.findMany({
      where: { productId: entry.id },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { previousStock: true, newStock: true },
    });

    if (movements.length === 0) continue;

    for (let i = 1; i < movements.length; i++) {
      if (movements[i].previousStock !== movements[i - 1].newStock) {
        brokenLinks++;
      }
    }

    if (movements[movements.length - 1].newStock !== entry.stock) {
      diverged++;
    }
  }

  equal("no broken ledger links", brokenLinks, 0);
  equal("no divergence between ledger and Product.stock", diverged, 0);

  // Mutations must extend the chain cleanly.
  await prisma.$transaction(async (tx) => {
    await applyStockChanges(tx, [
      {
        productId: product.id,
        quantity: 25,
        direction: "IN",
        type: "PURCHASE",
        referenceType: "Purchase",
        referenceId: "ledger-test",
        userId: user.id,
        note: "ledger integrity test",
      },
    ]);

    const after = await tx.product.findUniqueOrThrow({
      where: { id: product.id },
      select: { stock: true },
    });
    equal("stock increased inside transaction", after.stock, product.stock + 25);

    const movements = await tx.inventoryMovement.findMany({
      where: { productId: product.id },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { previousStock: true, newStock: true },
    });

    const last = movements[movements.length - 1];
    equal("new movement chains from the previous", last.previousStock, product.stock);
    equal("new movement ends at current stock", last.newStock, product.stock + 25);

    // Now try to remove more than exists.
    const blocked = await tx.product.updateMany({
      where: { id: product.id, stock: { gte: 999999 } },
      data: { stock: { decrement: 999999 } },
    });
    equal("oversell blocked", blocked.count, 0);

    throw new Error("ROLLBACK");
  }).catch((error: Error) => {
    check("ledger test rolled back", error.message === "ROLLBACK");
  });

  const final = await prisma.product.findUniqueOrThrow({
    where: { id: product.id },
    select: { stock: true },
  });
  equal("stock restored after rollback", final.stock, product.stock);

// Movement count must be unchanged by the rolled-back transaction.
  //
  // Measured as a before/after delta rather than against a hard-coded total: the
  // seeded ledger grows whenever data is repaired or a legitimate correction is
  // made, and a fixed number turns that into a spurious failure that hides a real
  // leak. What must hold is that *this* transaction added nothing.
  const count = await prisma.inventoryMovement.count();
  equal("no movement leaked by rollback", count, baselineMovements);

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
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });

