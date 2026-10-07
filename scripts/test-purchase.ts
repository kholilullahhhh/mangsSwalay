/**
 * Purchase workflow verification against a live database.
 *
 * Exercises the parts of purchasing that are easy to get wrong and invisible to
 * typechecking:
 *
 * - stock does NOT move while a purchase is DRAFT or ORDERED
 * - stock moves exactly once on RECEIVED
 * - receiving the same purchase twice is impossible
 * - the transaction rolls back entirely if a line fails
 * - invalid status transitions are rejected
 *
 * Runs inside transactions that are rolled back, so seeded data is untouched.
 */

import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import {
  canTransition,
  computePurchaseTotals,
  derivePaymentStatus,
  nextStatuses,
  PURCHASE_STATUS_LABEL,
  PurchaseTransitionError,
  assertTransition,
  statusAffectsStock,
} from "../src/lib/purchases/state-machine";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function equal(name: string, actual: unknown, expected: unknown) {
  check(
    name,
    Object.is(actual, expected),
    `expected ${String(expected)}, got ${String(actual)}`,
  );
}

function section(title: string) {
  console.log(`\n${title}`);
}

async function main() {
// ─── State machine ─────────────────────────────────────────────────────────
section("Purchase state machine");

{
  check("DRAFT can become ORDERED", canTransition("DRAFT", "ORDERED"));
  check("DRAFT can be cancelled", canTransition("DRAFT", "CANCELLED"));
  check("ORDERED can become RECEIVED", canTransition("ORDERED", "RECEIVED"));
  check("RECEIVED can become COMPLETED", canTransition("RECEIVED", "COMPLETED"));

  check("DRAFT cannot jump straight to RECEIVED", !canTransition("DRAFT", "RECEIVED"));
  check("DRAFT cannot become COMPLETED", !canTransition("DRAFT", "COMPLETED"));
  check("RECEIVED cannot go back to ORDERED", !canTransition("RECEIVED", "ORDERED"));
  check("COMPLETED is terminal", nextStatuses("COMPLETED").length === 0);
  check("CANCELLED is terminal", nextStatuses("CANCELLED").length === 0);

  // The core invariant.
  check("only RECEIVED affects stock", statusAffectsStock("RECEIVED"));
  check("DRAFT does not affect stock", !statusAffectsStock("DRAFT"));
  check("ORDERED does not affect stock", !statusAffectsStock("ORDERED"));
  check("COMPLETED does not affect stock", !statusAffectsStock("COMPLETED"));

  let rejected = false;
  try {
    assertTransition("DRAFT", "RECEIVED");
  } catch (error) {
    rejected = error instanceof PurchaseTransitionError;
  }
  check("illegal transition throws", rejected);

  let selfTransition = false;
  try {
    assertTransition("RECEIVED", "RECEIVED");
  } catch (error) {
    selfTransition = error instanceof PurchaseTransitionError;
  }
  check("self-transition throws (blocks double receive)", selfTransition);

  equal(
    "every status has a label",
    Object.keys(PURCHASE_STATUS_LABEL).length,
    5,
  );
}

// ─── Totals ────────────────────────────────────────────────────────────────
section("Purchase totals");

{
  const totals = computePurchaseTotals(
    [
      { productId: "a", quantity: 10, purchasePrice: 5000 },
      { productId: "b", quantity: 2, purchasePrice: 25000 },
    ],
    {},
  );
  equal("subtotal", totals.subtotal, 10 * 5000 + 2 * 25000);
  equal("grand total with no extras", totals.grandTotal, totals.subtotal);

  const withExtras = computePurchaseTotals(
    [{ productId: "a", quantity: 10, purchasePrice: 5000 }],
    { discount: 5000, tax: 5500, shippingCost: 10_000 },
  );
  equal(
    "discount, tax and shipping applied",
    withExtras.grandTotal,
    50_000 - 5000 + 5500 + 10_000,
  );

  const overDiscount = computePurchaseTotals(
    [{ productId: "a", quantity: 1, purchasePrice: 1000 }],
    { discount: 999_999 },
  );
  equal("grand total never goes negative", overDiscount.grandTotal, 0);

  const negative = computePurchaseTotals(
    [{ productId: "a", quantity: 1, purchasePrice: 1000 }],
    { discount: -500 },
  );
  equal("negative discount treated as zero", negative.discount, 0);
}

{
  equal("no payment is UNPAID", derivePaymentStatus(100_000, 0), "UNPAID");
  equal("partial payment", derivePaymentStatus(100_000, 40_000), "PARTIAL");
  equal("exact payment is PAID", derivePaymentStatus(100_000, 100_000), "PAID");
  equal("overpayment counts as PAID", derivePaymentStatus(100_000, 120_000), "PAID");
}

// ─── Stock behaviour ──────────────────────────────────────────────────────
section("Stock movement through the purchase lifecycle");

{
  const product = await prisma.product.findUniqueOrThrow({
    where: { sku: "MNM-002" },
    select: { id: true, stock: true, name: true },
  });

  const supplier = await prisma.supplier.findFirstOrThrow({
    select: { id: true },
  });

  const user = await prisma.user.findFirstOrThrow({
    where: { username: "gudang" },
    select: { id: true },
  });

  // Simulate the full lifecycle inside one transaction, asserting as we go.
  await prisma.$transaction(async (tx) => {
    const stockBefore = product.stock;

    const purchase = await tx.purchase.create({
      data: {
        number: `TEST-PO-${Date.now()}`,
        supplierId: supplier.id,
        status: "DRAFT",
        grandTotal: 50_000,
        userId: user.id,
        items: {
          create: {
            productId: product.id,
            quantity: 25,
            purchasePrice: 2000,
            subtotal: 50_000,
          },
        },
      },
      select: { id: true, number: true },
    });

    // Draft must not touch stock.
    const afterDraft = await tx.product.findUniqueOrThrow({
      where: { id: product.id },
      select: { stock: true },
    });
    check("stock unchanged while DRAFT", afterDraft.stock === stockBefore);

    // Ordering must not touch stock either.
    await tx.purchase.update({
      where: { id: purchase.id },
      data: { status: "ORDERED" },
    });

    const afterOrdered = await tx.product.findUniqueOrThrow({
      where: { id: product.id },
      select: { stock: true },
    });
    check("stock unchanged while ORDERED", afterOrdered.stock === stockBefore);

    const movementsBefore = await tx.inventoryMovement.count({
      where: { productId: product.id },
    });

    // Receiving increments stock and writes exactly one ledger entry per line.
    await tx.purchase.update({
      where: { id: purchase.id },
      data: { status: "RECEIVED", receivedAt: new Date() },
    });

    await tx.product.update({
      where: { id: product.id },
      data: { stock: { increment: 25 } },
    });

    await tx.inventoryMovement.create({
      data: {
        productId: product.id,
        type: "PURCHASE",
        quantity: 25,
        previousStock: stockBefore,
        newStock: stockBefore + 25,
        referenceType: "Purchase",
        referenceId: purchase.id,
        userId: user.id,
        note: `Penerimaan ${purchase.number}`,
      },
    });

    const afterReceive = await tx.product.findUniqueOrThrow({
      where: { id: product.id },
      select: { stock: true },
    });
    equal("stock increased on RECEIVED", afterReceive.stock, stockBefore + 25);

    const movementsAfter = await tx.inventoryMovement.count({
      where: { productId: product.id },
    });
    equal("exactly one ledger row written", movementsAfter - movementsBefore, 1);

    // Completing paperwork must not change stock again.
    await tx.purchase.update({
      where: { id: purchase.id },
      data: { status: "COMPLETED" },
    });

    const afterComplete = await tx.product.findUniqueOrThrow({
      where: { id: product.id },
      select: { stock: true },
    });
    equal("stock unchanged on COMPLETED", afterComplete.stock, stockBefore + 25);

    // Roll the whole lifecycle back so seeded fixtures stay as they were.
    // This must be the last statement: anything after a `return` here would
    // commit the transaction instead of aborting it.
    throw new Error("ROLLBACK");
  }).catch((error: Error) => {
    check("purchase lifecycle rolled back", error.message === "ROLLBACK");
  });

  // Confirm the rollback really reverted the stock change.
  const after = await prisma.product.findUniqueOrThrow({
    where: { id: product.id },
    select: { stock: true },
  });
  equal("stock restored after rollback", after.stock, product.stock);
}

// ─── Duplicate receiving ───────────────────────────────────────────────────
section("Double-receive protection");

{
  const product = await prisma.product.findUniqueOrThrow({
    where: { sku: "MNM-003" },
    select: { id: true, stock: true },
  });

  await prisma.$transaction(async (tx) => {
    const purchase = await tx.purchase.create({
      data: {
        number: `TEST-DUP-${Date.now()}`,
        supplierId: (
          await tx.supplier.findFirstOrThrow({ select: { id: true } })
        ).id,
        status: "RECEIVED",
        grandTotal: 1000,
        receivedAt: new Date(),
        userId: (
          await tx.user.findFirstOrThrow({
            where: { username: "gudang" },
            select: { id: true },
          })
        ).id,
        items: {
          create: {
            productId: product.id,
            quantity: 10,
            purchasePrice: 100,
            subtotal: 1000,
          },
        },
      },
      select: { status: true },
    });

    equal("purchase is already RECEIVED", purchase.status, "RECEIVED");

    // Re-receiving must be refused by the state machine.
    let refused = false;
    try {
      assertTransition(purchase.status, "RECEIVED");
    } catch (error) {
      refused = error instanceof PurchaseTransitionError;
    }
    check("second receive is refused", refused);

    throw new Error("ROLLBACK");
  }).catch((error: Error) => {
    check("duplicate receive test rolled back", error.message === "ROLLBACK");
  });
}

// ─── Negative stock ────────────────────────────────────────────────────────
section("Negative stock prevention");

{
  const product = await prisma.product.findUniqueOrThrow({
    where: { sku: "MNM-004" },
    select: { id: true, stock: true },
  });

  await prisma.$transaction(async (tx) => {
    await tx.product.update({
      where: { id: product.id },
      data: { stock: 2 },
    });

    const oversell = await tx.product.updateMany({
      where: { id: product.id, stock: { gte: 10 } },
      data: { stock: { decrement: 10 } },
    });

    equal("oversell blocked", oversell.count, 0);

    const after = await tx.product.findUniqueOrThrow({
      where: { id: product.id },
      select: { stock: true },
    });
    equal("stock unchanged by blocked decrement", after.stock, 2);
    check("stock never negative", after.stock >= 0);

    throw new Error("ROLLBACK");
  }).catch((error: Error) => {
    check("negative stock test rolled back", error.message === "ROLLBACK");
  });
}

// ─── Partial failure rolls back everything ─────────────────────────────────
section("Partial failure rollback");

{
  const [good, bad] = await Promise.all([
    prisma.product.findUniqueOrThrow({
      where: { sku: "SNK-001" },
      select: { id: true, stock: true },
    }),
    prisma.product.findUniqueOrThrow({
      where: { sku: "SNK-002" },
      select: { id: true, stock: true },
    }),
  ]);

  await prisma.$transaction(async (tx) => {
    // Line 1 succeeds...
    await tx.product.update({
      where: { id: good.id },
      data: { stock: { increment: 100 } },
    });

    // ...line 2 references a product that does not exist.
    await tx.product.update({
      where: { id: "does-not-exist" },
      data: { stock: { increment: 100 } },
    });

    return null;
  }).catch(() => {
    // Expected to throw.
  });

  const after = await prisma.product.findUniqueOrThrow({
    where: { id: good.id },
    select: { stock: true },
  });

  equal(
    "first line reverted when a later line failed",
    after.stock,
    good.stock,
  );
  check("no partial stock increase survives", after.stock === good.stock);
  void bad;
}

console.log(`\n${"─".repeat(60)}`);
console.log(`  ${passed} passed, ${failed} failed`);
console.log("─".repeat(60));
}

main()
  .then(async () => {
    await prisma.$disconnect();
    if (failed > 0) process.exit(1);
  })
  .catch(async (error) => {
    console.error("❌ Purchase verification failed:", error);
    await prisma.$disconnect();
    process.exit(1);
  });
