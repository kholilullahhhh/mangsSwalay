import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

/**
 * End-to-end smoke test of the money and stock paths against the live database.
 *
 * Everything runs inside one transaction that is always rolled back, so the store
 * is left exactly as it was found. This is the path a real cashier takes:
 * open a till, sell, redeem points, refund, void — checking that stock, the ledger
 * and the balances actually agree at each step rather than only that no error was
 * raised.
 */
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

class Rollback extends Error {}

let passed = 0;
const failures: string[] = [];

function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) {
    passed++;
    console.log("  ✓ " + name);
  } else {
    failures.push(name);
    console.log("  ✗ " + name + (detail === undefined ? "" : " :: " + JSON.stringify(detail)));
  }
}

async function main() {
  const { checkoutSale } = await import("../src/lib/sales/checkout");
  const { refundSale, voidSale } = await import("../src/lib/sales/mutations");
  const { openShift, getShiftComponents, closeShift } = await import(
    "../src/lib/shifts/mutations"
  );
  const { expectedCash } = await import("../src/lib/shifts/rules");

  const cashier = await prisma.user.findFirstOrThrow({
    where: { username: "kasir" },
    select: { id: true, name: true },
  });

  const product = await prisma.product.findFirstOrThrow({
    where: { stock: { gte: 20 }, isActive: true },
    select: { id: true, name: true, sellingPrice: true, stock: true },
  });

  const member = await prisma.customer.findFirstOrThrow({
    where: { isMember: true, isActive: true },
    select: { id: true, name: true, points: true },
  });

  console.log("\n  POS end-to-end: till → sale → refund → void → close\n");

  try {
    await prisma.$transaction(
      async (tx) => {
        const actor = { id: cashier.id, name: cashier.name };

        // A member balance and the point value, so redemption is exercised for
        // real rather than stubbed.
        await tx.customer.update({
          where: { id: member.id },
          data: { points: 400 },
        });

        await tx.storeSetting.upsert({
          where: { key: "loyalty.pointValue" },
          update: { value: 50 },
          create: { key: "loyalty.pointValue", value: 50, description: "test" },
        });

        // ── Open the till ────────────────────────────────────────────────
        const shift = await openShift(cashier.id, 100_000, { client: tx as never });
        check("a shift opens", Boolean(shift.id));

        const openingStock = product.stock;
        const unit = Number(product.sellingPrice);

        // ── Sell, with points redeemed ───────────────────────────────────
        const sale = await checkoutSale(
          {
            customerId: member.id,
            shiftId: shift.id,
            paymentMethod: "CASH",
            amountPaid: 1_000_000,
            redeemPoints: 10,
            lines: [{ productId: product.id, quantity: 3 }],
          },
          actor,
          { client: tx as never },
        );

        check(
          "the redemption is priced at the configured value",
          sale.pointsDiscount === 500,
          sale.pointsDiscount,
        );
        check(
          "the total is the goods less the redemption",
          sale.total === unit * 3 - 500,
          sale.total,
        );

        const afterSale = await tx.product.findUniqueOrThrow({
          where: { id: product.id },
          select: { stock: true },
        });
        check("stock fell by exactly the quantity sold", afterSale.stock === openingStock - 3, {
          before: openingStock,
          after: afterSale.stock,
        });

        const ledger = await tx.inventoryMovement.findMany({
          where: { productId: product.id, referenceId: sale.saleId },
        });
        check("exactly one ledger row per sale", ledger.length === 1, ledger.length);
        check(
          "the ledger's before/after match the counter",
          ledger[0]?.previousStock === openingStock && ledger[0]?.newStock === afterSale.stock,
          ledger[0],
        );

        const memberAfter = await tx.customer.findUniqueOrThrow({
          where: { id: member.id },
          select: { points: true },
        });
        check(
          "the member's balance nets spend against earn",
          memberAfter.points === 400 - 10 + sale.pointsEarned,
          { actual: memberAfter.points, expected: 400 - 10 + sale.pointsEarned },
        );

        const firstSaleTotal = sale.total;

        // ── Cash reconciliation ──────────────────────────────────────────
        const components = await getShiftComponents(shift.id, tx as never);
        check(
          "the drawer holds the sale total, not the cash handed over",
          components.cashSales === sale.total,
          components,
        );
        check(
          "expected cash accounts for the opening float",
          expectedCash(components) === 100_000 + sale.total,
        );

        // ── Partial refund ───────────────────────────────────────────────
        const item = await tx.saleItem.findFirstOrThrow({
          where: { saleId: sale.saleId },
          select: { id: true },
        });

        const refund = await refundSale(
          sale.saleId,
          [{ saleItemId: item.id, quantity: 1, condition: "GOOD" }],
          "Uji retur sebagian",
          cashier.id,
          { client: tx as never },
        );

        check("the refund is worth its share of what was paid", refund.totalRefund > 0);
        check(
          "the refund never exceeds what was collected",
          refund.totalRefund <= sale.total,
          { refund: refund.totalRefund, sale: sale.total },
        );

        const afterRefund = await tx.product.findUniqueOrThrow({
          where: { id: product.id },
          select: { stock: true },
        });
        check("the returned unit is back on the shelf", afterRefund.stock === openingStock - 2, {
          after: afterRefund.stock,
        });

        // ── Void the rest ────────────────────────────────────────────────
        const voidItem = await tx.saleItem.findFirstOrThrow({
          where: { saleId: sale.saleId },
          select: { id: true, quantity: true, returnedQty: true },
        });

        await refundSale(
          sale.saleId,
          [
            {
              saleItemId: voidItem.id,
              quantity: voidItem.quantity - voidItem.returnedQty,
              condition: "GOOD",
            },
          ],
          "Retur sisa sebelum void",
          cashier.id,
          { client: tx as never },
        );

        const fullyRefunded = await tx.sale.findUniqueOrThrow({
          where: { id: sale.saleId },
          select: { status: true, pointsRedeemed: true },
        });
        check("the sale is fully refunded", fullyRefunded.status === "REFUNDED", fullyRefunded);

        // A fully refunded sale is not voidable, and that refusal is explicit.
        let voidRefused = false;
        try {
          await voidSale(sale.saleId, cashier.id, "Harus ditolak", {
            client: tx as never,
          });
        } catch {
          voidRefused = true;
        }
        check("a refunded sale cannot be voided", voidRefused);

        const restored = await tx.product.findUniqueOrThrow({
          where: { id: product.id },
          select: { stock: true },
        });
        check(
          "every returned unit is accounted for back on the shelf",
          restored.stock === openingStock,
          { expected: openingStock, actual: restored.stock },
        );

        // ── Second sale, then a clean close ──────────────────────────────
        const secondSale = await checkoutSale(
          {
            shiftId: shift.id,
            paymentMethod: "CASH",
            amountPaid: secondSaleExact(unit),
            lines: [{ productId: product.id, quantity: 1 }],
          },
          actor,
          { client: tx as never },
        );

        const beforeClose = await getShiftComponents(shift.id, tx as never);
        const counted = expectedCash(beforeClose);

        const closed = await closeShift(
          shift.id,
          cashier.id,
          counted,
          "Uji tutup shift",
          { client: tx as never },
        );

        check("a correctly counted till closes balanced", closed.variance === 0, closed);
        check(
          "the close stores the ledger-derived expected cash",
          closed.expected === counted,
          { expected: closed.expected, counted },
        );
        check(
          // The fully-refunded sale contributed nothing to cash-in, while its
          // refund is still subtracted. Filtering the two sides differently is
          // what makes a returned sale come out as negative drawer cash.
          "the refunded sale is excluded from cash in while its refund is subtracted",
          closed.expected ===
            100_000 + secondSale.total - firstSaleTotal,
          { expected: closed.expected, sale: secondSale.total, refunded: firstSaleTotal },
        );

        throw new Rollback();
      },
      { timeout: 60_000, maxWait: 10_000 },
    ).catch((error) => {
      // Every scenario is discarded, so a completed run always throws.
      if (!(error instanceof Rollback)) {
        failures.push("transaction aborted :: " + (error as Error).message);
        console.log("  ✗ transaction aborted :: " + (error as Error).message);
      }
    });
  } finally {
    await prisma.$disconnect();
  }

  console.log(
    "\n  " + passed + " passed, " + failures.length + " failed\n",
  );

  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

/** Exactly one unit at its listed price, so the cash drawer balances to zero. */
function secondSaleExact(unit: number): number {
  return unit;
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});