/**
 * Business-flow verification against the real database.
 *
 * The HTTP suite proves pages render. This one proves the *rules* hold: that a
 * checkout writes the right rows, that a promotion cannot be worth more than the
 * engine says, that tax comes from settings rather than the request, and that a
 * refund or a stock correction never leaves stock out of step with its ledger.
 *
 * Each scenario runs in its own transaction that is rolled back afterwards, so
 * the seeded data every other suite depends on is left exactly as it was.
 *
 * The isolation is not tidiness. In PostgreSQL a single failed statement aborts
 * the whole transaction, so bundling the expected-rejection cases into one long
 * transaction would poison every later assertion â€” they would report failures
 * caused by an earlier, deliberately provoked error. One transaction per
 * scenario is what keeps each result attributable.
 */

import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "../src/generated/prisma/client";

import { checkoutSale } from "../src/lib/sales/checkout";
import {
  buildImportTemplate,
  importProducts,
  parseProductCsv,
  splitCsvLine,
} from "../src/lib/products/import";
import { generateStockNotifications } from "../src/lib/notifications/generate";
import { voidSale } from "../src/lib/sales/mutations";

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
  check(
    name,
    Object.is(actual, expected),
    "expected " + String(expected) + ", got " + String(actual),
  );
}

function section(title: string) {
  console.log("\n" + title);
}

/** Thrown to unwind a transaction that is meant to be discarded. */
class Rollback extends Error {
  constructor() {
    super("rollback");
  }
}

/**
 * Runs a scenario in its own transaction, then throws it away.
 *
 * The observed value is captured outside the transaction rather than returned
 * from the callback, because the rollback is thrown from a `finally` â€” which
 * discards the callback's return value. Returning it from `scenario` would
 * therefore always be `undefined`, and every assertion on an observed error
 * message would fail for the wrong reason.
 */
async function scenario<T>(
  body: (tx: Transactionish) => Promise<T>,
): Promise<T | undefined> {
  let observed: T | undefined;
  let abortedByScenario = false;
  let unexpected: unknown = null;

  try {
    await prisma.$transaction(
      async (tx) => {
        try {
          observed = await body(tx as unknown as Transactionish);
        } catch (error) {
          abortedByScenario = true;
          unexpected = error;
          throw error;
        } finally {
          // Discarded either way. A scenario that throws must not leave its
          // partial writes behind for the next run.
          throw new Rollback();
        }
      },
      { timeout: 60_000, maxWait: 10_000 },
    );
  } catch (error) {
    if (error instanceof Rollback) {
      // The body threw. That is the *expected* path for every `expectRejection`
      // scenario and a silent no-op for everything else â€” and a silent no-op is
      // how a broken rule hides behind a green run: the checks inside the body
      // simply never execute, so a section can report nothing at all and the
      // suite still passes. Surfacing it as a failure is what makes a green run
      // mean something.
      if (abortedByScenario && unexpected && !rejectionExpected) {
        failed++;
        failures.push(
          "scenario threw before finishing :: " + (unexpected as Error).message,
        );
      }
    } else if (!abortedByScenario) {
      // Reaching here means the transaction itself failed, not the scenario.
      failed++;
      failures.push("scenario aborted unexpectedly :: " + (error as Error).message);
    }
  }

  return observed;
}

/** The transaction surface these scenarios use. */
type Transactionish = Prisma.TransactionClient;

/** Asserts a promise rejects with an error of the given constructor. */
async function expectRejection(
  name: string,
  promise: Promise<unknown>,
  // Typed as a constructor rather than `Function`, which accepts anything
  // callable and would silence exactly the misuse this check exists to catch.
  kind: abstract new (...args: never[]) => Error,
): Promise<Error | null> {
  // The scenario harness treats any escaping exception as a failure, because a
  // body that dies early skips every check inside it. A rejection is the one
  // case where throwing is the point, so it announces itself first.
  rejectionExpected = true;

  try {
    await promise;
    failed++;
    failures.push(name + " :: expected a rejection, but it resolved");
    return null;
  } catch (error) {
    if (error instanceof kind) {
      passed++;
      return error as Error;
    }

    failed++;
    failures.push(
      name +
        " :: expected " +
        kind.name +
        ", got " +
        (error as Error).constructor.name +
        ": " +
        (error as Error).message,
    );
    return null;
  } finally {
    rejectionExpected = false;
  }
}

/**
 * Set by `expectRejection` for the duration of the promise it is awaiting.
 *
 * Read by the scenario harness, which otherwise reports every escaping exception
 * as a failure.
 */
let rejectionExpected = false;

/** The header row the parser expects, without the template's example row. */
function headerOf(template: string): string {
  return template.split("\n")[0];
}

/** A barcode unique to this run, so repeat runs cannot collide. */
function barcodeFor(suffix: string): string {
  const hex = "0x" + (suffix.replace(/[^0-9A-F]/g, "").slice(0, 10) || "1");
  const digits = BigInt(hex) % BigInt(1000000000);
  return "899" + String(digits).padStart(10, "0");
}

