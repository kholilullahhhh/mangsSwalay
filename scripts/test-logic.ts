/**
 * Business-logic checks for the pure pricing/stock functions.
 *
 * These run without a database, so the money rules are verified even before the
 * Neon connection exists. Run with: npm run test:logic
 *
 * Covers the cases the spec calls out explicitly: insufficient payment, cash
 * change, discount overflow, stock limits, and loyalty rounding.
 */

import {
  addToCart,
  calculateChange,
  calculatePoints,
  calculateTotals,
  cartSubtotal,
  pointsToValue,
  setQuantity,
  suggestCashAmounts,
  validateCart,
  type CartLine,
} from "../src/lib/pos/cart";
import {
  getStockState,
  stockRatio,
} from "../src/components/data/stock-badge";
import {
  documentPrefix,
} from "../src/lib/documents";
import {
  formatPercentChange,
  startOfStoreDay,
} from "../src/lib/format";
import {
  parsePagination,
  resolveSort,
  toPageRequest,
} from "../src/lib/pagination";
import {
  PERMISSIONS,
  permissionsForRole,
  roleHasPermission,
} from "../src/lib/rbac";

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

const line = (over: Partial<CartLine> = {}): CartLine => ({
  productId: "p1",
  sku: "SKU-1",
  name: "Indomie Goreng",
  unit: "PACK",
  quantity: 2,
  unitPrice: 3500,
  availableStock: 100,
  ...over,
});

// ─── Cart totals ───────────────────────────────────────────────────────────
section("Cart totals");

{
  const totals = calculateTotals({ lines: [line()] });
  equal("2 × 3500 = 7000", totals.subtotal, 7000);
  equal("total equals subtotal with no discount", totals.total, 7000);
  equal("quantity counted", totals.totalQuantity, 2);
  equal("distinct lines counted", totals.itemCount, 1);
}

{
  const totals = calculateTotals({
    lines: [line({ quantity: 3, lineDiscount: 500 })],
  });
  equal("line discount subtracted", totals.subtotal, 3 * 3500 - 500);
  equal("line discount totalled", totals.lineDiscountTotal, 500);
}

{
  const totals = calculateTotals({
    lines: [line()],
    manualDiscount: 1000,
  });
  equal("manual discount applied", totals.manualDiscount, 1000);
  equal("total after manual discount", totals.total, 6000);
}

{
  // A discount larger than the total must clamp to zero, never go negative.
  const totals = calculateTotals({
    lines: [line()],
    manualDiscount: 999_999,
  });
  equal("oversized discount clamps to total", totals.total, 0);
  equal("clamped discount equals subtotal", totals.manualDiscount, 7000);
}

{
  // Promotion + manual discount together still cannot exceed the subtotal.
  const totals = calculateTotals({
    lines: [line()],
    promotions: [
      { code: "A", name: "A", discountAmount: 5000 },
      { code: "B", name: "B", discountAmount: 5000 },
    ],
    manualDiscount: 5000,
  });
  equal("stacked discounts clamp to zero total", totals.total, 0);
}

{
  // Tax must be charged on the post-discount amount, not the sticker price.
  const totals = calculateTotals({
    lines: [line()],
    manualDiscount: 1000,
    taxRate: 0.11,
  });
  equal("tax computed after discount", totals.tax, Math.round(6000 * 0.11));
  equal("total includes tax", totals.total, 6000 + Math.round(6000 * 0.11));
}

{
  // The integer-rubiah property: a cart that would drift with floats must not.
  const totals = calculateTotals({
    lines: Array.from({ length: 30 }, (_, index) =>
      line({ productId: `p${index}`, unitPrice: 3333, quantity: 3 }),
    ),
  });
  equal("30 lines sum exactly", totals.subtotal, 30 * 3 * 3333);
}

{
  const totals = calculateTotals({ lines: [line()], manualDiscount: -500 });
  equal("negative manual discount ignored", totals.manualDiscount, 0);
}

// ─── Cash payment ──────────────────────────────────────────────────────────
section("Payment");

