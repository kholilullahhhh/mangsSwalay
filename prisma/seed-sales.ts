/**
 * Dummy sales history generator.
 *
 * `prisma/seed.ts` seeds the *catalogue* (users, products, promotions) and five
 * hand-written sales from a single September afternoon. That is enough to prove
 * the screens render, and useless for the reports: every sales chart, the profit
 * report, the product-performance ranking, the payment mix and the cash-flow
 * screen need months of history before they show anything a human would call a
 * trend. This script generates that history.
 *
 * ── What "realistic" means here ────────────────────────────────────────────
 * A random `total` per row would produce a flat, obviously synthetic chart. The
 * generator instead models a minimarket day: more baskets at the weekend and
 * around payday, two rush hours instead of a flat spread, cheap high-frequency
 * staples bought in multiples next to expensive items bought one at a time, cash
 * dominating because that is what an Indonesian minimarket actually sees, and a
 * slow upward drift across the window so month-over-month has a direction.
 *
 * ── Why it does not just INSERT rows ───────────────────────────────────────
 * Because the sales ledger is the thing that makes this database trustworthy,
 * and it is easy to break. Every generated sale therefore:
 *
 *  1. Moves stock through `InventoryMovement`, chained `previousStock` →
 *     `newStock`, so the ledger still replays to `Product.stock` (the invariant
 *     `scripts/test-ledger.ts` asserts).
 *  2. Is paid for by a `CashShift` whose `expectedCash` is computed from the
 *     cash sales actually booked against it, so the shift screen's variance is a
 *     real variance instead of a made-up one.
 *  3. Credits loyalty points to the member and rolls them back on a refund.
 *  4. Leaves `Product.stock` above `minStock`, because the seed deliberately
 *     stocks a handful of products at or below their minimum as fixtures for the
 *     low-stock and out-of-stock alerts. Those products are excluded from
 *     generation entirely — a history that quietly sold them away would delete
 *     the very alerts the dashboard is supposed to raise.
 *
 * Products whose ledger already disagrees with their counter are also skipped:
 * appending to a chain that is already broken hides the break rather than fixing
 * it, and the run reports them instead.
 *
 * ── Usage ──────────────────────────────────────────────────────────────────
 *   npm run db:seed:sales                 # 180 days, ~28 sales/day
 *   npm run db:seed:sales -- --days=90 --per-day=20
 *   npm run db:seed:sales -- --dry-run    # plan only, writes nothing
 *   npm run db:seed:sales -- --reset      # remove a previous run first
 *
 * `--reset` is exact rather than best-effort: the run stores the stock, batch
 * and loyalty values it displaced in `StoreSetting["dummy.sales.v1"]`, and
 * restores those values, so a reset returns the database to the state the seed
 * left it in.
 */

import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../src/generated/prisma/client";
import {
  PaymentMethod,
  SaleStatus,
  ShiftStatus,
  StockMovementType,
} from "../src/generated/prisma/enums";
import { calculateTotals, type CartLine } from "../src/lib/pos/cart";
import { allocateProportionally } from "../src/lib/sales/rules";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is not set. Add it to .env before generating data.");
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

// ── Configuration ───────────────────────────────────────────────────────────

const MARKER_KEY = "dummy.sales.v1";

/**
 * Every generated row is recognisable by this prefix, which is what makes
 * `--reset` and manual cleanup in Prisma Studio possible. It deliberately
 * breaks the `INV-YYYYMMDD-NNNN` shape the real document numbering produces
 * (`src/lib/documents.ts`): a fixture that looks exactly like a real invoice is
 * a fixture someone will eventually mistake for a real one.
 */
const INVOICE_PREFIX = "INV-DUMMY";
const REFUND_PREFIX = "RFD-DUMMY";
const SHIFT_PREFIX = "SFT-DUMMY";

/**
 * Timestamps are stored in UTC and displayed in WIB, so the generator works in
 * WIB wall-clock hours and shifts them once. Indonesia has no DST, so this is a
 * flat offset rather than a zone.
 */
const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

/** Rows per INSERT. Large enough to be quick, small enough to stay under Neon timeouts. */
const INSERT_CHUNK = 500;

const STORE_OPEN_HOUR = 7;
const STORE_CLOSE_HOUR = 21;

/** Cash float the drawer opens with, in rupiah. */
const OPENING_CASH = 200_000;

// ── Shape of a trading day ───────────────────────────────────────────────────

/** Indexed by `Date.getDay()`. Sunday and Saturday are the busy ones. */
const DAY_FACTOR = [1.35, 0.82, 0.8, 0.85, 0.9, 1.0, 1.25];

/** Baskets per hour of the trading day, 07:00–21:00. Two rush hours. */
const HOUR_WEIGHT = [
  2, 5, 6, 5, 4, 6, 8, 9, 7, 5, 4, 3, 4, 5, 7, 8,
];

const PAYMENT_WEIGHTS: Array<[PaymentMethod, number]> = [
  ["CASH", 34],
  ["QRIS", 30],
  ["E_WALLET", 13],
  ["DEBIT", 10],
  ["CREDIT_CARD", 8],
  ["TRANSFER", 5],
];

const CASHIER_WEIGHTS: Array<[string, number]> = [
  ["kasir", 70],
  ["admin", 15],
  ["manager", 15],
];

/**
 * Basket sizes. One or two lines is the common Indonesian minimarket run; the
 * long tail exists because a monthly grocery shop is a real basket too.
 */
const LINE_COUNT_WEIGHT = [34, 28, 18, 10, 6, 4];

/**
 * Products that turn over fast. Weight is a sales multiplier, not a stock
 * level: instant noodles and bottled water are bought constantly and in small
 * numbers, an air conditioner filter essentially never.
 */