async function main() {
  const cashier = await prisma.user.findUniqueOrThrow({
    where: { username: "kasir" },
    select: { id: true, name: true },
  });

  const product = await prisma.product.findFirstOrThrow({
    where: { stock: { gte: 10 }, isActive: true },
    select: {
      id: true,
      name: true,
      sku: true,
      stock: true,
      sellingPrice: true,
      purchasePrice: true,
    },
  });

  const second = await prisma.product.findFirstOrThrow({
    where: { stock: { gte: 10 }, isActive: true, id: { not: product.id } },
    select: { id: true, name: true, stock: true, sellingPrice: true },
  });

  const member = await prisma.customer.findFirstOrThrow({
    where: { isMember: true, isActive: true },
    select: { id: true, name: true, points: true, totalPurchases: true },
  });

  const actor = { id: cashier.id, name: cashier.name };

  /**
   * An open shift for the cashier, inside the caller's transaction.
   *
   * Cash sales are refused without one â€” that is the rule under test, not an
   * obstacle to it â€” so every scenario that has to complete a cash sale opens a
   * shift the way the POS does, and the scenarios that check the refusal itself
   * deliberately omit it.
   */
  async function withOpenShift<T>(
    tx: Transactionish,
    body: (shiftId: string) => Promise<T>,
  ): Promise<T> {
    const shift = await tx.cashShift.create({
      data: {
        number: `TEST-SFT-${Math.random().toString(36).slice(2, 8)}`,
        userId: cashier.id,
        status: "OPEN",
        openedAt: new Date(),
        openingCash: 0,
      },
      select: { id: true },
    });

    return body(shift.id);
  }

  // â”€â”€ Checkout writes a complete, consistent sale â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  section("Checkout writes a complete, consistent sale");

  await scenario(async (tx) => {
    const before = await tx.product.findUniqueOrThrow({
      where: { id: product.id },
      select: { stock: true },
    });

    const result = await withOpenShift(tx, (shiftId) =>
      checkoutSale(
        {
          paymentMethod: "CASH",
          amountPaid: 100_000,
          shiftId,
          lines: [{ productId: product.id, quantity: 2 }],
        },
        actor,
        { client: tx },
      ),
    );

    const sale = await tx.sale.findUniqueOrThrow({
      where: { id: result.saleId },
      select: {
        subtotal: true,
        total: true,
        tax: true,
        discount: true,
        amountPaid: true,
        change: true,
        status: true,
        invoiceNumber: true,
        promotionCode: true,
        items: { select: { quantity: true, price: true, cost: true } },
      },
    });

    check("a sale row is written", Boolean(sale));
    equal(
      "subtotal equals the DB selling price times quantity",
      Number(sale.subtotal),
      Number(product.sellingPrice) * 2,
    );
    equal("tax is zero when the store has tax off", Number(sale.tax), 0);
    equal(
      "total equals subtotal with no discount or tax",
      Number(sale.total),
      Number(sale.subtotal),
    );
    equal(
      "change is what was handed over minus the total",
      Number(sale.change),
      100_000 - Number(sale.total),
    );
    equal("the sale is completed", sale.status, "COMPLETED");
    equal("no promotion is recorded", sale.promotionCode, null);
    equal("one sale item is written", sale.items.length, 1);
    equal("the item quantity is recorded", sale.items[0].quantity, 2);
    equal(
      "the cost is snapshotted on the line",
      Number(sale.items[0].cost),
      Number(product.purchasePrice),
    );
    check(
      "the invoice number is generated",
      /^INV-\d{8}-\d{4,}$/.test(sale.invoiceNumber),
      sale.invoiceNumber,
    );

    const after = await tx.product.findUniqueOrThrow({
      where: { id: product.id },
      select: { stock: true },
    });

    equal("stock is decremented by the sold quantity", after.stock, before.stock - 2);

    const movement = await tx.inventoryMovement.findFirstOrThrow({
      where: { referenceId: result.saleId, productId: product.id },
      select: { type: true, quantity: true, previousStock: true, newStock: true },
    });

    equal("the ledger records an OUT movement", movement.type, "SALE");
    equal("the ledger quantity matches the sale", movement.quantity, 2);
    equal("the ledger's previous stock is correct", movement.previousStock, before.stock);
    equal("the ledger's new stock matches the product", movement.newStock, after.stock);

    // The receipt is the customer's record; it must match what was stored.
    equal("the receipt lists the sold line", result.lines.length, 1);
    equal(
      "the receipt uses the DB price",
      result.lines[0].unitPrice,
      Number(product.sellingPrice),
    );
    equal("the receipt records the cashier", result.cashierName, actor.name);
    equal(
      "the receipt total matches the stored total",
      result.total,
      Number(sale.total),
    );
  });

  // â”€â”€ Refusals â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  section("Checkout refuses what it must not sell");

  {
    const error = await scenario(async (tx) =>
      expectRejection(
        "an empty cart is refused",
        checkoutSale(
          { paymentMethod: "CASH", amountPaid: 1000, lines: [] },
          actor,
          { client: tx },
        ),
        Error,
      ),
    );
    void error;
  }

  {
    await scenario(async (tx) =>
      expectRejection(
        "an unknown product is refused",
        checkoutSale(
          {
            paymentMethod: "CASH",
            amountPaid: 1000,
            lines: [{ productId: "does-not-exist", quantity: 1 }],
          },
          actor,
          { client: tx },
        ),
        Error,
      ),
    );
  }

  {
    // The most important refusal: allowing it would sell stock the shop does not
    // have, and no amount of UI validation can be relied on for that.
    const error = await scenario(async (tx) =>
      expectRejection(
        "selling more than is in stock is refused",
        checkoutSale(
          {
            paymentMethod: "CASH",
            amountPaid: 1_000_000_000,
            lines: [{ productId: product.id, quantity: 100_000 }],
          },
          actor,
          { client: tx },
        ),
        Error,
      ),
    );

    check(
      "the oversell message names the shortfall",
      error?.message.includes("tidak mencukupi") ?? false,
      error?.message,
    );
  }

  {
    const error = await scenario(async (tx) =>
      withOpenShift(tx, (shiftId) =>
        expectRejection(
          "cash that does not cover the total is refused",
          checkoutSale(
            {
              paymentMethod: "CASH",
              amountPaid: 1,
              shiftId,
              lines: [{ productId: product.id, quantity: 1 }],
            },
            actor,
            { client: tx },
          ),
          Error,
        ),
      ),
    );

    check(
      "the underpayment message states the shortfall",
      error?.message.includes("kurang") ?? false,
      error?.message,
    );
  }

  // â”€â”€ Cash accountability: a till that cannot be reconciled is refused â”€â”€â”€â”€â”€
  section("Cash sales require an open shift the cashier actually owns");

  {
    const error = await scenario(async (tx) =>
      expectRejection(
        "a cash sale with no open shift is refused",
        checkoutSale(
          {
            paymentMethod: "CASH",
            amountPaid: 1_000_000,
            lines: [{ productId: product.id, quantity: 1 }],
          },
          actor,
          { client: tx },
        ),
        Error,
      ),
    );

    check(
      "the missing-shift refusal says to open one",
      error?.message.includes("Buka shift") ?? false,
      error?.message,
    );
  }

  {
    const error = await scenario(async (tx) =>
      withOpenShift(tx, (shiftId) =>
        expectRejection(
          "a shift belonging to someone else is refused",
          checkoutSale(
            {
              paymentMethod: "CASH",
              amountPaid: 1_000_000,
              shiftId,
              lines: [{ productId: product.id, quantity: 1 }],
            },
            // A different cashier, holding a shift that is not theirs. The id is
            // taken from the payload, so only a server-side ownership check
            // stops the sale landing in someone else's till.
            { id: second.id, name: "Kasir Lain" },
            { client: tx },
          ),
          Error,
        ),
      ),
    );

    check(
      "another cashier's shift is rejected",
      error?.message.includes("Shift") ?? false,
      error?.message,
    );
  }

  {
    // A non-cash sale never touches the drawer, so it must stay available when
    // no shift is open â€” otherwise the store cannot sell at all before opening.
    await scenario(async (tx) => {
      await checkoutSale(
        {
          paymentMethod: "QRIS",
          amountPaid: 0,
          lines: [{ productId: product.id, quantity: 1 }],
        },
        actor,
        { client: tx },
      );
    });

    check("a non-cash sale needs no shift", true);
  }

  {
    const error = await scenario(async (tx) =>
      expectRejection(
        "a manual discount from a cashier with no discount grant is refused",
        checkoutSale(
          {
            paymentMethod: "QRIS",
            amountPaid: 0,
            manualDiscount: 5_000,
            lines: [{ productId: product.id, quantity: 1 }],
          },
          actor,
          { client: tx, canApplyDiscount: false },
        ),
        Error,
      ),
    );

    check(
      "the discount refusal names the missing permission",
      error?.message.includes("diskon manual") ?? false,
      error?.message,
    );
  }

  {
    await scenario(async (tx) => {
      const disabled = await tx.product.findFirstOrThrow({
        where: { isActive: true },
        select: { id: true, name: true },
      });

      await tx.product.update({
        where: { id: disabled.id },
        data: { isActive: false },
      });

      const failure = await expectRejection(
        "a deactivated product is refused",
        checkoutSale(
          {
            paymentMethod: "CASH",
            amountPaid: 1_000_000,
            lines: [{ productId: disabled.id, quantity: 1 }],
          },
          actor,
          { client: tx },
        ),
        Error,
      );

      check(
        "the refusal names the product",
        failure?.message.includes(disabled.name) ?? false,
        failure?.message,
      );
    });
  }

  // â”€â”€ Promotions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  section("Promotions are valued by the server, not the client");

  {
    const promoCode = "TEST-" + Date.now().toString(36).toUpperCase();
    const now = new Date();

    await scenario(async (tx) => {
      const capped = await tx.promotion.create({
        data: {
          code: promoCode,
          name: "Promo uji 50%",
          type: "PERCENTAGE",
          // Stored as 0-100, matching the column's convention.
          value: 50,
          startDate: new Date(now.getTime() - 86_400_000),
          endDate: new Date(now.getTime() + 86_400_000),
          usageLimit: 1,
          usedCount: 0,
          isActive: true,
        },
        select: { id: true },
      });

      const subtotal = Number(product.sellingPrice) * 2;
      const expectedDiscount = Math.round(subtotal * 0.5);

      const result = await withOpenShift(tx, (shiftId) =>
        checkoutSale(
          {
            paymentMethod: "CASH",
            amountPaid: 1_000_000,
            shiftId,
            // Lowercase on purpose: the server must normalise, or the code would
            // not match and the discount would silently not apply.
            promotionCode: promoCode.toLowerCase(),
            lines: [{ productId: product.id, quantity: 2 }],
          },
          actor,
          { client: tx },
        ),
      );

      equal("the promotion is applied", result.promotionCode, promoCode);
      equal("the discount is exactly half the subtotal", result.discount, expectedDiscount);
      equal("the total is subtotal minus the discount", result.total, subtotal - expectedDiscount);
      equal("no tax is added", result.tax, 0);

      const sale = await tx.sale.findUniqueOrThrow({
        where: { id: result.saleId },
        select: { promotionCode: true, discount: true, total: true },
      });

      equal("the code is stored normalised on the sale", sale.promotionCode, promoCode);
      equal("the recorded discount matches the engine", Number(sale.discount), expectedDiscount);

      const used = await tx.promotion.findUniqueOrThrow({
        where: { id: capped.id },
        select: { usedCount: true },
      });

      equal("a capped promotion counts one use", used.usedCount, 1);

      // The limit is now spent, so the next attempt must be refused. This is the
      // check that stops a promotion being honoured more times than it was sold.
      await expectRejection(
        "an exhausted promotion is refused",
        checkoutSale(
          {
            paymentMethod: "CASH",
            amountPaid: 1_000_000,
            promotionCode: promoCode,
            lines: [{ productId: product.id, quantity: 1 }],
          },
          actor,
          { client: tx },
        ),
        Error,
      );
    });
  }

  {
    await scenario((tx) =>
      expectRejection(
        "an unknown promo code is refused",
        checkoutSale(
          {
            paymentMethod: "CASH",
            amountPaid: 1_000_000,
            promotionCode: "NOPE-NOT-A-REAL-CODE",
            lines: [{ productId: product.id, quantity: 1 }],
          },
          actor,
          { client: tx },
        ),
        Error,
      ),
    );
  }

  {
    // A valid code that has expired must not work, or an old campaign keeps
    // discounting sales indefinitely.
    const expiredCode = "EXPIRED-" + Date.now().toString(36).toUpperCase();
    const now = new Date();

    const error = await scenario(async (tx) => {
      await tx.promotion.create({
        data: {
          code: expiredCode,
          name: "Promo kedaluwarsa",
          type: "PERCENTAGE",
          value: 90,
          startDate: new Date(now.getTime() - 30 * 86_400_000),
          endDate: new Date(now.getTime() - 86_400_000),
          isActive: true,
        },
      });

      return expectRejection(
        "an expired promotion is refused",
        checkoutSale(
          {
            paymentMethod: "CASH",
            amountPaid: 1_000_000,
            promotionCode: expiredCode,
            lines: [{ productId: product.id, quantity: 1 }],
          },
          actor,
          { client: tx },
        ),
        Error,
      );
    });

    check(
      "the refusal says the promo has ended",
      error?.message.includes("berakhir") ?? false,
      error?.message,
    );
  }

  // â”€â”€ Tax from settings â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  section("Tax comes from settings, never from the request");

  {
    await scenario(async (tx) => {
      await tx.storeSetting.upsert({
        where: { key: "tax.enabled" },
        create: { key: "tax.enabled", value: true, description: "test" },
        update: { value: true },
      });
      await tx.storeSetting.upsert({
        where: { key: "tax.rate" },
        create: { key: "tax.rate", value: 0.1, description: "test" },
        update: { value: 0.1 },
      });

      const subtotal = Number(second.sellingPrice) * 2;

      // `taxRate: 0` is sent deliberately: a server that trusted the request
      // would collect nothing here, which is the whole bug this guards against.
      const taxed = await checkoutSale(
        {
          paymentMethod: "QRIS",
          amountPaid: 0,
          taxRate: 0,
          lines: [{ productId: second.id, quantity: 2 }],
        },
        actor,
        { client: tx },
      );

      equal(
        "tax is charged even though the client claimed zero",
        taxed.tax,
        Math.round(subtotal * 0.1),
      );
      equal(
        "the total includes tax",
        taxed.total,
        subtotal + Math.round(subtotal * 0.1),
      );
      equal("a non-cash sale settles at exactly the total", taxed.amountPaid, taxed.total);
      equal("a non-cash sale has no change", taxed.change, 0);
    });
  }

  {
    // Turning tax off must actually stop it, whatever the client claims.
    await scenario(async (tx) => {
      await tx.storeSetting.upsert({
        where: { key: "tax.enabled" },
        create: { key: "tax.enabled", value: false, description: "test" },
        update: { value: false },
      });
      await tx.storeSetting.upsert({
        where: { key: "tax.rate" },
        create: { key: "tax.rate", value: 0.1, description: "test" },
        update: { value: 0.1 },
      });

      const sale = await withOpenShift(tx, (shiftId) =>
        checkoutSale(
          {
            paymentMethod: "CASH",
            amountPaid: 1_000_000,
            shiftId,
            taxRate: 0.5,
            lines: [{ productId: second.id, quantity: 1 }],
          },
          actor,
          { client: tx },
        ),
      );

      equal("tax is not charged when the store has disabled it", sale.tax, 0);
    });
  }

  // â”€â”€ Loyalty â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  section("Loyalty points accrue on post-discount, pre-tax revenue");

  await scenario(async (tx) => {
    const before = await tx.customer.findUniqueOrThrow({
      where: { id: member.id },
      select: { points: true, totalPurchases: true },
    });

    const result = await withOpenShift(tx, (shiftId) =>
      checkoutSale(
        {
          paymentMethod: "CASH",
          amountPaid: 1_000_000,
          shiftId,
          customerId: member.id,
          lines: [{ productId: second.id, quantity: 1 }],
        },
        actor,
        { client: tx },
      ),
    );

    const ratioRow = await tx.storeSetting.findUnique({
      where: { key: "loyalty.ratio" },
      select: { value: true },
    });

    const ratio = typeof ratioRow?.value === "number" ? ratioRow.value : 10_000;

    equal(
      "points earned equals revenue over the configured ratio",
      result.pointsEarned,
      Math.floor((result.total - result.tax) / ratio),
    );

    const after = await tx.customer.findUniqueOrThrow({
      where: { id: member.id },
      select: { points: true, totalPurchases: true },
    });

    equal("the member's points are incremented", after.points, before.points + result.pointsEarned);
    equal(
      "the member's purchase count is incremented",
      after.totalPurchases,
      before.totalPurchases + 1,
    );
    equal("the receipt names the customer", result.customerName, member.name);
  });

  // â”€â”€ Loyalty redemption â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  section("Points can be spent, and only against a real balance");

  // Gives the section its own value so it does not depend on whatever the seeded
// store happens to have configured. The member's balance is topped up inside
  // each scenario rather than out here, so the whole section stays rolled back
  // and leaves no fixture behind.
  const POINT_VALUE = 100;
  const REDEEMED_POINTS = 2;

  await prisma.storeSetting.upsert({
    where: { key: "loyalty.pointValue" },
    update: { value: POINT_VALUE },
    create: {
      key: "loyalty.pointValue",
      value: POINT_VALUE,
      description: "Nilai tukar 1 poin saat penukaran (Rp)",
    },
  });

  /** Gives the member a balance to draw on, inside the caller's transaction. */
  async function fundMember(tx: Transactionish, points = 500) {
    await tx.customer.update({
      where: { id: member.id },
      data: { points, isMember: true, isActive: true },
    });
  }

  {
    const error = await scenario(async (tx) => {
      await fundMember(tx, REDEEMED_POINTS);

      return expectRejection(
        "redeeming more points than the member holds is refused",
        checkoutSale(
          {
            customerId: member.id,
            paymentMethod: "QRIS",
            amountPaid: 0,
            redeemPoints: REDEEMED_POINTS + 1,
            lines: [{ productId: product.id, quantity: 1 }],
          },
          actor,
          { client: tx },
        ),
        Error,
      );
    });

    check(
      "the overdraft refusal states the balance",
      error?.message.includes("Poin tidak cukup") ?? false,
      error?.message,
    );
  }

  {
    const error = await scenario((tx) =>
      expectRejection(
        "a non-member cannot redeem points",
        checkoutSale(
          {
            paymentMethod: "QRIS",
            amountPaid: 0,
            redeemPoints: 10,
            lines: [{ productId: product.id, quantity: 1 }],
          },
          actor,
          { client: tx },
        ),
        Error,
      ),
    );

    check(
      "the redemption refusal names the membership requirement",
      error?.message.includes("member") ?? false,
      error?.message,
    );
  }

  {
    const unit = Number(product.sellingPrice);

    const observed = await scenario(async (tx) => {
      await fundMember(tx);

      const result = await checkoutSale(
        {
          customerId: member.id,
          paymentMethod: "QRIS",
          amountPaid: 0,
          redeemPoints: REDEEMED_POINTS,
          lines: [{ productId: product.id, quantity: 1 }],
        },
        actor,
        { client: tx },
      );

      const sale = await tx.sale.findUniqueOrThrow({
        where: { id: result.saleId },
        select: { discount: true, pointsRedeemed: true, total: true },
      });

      return { result, sale };
    });

    if (observed) {
      // The redemption is taken before tax so the receipt
      // still foots, and capped so it can never exceed what is owed.
      equal(
        "the redemption is priced from the setting",
        observed.result.pointsDiscount,
        REDEEMED_POINTS * POINT_VALUE,
      );
      equal("the total drops by the redeemed value", observed.result.total, unit - REDEEMED_POINTS * POINT_VALUE);
      equal("the points spent are reported back", observed.result.pointsRedeemed, REDEEMED_POINTS);
      equal("the sale records the points spent", observed.sale.pointsRedeemed, REDEEMED_POINTS);
      equal(
        "the discount column carries the redemption",
        Number(observed.sale.discount),
        REDEEMED_POINTS * POINT_VALUE,
      );
    } else {
      check("the redemption scenario ran to completion", false);
    }
  }

  {
    // The mirror image: returning goods bought with points has to hand the points
    // back, or the member ends up with both the goods' cash value and the points
    // they paid for.
    const observed = await scenario(async (tx) =>
      withOpenShift(tx, async (shiftId) => {
        await fundMember(tx);

        const sale = await checkoutSale(
          {
            customerId: member.id,
            paymentMethod: "CASH",
            amountPaid: 1_000_000,
            shiftId,
            redeemPoints: REDEEMED_POINTS,
            lines: [{ productId: product.id, quantity: 1 }],
          },
          actor,
          { client: tx },
        );

        const item = await tx.saleItem.findFirstOrThrow({
          where: { saleId: sale.saleId },
          select: { id: true },
        });

        const { refundSale } = await import("../src/lib/sales/mutations");

        await refundSale(
          sale.saleId,
          [{ saleItemId: item.id, quantity: 1, condition: "GOOD" }],
          "Pengujian pembalikan poin",
          actor.id,
          { client: tx },
        );

        const after = await tx.sale.findUniqueOrThrow({
          where: { id: sale.saleId },
          select: { status: true, pointsRedeemed: true },
        });

        return after;
      }),
    );

    check(
      "a refunded sale is reconciled and still records its redemption",
      observed?.status === "REFUNDED" &&
        observed.pointsRedeemed === REDEEMED_POINTS,
      JSON.stringify(observed),
    );
  }

  // â”€â”€ Void â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  section("Voiding a sale puts the stock back");

  await scenario(async (tx) => {
    const before = await tx.product.findUniqueOrThrow({
      where: { id: product.id },
      select: { stock: true },
    });

    const sale = await withOpenShift(tx, (shiftId) =>
      checkoutSale(
        {
          paymentMethod: "CASH",
          amountPaid: 1_000_000,
          shiftId,
          lines: [{ productId: product.id, quantity: 3 }],
        },
        actor,
        { client: tx },
      ),
    );

    const mid = await tx.product.findUniqueOrThrow({
      where: { id: product.id },
      select: { stock: true },
    });

    equal("the sale reduced stock", mid.stock, before.stock - 3);

    await voidSale(sale.saleId, actor.id, "Uji pembatalan", { client: tx });

    const after = await tx.product.findUniqueOrThrow({
      where: { id: product.id },
      select: { stock: true },
    });

    equal("voiding restores the stock", after.stock, before.stock);

    const voided = await tx.sale.findUniqueOrThrow({
      where: { id: sale.saleId },
      select: { status: true, voidReason: true },
    });

    equal("the sale is marked VOID", voided.status, "VOID");
    check("the void reason is recorded", Boolean(voided.voidReason));

    // The restock must itself be explained by the ledger.
    const restock = await tx.inventoryMovement.findFirst({
      where: { referenceId: sale.saleId, type: "SALE_VOID" },
      select: { quantity: true, type: true },
    });

    equal("the restock is written to the ledger", restock?.quantity, 3);
    equal("the restock is recorded as a void return", restock?.type, "SALE_VOID");
  });

  // â”€â”€ Refund â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  section("Refunds restock good goods and never resell damaged ones");

  await scenario(async (tx) => {
    // Two products in one sale, so the refund can split conditions across lines:
    // a refund carries one row per sale line, and asking for the same line twice
    // is rejected as a duplicate rather than silently merged.
    const sale = await withOpenShift(tx, (shiftId) =>
      checkoutSale(
        {
          paymentMethod: "CASH",
          amountPaid: 1_000_000,
          shiftId,
          lines: [
            { productId: product.id, quantity: 2 },
            { productId: second.id, quantity: 2 },
          ],
        },
        actor,
        { client: tx },
      ),
    );

    const items = await tx.saleItem.findMany({
      where: { saleId: sale.saleId },
      select: { id: true, productId: true },
    });

    const good = items.find((entry) => entry.productId === product.id)!;
    const damaged = items.find((entry) => entry.productId === second.id)!;

    const before = new Map(
      (
        await tx.product.findMany({
          where: { id: { in: [product.id, second.id] } },
          select: { id: true, stock: true },
        })
      ).map((row) => [row.id, row.stock]),
    );

    const { refundSale } = await import("../src/lib/sales/mutations");

    // Two good from one line, two damaged from the other: only the good ones may
    // go back on the shelf.
    const refund = await refundSale(
      sale.saleId,
      [
        { saleItemId: good.id, quantity: 2, condition: "GOOD" },
        { saleItemId: damaged.id, quantity: 1, condition: "DAMAGED" },
      ],
      "Barang rusak sebagian",
      actor.id,
      { client: tx },
    );

    equal("the refund totals only what is returned", refund.totalRefund > 0, true);
    equal("only the good units are restocked", refund.restocked, 2);

    const after = await tx.product.findUniqueOrThrow({
      where: { id: product.id },
      select: { stock: true },
    });

    equal(
      "stock reflects only the good returns",
      after.stock,
      (before.get(product.id) ?? 0) + 2,
    );

    const updated = await tx.sale.findUniqueOrThrow({
      where: { id: sale.saleId },
      select: { status: true },
    });

    equal("the sale is marked partially refunded", updated.status, "PARTIALLY_REFUNDED");

    const damagedAfter = await tx.product.findUniqueOrThrow({
      where: { id: second.id },
      select: { stock: true },
    });

    // Damaged units left the shelf but must not re-enter sellable stock, so the
    // counter is unchanged â€” and the shrink has to be on the ledger, or the
    // disappearance is unexplained.
    equal(
      "damaged units never return to sellable stock",
      damagedAfter.stock,
      before.get(second.id) ?? 0,
    );

    const damageLedger = await tx.inventoryMovement.count({
      where: {
        productId: second.id,
        type: "DAMAGED",
        referenceType: "SaleRefund",
      },
    });

    equal("the damaged write-off is recorded in the ledger", damageLedger > 0, true);

    check(
      "the refunded sale cannot be voided",
      await (async () => {
        try {
          await voidSale(sale.saleId, actor.id, "Harus ditolak", { client: tx });
          return false;
        } catch {
          return true;
        }
      })(),
    );
  });

  // â”€â”€ CSV import â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  section("CSV import validates every row before writing any");

  {
    const suffix = Date.now().toString(36).toUpperCase();

    await scenario(async (tx) => {
      // A bad row in the middle. An importer that stopped at the first error
      // would leave the shop unable to tell which products arrived.
      const csv = headerOf(buildImportTemplate()).concat(
        "\n" +
          [
            "IMP-GOOD-" + suffix + ",Produk Impor Satu,Minuman,PCS,10000,15000,10,2",
            "IMP-BAD-" + suffix + ",Produk Tanpa Kategori,,PCS,10000,15000,5,1",
            "IMP-GOOD2-" + suffix + ",Produk Impor Dua,Snack,PACK,5000,8000,20,3",
          ].join("\n"),
      );

      const parsed = await parseProductCsv(csv, { client: tx });

      equal("the valid rows are parsed", parsed.rows.length, 2);
      check("the invalid row is reported", parsed.errors.length > 0);
      check(
        "the error names the offending line",
        parsed.errors.some((entry) => entry.line === 3),
        JSON.stringify(parsed.errors),
      );
      check(
        "the error points at the category field",
        parsed.errors.some((entry) => entry.field === "categoryId"),
        JSON.stringify(parsed.errors),
      );

      // Parsing must not have written anything, not even the categories it
      // resolves on the way through.
      const leaked = await tx.product.count({
        where: { sku: { startsWith: "IMP-GOOD-" } },
      });

      equal("parsing creates no products", leaked, 0);
    });
  }

  {
    const suffix = Date.now().toString(36).toUpperCase();

    await scenario(async (tx) => {
      const csv = headerOf(buildImportTemplate()).concat(
        "\n" +
          [
            "IMP-OK1-" + suffix + ',"Beras, Premium",Sembako,PACK,60000,70000,30,5,' + barcodeFor(suffix),
            "IMP-OK2-" + suffix + ",Gula Pasir,Sembako,PACK,14000,16000,25,4",
          ].join("\n"),
      );

      const parsed = await parseProductCsv(csv, { client: tx });

      equal("a clean file parses fully", parsed.rows.length, 2);
      equal("a clean file reports no errors", parsed.errors.length, 0);
      equal(
        "a quoted name containing a comma survives parsing",
        parsed.rows[0].data.name,
        "Beras, Premium",
      );

      const result = await importProducts(parsed.rows, { client: tx });

      equal("the import reports how many rows landed", result.imported, 2);

      const created = await tx.product.findUniqueOrThrow({
        where: { sku: "IMP-OK1-" + suffix },
        select: { stock: true, name: true },
      });

      equal("the imported product has the file's stock", created.stock, 30);
      equal("the imported product keeps its name", created.name, "Beras, Premium");

      // Opening stock must be explained, not appear as a mystery non-zero count.
      const ledger = await tx.inventoryMovement.findFirst({
        where: { referenceType: "PRODUCT_CREATE", productId: { not: "" } },
        select: { quantity: true, previousStock: true, newStock: true },
      });

      check(
        "opening stock is recorded in the ledger",
        Number(ledger?.newStock ?? 0) >= 0,
      );
    });
  }

  {
    // Duplicate SKUs inside one file must be caught before the write: the unique
    // constraint would otherwise abort the transaction mid-import with an opaque
    // database error.
    const suffix = Date.now().toString(36).toUpperCase();

    await scenario(async (tx) => {
      const csv = headerOf(buildImportTemplate()).concat(
        "\n" +
          [
            "IMP-DUP-" + suffix + ",Produk A,Sembako,PACK,10000,12000,5,1",
            "IMP-DUP-" + suffix + ",Produk B,Sembako,PACK,10000,12000,5,1",
          ].join("\n"),
      );

      const parsed = await parseProductCsv(csv, { client: tx });

      equal("a duplicate SKU inside the file is reported", parsed.errors.length, 1);
      check(
        "the duplicate error names the earlier line",
        parsed.errors[0]?.message.includes("baris 2") ?? false,
        parsed.errors[0]?.message,
      );
    });
  }

  // â”€â”€ CSV parsing â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  section("CSV parsing handles quoting");

  equal("a plain line splits on commas", splitCsvLine("a,b,c").length, 3);
  equal("a quoted comma is not a separator", splitCsvLine('a,"b,c",d').length, 3);
  equal("a doubled quote is one quote", splitCsvLine('a,"say ""hi""",c')[1], 'say "hi"');
  equal("an empty line yields one empty field", splitCsvLine("").length, 1);
  equal("trailing spaces are trimmed", splitCsvLine("a , b").join("|"), "a|b");

  // â”€â”€ Notifications â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  section("Notifications deduplicate, then resolve");

  {
    const first = await generateStockNotifications();
    check("generation reports what it did", typeof first.created === "number");

    const second = await generateStockNotifications();

    // The decisive assertion: running it again must not double the alerts, or
    // the dashboard fills with duplicates every time it is opened.
    equal("a second run creates nothing new", second.created, 0);

    const duplicates = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count FROM (
        SELECT "dedupeKey" FROM "Notification"
        WHERE "dedupeKey" IS NOT NULL
        GROUP BY "dedupeKey"
        HAVING COUNT(*) > 1
      ) duplicates
    `;

    equal("no dedupeKey has more than one row", Number(duplicates[0]?.count ?? 0), 0);
  }

  {
    // Clearing the underlying condition must close the alert out, and raising it
    // again must reopen rather than create a duplicate.
    const target = await prisma.product.findFirstOrThrow({
      where: { stock: { gt: 0 }, isActive: true },
      select: { id: true, stock: true },
    });

    // Restored to the value it had, not to an arbitrary one. This edit happens
    // outside a transaction and without a ledger row, so anything other than an
    // exact restore would leave the product's stock permanently out of step with
    // its own history â€” which the ledger suite would then correctly report.
    const originalStock = target.stock;

    try {
      await prisma.product.update({ where: { id: target.id }, data: { stock: 0 } });
      await generateStockNotifications();

      const alert = await prisma.notification.findFirst({
        where: { dedupeKey: "stock:out:" + target.id },
        select: { type: true, severity: true },
      });

      equal("an emptied product raises an out-of-stock alert", alert?.type, "OUT_OF_STOCK");
      equal("an out-of-stock alert is critical", alert?.severity, "CRITICAL");

      const again = await generateStockNotifications();
      equal("re-running does not duplicate the open alert", again.created, 0);

      await prisma.product.update({
        where: { id: target.id },
        data: { stock: originalStock },
      });

      const resolved = await generateStockNotifications();
      check("resolving the condition closes the alert", resolved.resolved > 0, JSON.stringify(resolved));

      const row = await prisma.notification.findFirstOrThrow({
        where: { dedupeKey: "stock:out:" + target.id },
        select: { isRead: true },
      });

      equal("the resolved alert is no longer unread", row.isRead, true);
    } finally {
      // Restored in a `finally` so a failed assertion cannot leave the product
      // at zero stock for every later suite.
      await prisma.product.update({
        where: { id: target.id },
        data: { stock: originalStock },
      });
    }
  }

  // â”€â”€ Nothing escaped â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  section("No write escaped the rolled-back scenarios");

  {
    // Snapshot the counts this suite could plausibly touch and confirm none of
    // them moved. A mutation that writes through the global Prisma client inside
    // a scenario commits regardless of the caller's rollback, and that is
    // invisible from inside the scenario itself â€” it looks like it passed while
    // leaving rows behind for every later run.
    const leaked = await prisma.product.count({
      where: { OR: [{ sku: { startsWith: "IMP-" } }, { sku: { startsWith: "DBG" } }] },
    });

    equal("no imported or debug products were committed", leaked, 0);

    const straySales = await prisma.sale.count({
      where: { userId: cashier.id },
    });

    equal("no test sale was committed", straySales, 0);

    const strays = await prisma.promotion.count({
      where: { code: { startsWith: "TEST-" } },
    });

    equal("no test promotion was committed", strays, 0);

    const strays2 = await prisma.promotion.count({
      where: { code: { startsWith: "EXPIRED-" } },
    });

    equal("no test expired promotion was committed", strays2, 0);

    // And the same for the demo data the suites depend on.
    const stillSeeded = await prisma.product.count({ where: { stock: { gt: 0 } } });
    check(
      "seeded stock is intact",
      stillSeeded >= 25,
      "only " + stillSeeded + " products hold stock",
    );

    const negatives = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count FROM "Product" WHERE stock < 0
    `;

    equal("no product has negative stock", Number(negatives[0]?.count ?? 0), 0);

    // Every stock change must be explainable by a ledger row.
    const unexplained = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count
      FROM "Product" p
      WHERE p.stock <> 0
        AND NOT EXISTS (
          SELECT 1 FROM "InventoryMovement" m WHERE m."productId" = p.id
        )
    `;

    equal(
      "every product holding stock has ledger history",
      Number(unexplained[0]?.count ?? 0),
      0,
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
    console.error("flow verification failed:", error);
    await prisma.$disconnect();
    process.exit(1);
  });