{
  const exact = calculateChange(10_000, 10_000);
  equal("exact payment yields no change", exact.change, 0);
  check("exact payment is sufficient", exact.isSufficient);

  const over = calculateChange(10_000, 25_000);
  equal("change calculated", over.change, 15_000);

  const under = calculateChange(10_000, 8_000);
  check("underpayment rejected", !under.isSufficient);
  equal("shortfall reported as positive", under.shortfall, 2_000);
  equal("no negative change", under.change, 0);
}

{
  const suggestions = suggestCashAmounts(23_500);
  check(
    "suggested amounts all cover the total",
    suggestions.every((suggestion) => suggestion.amount >= 23_500),
  );
  check("suggestions are non-empty", suggestions.length > 0);
}

{
  // Very small totals should still get a usable suggestion.
  const suggestions = suggestCashAmounts(500);
  check("small total gets suggestions", suggestions.length > 0);
}

// ─── Cart manipulation ─────────────────────────────────────────────────────
section("Cart manipulation");

{
  const empty: CartLine[] = [];
  const added = addToCart(empty, line());
  equal("item added", added.lines.length, 1);
  equal("no error on add", added.error, undefined);
}

{
  const added = addToCart([line()], line());
  equal("adding same product merges", added.lines.length, 1);
  equal("quantities summed", added.lines[0].quantity, 4);
}

{
  const result = addToCart([line()], line({ quantity: 200 }));
  equal("adding beyond stock is refused", result.lines.length, 1);
  equal("quantity unchanged on refusal", result.lines[0].quantity, 2);
  check("refusal explains why", Boolean(result.error));
}

{
  const result = setQuantity([line()], "p1", 5);
  equal("quantity updated", result.lines[0].quantity, 5);

  const removed = setQuantity([line()], "p1", 0);
  equal("zero quantity removes the line", removed.lines.length, 0);

  const tooMany = setQuantity([line()], "p1", 500);
  equal("over-stock quantity refused", tooMany.lines[0].quantity, 2);

  const negative = setQuantity([line()], "p1", -3);
  check("negative quantity refused", Boolean(negative.error));

  const fractional = setQuantity([line()], "p1", 1.5);
  check("fractional quantity refused", Boolean(fractional.error));
}

{
  const subtotal = cartSubtotal([
    line({ productId: "a", quantity: 2, unitPrice: 5000 }),
    line({ productId: "b", quantity: 1, unitPrice: 2500 }),
  ]);
  equal("multi-line subtotal", subtotal, 12_500);
}

// ─── Cart validation ───────────────────────────────────────────────────────
section("Cart validation");

{
  equal("empty cart has no line problems", validateCart([]).length, 0);

  const overStock = validateCart([line({ quantity: 5, availableStock: 2 })]);
  check("over-stock reported", overStock.length > 0);
  check(
    "message names the available quantity",
    overStock[0].message.includes("tersedia 2"),
  );

  const duplicate = validateCart([line(), line()]);
  check("duplicate product reported", duplicate.length > 0);
}

// ─── Stock state ───────────────────────────────────────────────────────────
section("Stock state");

{
  equal("zero stock is out", getStockState(0, 10), "out");
  equal("negative stock treated as out", getStockState(-1, 10), "out");
  equal("at minimum is low", getStockState(10, 10), "low");
  equal("below minimum is low", getStockState(3, 10), "low");
  equal("above minimum is ok", getStockState(11, 10), "ok");
  equal("no minimum set is ok", getStockState(1, 0), "ok");
  equal("ratio clamps to 100", stockRatio(999, 10), 100);
  equal("ratio never negative", stockRatio(0, 10), 0);
}

// ─── Loyalty ───────────────────────────────────────────────────────────────
section("Loyalty");

{
  equal("10.000 rupiah earns 1 point", calculatePoints(10_000, 10_000), 1);
  equal("points floor, not round", calculatePoints(19_999, 10_000), 1);
  equal("zero total earns nothing", calculatePoints(0, 10_000), 0);
  equal("zero ratio earns nothing", calculatePoints(50_000, 0), 0);
  equal("points value", pointsToValue(10, 500), 5_000);
  equal("negative points worth nothing", pointsToValue(-5, 500), 0);
}