const VELOCITY: Record<string, number> = {
  "MKN-001": 9, // Indomie Goreng
  "MNM-001": 8, // Air Mineral
  "MNM-004": 7, // Kopi Kapal Api
  "SMB-002": 6, // Gula Pasir
  "SMB-005": 5, // Garam Halus
  "SNK-001": 4, // Chitato
  "PDR-002": 3, // Sabun Batang
  "MNM-002": 3, // Teh Pucuk
  "SMB-004": 3, // Telur
  "ATK-002": 2,
  "SMB-001": 2, // Beras — big ticket, low frequency
  "MKN-002": 2,
  "KBR-002": 2,
  "RHT-001": 1,
  "RHT-002": 1,
  "PDR-001": 1,
  "SNK-003": 1,
  "SNK-002": 1,
  "ATK-001": 1,
  "MKN-003": 2,
  "FRZ-001": 2,
  "SMB-003": 2,
  "FRZ-002": 1,
  "KBR-001": 1,
  "KBR-003": 1,
};

/** Above this price a minimarket basket buys one, not four. */
const BULKY_PRICE_THRESHOLD = 30_000;

const VOID_RATE = 0.012;
const REFUND_RATE = 0.015;
/** Refunds need a sale old enough to have been brought back. */
const REFUND_MIN_AGE_DAYS = 3;

const REFUND_REASONS = [
  "Barang rusak dikemasan",
  "Pelanggan membatalkan sebagian",
  "Salah ambil jumlah",
  "Kadaluarsa lebih cepat dari perkiraan",
  "Barang tidak sesuai pesanan",
];

const VARIANCE_REASONS = [
  "Selisih pembulatan koin",
  "Uang salah kembalian",
  "Lainnya",
];

// ── Argument parsing ─────────────────────────────────────────────────────────

interface Options {
  days: number;
  perDay: number;
  seed: number;
  reset: boolean;
  dryRun: boolean;
}

function parseArgs(argv: string[]): Options {
  const value = (name: string, fallback: number) => {
    const match = argv.find((arg) => arg.startsWith(`--${name}=`));

    if (!match) return fallback;

    const parsed = Number(match.slice(name.length + 3));

    return Number.isFinite(parsed) ? parsed : fallback;
  };

  return {
    days: Math.max(1, Math.round(value("days", 180))),
    perDay: Math.max(1, Math.round(value("per-day", 28))),
    seed: Math.round(value("seed", 20_261_009)),
    reset: argv.includes("--reset"),
    dryRun: argv.includes("--dry-run"),
  };
}

/**
 * Deterministic PRNG (mulberry32). A seeder that produces different data on
 * every run cannot be used to compare two screenshots, and `--reset` would have
 * nothing to restore.
 */
function createRandom(seed: number): () => number {
  let state = seed >>> 0;

  return () => {
    state = (state + 0x6d2b79f5) >>> 0;

    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);

    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function pickWeighted<T>(random: () => number, entries: Array<[T, number]>): T {
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = random() * total;

  for (const [value, weight] of entries) {
    roll -= weight;

    if (roll <= 0) return value;
  }

  return entries[entries.length - 1][0];
}

function pickIndex(random: () => number, weights: number[]): number {
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let roll = random() * total;

  for (let index = 0; index < weights.length; index += 1) {
    roll -= weights[index];

    if (roll <= 0) return index;
  }

  return weights.length - 1;
}

// ── Time helpers ────────────────────────────────────────────────────────────

/** WIB wall clock → the UTC instant it denotes. */
function wibTime(dayUtcMidnight: Date, hour: number, minute: number, second = 0): Date {
  return new Date(
    dayUtcMidnight.getTime() + (hour * 60 + minute) * 60_000 - WIB_OFFSET_MS + second * 1000,
  );
}

/** Midnight WIB of the day `date` (UTC instant) falls on, expressed as a UTC date. */
function wibMidnight(date: Date): Date {
  const shifted = new Date(date.getTime() + WIB_OFFSET_MS);

  return new Date(
    Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()),
  );
}

function formatDay(date: Date): string {
  const shifted = new Date(date.getTime() + WIB_OFFSET_MS);
  const pad = (value: number) => String(value).padStart(2, "0");

  return `${shifted.getUTCFullYear()}${pad(shifted.getUTCMonth() + 1)}${pad(shifted.getUTCDate())}`;
}

// ── Generated shapes ─────────────────────────────────────────────────────────

interface ProductRow {
  id: string;
  sku: string;
  name: string;
  unit: string;
  stock: number;
  minStock: number;
  sellingPrice: number;
  purchasePrice: number;
  /** False when the product must not be sold by this script, with the reason. */
  sellable: boolean;
  reason?: string;
}

interface SaleItemPlan {
  id: string;
  productId: string;
  quantity: number;
  price: number;
  cost: number;
  discount: number;
  subtotal: number;
  /** Units given back by a later refund; 0 until one exists. */
  returnedQty: number;
}

interface SalePlan {
  id: string;
  invoiceNumber: string;
  customerId: string | null;
  userId: string;
  shiftKey: string;
  date: Date;
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  paymentMethod: PaymentMethod;
  amountPaid: number;
  change: number;
  status: SaleStatus;
  pointsEarned: number;
  promotionCode: string | null;
  notes: string | null;
  voidedAt: Date | null;
  voidReason: string | null;
  items: SaleItemPlan[];
}

interface RefundPlan {
  id: string;
  number: string;
  sale: SalePlan;
  date: Date;
  totalRefund: number;
  reason: string;
  approvedById: string;
  items: Array<{
    id: string;
    saleItemId: string;
    productId: string;
    quantity: number;
    amount: number;
  }>;
  /** Stock that goes back on the shelf, and the sale items it comes from. */
  restock: Array<{ saleItem: SaleItemPlan; quantity: number }>;
}

interface ShiftPlan {
  id: string;
  number: string;
  userId: string;
  openedAt: Date;
  closedAt: Date;
  openingCash: number;
  /** Cash sales booked against this shift, accumulated while generating. */
  cashSales: number;
  /** Cash refunds paid out of this shift's drawer. */
  cashRefunds: number;
  expectedCash: number;
  closingCash: number;
  variance: number;
  sales: SalePlan[];
}

interface StockEvent {
  date: Date;
  productId: string;
  type: StockMovementType;
  quantity: number;
  direction: "IN" | "OUT";
  referenceType: string;
  referenceId: string | null;
  note: string;
  userId: string;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const random = createRandom(options.seed);

