/**
 * Sale void/refund and cash shift verification.
 *
 * Covers the money arithmetic and eligibility rules that are easy to get subtly
 * wrong: repeated partial refunds of one line, refunds that must not resell
 * damaged goods, and shift variance arithmetic.
 */

import {
  canRefund,
  canVoid,
  planRefund,
  refundBlockReason,
  refundValueFor,
  remainingReturnable,
  voidBlockReason,
  type RefundableItem,
} from "../src/lib/sales/rules";
import {
  calculateVariance,
  describeVariance,
  expectedCash,
  isMinorVariance,
  validateClosingCash,
} from "../src/lib/shifts/rules";
import {
  applyPromotions,
  eligibleLines,
  evaluatePromotion,
  freeUnitsFor,
  hasUsageRemaining,
  isWithinWindow,
  type PromotionInput,
  type PromotionLine,
} from "../src/lib/promotions/engine";

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

function section(title: string) {
  console.log("");
  console.log(title);
}

/**
 * Builds a promotion fixture.
 *
 * Defaults describe a valid, currently-running promotion so each test only has
 * to state the field it is actually exercising.
 */
const promo = (over: Partial<PromotionInput> = {}): PromotionInput => ({
  id: "promo1",
  code: "HEMAT10",
  name: "Hemat 10%",
  type: "PERCENTAGE",
  // Percentage types carry a fraction: 0.1 is 10%.
  value: 0.1,
  minPurchaseAmount: null,
  buyQuantity: null,
  getQuantity: null,
  categoryId: null,
  startDate: new Date("2026-10-01T00:00:00Z"),
  endDate: new Date("2026-10-31T23:59:59Z"),
  usageLimit: null,
  usedCount: 0,
  isActive: true,
  productIds: [],
  ...over,
});

/**
 * Builds a cart from line literals.
 *
 * A plain identity function rather than a defaulting factory: these tests state
 * every field of every line, so a silent default would hide which rule is
 * actually being exercised.
 */
const cartLines = (entries: PromotionLine[]): PromotionLine[] => entries;



const item = (over: Partial<RefundableItem> = {}): RefundableItem => ({
  saleItemId: "si1",
  productId: "p1",
  name: "Indomie Goreng",
  quantity: 10,
  returnedQty: 0,
  subtotal: 35_000,
  ...over,
});

