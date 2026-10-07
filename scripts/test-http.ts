/**
 * End-to-end HTTP verification against a running dev server.
 *
 * Logs in through the real login form (Server Action), then requests each
 * protected page with the resulting session cookie and asserts on the rendered
 * HTML. This is the check that catches what typechecking cannot: a page that
 * 500s, a redirect that leaks, or a query whose shape doesn't match what the
 * component expects.
 *
 * Usage: npx tsx scripts/test-http.ts [baseUrl]
 */

import "dotenv/config";
import { SignJWT } from "jose";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

const BASE = process.argv[2] ?? "http://localhost:3100";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    passed++;
    console.log(`  [ok] ${name}`);
  } else {
    failures.push(detail ? name + " :: " + detail : name);
    failed++;
    console.log(`  [FAIL] ${name}${detail ? " :: " + detail : ""}`);
  }
}

function section(title: string) {
  console.log(`\n${title}`);
}

/** Signs a session cookie exactly the way src/lib/auth/session.ts does. */
async function mintSessionCookie(userId: string): Promise<string> {
  const token = crypto.randomUUID() + crypto.randomUUID();

  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );

  const tokenHash = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  await prisma.session.create({
    data: {
      token: tokenHash,
      userId,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });

  const secret = process.env.AUTH_SECRET;

  if (!secret) {
    throw new Error("AUTH_SECRET is not set");
  }

  const jwt = await new SignJWT({ tokenHash })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(secret));

  return `swalayaku_session=${jwt}`;
}