  console.log("🧾 Generating dummy sales history\n");
  console.log(`  window      ${options.days} days`);
  console.log(`  density     ~${options.perDay} sales/day`);
  console.log(`  rng seed    ${options.seed}`);

  if (options.reset) {
    // `--dry-run` must never destroy a previous run, however it is combined.
    if (!options.dryRun) {
      await resetPreviousRun();
    }
  } else {
    const marker = await prisma.storeSetting.findUnique({
      where: { key: MARKER_KEY },
      select: { value: true },
    });

    if (marker) {
      console.log(
        `\n  ${MARKER_KEY} already exists — a previous run is in this database.`,
      );
      console.log("  Re-run with --reset to replace it, or --dry-run to plan.\n");

      return;
    }
  }

  // ── Catalogue ─────────────────────────────────────────────────────────────

  const [products, batches, users, customers, settings, promotions] = await Promise.all([
    prisma.product.findMany({
      select: {
        id: true,
        sku: true,
        name: true,
        unit: true,
        stock: true,
        minStock: true,
        isActive: true,
        sellingPrice: true,
        purchasePrice: true,
      },
      orderBy: { sku: "asc" },
    }),
    prisma.productBatch.findMany({
      select: { id: true, productId: true, quantity: true, expiryDate: true },
      orderBy: { expiryDate: "asc" },
    }),
    prisma.user.findMany({
      select: { id: true, username: true, role: true },
      orderBy: { username: "asc" },
    }),
    prisma.customer.findMany({
      select: { id: true, name: true, isMember: true, isActive: true },
      orderBy: { id: "asc" },
    }),
    prisma.storeSetting.findMany({
      select: { key: true, value: true },
    }),
    prisma.promotion.findMany({
      select: {
        id: true,
        code: true,
        name: true,
        type: true,
        value: true,
        minPurchaseAmount: true,
        startDate: true,
        endDate: true,
        isActive: true,
        usageLimit: true,
        usedCount: true,
      },
      orderBy: { code: "asc" },
    }),
  ]);

  if (products.length === 0) {
    throw new Error("No products found. Run `npm run db:seed` first.");
  }

  const byId = new Map(users.map((user) => [user.username, user]));
  const cashiers = CASHIER_WEIGHTS.map(([username, weight]) => {
    const user = byId.get(username);

    if (!user) {
      throw new Error(
        `Cashier "${username}" is missing. Run \`npm run db:seed\` first.`,
      );
    }

    return [user, weight] as const;
  });

  const approver =
    byId.get("manager") ?? byId.get("admin") ?? users.find((user) => user.role === "ADMIN");

  if (!approver) {
    throw new Error("No manager/admin account to approve the seeded refunds.");
  }

  const settingValue = (key: string) =>
    settings.find((setting) => setting.key === key)?.value;

  const taxEnabled = settingValue("tax.enabled") === true;
  const rawTaxRate = settingValue("tax.rate");
  const taxRate =
    taxEnabled && typeof rawTaxRate === "number" && rawTaxRate > 0
      ? Math.min(rawTaxRate, 1)
      : 0;

  const loyaltyEnabled = settingValue("loyalty.enabled") !== false;
  const rawRatio = settingValue("loyalty.ratio");
  const pointsRatio = typeof rawRatio === "number" && rawRatio > 0 ? rawRatio : 10_000;

  const activeCustomers = customers.filter((customer) => customer.isActive);
  const members = activeCustomers.filter((customer) => customer.isMember);

  // Promotions whose window actually covers the generated history. The seed
  // starts them at seed time, so anything before that could not have been
  // redeemed and applying the code anyway would put a discount on screen that
  // the promotion engine would have refused.
  const usablePromotions = promotions.filter(
    (promotion) => promotion.isActive && promotion.endDate > new Date(),
  );

  // ── Which products may be sold ────────────────────────────────────────────

