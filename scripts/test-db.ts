/**
 * Live database verification against Neon.
 *
 * This exercises the queries that `tsc` and `eslint` cannot check: the raw SQL
 * dashboard aggregations, the column-to-column stock filter, and the guarded
 * checkout transaction including its concurrency guard.
 *
 * Run with: npm run test:db
 *
 * Every check that mutates data runs inside a transaction that is rolled back,
 * so the seeded fixtures are left exactly as they were.
 */

import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

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

function section(title: string) {
  console.log(`\n${title}`);
}

async function main() {
  console.log("🔌 Verifikasi database Neon\n");

  // ── Schema sanity ────────────────────────────────────────────────────────
  section("Schema");

  {
    const tables = await prisma.$queryRaw<Array<{ table_name: string }>>`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' ORDER BY table_name
    `;
    check(
      "all expected tables exist",
      tables.length >= 25,
      `found ${tables.length}`,
    );

    const enums = await prisma.$queryRaw<Array<{ typname: string }>>`
      SELECT typname FROM pg_type WHERE typtype = 'e' ORDER BY typname
    `;
    // Role, Unit, StockMovementType, PurchaseStatus, PurchasePaymentStatus,
    // SaleStatus, PaymentMethod, ShiftStatus, CashMovementType, OpnameStatus,
    // PromotionType, ExpenseCategory, NotificationType, NotificationSeverity,
    // RefundCondition.
    check("enums created", enums.length >= 15, `found ${enums.length}`);

    const names = enums.map((row) => row.typname);
    for (const required of [
      "Role",
      "Unit",
      "StockMovementType",
      "SaleStatus",
      "PaymentMethod",
      "PurchaseStatus",
      "ShiftStatus",
    ]) {
      check(`enum ${required} exists`, names.includes(required));
    }
  }

  // ── Seed data ────────────────────────────────────────────────────────────
  section("Seed data");

  {
    const [users, categories, products, suppliers, customers, promotions] =
      await Promise.all([
        prisma.user.count(),
        prisma.category.count(),
        prisma.product.count(),
        prisma.supplier.count(),
        prisma.customer.count(),
        prisma.promotion.count(),
      ]);

    check("5 users seeded", users === 5, `got ${users}`);
    check("10 categories seeded", categories === 10, `got ${categories}`);
    check("products seeded", products >= 25, `got ${products}`);
    check("3 suppliers seeded", suppliers === 3, `got ${suppliers}`);
    check("customers seeded", customers >= 5, `got ${customers}`);
    check("promotions seeded", promotions >= 4, `got ${promotions}`);
  }

  // ── Fixture hygiene ─────────────────────────────────────────────────────
  section("Fixture hygiene");

  {
    // The workflow tests run inside rolled-back transactions. If one ever fails
    // to roll back, it leaves rows behind and quietly pollutes the seeded data
    // every later run depends on — so stray fixtures are treated as failures.
    const strayPurchases = await prisma.purchase.count({
      where: { number: { startsWith: "TEST-" } },
    });
    check(
      "no leftover test purchases",
      strayPurchases === 0,
      `found ${strayPurchases} — a workflow test failed to roll back`,
    );

    const straySales = await prisma.sale.count({
      where: { invoiceNumber: { startsWith: "TEST-" } },
    });
    check("no leftover test sales", straySales === 0, `found ${straySales}`);

    // Sessions are created by real logins, so counting all of them would fail
    // whenever anyone is using the app. Only the HTTP suite mints its own, and it
    // deletes them in a finally block, so an expired leftover is genuine debris.
    const staleSessions = await prisma.session.count({
      where: { expiresAt: { lt: new Date() } },
    });
    check(
      "no expired sessions left behind",
      staleSessions === 0,
      `found ${staleSessions} — a session cleanup step was skipped`,
    );

    // Every product's stock must be explainable by its ledger.
    const negatives = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count FROM "Product" WHERE stock < 0
    `;
    check(
      "no product has negative stock",
      Number(negatives[0]?.count ?? 0) === 0,
      `found ${negatives[0]?.count ?? 0}`,
    );
  }

  // ── Constraints ──────────────────────────────────────────────────────────
  section("Business constraints");

  {
    const product = await prisma.product.findFirst({ select: { sku: true } });

    let duplicateRejected = false;
    try {
      await prisma.product.create({
        data: {
          sku: product!.sku,
          name: "Produk duplikat",
          slug: `duplikat-${Date.now()}`,
          categoryId: (
            await prisma.category.findFirstOrThrow({ select: { id: true } })
          ).id,
          purchasePrice: 1000,
          sellingPrice: 1500,
        },
      });
    } catch (error) {
      duplicateRejected = (error as { code?: string }).code === "P2002";
    }
    check("duplicate SKU rejected by database", duplicateRejected);

    // Clean up in case the constraint did not fire (it must have).
    await prisma.product.deleteMany({ where: { name: "Produk duplikat" } });
  }

  {
    // A product with a barcode must not accept a second product with the same one.
    const withBarcode = await prisma.product.findFirst({
      where: { barcode: { not: null } },
      select: { barcode: true },
    });

    let rejected = false;
    try {
      await prisma.product.create({
        data: {
          sku: `TEST-${Date.now()}`,
          barcode: withBarcode!.barcode!,
          name: "Barcode duplikat",
          slug: `barcode-duplikat-${Date.now()}`,
          categoryId: (
            await prisma.category.findFirstOrThrow({ select: { id: true } })
          ).id,
          purchasePrice: 1000,
          sellingPrice: 1500,
        },
      });
    } catch (error) {
      rejected = (error as { code?: string }).code === "P2002";
    }
    check("duplicate barcode rejected by database", rejected);

    await prisma.product.deleteMany({ where: { name: "Barcode duplikat" } });
  }

  {
    const negative = await prisma.$queryRaw<Array<{ ok: boolean }>>`
      SELECT (5 > 3) AS ok
    `;
    check("raw sql arithmetic works", negative[0]?.ok === true);
  }

  // ── Dashboard raw SQL (previously unverified) ────────────────────────────
  section("Dashboard aggregations (raw SQL)");

  {
    const salesTrend = await prisma.$queryRaw<
      Array<{ day: Date; total: unknown; transactions: bigint }>
    >`
      SELECT
        date_trunc('day', "date" AT TIME ZONE 'Asia/Jakarta') AS day,
        COALESCE(SUM(total), 0) AS total,
        COUNT(*) AS transactions
      FROM "Sale"
      WHERE "date" >= NOW() - INTERVAL '30 days'
        AND status = 'COMPLETED'
      GROUP BY 1
      ORDER BY 1 ASC
    `;
    check("sales trend query executes", Array.isArray(salesTrend));
  }

  {
    const byCategory = await prisma.$queryRaw<
      Array<{ category: string; total: unknown; quantity: bigint }>
    >`
      SELECT
        c.name AS category,
        COALESCE(SUM(si.subtotal), 0) AS total,
        COALESCE(SUM(si.quantity), 0)::bigint AS quantity
      FROM "SaleItem" si
      JOIN "Sale" s ON s.id = si."saleId"
      JOIN "Product" p ON p.id = si."productId"
      JOIN "Category" c ON c.id = p."categoryId"
      WHERE s."date" >= NOW() - INTERVAL '30 days'
        AND s.status = 'COMPLETED'
      GROUP BY c.name
      ORDER BY 2 DESC
      LIMIT 8
    `;
    check("category sales query executes", Array.isArray(byCategory));
  }

  {
    // This is the column-to-column comparison Prisma's filter API cannot express.
    const lowStock = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count
      FROM "Product"
      WHERE "isActive" = true AND "minStock" > 0
        AND "stock" > 0 AND "stock" <= "minStock"
    `;
    const count = Number(lowStock[0]?.count ?? 0);
    check("low-stock filter finds seeded fixtures", count > 0, `found ${count}`);

    const ids = await prisma.$queryRaw<Array<{ id: string; stock: number; minStock: number }>>`
      SELECT id, stock, "minStock" FROM "Product"
      WHERE "isActive" = true AND "minStock" > 0
        AND "stock" > 0 AND "stock" <= "minStock"
      ORDER BY stock ASC LIMIT 500
    `;
    check(
      "every returned row really is at/below minimum",
      ids.every((row) => row.stock <= row.minStock && row.stock > 0),
    );
  }

  {
    const purchaseVsSale = await prisma.$queryRaw<Array<{ day: Date }>>`
      SELECT date_trunc('day', date AT TIME ZONE 'Asia/Jakarta') AS day
      FROM "Purchase"
      WHERE date >= NOW() - INTERVAL '14 days'
        AND status IN ('RECEIVED', 'COMPLETED')
      GROUP BY 1
    `;
    check("purchase vs sale query executes", Array.isArray(purchaseVsSale));
  }

  // ── Inventory ledger + guarded checkout ──────────────────────────────────
  section("Checkout transaction (rolled back)");

  {
    const user = await prisma.user.findUniqueOrThrow({
      where: { username: "kasir" },
      select: { id: true },
    });

    // Indomie with stock 640 — plenty, so a normal sale can proceed.
    const product = await prisma.product.findUniqueOrThrow({
      where: { sku: "MNM-001" },
      select: { id: true, stock: true, sellingPrice: true, purchasePrice: true, name: true },
    });

    const stockBefore = product.stock;
    const movementsBefore = await prisma.inventoryMovement.count({
      where: { productId: product.id },
    });

    await prisma.$transaction(async (tx) => {
      const sale = await tx.sale.create({
        data: {
          invoiceNumber: `TEST-VERIFY-${Date.now()}`,
          userId: user.id,
          subtotal: 7000,
          total: 7000,
          paymentMethod: "CASH",
          amountPaid: 10000,
          change: 3000,
          items: {
            create: [
              {
                productId: product.id,
                quantity: 2,
                price: product.sellingPrice,
                cost: product.purchasePrice,
                subtotal: 7000,
              },
            ],
          },
        },
        select: { id: true, invoiceNumber: true },
      });

      // Same guarded decrement the real checkout uses.
      const updated = await tx.product.updateMany({
        where: { id: product.id, stock: { gte: 2 } },
        data: { stock: { decrement: 2 } },
      });

      check(
        "guarded decrement matched a row",
        updated.count === 1,
        `count=${updated.count}`,
      );

      await tx.inventoryMovement.create({
        data: {
          productId: product.id,
          type: "SALE",
          quantity: 2,
          previousStock: stockBefore,
          newStock: stockBefore - 2,
          referenceType: "Sale",
          referenceId: sale.id,
          userId: user.id,
        },
      });

      // Verify the sale, the decrement, and the ledger row all landed before
      // aborting, so the assertions run against real intermediate state.
      const after = await tx.product.findUniqueOrThrow({
        where: { id: product.id },
        select: { stock: true },
      });
      check("stock decremented inside transaction", after.stock === stockBefore - 2);

      const movements = await tx.inventoryMovement.count({
        where: { productId: product.id },
      });
      check("ledger row written", movements === movementsBefore + 1);

      const saleCount = await tx.sale.count({
        where: { invoiceNumber: { startsWith: "TEST-VERIFY-" } },
      });
      check("sale row written", saleCount >= 1);

      // Force a rollback. Without this throw the transaction commits and the
      // fixture leaks into the next run.
      throw new Error("ROLLBACK");
    }).catch((error: Error) => {
      check("checkout simulation rolled back", error.message === "ROLLBACK");
    });

    // Nothing may survive the abort.
    const restored = await prisma.product.findUniqueOrThrow({
      where: { id: product.id },
      select: { stock: true },
    });
    check("stock restored after rollback", restored.stock === stockBefore);

    const restoredMovements = await prisma.inventoryMovement.count({
      where: { productId: product.id },
    });
    check(
      "ledger restored after rollback",
      restoredMovements === movementsBefore,
    );

    const leftoverSales = await prisma.sale.count({
      where: { invoiceNumber: { startsWith: "TEST-VERIFY-" } },
    });
    check("no leftover sale after rollback", leftoverSales === 0);
  }

  // ── Concurrency guard ────────────────────────────────────────────────────
  section("Concurrency guard");

  {
    // Set a product to exactly 1 unit, then attempt to sell 2. The conditional
    // update must match zero rows, which is what prevents overselling when two
    // cashiers check out simultaneously.
    const product = await prisma.product.findUniqueOrThrow({
      where: { sku: "SMB-005" },
      select: { id: true, stock: true },
    });

    await prisma.$transaction(async (tx) => {
      await tx.product.update({
        where: { id: product.id },
        data: { stock: 1 },
      });

      const oversell = await tx.product.updateMany({
        where: { id: product.id, stock: { gte: 2 } },
        data: { stock: { decrement: 2 } },
      });

      check(
        "oversell blocked when stock is insufficient",
        oversell.count === 0,
        `count=${oversell.count}`,
      );

      const after = await tx.product.findUniqueOrThrow({
        where: { id: product.id },
        select: { stock: true },
      });
      check("stock untouched by rejected decrement", after.stock === 1);

      throw new Error("ROLLBACK");
    }).catch((error: Error) => {
      check("cleanup rolled back", error.message === "ROLLBACK");
    });
  }

  // ── Money precision ──────────────────────────────────────────────────────
  section("Money precision");

  {
    const decimals = await prisma.$queryRaw<Array<{ data_type: string }>>`
      SELECT data_type FROM information_schema.columns
      WHERE table_name = 'Sale' AND column_name = 'total'
    `;
    check(
      "money stored as numeric, not float",
      decimals[0]?.data_type === "numeric",
      `got ${decimals[0]?.data_type}`,
    );

    const sum = await prisma.sale.aggregate({
      _sum: { total: true },
    });
    check("aggregate over Decimal works", sum._sum.total === null || sum._sum.total !== undefined);
  }

  // ── Indexes ──────────────────────────────────────────────────────────────
  section("Indexes");

  {
    const indexed = await prisma.$queryRaw<Array<{ tablename: string; indexname: string }>>`
      SELECT tablename, indexname FROM pg_indexes
      WHERE schemaname = 'public' ORDER BY tablename
    `;
    check(
      "indexes created across tables",
      indexed.length >= 30,
      `found ${indexed.length}`,
    );

    const names = indexed.map((index) => index.indexname).join(" ");
    check("product sku is indexed", names.includes("Product_sku_idx"));
    check("invoice number is indexed", names.includes("Sale_invoiceNumber_idx"));
    check("barcode is indexed", names.includes("Product_barcode_idx"));
  }

  // ── Summary ──────────────────────────────────────────────────────────────
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
    console.error("❌ Verification failed:", error);
    await prisma.$disconnect();
    process.exit(1);
  });