async function main() {
  section("Refund valuation");

  {
    equal("full line refund returns the whole subtotal", refundValueFor(item(), 10), 35_000);
    equal("half the line returns half", refundValueFor(item(), 5), 17_500);
    equal("single unit", refundValueFor(item(), 1), 3_500);
    equal("zero units worth nothing", refundValueFor(item(), 0), 0);
    equal("over-quantity is capped at the line", refundValueFor(item(), 99), 35_000);
  }

  {
    // An indivisible subtotal must not lose or gain rupiah across splits. The
    // remainder rides on whichever refund completes the line.
    const odd = item({ quantity: 3, subtotal: 10_000 });
    equal("odd subtotal first unit", refundValueFor(odd, 1), 3_333);
    equal("odd subtotal second unit", refundValueFor({ ...odd, returnedQty: 1 }, 1), 3_333);
    equal("odd subtotal final unit absorbs the remainder", refundValueFor({ ...odd, returnedQty: 2, refundedAmount: 6_666 }, 1), 3_334);
    equal("completing refund pays the balance", refundValueFor({ ...odd, returnedQty: 2, refundedAmount: 6_666 }, 1) + 6_666, 10_000);
  }

  {
    // Repeated single-unit refunds must sum to exactly the line subtotal.
    const line = item({ quantity: 10, subtotal: 35_000 });
    let total = 0;
    let returnedQty = 0;
    let refundedAmount = 0;
    for (let i = 0; i < 10; i++) {
      const step = item({ ...line, returnedQty, refundedAmount });
      const value = refundValueFor(step, 1);
      total += value;
      returnedQty += 1;
      refundedAmount += value;
    }
    equal("ten single-unit refunds equal the line", total, 35_000);
    equal("units fully accounted for", returnedQty, 10);
  }

  {
    // An indivisible line refunded one unit at a time must still total exactly.
    const line = item({ quantity: 3, subtotal: 10_000 });
    let total = 0;
    let returnedQty = 0;
    let refundedAmount = 0;
    for (let i = 0; i < 3; i++) {
      const value = refundValueFor(item({ ...line, returnedQty, refundedAmount }), 1);
      total += value;
      returnedQty += 1;
      refundedAmount += value;
    }
    equal("indivisible line refunds sum exactly", total, 10_000);
  }

  {
    // A partial refund can never exceed the outstanding balance.
    const partial = item({ quantity: 10, subtotal: 35_000, returnedQty: 0, refundedAmount: 34_000 });
    equal("partial refund capped at outstanding", refundValueFor(partial, 1), 1_000);
  }

  {
    equal("remaining for an untouched line", remainingReturnable(item()), 10);
    equal("remaining after 4 returned", remainingReturnable(item({ returnedQty: 4 })), 6);
    equal("remaining never negative", remainingReturnable(item({ returnedQty: 15 })), 0);
  }

  section("Refund planning");

  {
    const plan = planRefund([item()], [{ saleItemId: "si1", quantity: 3, condition: "GOOD" }], "COMPLETED");

    equal("three units refunded", plan.lines.length === 1 && plan.lines[0].quantity, 3);
    equal("refund total", plan.totalRefund, 10_500);
    equal("no errors", plan.errors.length, 0);
    equal("restock list has the quantity", plan.restockLines[0].quantity, 3);
    equal("nothing damaged", plan.damagedLines.length, 0);
    equal("partial refund status", plan.newStatus, "PARTIALLY_REFUNDED");
  }

  {
    // A fully returned line flips the sale to REFUNDED.
    const plan = planRefund([item()], [{ saleItemId: "si1", quantity: 10, condition: "GOOD" }], "COMPLETED");
    equal("full refund status", plan.newStatus, "REFUNDED");
  }

  {
    // Damaged goods must NOT re-enter sellable stock.
    const plan = planRefund([item()], [{ saleItemId: "si1", quantity: 2, condition: "DAMAGED" }], "COMPLETED");

    equal("nothing restocked for damaged", plan.restockLines.length, 0);
    equal("damaged recorded separately", plan.damagedLines[0].quantity, 2);
    equal("customer still refunded", plan.totalRefund, 7_000);
  }

  {
    const mixed = planRefund(
      [item({ saleItemId: "a", productId: "p1", subtotal: 10_000, quantity: 2 })],
      [
        { saleItemId: "a", quantity: 1, condition: "GOOD" },
        { saleItemId: "a", quantity: 1, condition: "DAMAGED" },
      ],
      "COMPLETED",
    );
    equal("duplicate line rejected", mixed.errors.length > 0, true);
  }

  {
    const plan = planRefund(
      [item({ returnedQty: 7 })],
      [{ saleItemId: "si1", quantity: 5, condition: "GOOD" }],
      "COMPLETED",
    );
    equal("returning more than remains is rejected", plan.errors.length > 0, true);
    equal("no lines accepted", plan.lines.length, 0);
  }

  {
    const empty = planRefund([item()], [], "COMPLETED");
    equal("empty request rejected", empty.errors.length > 0, true);
  }

  {
    const zero = planRefund([item()], [{ saleItemId: "si1", quantity: 0, condition: "GOOD" }], "COMPLETED");
    equal("zero quantity rejected", zero.errors.length > 0, true);
  }

  {
    const voided = planRefund([item()], [{ saleItemId: "si1", quantity: 1, condition: "GOOD" }], "VOID");
    equal("refund on a voided sale rejected", voided.errors.length > 0, true);
  }

  section("Void and refund eligibility");

  {
    check("completed sale can be voided", canVoid("COMPLETED", false));
    check("sale with refunds cannot be voided", !canVoid("COMPLETED", true));
    check("already voided cannot be voided again", !canVoid("VOID", false));
    check("fully refunded cannot be voided", !canVoid("REFUNDED", false));

    check(
      "void blocked reason explains refunds",
      (voidBlockReason("COMPLETED", true) ?? "").includes("retur"),
    );
    equal("completed sale has no void blocker", voidBlockReason("COMPLETED", false), null);
    equal("voided sale is blocked", voidBlockReason("VOID", false) !== null, true);
  }

  {
    check("completed sale can be refunded", canRefund("COMPLETED", [item()]));
    check("voided sale cannot be refunded", !canRefund("VOID", [item()]));
    check("fully refunded sale cannot be refunded again", !canRefund("REFUNDED", [item()]));
    check(
      "fully returned line blocks further refunds",
      !canRefund("PARTIALLY_REFUNDED", [item({ returnedQty: 10 })]),
    );
    check("partially returned line still allows refund", canRefund("PARTIALLY_REFUNDED", [item({ returnedQty: 3 })]));

    equal("refund blocker explains void", (refundBlockReason("VOID", [item()]) ?? "").includes("void"), true);
  }

  section("Cash shift arithmetic");

  {
    const base = {
      openingCash: 500_000,
      cashSales: 2_000_000,
      cashRefunds: 0,
      cashIn: 100_000,
      cashOut: 50_000,
    };

    equal("expected cash", expectedCash(base), 2_550_000);

    const withRefund = { ...base, cashRefunds: 150_000 };
    equal("refunds reduce expected cash", expectedCash(withRefund), 2_400_000);
  }

  {
    const base = {
      openingCash: 500_000,
      cashSales: 2_000_000,
      cashRefunds: 0,
      cashIn: 0,
      cashOut: 0,
    };

    const exact = calculateVariance(base, 2_500_000);
    equal("exact count is balanced", exact.direction, "balanced");
    equal("variance is zero", exact.variance, 0);
    check("balanced needs no explanation", !exact.requiresExplanation);

    const short = calculateVariance(base, 2_480_000);
    equal("short drawer detected", short.direction, "short");
    equal("short variance is negative", short.variance, -20_000);
    check("short requires explanation", short.requiresExplanation);
    check(
      "description states the shortfall",
      describeVariance(short).includes("20.000"),
    );

    const over = calculateVariance(base, 2_520_000);
    equal("over drawer detected", over.direction, "over");

    // Small coin-level differences should not raise an alarm.
    const coinNoise = calculateVariance(base, 2_500_200);
    equal("coin noise is tolerated", coinNoise.direction, "balanced");
    check("coin noise needs no explanation", !coinNoise.requiresExplanation);
  }

  {
    equal("negative closing rejected", validateClosingCash(-100).valid, false);
    equal("fractional closing rejected", validateClosingCash(1000.5).valid, false);
    equal("zero closing accepted", validateClosingCash(0).valid, true);
    equal("valid closing accepted", validateClosingCash(1_000_000).valid, true);
  }

{
    check("coin rounding is a minor reason", isMinorVariance("Selisih pembulatan koin"));
    check("theft is not a minor reason", !isMinorVariance("Barang hilang / dicuri"));
  }

  // ── Promotions ────────────────────────────────────────────────────────
  section("Promotion: window and usage");

  const NOW = new Date("2026-10-07T10:00:00Z");

  {
    check("in-window promotion is live",
      isWithinWindow({ startDate: new Date("2026-10-01"), endDate: new Date("2026-10-31") }, NOW));
    check("before start is not live",
      !isWithinWindow({ startDate: new Date("2026-10-08"), endDate: new Date("2026-10-31") }, NOW));
    check("after end is not live",
      !isWithinWindow({ startDate: new Date("2026-09-01"), endDate: new Date("2026-09-30") }, NOW));
    check("start bound is inclusive",
      isWithinWindow({ startDate: NOW, endDate: NOW }, NOW));

    check("no limit means unlimited", hasUsageRemaining(promo({ usageLimit: null, usedCount: 9999 })));
    check("under the limit is usable", hasUsageRemaining(promo({ usageLimit: 10, usedCount: 9 })));
    check("at the limit is exhausted", !hasUsageRemaining(promo({ usageLimit: 10, usedCount: 10 })));
  }

  section("Promotion: free units for BUY_X_GET_Y");

  {
    // The remainder carrying over is what makes the count match the signage.
    equal("buy 2 get 1 at qty 2 grants nothing", freeUnitsFor(2, 2, 1), 0);
    equal("buy 2 get 1 at qty 3 grants 1", freeUnitsFor(3, 2, 1), 1);
    equal("buy 2 get 1 at qty 4 grants 2", freeUnitsFor(4, 2, 1), 2);
    equal("buy 2 get 1 at qty 5 grants 2", freeUnitsFor(5, 2, 1), 2);
    equal("buy 3 get 1 at qty 4 grants 1", freeUnitsFor(4, 3, 1), 1);

    // Never grant more free units than were actually put in the cart.
    check("free units never exceed the cart",
      freeUnitsFor(2, 1, 5) <= 2, String(freeUnitsFor(2, 1, 5)));
    equal("zero quantity grants nothing", freeUnitsFor(0, 2, 1), 0);
    equal("zero buy quantity grants nothing", freeUnitsFor(5, 0, 1), 0);
  }

  section("Promotion: percentage");

  {
    const cart = cartLines([
      { productId: "p1", name: "Kopi", categoryId: "c1", quantity: 2, unitPrice: 15_000 },
    ]);

    const tenPercent = evaluatePromotion(
      promo({ type: "PERCENTAGE", value: 0.1 }),
      cart,
      NOW,
    );
    check("percentage applies", tenPercent.valid, tenPercent.reason);
    equal("10% of 30.000 is 3.000", tenPercent.discount, 3_000);

    // A 10% voucher reached over a threshold must discount the whole cart,
    // otherwise the customer is penalised for the items that qualified it.
    const cartWithExtra = cartLines([
      { productId: "p1", name: "Kopi", categoryId: "c1", quantity: 2, unitPrice: 15_000 },
      { productId: "p2", name: "Roti", categoryId: "c2", quantity: 1, unitPrice: 10_000 },
    ]);
    const wholeCart = evaluatePromotion(
      promo({ type: "PERCENTAGE", value: 0.1 }),
      cartWithExtra,
      NOW,
    );
    equal("10% of 40.000 is 4.000", wholeCart.discount, 4_000);
    equal("percentage covers every line", wholeCart.eligibleProductIds.length, 2);

    const over100 = evaluatePromotion(promo({ type: "PERCENTAGE", value: 1.5 }), cart, NOW);
    check("a 150% promo is rejected as misconfigured",
      over100.rejection === "INVALID_CONFIGURATION", over100.reason);

    const zero = evaluatePromotion(promo({ type: "PERCENTAGE", value: 0 }), cart, NOW);
    check("a 0% promo is rejected", zero.rejection === "INVALID_CONFIGURATION");
  }

  section("Promotion: fixed amount");

  {
    const cart = cartLines([
      { productId: "p1", name: "Kopi", categoryId: "c1", quantity: 1, unitPrice: 5_000 },
    ]);

    const ok = evaluatePromotion(promo({ type: "FIXED", value: 3_000 }), cart, NOW);
    check("fixed discount applies", ok.valid, ok.reason);
    equal("fixed discount is exact", ok.discount, 3_000);

    // A voucher larger than the cart must clamp, never produce a negative total.
    const huge = evaluatePromotion(promo({ type: "FIXED", value: 99_000 }), cart, NOW);
    equal("oversized voucher clamps to the cart", huge.discount, 5_000);
  }

  section("Promotion: minimum purchase");

  {
    const small = cartLines([
      { productId: "p1", name: "Kopi", categoryId: "c1", quantity: 1, unitPrice: 20_000 },
    ]);
    const big = cartLines([
      { productId: "p1", name: "Kopi", categoryId: "c1", quantity: 5, unitPrice: 20_000 },
    ]);

    const threshold = promo({
      type: "MINIMUM_PURCHASE",
      value: 0.1,
      minPurchaseAmount: 50_000,
    });

    const below = evaluatePromotion(threshold, small, NOW);
    check("below the minimum is rejected", below.rejection === "BELOW_MINIMUM", below.reason);

    const met = evaluatePromotion(threshold, big, NOW);
    check("meeting the minimum applies", met.valid, met.reason);
    equal("10% of 100.000 is 10.000", met.discount, 10_000);

    const noThreshold = evaluatePromotion(
      promo({ type: "MINIMUM_PURCHASE", value: 0.1, minPurchaseAmount: null }),
      big,
      NOW,
    );
    check("a missing threshold is misconfigured",
      noThreshold.rejection === "INVALID_CONFIGURATION");
  }

  section("Promotion: product and category scope");

  {
    const cart = cartLines([
      { productId: "p1", name: "Kopi", categoryId: "c1", quantity: 1, unitPrice: 50_000 },
      { productId: "p2", name: "Roti", categoryId: "c2", quantity: 1, unitPrice: 30_000 },
    ]);

    const scoped = evaluatePromotion(
      promo({ type: "PRODUCT", value: 0.5, productIds: ["p1"] }),
      cart,
      NOW,
    );
    check("product promo applies", scoped.valid, scoped.reason);
    equal("only the targeted product is discounted", scoped.discount, 25_000);
    equal("only one eligible product", scoped.eligibleProductIds.length, 1);

    const byCategory = evaluatePromotion(
      promo({ type: "CATEGORY", value: 0.2, categoryId: "c2" }),
      cart,
      NOW,
    );
    equal("category promo discounts only its category", byCategory.discount, 6_000);

    // A category promo pointed at a category nobody bought must not silently
    // discount the entire cart.
    const absent = evaluatePromotion(
      promo({ type: "CATEGORY", value: 0.2, categoryId: "c99" }),
      cart,
      NOW,
    );
    check("an unmatched category is rejected", absent.rejection === "NO_ELIGIBLE_ITEMS");
    equal("an unmatched category grants nothing", absent.discount, 0);

    const selected = eligibleLines(
      promo({ type: "PRODUCT", productIds: ["p2"] }),
      cart,
    );
    equal("eligibleLines narrows correctly", selected.length, 1);
    equal("eligibleLines picks the right product", selected[0].productId, "p2");
  }

  section("Promotion: buy X get Y");

  {
    const cart = cartLines([
      { productId: "p1", name: "Susu", categoryId: "c1", quantity: 3, unitPrice: 10_000 },
    ]);

    const verdict = evaluatePromotion(
      promo({ type: "BUY_X_GET_Y", value: 0, buyQuantity: 2, getQuantity: 1 }),
      cart,
      NOW,
    );
    check("buy 2 get 1 applies at qty 3", verdict.valid, verdict.reason);
    equal("the free unit is discounted", verdict.discount, 10_000);
    equal("only the qualifying product is listed", verdict.eligibleProductIds.length, 1);

    // Below the threshold nothing is granted.
    const tooFew = evaluatePromotion(
      promo({ type: "BUY_X_GET_Y", value: 0, buyQuantity: 2, getQuantity: 1 }),
      cartLines([{ productId: "p1", name: "Susu", categoryId: "c1", quantity: 2, unitPrice: 10_000 }]),
      NOW,
    );
    equal("buy 2 get 1 at qty 2 grants nothing", tooFew.discount, 0);

    // With two qualifying lines, the cheapest is the free one.
    const twoLines = cartLines([
      { productId: "p1", name: "Mahal", categoryId: "c1", quantity: 3, unitPrice: 50_000 },
      { productId: "p2", name: "Murah", categoryId: "c1", quantity: 3, unitPrice: 5_000 },
    ]);
    const cheapestFree = evaluatePromotion(
      promo({ type: "BUY_X_GET_Y", value: 0, buyQuantity: 2, getQuantity: 1 }),
      twoLines,
      NOW,
    );
    equal("the cheapest line gives the free unit", cheapestFree.discount, 5_000);

    const unconfigured = evaluatePromotion(
      promo({ type: "BUY_X_GET_Y", value: 0, buyQuantity: 0, getQuantity: 1 }),
      cart,
      NOW,
    );
    check("a missing buy quantity is misconfigured",
      unconfigured.rejection === "INVALID_CONFIGURATION");
  }

  section("Promotion: expiry and stacking");

  {
    const cart = cartLines([
      { productId: "p1", name: "Kopi", categoryId: "c1", quantity: 2, unitPrice: 25_000 },
    ]);

    const expired = evaluatePromotion(
      promo({
        endDate: new Date("2026-09-01"),
        type: "PERCENTAGE",
        value: 0.5,
      }),
      cart,
      NOW,
    );
    check("expired promo is rejected", expired.rejection === "EXPIRED", expired.reason);

    const future = evaluatePromotion(
      promo({
        startDate: new Date("2026-11-01"),
        type: "PERCENTAGE",
        value: 0.5,
      }),
      cart,
      NOW,
    );
    check("future promo is rejected", future.rejection === "NOT_STARTED");

    const inactive = evaluatePromotion(
      promo({ isActive: false, type: "PERCENTAGE", value: 0.5 }),
      cart,
      NOW,
    );
    check("inactive promo is rejected", inactive.rejection === "INACTIVE");

    const exhausted = evaluatePromotion(
      promo({ type: "PERCENTAGE", value: 0.5, usageLimit: 5, usedCount: 5 }),
      cart,
      NOW,
    );
    check("exhausted promo is rejected", exhausted.rejection === "USAGE_LIMIT_REACHED");

    // Stacking two half-off promos would drive the cart to zero, so only the
    // first is honoured.
    const stacked = applyPromotions(
      [
        promo({ code: "A", type: "PERCENTAGE", value: 0.5 }),
        promo({ code: "B", type: "PERCENTAGE", value: 0.5 }),
      ],
      cart,
      NOW,
    );
    equal("only one promo is applied", stacked.applied?.code, "A");
    equal("the second promo is reported as ignored", stacked.ignored.length, 1);
    equal("total discount is not doubled", stacked.totalDiscount, 25_000);

    // A promotion larger than the cart still cannot make the total negative.
    const clamped = applyPromotions(
      [promo({ code: "BIG", type: "FIXED", value: 10_000_000 })],
      cart,
      NOW,
    );
    equal("oversized discount clamps to the cart", clamped.totalDiscount, 50_000);

    const none = applyPromotions([], cart, NOW);
    equal("no promotions means no discount", none.totalDiscount, 0);
    equal("no promotions means nothing applied", none.applied, undefined);
  }

  console.log("");
  if (failures.length > 0) {
    console.log("FAILURES:");
    for (const failure of failures) console.log("  - " + failure);
  }
  console.log("  " + passed + " passed, " + failed + " failed");

  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});