  const ledger = await prisma.inventoryMovement.findMany({
    select: {
      productId: true,
      previousStock: true,
      newStock: true,
      createdAt: true,
      id: true,
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });

  const movementsByProduct = new Map<string, typeof ledger>();
  for (const movement of ledger) {
    const list = movementsByProduct.get(movement.productId);
    if (list) list.push(movement);
    else movementsByProduct.set(movement.productId, [movement]);
  }

  const catalog: ProductRow[] = products.map((product) => {
    const movements = movementsByProduct.get(product.id) ?? [];
    const last = movements[movements.length - 1];

    let broken = false;

    for (let index = 1; index < movements.length; index += 1) {
      if (movements[index].previousStock !== movements[index - 1].newStock) {
        broken = true;
        break;
      }
    }

    if (last && last.newStock !== product.stock) broken = true;

    if (!product.isActive) {
      return { ...base(product), sellable: false, reason: "produk nonaktif" };
    }

    if (product.stock <= product.minStock) {
      // Deliberate: these are the low-stock/out-of-stock alert fixtures.
      return { ...base(product), sellable: false, reason: "fixture stok menipis" };
    }

    if (broken) {
      return { ...base(product), sellable: false, reason: "ledger sudah tidak cocok" };
    }

    return { ...base(product), sellable: true };
  });

  function base(product: {
    id: string;
    sku: string;
    name: string;
    unit: string;
    stock: number;
    minStock: number;
    sellingPrice: unknown;
    purchasePrice: unknown;
  }) {
    return {
      id: product.id,
      sku: product.sku,
      name: product.name,
      unit: product.unit,
      stock: product.stock,
      minStock: product.minStock,
      sellingPrice: Number(product.sellingPrice),
      purchasePrice: Number(product.purchasePrice),
    };
  }

  const sellable = catalog.filter((product) => product.sellable);
  const skipped = catalog.filter((product) => !product.sellable);

  if (sellable.length === 0) {
    throw new Error("No sellable products — nothing to generate.");
  }

  const weightedCatalog = sellable.map(
    (product) => [product, VELOCITY[product.sku] ?? 1] as const,
  );

  // Batches, oldest expiry first, so sales can be drawn down FEFO exactly the
  // way `syncBatches` does at runtime.
  const batchState = batches.map((batch) => ({ ...batch }));
  const batchesByProduct = new Map<string, typeof batchState>();
  for (const batch of batchState) {
    const list = batchesByProduct.get(batch.productId);
    if (list) list.push(batch);
    else batchesByProduct.set(batch.productId, [batch]);
  }

  function batchUsable(productId: string, at: Date): boolean {
    const list = batchesByProduct.get(productId);

    // No batches means the product is not expiry-tracked, so it is always fine.
    if (!list || list.length === 0) return true;

    return list.some((batch) => batch.quantity > 0 && batch.expiryDate > at);
  }

  function drawBatches(productId: string, quantity: number) {
    let remaining = quantity;

    for (const batch of batchesByProduct.get(productId) ?? []) {
      if (remaining <= 0) break;

      const take = Math.min(remaining, batch.quantity);
      batch.quantity -= take;
      remaining -= take;
    }
  }

  function returnToBatches(productId: string, quantity: number) {
    const list = batchesByProduct.get(productId);
    if (!list || list.length === 0) return;

    const target = [...list].reverse().find((batch) => batch.quantity > 0) ?? list[list.length - 1];
    target.quantity += quantity;
  }

  // ── Generate ──────────────────────────────────────────────────────────────

  const today = wibMidnight(new Date());
  const windowStart = new Date(today.getTime() - (options.days - 1) * 86_400_000);
  const now = new Date();

  const sales: SalePlan[] = [];
  const refunds: RefundPlan[] = [];
  const shifts = new Map<string, ShiftPlan>();
  const stockEvents: StockEvent[] = [];
  const perDaySequence = new Map<string, number>();
  const perShiftSequence = new Map<string, number>();
  const perRefundSequence = new Map<string, number>();
  const pointsByCustomer = new Map<string, number>();
  const purchasesByCustomer = new Map<string, number>();
  /** Units demanded per product, used to size the opening restock. */
  const demand = new Map<string, number>();

  const restockNeeded = new Map<string, number>();

  function nextId(prefix: string, counter: { value: number }): string {
    counter.value += 1;

    // cuid-shaped so it is indistinguishable from a generated id if anyone ever
    // validates the format, and prefixed so a fixture row is obvious in Studio.
    return `${prefix}${counter.value.toString(36).padStart(4, "0")}dummy0000000000000000000000`;
  }

  const saleCounter = { value: 0 };
  const itemCounter = { value: 0 };
  const refundCounter = { value: 0 };
  const refundItemCounter = { value: 0 };
  const shiftCounter = { value: 0 };

  function shiftFor(day: Date, userId: string): ShiftPlan {
    const key = `${userId}:${formatDay(day)}`;
    const existing = shifts.get(key);

    if (existing) return existing;

    const sequence = (perShiftSequence.get(formatDay(day)) ?? 0) + 1;
    perShiftSequence.set(formatDay(day), sequence);

    const openedAt = wibTime(day, STORE_OPEN_HOUR, 0);
    const closedAt = wibTime(day, STORE_CLOSE_HOUR + 1, 0);

    const shift: ShiftPlan = {
      id: nextId("sft", shiftCounter),
      number: `${SHIFT_PREFIX}-${formatDay(day)}-${String(sequence).padStart(3, "0")}`,
      userId,
      openedAt,
      closedAt,
      openingCash: OPENING_CASH,
      cashSales: 0,
      cashRefunds: 0,
      expectedCash: 0,
      closingCash: 0,
      variance: 0,
      sales: [],
    };

    shifts.set(key, shift);

    return shift;
  }

  for (let dayOffset = 0; dayOffset < options.days; dayOffset += 1) {
    const day = new Date(windowStart.getTime() + dayOffset * 86_400_000);
    const dayKey = formatDay(day);

    const isPayday = day.getUTCDay() !== 0 && (day.getUTCDate() <= 2 || day.getUTCDate() === 15 || day.getUTCDate() === 16);
    const paydayFactor = isPayday ? 1.25 : 1;
    /** A gentle upward drift, so month-over-month has a direction to show. */
    const growth = 1 + (0.25 * dayOffset) / Math.max(1, options.days - 1);
    const jitter = 0.8 + random() * 0.4;

    const planned = Math.max(
      1,
      Math.round(options.perDay * DAY_FACTOR[day.getUTCDay()] * paydayFactor * growth * jitter),
    );

    for (let n = 0; n < planned; n += 1) {
      const hour = STORE_OPEN_HOUR + pickIndex(random, HOUR_WEIGHT);
      const minute = Math.floor(random() * 60);
      const date = wibTime(day, hour, minute, Math.floor(random() * 60));

      // Never book a sale in the future: "today" stops at the current hour.
      if (date > now) continue;

      const cashier = pickWeighted(random, cashiers as unknown as Array<[typeof cashiers[0][0], number]>);
      const shift = shiftFor(day, cashier.id);

      // ── Basket ───────────────────────────────────────────────────────────
      const lineCount = pickIndex(random, LINE_COUNT_WEIGHT) + 1;
      const chosen = new Map<string, ProductRow>();
      let attempts = 0;

      while (chosen.size < lineCount && attempts < lineCount * 6) {
        attempts += 1;

        const product = pickWeighted(
          random,
          weightedCatalog as unknown as Array<[ProductRow, number]>,
        );

        if (chosen.has(product.id)) continue;
        if (!batchUsable(product.id, date)) continue;

        chosen.set(product.id, product);
      }

      if (chosen.size === 0) continue;

      const lines: CartLine[] = [...chosen.values()].map((product) => {
        const bulky = product.sellingPrice >= BULKY_PRICE_THRESHOLD;
        const quantity = bulky
          ? random() < 0.85
            ? 1
            : 2
          : pickIndex(random, [46, 30, 14, 6, 4]) + 1;

        return {
          productId: product.id,
          sku: product.sku,
          name: product.name,
          unit: product.unit,
          quantity,
          unitPrice: product.sellingPrice,
          lineDiscount: 0,
          availableStock: Number.MAX_SAFE_INTEGER,
        };
      });

      // ── Who is buying ────────────────────────────────────────────────────
      const wantsCustomer = random() < 0.24;
      const pool = wantsCustomer ? (random() < 0.65 ? members : activeCustomers) : [];
      const customer = pool.length > 0 ? pool[Math.floor(random() * pool.length)] : null;

      // ── Discounts ────────────────────────────────────────────────────────
      const cartSubtotal = lines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0);

      let manualDiscount = 0;

      if (random() < 0.1) {
        const cap = Math.floor(cartSubtotal * 0.08);
        manualDiscount = Math.min(cap, Math.round((random() * cap) / 500) * 500);
      }

      const totals = calculateTotals({
        lines,
        manualDiscount,
        taxRate,
      });

      if (totals.total <= 0) continue;

      // ── Promotion ────────────────────────────────────────────────────────
      // Only codes the engine would actually accept on this date and basket.
      let promotionCode: string | null = null;
      let promotionDiscount = 0;

      for (const promotion of usablePromotions) {
        if (random() > 0.16) continue;
        if (date < promotion.startDate || date > promotion.endDate) continue;
        if (promotion.usageLimit !== null && promotion.usedCount >= promotion.usageLimit) continue;

        if (
          promotion.type === "MINIMUM_PURCHASE" &&
          cartSubtotal < Number(promotion.minPurchaseAmount ?? 0)
        ) {
          continue;
        }

        if (promotion.type === "FIXED") {
          promotionDiscount = Math.min(Number(promotion.value), cartSubtotal);
        } else if (promotion.type === "PERCENTAGE") {
          promotionDiscount = Math.floor((cartSubtotal * Number(promotion.value)) / 100);
        } else {
          // BUY_X_GET_Y and CATEGORY would need the engine's own line matching to
          // be worth anything; a fixture that only looks like a promo is worse
          // than none.
          continue;
        }

        if (promotionDiscount > 0) {
          promotionCode = promotion.code;
          break;
        }
      }

      const finalTotals =
        promotionDiscount > 0
          ? calculateTotals({
              lines,
              promotions: [{ code: promotionCode!, name: promotionCode!, discountAmount: promotionDiscount }],
              manualDiscount,
              taxRate,
            })
          : totals;

      if (finalTotals.total <= 0) continue;

      const paymentMethod = pickWeighted(random, PAYMENT_WEIGHTS);

      const amountPaid =
        paymentMethod === "CASH"
          ? Math.ceil(finalTotals.total / 5_000) * 5_000
          : finalTotals.total;

      const isMember = loyaltyEnabled && Boolean(customer?.isMember);
      const pointsEarned =
        isMember && pointsRatio > 0
          ? Math.max(
              0,
              Math.floor(
                (finalTotals.total - finalTotals.tax - finalTotals.pointsDiscount) / pointsRatio,
              ),
            )
          : 0;

      const sequence = (perDaySequence.get(dayKey) ?? 0) + 1;
      perDaySequence.set(dayKey, sequence);

      const voided = random() < VOID_RATE;

      const sale: SalePlan = {
        id: nextId("sal", saleCounter),
        invoiceNumber: `${INVOICE_PREFIX}-${dayKey}-${String(sequence).padStart(4, "0")}`,
        customerId: customer?.id ?? null,
        userId: cashier.id,
        shiftKey: `${cashier.id}:${dayKey}`,
        date,
        subtotal: finalTotals.subtotal,
        discount: finalTotals.promotionDiscount + finalTotals.pointsDiscount + finalTotals.manualDiscount,
        tax: finalTotals.tax,
        total: finalTotals.total,
        paymentMethod,
        amountPaid,
        change: paymentMethod === "CASH" ? amountPaid - finalTotals.total : 0,
        status: voided ? SaleStatus.VOID : SaleStatus.COMPLETED,
        pointsEarned,
        promotionCode,
        notes: random() < 0.08 ? "Pelanggan minta diantar" : null,
        voidedAt: null,
        voidReason: null,
        items: lines.map((line) => ({
          id: nextId("sai", itemCounter),
          productId: line.productId,
          quantity: line.quantity,
          price: line.unitPrice,
          cost: 0,
          discount: line.lineDiscount ?? 0,
          subtotal: line.unitPrice * line.quantity - (line.lineDiscount ?? 0),
          returnedQty: 0,
        })),
      };

      // Cost snapshot from the product's own purchase price, as checkout does.
      const priceOf = new Map(catalog.map((product) => [product.id, product.purchasePrice]));
      for (const item of sale.items) {
        item.cost = priceOf.get(item.productId) ?? 0;
      }

      sales.push(sale);
      shift.sales.push(sale);

      if (sale.customerId) {
        pointsByCustomer.set(
          sale.customerId,
          (pointsByCustomer.get(sale.customerId) ?? 0) + sale.pointsEarned,
        );

        if (!voided) {
          purchasesByCustomer.set(
            sale.customerId,
            (purchasesByCustomer.get(sale.customerId) ?? 0) + 1,
          );
        }
      }

      // ── Stock out ────────────────────────────────────────────────────────
      for (const item of sale.items) {
        stockEvents.push({
          date,
          productId: item.productId,
          type: StockMovementType.SALE,
          quantity: item.quantity,
          direction: "OUT",
          referenceType: "Sale",
          referenceId: sale.id,
          note: `Penjualan ${sale.invoiceNumber}`,
          userId: cashier.id,
        });

        drawBatches(item.productId, item.quantity);
        demand.set(item.productId, (demand.get(item.productId) ?? 0) + item.quantity);
      }

      if (voided) {
        // A void releases the stock again a few minutes later, which is also
        // what makes it visible as a correction rather than a sale.
        const voidedAt = new Date(date.getTime() + 3 * 60_000);

        sale.voidedAt = voidedAt;
        sale.voidReason = "Salah input nominal";

        for (const item of sale.items) {
          stockEvents.push({
            date: voidedAt,
            productId: item.productId,
            type: StockMovementType.SALE_VOID,
            quantity: item.quantity,
            direction: "IN",
            referenceType: "Sale",
            referenceId: sale.id,
            note: `Pengembalian stok karena transaksi void ${sale.invoiceNumber}`,
            userId: cashier.id,
          });

          returnToBatches(item.productId, item.quantity);
          demand.set(item.productId, (demand.get(item.productId) ?? 0) - item.quantity);
        }
      }

      if (!voided && paymentMethod === "CASH") {
        shift.cashSales += finalTotals.total;
      }
    }
  }