// ─── Document numbering ────────────────────────────────────────────────────
section("Document numbering");

{
  const date = new Date("2026-10-06T03:00:00Z");
  equal("invoice prefix format", documentPrefix("INV", date), "INV-20261006-");
  equal("purchase prefix format", documentPrefix("PO", date), "PO-20261006-");
}

// ─── Pagination ────────────────────────────────────────────────────────────
section("Pagination");

{
  equal("default page", parsePagination({}).page, 1);
  equal("default per page", parsePagination({}).perPage, 20);

  const capped = parsePagination({ perPage: "99999" });
  check("perPage capped", capped.perPage <= 100, `got ${capped.perPage}`);

  const negative = parsePagination({ page: "-5" });
  equal("negative page falls back to 1", negative.page, 1);

  const first = toPageRequest(45, { page: 1, perPage: 20 });
  equal("page count", first.pageCount, 3);
  equal("first skip", first.skip, 0);

  const third = toPageRequest(45, { page: 3, perPage: 20 });
  equal("third page skip", third.skip, 40);

  const past = toPageRequest(45, { page: 99, perPage: 20 });
  equal("page beyond end clamps", past.page, 3);

  const empty = toPageRequest(0, { page: 1, perPage: 20 });
  equal("zero rows still has one page", empty.pageCount, 1);
}

{
  const fields = { name: "name", stock: "stock" } as const;
  equal("known sort field honoured", resolveSort("stock", "desc", fields, "name")["stock"], "desc");
  equal(
    "unknown sort field falls back",
    resolveSort("passwordHash", "desc", fields, "name")["name"],
    "asc",
  );
  equal("direction is constrained", resolveSort("name", "DROP TABLE", fields, "name")["name"], "asc");
}

// ─── RBAC ──────────────────────────────────────────────────────────────────
section("RBAC");

{
  check("cashier can use POS", roleHasPermission("CASHIER", "pos:use"));
  check("cashier cannot adjust stock", !roleHasPermission("CASHIER", "stock:adjust"));
  check("cashier cannot manage users", !roleHasPermission("CASHIER", "users:manage"));
  check("admin cannot manage users", !roleHasPermission("ADMIN", "users:manage"));
  check("super admin can do everything", roleHasPermission("SUPER_ADMIN", "users:manage"));

  check(
    "cashier sees only own sales",
    roleHasPermission("CASHIER", "sales:view-own") &&
      !roleHasPermission("CASHIER", "sales:view"),
  );

  equal(
    "super admin holds every permission",
    permissionsForRole("SUPER_ADMIN").length,
    PERMISSIONS.length,
  );

  // Every role's permission list must be real, not typos.
  const allRoles = ["SUPER_ADMIN", "ADMIN", "MANAGER", "CASHIER", "STOCK_OPERATOR"] as const;
  let unknown = 0;
  for (const role of allRoles) {
    for (const permission of permissionsForRole(role)) {
      if (!roleHasPermission("SUPER_ADMIN", permission)) unknown++;
    }
  }
  equal("no role grants an unknown permission", unknown, 0);
}

// ─── Formatting ────────────────────────────────────────────────────────────
section("Formatting");

{
  const change = formatPercentChange(150, 100);
  equal("percent increase", change?.text, "+50.0%");
  equal("direction is up", change?.direction, "up");

  const down = formatPercentChange(50, 100);
  equal("direction is down", down?.direction, "down");

  equal("no baseline returns null", formatPercentChange(50, 0), null);
  equal("flat change", formatPercentChange(100, 100)?.direction, "flat");

  // Store day boundaries are computed in WIB, so a 20:00 UTC timestamp is already
  // the next calendar day in Jakarta.
  const start = startOfStoreDay(new Date("2026-10-06T20:00:00Z"));
  equal("WIB day boundary is 17:00 UTC", start.toISOString(), "2026-10-06T17:00:00.000Z");
}

// ─── Summary ───────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(60)}`);
console.log(`  ${passed} passed, ${failed} failed`);
console.log("─".repeat(60));

if (failed > 0) {
  process.exit(1);
}