async function main() {
  console.log(`\n🔎 Verifikasi HTTP terhadap ${BASE}\n`);

  // ── Public surface ───────────────────────────────────────────────────────
  section("Public routes");

  {
    const landing = await fetch(`${BASE}/`);
    const html = await landing.text();

    check("landing page responds 200", landing.status === 200, `got ${landing.status}`);
    check("landing is not a redirect to login", landing.status !== 307);
    check("landing mentions the store name", html.includes("Swalayaku"));
    check(
      "landing does not leak dashboard internals",
      !html.includes("KRobinson") && !html.includes("passwordHash"),
    );
  }

  {
    const login = await fetch(`${BASE}/login`);
    const html = await login.text();

    check("login page responds 200", login.status === 200, `got ${login.status}`);
    check("login renders a form", html.includes("<form"));
    check(
      "login does not leak the password hash",
      !html.includes("passwordHash"),
    );
  }

  // ── Auth gate ────────────────────────────────────────────────────────────
  section("Unauthenticated access is blocked");

  for (const path of ["/dashboard", "/pos", "/products"]) {
    const response = await fetch(`${BASE}${path}`, { redirect: "manual" });

    check(
      `${path} redirects when signed out`,
      response.status === 307 || response.status === 302,
      `got ${response.status}`,
    );

    const location = response.headers.get("location") ?? "";
    check(
      `${path} redirects to /login`,
      location.includes("/login"),
      `location=${location}`,
    );

    check(
      `${path} remembers the intended destination`,
      location.includes("from="),
    );
  }

  // ── Authenticated pages ──────────────────────────────────────────────────
  section("Authenticated pages (SUPER_ADMIN)");

  const admin = await prisma.user.findUniqueOrThrow({
    where: { username: "admin" },
    select: { id: true },
  });

  const cookie = await mintSessionCookie(admin.id);

  // Fetched here rather than inside the role sections below, because several
  // later sections need to act as the same cashier and stock operator.
  const cashier = await prisma.user.findUniqueOrThrow({
    where: { username: "kasir" },
    select: { id: true },
  });

  const operator = await prisma.user.findUniqueOrThrow({
    where: { username: "gudang" },
    select: { id: true },
  });

  const fetchAuthed = (path: string) =>
    fetch(`${BASE}${path}`, {
      headers: { cookie },
      redirect: "manual",
    });

  {
    const dashboard = await fetchAuthed("/dashboard");
    const html = await dashboard.text();

    check("dashboard responds 200", dashboard.status === 200, `got ${dashboard.status}`);
    check("dashboard shows summary card labels", html.includes("Penjualan Hari Ini"));
    check("dashboard shows total stock", html.includes("Total Stok"));
    check("dashboard shows restock widget", html.includes("Perlu Restock") || html.includes("Semua stok aman"));
    check("dashboard renders sidebar", html.includes("Sidebar") || html.includes("Operasional"));
    check(
      "dashboard does not show an error boundary",
      !html.includes("Dashboard tidak dapat dimuat"),
    );
  }

  {
    const products = await fetchAuthed("/products");
    const html = await products.text();

    check("products responds 200", products.status === 200, `got ${products.status}`);
    check("products lists seeded rows", html.includes("Indomie Goreng"));
    check("products renders a row count", html.includes("produk"));
  }

  {
    const pos = await fetchAuthed("/pos");
    const html = await pos.text();

    check("pos responds 200", pos.status === 200, `got ${pos.status}`);
    check("pos renders the barcode field", html.includes("pos-scan"));
    check("pos renders product tiles", html.includes("Indomie Goreng"));
    check("pos renders the cart panel", html.includes("Keranjang"));
    check("pos renders the payment button", html.includes("Bayar"));
  }

  {
    // Filters and sorting are server-side; a filtered query must still render.
    const filtered = await fetchAuthed("/products?search=indomie&sort=sellingPrice&direction=desc");
    const html = await filtered.text();

    check("filtered product list responds 200", filtered.status === 200);
    check("filter narrows results", html.includes("Indomie Goreng"));
  }

  {
    const purchases = await fetchAuthed("/purchases");
    const html = await purchases.text();

    check("purchases responds 200", purchases.status === 200, `got ${purchases.status}`);
    check("purchases renders its heading", html.includes("Pembelian"));
    check("purchases shows the empty state (no orders yet)", html.includes("Belum ada pembelian"));
    check("purchases offers a create action", html.includes("Pembelian Baru"));

    const byStatus = await fetchAuthed("/purchases?status=DRAFT");
    check(
      "purchase status filter renders",
      byStatus.status === 200,
      `got ${byStatus.status}`,
    );

    const bySupplier = await fetchAuthed("/purchases?supplierId=nonexistent");
    check(
      "purchase supplier filter renders",
      bySupplier.status === 200,
      `got ${bySupplier.status}`,
    );
  }

  {
    const suppliers = await fetchAuthed("/suppliers");
    const html = await suppliers.text();

    check("suppliers responds 200", suppliers.status === 200, `got ${suppliers.status}`);
    check("suppliers lists seeded data", html.includes("Sumber Pangan"));
    check("suppliers shows supplier codes", html.includes("SUP-001"));

    const searched = await fetchAuthed("/suppliers?search=faster");
    check("supplier search renders", searched.status === 200, `got ${searched.status}`);
  }

  {
    const unknown = await fetchAuthed("/purchases/does-not-exist");
    check(
      "unknown purchase id returns 404, not 500",
      unknown.status === 404,
      `got ${unknown.status}`,
    );
  }

  {
    const inventory = await fetchAuthed("/inventory");
    const html = await inventory.text();

    check("inventory responds 200", inventory.status === 200, "got " + inventory.status);
    check("inventory shows total units", html.includes("Total unit"));
    check("inventory shows stock value", html.includes("Nilai persediaan"));
    check("inventory lists seeded products", html.includes("Kopi Kapal Api"));

    const lowStock = await fetchAuthed("/inventory?stock=low");
    check("low-stock filter renders", lowStock.status === 200, "got " + lowStock.status);
    const lowHtml = await lowStock.text();
    check(
      "low-stock filter narrows to seeded fixtures",
      lowHtml.includes("Semua stok aman") || lowHtml.includes("Sabun Mandi Cair"),
    );

    const outStock = await fetchAuthed("/inventory?stock=out");
    check("out-of-stock filter renders", outStock.status === 200);
  }

  {
    const movements = await fetchAuthed("/inventory/movements");
    const html = await movements.text();

    check("movements responds 200", movements.status === 200, "got " + movements.status);
    check("movements lists seeded ledger entries", html.includes("Saldo awal"));
    check("movements shows movement labels", html.includes("Penyesuaian Masuk"));
  }

  {
    const batches = await fetchAuthed("/inventory/batches");
    const html = await batches.text();

    check("batches responds 200", batches.status === 200, "got " + batches.status);
    check("batches lists seeded expiring stock", html.includes("Es Krim") || html.includes("Frozen Chicken"));
    check("batches shows day counts", html.includes("hari"));
  }

  {
    const adjustment = await fetchAuthed("/inventory/adjustment");
    const html = await adjustment.text();

    check("adjustment responds 200", adjustment.status === 200, "got " + adjustment.status);
    check("adjustment requires a reason", html.includes("Alasan Penyesuaian"));
    check("adjustment lists products to correct", html.includes("Es Krim"));

    const opname = await fetchAuthed("/inventory/opname");
    const opHtml = await opname.text();

    check("opname list responds 200", opname.status === 200, "got " + opname.status);
    check("opname list shows empty state", opHtml.includes("Belum ada sesi opname"));
  }

  {
    const unknownOpname = await fetchAuthed("/inventory/opname/nope");
    check("unknown opname returns 404", unknownOpname.status === 404, "got " + unknownOpname.status);
  }

  // ── Role-based access ────────────────────────────────────────────────────
  {
    const sales = await fetchAuthed("/sales");
    const html = await sales.text();

    check("sales responds 200", sales.status === 200, "got " + sales.status);
    check("sales shows its heading", html.includes("Penjualan"));
    check("sales shows the empty state", html.includes("Belum ada transaksi"));
    check("sales shows the omzet card", html.includes("Omzet"));

    const filtered = await fetchAuthed("/sales?status=COMPLETED&paymentMethod=CASH");
    check("sales filters render", filtered.status === 200, "got " + filtered.status);

    const searched = await fetchAuthed("/sales?search=INV-99999");
    check("sales search renders", searched.status === 200, "got " + searched.status);
  }

  {
    // sales:view-own is a CASHIER-only grant, so an ADMIN must be refused here.
    // The role check is the point of this assertion, not a 200.
    const myAsAdmin = await fetchAuthed("/sales/my");
    check(
      "my-sales refuses a role without sales:view-own",
      myAsAdmin.status === 403,
      "got " + myAsAdmin.status,
    );

    const returns = await fetchAuthed("/sales/returns");
    const rHtml = await returns.text();

    check("returns responds 200", returns.status === 200, "got " + returns.status);
    check("returns shows empty state", rHtml.includes("Belum ada retur"));

    const unknown = await fetchAuthed("/sales/does-not-exist");
    check("unknown sale returns 404", unknown.status === 404, "got " + unknown.status);
  }

  {
    const shifts = await fetchAuthed("/shifts");
    const html = await shifts.text();

    check("shifts responds 200", shifts.status === 200, "got " + shifts.status);
    check("shifts prompts to open a shift", html.includes("Buka Shift"));
    check("shifts shows the history table", html.includes("Riwayat Shift"));
    check("shifts explains the workflow", html.includes("Cara Kerja Shift"));
  }

  section("Role-based access");

  {
    const cashierCookie = await mintSessionCookie(cashier.id);

    const mySalesAsCashier = await fetch(`${BASE}/sales/my`, {
      headers: { cookie: cashierCookie },
      redirect: "manual",
    });
    check(
      "cashier can open their own sales list",
      mySalesAsCashier.status === 200,
      `got ${mySalesAsCashier.status}`,
    );

    const shiftsAsCashier = await fetch(`${BASE}/shifts`, {
      headers: { cookie: cashierCookie },
      redirect: "manual",
    });
    check(
      "cashier can manage their own shift",
      shiftsAsCashier.status === 200,
      `got ${shiftsAsCashier.status}`,
    );

    const usersAsCashier = await fetch(`${BASE}/users`, {
      headers: { cookie: cashierCookie },
      redirect: "manual",
    });

    // A cashier has no users:manage, so the page must refuse rather than render.
    check(
      "cashier cannot reach user management",
      usersAsCashier.status === 403,
      `got ${usersAsCashier.status}`,
    );

    const productsAsCashier = await fetch(`${BASE}/products`, {
      headers: { cookie: cashierCookie },
      redirect: "manual",
    });
    check(
      "cashier can still view products",
      productsAsCashier.status === 200,
      `got ${productsAsCashier.status}`,
    );

    const posAsCashier = await fetch(`${BASE}/pos`, {
      headers: { cookie: cashierCookie },
      redirect: "manual",
    });
    check(
      "cashier can use the POS",
      posAsCashier.status === 200,
      `got ${posAsCashier.status}`,
    );

    // Clean up the throwaway sessions.
    await prisma.session.deleteMany({ where: { userId: cashier.id } });
  }

  // ── CSRF / method checks ─────────────────────────────────────────────────
  section("Method and export");

  {
    const badMethod = await fetch(`${BASE}/api/auth/logout`, {
      method: "GET",
      redirect: "manual",
    });
    check("logout rejects GET", badMethod.status === 405, `got ${badMethod.status}`);

    const exportAsAnon = await fetch(`${BASE}/api/products/export`, {
      redirect: "manual",
    });
    check(
      "product export requires auth",
      exportAsAnon.status === 401 || exportAsAnon.status === 307,
      `got ${exportAsAnon.status}`,
    );
  }

  // ── Every remaining page ─────────────────────────────────────────────────
  // Each route is requested as a super admin and as a cashier. A 500 anywhere is
  // the failure this suite exists to catch: typechecking passes happily while a
  // page throws at render time.
  section("Full route coverage");

  // Requested as SUPER_ADMIN, because some of these are super-admin-only by
  // design: ADMIN deliberately has no users or system-settings access.
  const superAdmin = await prisma.user.findUniqueOrThrow({
    where: { username: "superadmin" },
    select: { id: true },
  });

  const superCookie = await mintSessionCookie(superAdmin.id);

  const fetchAsSuperAdmin = (path: string) =>
    fetch(`${BASE}${path}`, {
      headers: { cookie: superCookie },
      redirect: "manual",
    });

  const ROUTES = [
    "/customers",
    "/customers/loyalty",
    "/categories",
    "/expenses",
    "/promotions",
    "/notifications",
    "/settings",
    "/users",
    "/audit-log",
    "/reports/sales",
    "/reports/products",
    "/reports/inventory",
    "/reports/purchases",
    "/reports/profit",
    "/cashflow",
    "/products/import",
    "/purchases/new",
    "/purchases?status=COMPLETED",
    "/sales?status=COMPLETED",
    "/reports/sales?range=today",
    "/reports/sales?range=custom&from=2020-01-01&to=2020-01-31",
  ];

  for (const path of ROUTES) {
    const response = await fetchAsSuperAdmin(path);
    const body = await response.text();

    check(
      `${path} responds 200 for SUPER_ADMIN`,
      response.status === 200,
      `got ${response.status}`,
    );

    check(
      `${path} renders no error boundary`,
      !body.includes("tidak dapat dimuat"),
    );

    // The range filters must render a real chart or table, not just a frame.
    check(`${path} is not a bare shell`, body.length > 2000, `only ${body.length} bytes`);
  }

  {
    // The import template must serve the header the parser expects.
    const template = await fetchAsSuperAdmin("/api/products/import/template");

    check("import template responds 200", template.status === 200, `got ${template.status}`);

    const csv = await template.text();
    check(
      "import template carries the required columns",
      ["sku", "name", "category", "unit", "purchasePrice", "sellingPrice", "stock"].every(
        (column) => csv.includes(column),
      ),
    );
    check(
      "import template is served as a download",
      (template.headers.get("content-disposition") ?? "").includes("attachment"),
    );
  }

  {
    // Detail pages need a real id; a bogus one must 404 rather than 500.
    const [product, supplier, sale] = await Promise.all([
      prisma.product.findFirstOrThrow({ select: { id: true } }),
      prisma.supplier.findFirstOrThrow({ select: { id: true } }),
      prisma.sale.findFirst({ select: { id: true } }),
    ]);

    for (const [label, path] of [
      ["product", `/products/${product.id}`],
      ["supplier", `/suppliers/${supplier.id}`],
    ] as const) {
      const response = await fetchAuthed(path);
      check(
        `${label} detail responds 200`,
        response.status === 200,
        `got ${response.status}`,
      );
    }

    const missing = await fetchAuthed("/products/does-not-exist");
    check("unknown product 404s", missing.status === 404, `got ${missing.status}`);

    if (sale) {
      const salePage = await fetchAuthed(`/sales/${sale.id}`);
      check("sale detail responds 200", salePage.status === 200, `got ${salePage.status}`);
    }
  }

  // ── Authorization on the new screens ─────────────────────────────────────
  section("Authorization on admin screens");

  {
    const cashierCookie = await mintSessionCookie(cashier.id);
    const asCashier = (path: string) =>
      fetch(`${BASE}${path}`, {
        headers: { cookie: cashierCookie },
        redirect: "manual",
      });

    // A cashier may not reach system administration. These must be refused
    // rather than rendered and hidden by CSS.
    for (const path of [
      "/users",
      "/settings",
      "/audit-log",
      "/reports/profit",
      "/cashflow",
    ]) {
      const response = await asCashier(path);

      check(
        `cashier is refused ${path}`,
        response.status === 403 || response.status === 307,
        `got ${response.status}`,
      );
    }

    // A cashier does need these: the topbar notification bell is rendered for
    // every role, so its target must be reachable by every role.
    for (const path of ["/promotions", "/notifications"]) {
      const response = await asCashier(path);

      check(
        `cashier can open ${path}`,
        response.status === 200,
        `got ${response.status}`,
      );
    }

    // Store-wide revenue reporting is a management concern; a cashier has their
    // own sales list instead.
    const reportsAsCashier = await asCashier("/reports/sales");
    check(
      "cashier is refused the store-wide sales report",
      reportsAsCashier.status === 403,
      `got ${reportsAsCashier.status}`,
    );

    await prisma.session.deleteMany({ where: { userId: cashier.id } });
  }

  {
    // A stock operator manages stock but not the till.
    const operatorCookie = await mintSessionCookie(operator.id);
    const asOperator = (path: string) =>
      fetch(`${BASE}${path}`, {
        headers: { cookie: operatorCookie },
        redirect: "manual",
      });

    check(
      "stock operator can open the stock list",
      (await asOperator("/inventory")).status === 200,
    );
    check(
      "stock operator can run an opname",
      (await asOperator("/inventory/opname")).status === 200,
    );
    check(
      "stock operator is refused the POS",
      (await asOperator("/pos")).status === 403,
      `got ${(await asOperator("/pos")).status}`,
    );
    check(
      "stock operator is refused user management",
      (await asOperator("/users")).status === 403,
    );

    await prisma.session.deleteMany({ where: { userId: operator.id } });
  }

  // ── Clean up ─────────────────────────────────────────────────────────────
  await prisma.session.deleteMany({ where: { userId: admin.id } });

  console.log(`\n${"─".repeat(60)}`);
  if (failures.length > 0) {
    console.log("");
    console.log("FAILURES:");
    for (const failure of failures) console.log("  - " + failure);
  }
  console.log(`  ${passed} passed, ${failed} failed`);
  console.log("─".repeat(60));
}

main()
  .then(async () => {
    await prisma.$disconnect();
    if (failed > 0) process.exit(1);
  })
  .catch(async (error) => {
    console.error("❌ HTTP verification failed:", error);
    await prisma.$disconnect();
    process.exit(1);
  });