  // ── Refunds ────────────────────────────────────────────────────────────────

  const refundable = sales.filter(
    (sale) =>
      sale.status === SaleStatus.COMPLETED &&
      now.getTime() - sale.date.getTime() >= REFUND_MIN_AGE_DAYS * 86_400_000,
  );

  for (const sale of refundable) {
    if (random() >= REFUND_RATE) continue;

    // Split what the customer actually paid across the lines, so a refund can
    // never add up to more than was collected.
    const shares = allocateProportionally(
      sale.total,
      sale.items.map((item) => item.subtotal),
    );

    const targetIndex = Math.floor(random() * sale.items.length);
    const target = sale.items[targetIndex];
    const quantity = Math.min(target.quantity, 1 + Math.floor(random() * target.quantity));
    const amount = Math.min(shares[targetIndex], Math.round((target.subtotal / target.quantity) * quantity));

    if (amount <= 0) continue;

    const refundDate = new Date(sale.date.getTime() + (1 + Math.floor(random() * 4)) * 86_400_000);

    if (refundDate > now) continue;

    const refundSequence = (perRefundSequence.get(formatDay(refundDate)) ?? 0) + 1;
    perRefundSequence.set(formatDay(refundDate), refundSequence);

    const refund: RefundPlan = {
      id: nextId("rfd", refundCounter),
      number: `${REFUND_PREFIX}-${formatDay(refundDate)}-${String(refundSequence).padStart(4, "0")}`,
      sale,
      date: refundDate,
      totalRefund: amount,
      reason: REFUND_REASONS[Math.floor(random() * REFUND_REASONS.length)],
      approvedById: approver.id,
      items: [
        {
          id: nextId("rfi", refundItemCounter),
          saleItemId: target.id,
          productId: target.productId,
          quantity,
          amount,
        },
      ],
      restock: [{ saleItem: target, quantity }],
    };

    refunds.push(refund);

    const fullyReturned = sale.items.every((item) =>
      refund.items.some((entry) => entry.saleItemId === item.id && entry.quantity >= item.quantity),
    );

    sale.status = fullyReturned ? SaleStatus.REFUNDED : SaleStatus.PARTIALLY_REFUNDED;

    stockEvents.push({
      date: refundDate,
      productId: target.productId,
      type: StockMovementType.RETURN_SALE,
      quantity,
      direction: "IN",
      referenceType: "SaleRefund",
      referenceId: refund.id,
      note: `Retur penjualan ${sale.invoiceNumber}`,
      userId: approver.id,
    });

    returnToBatches(target.productId, quantity);
    demand.set(target.productId, (demand.get(target.productId) ?? 0) - quantity);

    // Loyalty goes back with the goods, as `refundSale` does.
    if (sale.customerId) {
      const giveBack = Math.floor(amount / pointsRatio);

      if (giveBack > 0) {
        pointsByCustomer.set(
          sale.customerId,
          (pointsByCustomer.get(sale.customerId) ?? 0) - giveBack,
        );
      }

      if (sale.paymentMethod === "CASH") {
        const refundDay = wibMidnight(refundDate);
        const shift = shifts.get(`${sale.userId}:${formatDay(refundDay)}`);

        if (shift) shift.cashRefunds += amount;
      }
    }
  }

  for (const sale of sales) {
    for (const item of sale.items) {
      const refunded = refunds.find((refund) =>
        refund.items.some((entry) => entry.saleItemId === item.id),
      );

      if (!refunded) continue;

      const returned = refunded.items
        .filter((entry) => entry.saleItemId === item.id)
        .reduce((sum, entry) => sum + entry.quantity, 0);

      item.returnedQty = returned;
    }
  }

  // ── Opening restock ───────────────────────────────────────────────────────
  //
  // History cannot spend stock the shop never had: 180 days of demand is far
  // more than the seeded quantities. Rather than capping the baskets (which
  // would flatten the very trends the reports exist to show), the generator
  // books one ADJUSTMENT_IN per product at the start of the window, sized so
  // the shop ends the period at a healthy level. It is a real ledger row, so
  // the chain still replays.

  const reserveFor = (product: ProductRow, units: number) =>
    Math.max(product.minStock * 2, Math.round(units * 0.4));

  for (const product of sellable) {
    const units = demand.get(product.id) ?? 0;
    if (units <= 0) continue;

    const reserve = reserveFor(product, units);
    const shortfall = units + reserve - product.stock;

    if (shortfall <= 0) continue;

    restockNeeded.set(product.id, shortfall);

    stockEvents.push({
      date: new Date(windowStart.getTime() - 86_400_000),
      productId: product.id,
      type: StockMovementType.ADJUSTMENT_IN,
      quantity: shortfall,
      direction: "IN",
      referenceType: "DUMMY_SALES",
      referenceId: null,
      note: "Restok pembuka untuk data dummy penjualan",
      userId: byId.get("gudang")?.id ?? approver.id,
    });
  }

  // ── Chain the movements per product ───────────────────────────────────────
  //
  // previousStock/newStock are computed by walking each product's events in
  // time order, so the ledger is continuous by construction rather than by
  // hoping the inserts landed in order.

  stockEvents.sort((a, b) => a.date.getTime() - b.date.getTime());

  const running = new Map(catalog.map((product) => [product.id, product.stock]));
  const chainedMovements: Array<{
    productId: string;
    type: StockMovementType;
    quantity: number;
    previousStock: number;
    newStock: number;
    referenceType: string | null;
    referenceId: string | null;
    note: string;
    userId: string;
    createdAt: Date;
  }> = [];

  for (const event of stockEvents) {
    const current = running.get(event.productId) ?? 0;
    const next = event.direction === "OUT" ? current - event.quantity : current + event.quantity;

    if (next < 0) {
      throw new Error(
        `Stock went negative for ${event.productId} at ${event.date.toISOString()}.`,
      );
    }

    running.set(event.productId, next);

    chainedMovements.push({
      productId: event.productId,
      type: event.type,
      quantity: event.quantity,
      previousStock: current,
      newStock: next,
      referenceType: event.referenceType,
      referenceId: event.referenceId,
      note: event.note,
      userId: event.userId,
      createdAt: event.date,
    });
  }

  // ── Shift reconciliation ──────────────────────────────────────────────────

  for (const shift of shifts.values()) {
    shift.expectedCash = shift.openingCash + shift.cashSales - shift.cashRefunds;
    const variance = pickVariance(random);

    shift.closingCash = shift.expectedCash + variance;
    shift.variance = variance;
  }

  // ── Report ────────────────────────────────────────────────────────────────

  const gross = sales
    .filter((sale) => sale.status !== SaleStatus.VOID)
    .reduce((sum, sale) => sum + sale.total, 0);
  const refunded = refunds.reduce((sum, refund) => sum + refund.totalRefund, 0);
  const itemCount = sales.reduce((sum, sale) => sum + sale.items.length, 0);

  console.log(`\n  sales         ${sales.length}`);
  console.log(`  sale items    ${itemCount}`);
  console.log(`  refunds       ${refunds.length} (Rp${refunded.toLocaleString("id-ID")})`);
  console.log(`  shifts        ${shifts.size}`);
  console.log(`  movements     ${chainedMovements.length}`);
  console.log(`  gross omzet   Rp${gross.toLocaleString("id-ID")}`);
  console.log(`  produk dipakai ${sellable.length}/${catalog.length}`);

  if (skipped.length > 0) {
    console.log("\n  Products left alone:");

    for (const product of skipped) {
      console.log(`    ${product.sku.padEnd(9)} ${product.reason}`);
    }
  }

  if (options.dryRun) {
    console.log("\n  --dry-run: plan only, nothing written.\n");

    return;
  }

  // ── Persist ───────────────────────────────────────────────────────────────

  const stockBeforeRecord: Record<string, number> = {};
  for (const product of catalog) {
    stockBeforeRecord[product.id] = product.stock;
  }

  const batchBeforeRecord: Record<string, number> = {};
  for (const batch of batchState) {
    batchBeforeRecord[batch.id] = batches.find((entry) => entry.id === batch.id)!.quantity;
  }

  const customerBeforeRecord: Record<string, { points: number; totalPurchases: number }> = {};
  const customersWithIds = await prisma.customer.findMany({
    select: { id: true, points: true, totalPurchases: true },
  });
  for (const customer of customersWithIds) {
    customerBeforeRecord[customer.id] = {
      points: customer.points,
      totalPurchases: customer.totalPurchases,
    };
  }

  const allItems = sales.flatMap((sale) =>
    sale.items.map((item) => ({
      id: item.id,
      saleId: sale.id,
      productId: item.productId,
      quantity: item.quantity,
      price: item.price,
      cost: item.cost,
      discount: item.discount,
      subtotal: item.subtotal,
      returnedQty: item.returnedQty,
    })),
  );

  /**
   * Everything below is one transaction.
   *
   * It is not tidiness: a partially written dataset is worse than none. The
   * first version of this script inserted the ledger, then the sales, and died on
   * a foreign key — leaving 14,109 stock movements describing sales that did not
   * exist and `Product.stock` that no longer matched its own ledger. A run that
   * cannot finish must leave the database exactly as it found it.
   */
  await prisma.$transaction(
    async (tx) => {
      /**
       * The seed's own opening movements are stamped with the time the seed ran,
       * which is *after* every sale this script inserts. The ledger is replayed
       * in `createdAt` order, so history inserted earlier would sort before its
       * own opening balance and the chain would break at the first product.
       * Moving the opening balance to the start of the generated window is what
       * makes "stock existed, then it was sold" true in the ledger's ordering.
       */
      if (chainedMovements.length > 0) {
        const openingDate = new Date(windowStart.getTime() - 2 * 86_400_000);

        await tx.inventoryMovement.updateMany({
          where: { referenceType: "SEED", createdAt: { gt: openingDate } },
          data: { createdAt: openingDate },
        });
      }

      // Shifts first: `Sale.shiftId` is a foreign key, and a sale booked to a
      // till that has not been opened yet is a constraint violation.
      for (const chunk of chunked([...shifts.values()], 200)) {
        await tx.cashShift.createMany({
          data: chunk.map((shift) => ({
            id: shift.id,
            number: shift.number,
            userId: shift.userId,
            status: ShiftStatus.CLOSED,
            openedAt: shift.openedAt,
            closedAt: shift.closedAt,
            openingCash: shift.openingCash,
            closingCash: shift.closingCash,
            expectedCash: shift.expectedCash,
            variance: shift.variance,
            notes:
              Math.abs(shift.variance) > 500
                ? `Selisih kas: ${VARIANCE_REASONS[Math.floor(random() * VARIANCE_REASONS.length)]}`
                : null,
          })),
        });
      }

      for (const chunk of chunked(sales, INSERT_CHUNK)) {
        await tx.sale.createMany({
          data: chunk.map((sale) => ({
            id: sale.id,
            invoiceNumber: sale.invoiceNumber,
            customerId: sale.customerId,
            userId: sale.userId,
            shiftId: shifts.get(sale.shiftKey)?.id ?? null,
            date: sale.date,
            subtotal: sale.subtotal,
            discount: sale.discount,
            tax: sale.tax,
            total: sale.total,
            paymentMethod: sale.paymentMethod,
            amountPaid: sale.amountPaid,
            change: sale.change,
            status: sale.status,
            pointsEarned: sale.pointsEarned,
            pointsRedeemed: 0,
            promotionCode: sale.promotionCode,
            notes: sale.notes,
            voidedAt: sale.voidedAt,
            voidReason: sale.voidReason,
            createdAt: sale.date,
            updatedAt: sale.date,
          })),
        });
      }

      for (const chunk of chunked(allItems, INSERT_CHUNK)) {
        await tx.saleItem.createMany({ data: chunk });
      }

      for (const chunk of chunked(refunds, 200)) {
        await tx.saleRefund.createMany({
          data: chunk.map((refund) => ({
            id: refund.id,
            number: refund.number,
            saleId: refund.sale.id,
            date: refund.date,
            totalRefund: refund.totalRefund,
            paymentMethod: refund.sale.paymentMethod,
            reason: refund.reason,
            approvedById: refund.approvedById,
            createdAt: refund.date,
          })),
        });

        await tx.saleRefundItem.createMany({
          data: chunk.flatMap((refund) =>
            refund.items.map((item) => ({
              id: item.id,
              refundId: refund.id,
              saleItemId: item.saleItemId,
              quantity: item.quantity,
              amount: item.amount,
              condition: "GOOD" as const,
            })),
          ),
        });
      }

      for (const chunk of chunked(chainedMovements, INSERT_CHUNK)) {
        await tx.inventoryMovement.createMany({ data: chunk });
      }

      for (const [productId, stock] of running) {
        await tx.product.update({ where: { id: productId }, data: { stock } });
      }

      for (const batch of batchState) {
        if (batch.quantity < 0) {
          throw new Error(`Batch ${batch.id} went negative.`);
        }

        await tx.productBatch.update({
          where: { id: batch.id },
          data: { quantity: batch.quantity },
        });
      }

      for (const [customerId, points] of pointsByCustomer) {
        if (points === 0) continue;

        await tx.customer.update({
          where: { id: customerId },
          data: { points: { increment: points } },
        });
      }

      for (const [customerId, purchases] of purchasesByCustomer) {
        if (purchases === 0) continue;

        await tx.customer.update({
          where: { id: customerId },
          data: { totalPurchases: { increment: purchases } },
        });
      }

      // Written last, inside the same transaction: the marker is what `--reset`
      // and the idempotency check trust, so it must not survive a failed run.
      await tx.storeSetting.upsert({
        where: { key: MARKER_KEY },
        update: { value: markerValue(), description: "Marker data dummy penjualan" },
        create: {
          key: MARKER_KEY,
          value: markerValue(),
          description: "Marker data dummy penjualan",
        },
      });
    },
    {
      // ~14k inserts over a network link to Neon is not a fast transaction, and
      // Prisma's 5s default would abort a run that is actually working.
      timeout: 900_000,
      maxWait: 60_000,
    },
  );

  function markerValue() {
    return {
      generatedAt: new Date().toISOString(),
      windowDays: options.days,
      rngSeed: options.seed,
      counts: {
        sales: sales.length,
        saleItems: allItems.length,
        refunds: refunds.length,
        shifts: shifts.size,
        movements: chainedMovements.length,
      },
      prefixes: { invoice: INVOICE_PREFIX, refund: REFUND_PREFIX, shift: SHIFT_PREFIX },
      stockBefore: stockBeforeRecord,
      batchesBefore: batchBeforeRecord,
      customersBefore: customerBeforeRecord,
    };
  }

  console.log("\n  ✓ written. Hapus dengan: npm run db:seed:sales -- --reset\n");
}

function pickVariance(random: () => number): number {
  const roll = random();

  if (roll < 0.62) return 0;
  if (roll < 0.78) return 1_000;
  if (roll < 0.9) return -1_000;
  if (roll < 0.96) return 2_500;

  return random() < 0.5 ? -5_000 : 5_000;
}

function* chunked<T>(items: T[], size: number): Generator<T[]> {
  for (let index = 0; index < items.length; index += size) {
    yield items.slice(index, index + size);
  }
}

/**
 * Removes a previous run and puts the stock, batch and loyalty values it
 * displaced back the way it found them.
 */
async function resetPreviousRun() {
  const marker = await prisma.storeSetting.findUnique({
    where: { key: MARKER_KEY },
    select: { value: true },
  });

  const previous = (marker?.value ?? null) as {
    stockBefore?: Record<string, number>;
    batchesBefore?: Record<string, number>;
    customersBefore?: Record<string, { points: number; totalPurchases: number }>;
  } | null;

  const sales = await prisma.sale.findMany({
    where: { invoiceNumber: { startsWith: `${INVOICE_PREFIX}-` } },
    select: {
      id: true,
      items: { select: { productId: true, quantity: true } },
    },
  });

  const refunds = await prisma.saleRefund.findMany({
    where: { number: { startsWith: `${REFUND_PREFIX}-` } },
    select: { id: true },
  });

  const shifts = await prisma.cashShift.findMany({
    where: { number: { startsWith: `${SHIFT_PREFIX}-` } },
    select: { id: true },
  });

  const saleIds = sales.map((sale) => sale.id);
  const refundIds = refunds.map((refund) => refund.id);

  console.log(`\n  removing ${sales.length} sales, ${refunds.length} refunds, ${shifts.length} shifts`);

  await prisma.inventoryMovement.deleteMany({
    where: {
      OR: [
        { referenceType: "DUMMY_SALES" },
        // Also matched by note: an interrupted run can leave movements whose
        // `referenceId` points at a sale that was never inserted, so the id
        // lists above cannot be the only way to find them.
        { note: { contains: INVOICE_PREFIX } },
        ...(saleIds.length > 0 ? [{ referenceId: { in: saleIds } }] : []),
        ...(refundIds.length > 0 ? [{ referenceId: { in: refundIds } }] : []),
      ],
    },
  });

  await prisma.sale.deleteMany({ where: { id: { in: saleIds } } });
  await prisma.cashShift.deleteMany({ where: { id: { in: shifts.map((shift) => shift.id) } } });
  await prisma.storeSetting.deleteMany({ where: { key: MARKER_KEY } });

  if (!previous) {
    console.log("  no marker found — restored nothing beyond deleting the rows.");
    console.log("  Stock is whatever the ledger replay now says; re-run the seed if unsure.\n");

    return;
  }

  for (const [productId, stock] of Object.entries(previous.stockBefore ?? {})) {
    await prisma.product.update({ where: { id: productId }, data: { stock } });
  }

  for (const [batchId, quantity] of Object.entries(previous.batchesBefore ?? {})) {
    await prisma.productBatch.update({ where: { id: batchId }, data: { quantity } });
  }

  for (const [customerId, value] of Object.entries(previous.customersBefore ?? {})) {
    await prisma.customer.update({
      where: { id: customerId },
      data: { points: value.points, totalPurchases: value.totalPurchases },
    });
  }

  console.log(`  ✓ restored stock, batches and loyalty for ${Object.keys(previous.stockBefore ?? {}).length} products\n`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
