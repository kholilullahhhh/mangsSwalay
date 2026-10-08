import "dotenv/config";
import { hash } from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "DATABASE_URL is not set. Add it to .env before seeding.",
  );
}

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

/**
 * Development seed data.
 *
 * ⚠️  SECURITY: every account below uses a well-known development password.
 *     Never run this seed against a production database. Change all passwords
 *     before the store goes live.
 */

/** Development-only password shared by all seeded users. */
const DEV_PASSWORD = "Password123!";

const BCRYPT_ROUNDS = 12;

async function main() {
  console.log("🌱 Seeding Swalayaku database...\n");

  // ── Users ────────────────────────────────────────────────────────────────
  const passwordHash = await hash(DEV_PASSWORD, BCRYPT_ROUNDS);

  const userSeeds = [
    {
      username: "superadmin",
      email: "superadmin@swalayaku.test",
      name: "Super Admin",
      role: "SUPER_ADMIN" as const,
      phone: "081100000001",
    },
    {
      username: "admin",
      email: "admin@swalayaku.test",
      name: "Admin Toko",
      role: "ADMIN" as const,
      phone: "081100000002",
    },
    {
      username: "manager",
      email: "manager@swalayaku.test",
      name: "Budi Manager",
      role: "MANAGER" as const,
      phone: "081100000003",
    },
    {
      username: "kasir",
      email: "kasir@swalayaku.test",
      name: "Siti Kasir",
      role: "CASHIER" as const,
      phone: "081100000004",
    },
    {
      username: "gudang",
      email: "gudang@swalayaku.test",
      name: "Rudi Gudang",
      role: "STOCK_OPERATOR" as const,
      phone: "081100000005",
    },
  ];

  const users: Record<string, { id: string }> = {};
  for (const u of userSeeds) {
    const user = await prisma.user.upsert({
      where: { username: u.username },
      update: { name: u.name, role: u.role, isActive: true },
      create: { ...u, passwordHash },
      select: { id: true },
    });
    users[u.username] = user;
    console.log(`  ✓ user ${u.username} (${u.role})`);
  }

  // ── Categories ───────────────────────────────────────────────────────────
  const categorySeeds = [
    { name: "Sembako", description: "Beras, gula, minyak goreng, telur, dan kebutuhan pokok harian.", icon: "wheat" },
    { name: "Minuman", description: "Air mineral, teh, kopi, minuman kaleng dan botol.", icon: "cup-soda" },
    { name: "Makanan", description: "Makanan instan, mi instan, dan produk olahan.", icon: "utensils" },
    { name: "Snack", description: "Keripik, biskuit, cokelat, permen, dan makanan ringan.", icon: "cookie" },
    { name: "Produk Kebersihan", description: "Sabun, shampo, deterjen, dan kebutuhan rumah tangga.", icon: "spray-can" },
    { name: "Perawatan Diri", description: "Kosmetik, pasta gigi, dan produk perawatan pribadi.", icon: "heart-pulse" },
    { name: "Produk Rumah Tangga", description: "Alat rumah tangga, plastik, dan kebutuhan dapur.", icon: "house" },
    { name: "Frozen Food", description: "Frozen makanan beku, es krim, dan produk beku.", icon: "snowflake" },
    { name: "ATK", description: "Alat tulis, kertas, dan kebutuhan sekolah.", icon: "pencil" },
    { name: "Lainnya", description: "Produk lainnya di luar kategori utama.", icon: "package" },
  ];

  const categories: Record<string, { id: string }> = {};
  for (const c of categorySeeds) {
    const category = await prisma.category.upsert({
      where: { slug: slugify(c.name) },
      update: { name: c.name, description: c.description, isActive: true },
      create: {
        name: c.name,
        slug: slugify(c.name),
        description: c.description,
        icon: c.icon,
      },
      select: { id: true },
    });
    categories[c.name] = category;
  }
  console.log(`  ✓ ${categorySeeds.length} categories`);

  // ── Brands ───────────────────────────────────────────────────────────────
  const brandSeeds = [
    "Indomie",
    "Aqua",
    "Tropicana Slim",
    "Ultra Milk",
    "Gulaku",
    "MinyakKita",
    "Lifebuoy",
    "Pepsodent",
    "Sunlight",
    "Chitato",
  ];

  const brands: Record<string, { id: string }> = {};
  for (const name of brandSeeds) {
    const brand = await prisma.brand.upsert({
      where: { name },
      update: { isActive: true },
      create: { name },
      select: { id: true },
    });
    brands[name] = brand;
  }
  console.log(`  ✓ ${brandSeeds.length} brands`);

  // ── Suppliers ────────────────────────────────────────────────────────────
  const supplierSeeds = [
    {
      code: "SUP-001",
      name: "PT Sumber Pangan Nusantara",
      company: "PT Sumber Pangan Nusantara",
      contactPerson: "Bpk. Rahmat",
      phone: "081200000001",
      email: "sales@sumberpangan.co.id",
      address: "Jl. Industri No. 45, Bekasi, Jawa Barat",
    },
    {
      code: "SUP-002",
      name: "CV Faster Jaya Sentosa",
      company: "CV Faster Jaya Sentosa",
      contactPerson: "Ibu Sri",
      phone: "081200000002",
      email: "order@fasterjaya.co.id",
      address: "Jl. Raya Industri Blok C, Tangerang, Banten",
    },
    {
      code: "SUP-003",
      name: "UD Berkah Makmur",
      company: "UD Berkah Makmur",
      contactPerson: "Bpk. Joko",
      phone: "081200000003",
      email: "berkah.makmur@gmail.com",
      address: "Jl. Pasar Baru No. 12, Bandung, Jawa Barat",
    },
  ];

  const suppliers: Record<string, { id: string }> = {};
  for (const s of supplierSeeds) {
    const supplier = await prisma.supplier.upsert({
      where: { code: s.code },
      update: { ...s, isActive: true },
      create: s,
      select: { id: true },
    });
    suppliers[s.code] = supplier;
  }
  console.log(`  ✓ ${supplierSeeds.length} suppliers`);

  // ── Products ─────────────────────────────────────────────────────────────
  // purchasePrice / sellingPrice in Rupiah. minStock drives low-stock alerts.
  const productSeeds: {
    sku: string;
    barcode: string;
    name: string;
    category: string;
    brand?: string;
    unit: "PCS" | "PACK" | "BOX" | "KG" | "G" | "L" | "ML" | "DOSE" | "SACHET" | "CAN" | "BOTTLE" | "ROLL" | "TUBE";
    purchasePrice: number;
    sellingPrice: number;
    minStock: number;
    stock: number;
    hasExpiry?: boolean;
    isFeatured?: boolean;
    description?: string;
  }[] = [
    // Sembako
    { sku: "SMB-001", barcode: "8992775001017", name: "Beras Pandan Wangi 5kg", category: "Sembako", unit: "PACK", purchasePrice: 62000, sellingPrice: 68000, minStock: 20, stock: 120, isFeatured: true, description: "Beras aromatik premium kualitas ekspor." },
    { sku: "SMB-002", barcode: "8992775001024", name: "Gula Pasir Gulaku 1kg", category: "Sembako", brand: "Gulaku", unit: "PACK", purchasePrice: 14500, sellingPrice: 16500, minStock: 30, stock: 200 },
    { sku: "SMB-003", barcode: "8992775001031", name: "Minyak Goreng 1L", category: "Sembako", brand: "MinyakKita", unit: "BOTTLE", purchasePrice: 17500, sellingPrice: 19500, minStock: 24, stock: 8, isFeatured: true },
    { sku: "SMB-004", barcode: "8992775001048", name: "Telur Ayam Negeri 1kg", category: "Sembako", unit: "KG", purchasePrice: 27000, sellingPrice: 29500, minStock: 15, stock: 60 },
    { sku: "SMB-005", barcode: "8992775001055", name: "Garam Halus 250g", category: "Sembako", unit: "PACK", purchasePrice: 2500, sellingPrice: 3500, minStock: 40, stock: 300 },

    // Minuman
    { sku: "MNM-001", barcode: "8992769122019", name: "Air Mineral Aqu 600ml", category: "Minuman", brand: "Aqua", unit: "BOTTLE", purchasePrice: 2500, sellingPrice: 3500, minStock: 48, stock: 480, isFeatured: true },
    { sku: "MNM-002", barcode: "8992775002014", name: "Teh Pucuk Harum 350ml", category: "Minuman", unit: "BOTTLE", purchasePrice: 3500, sellingPrice: 4500, minStock: 36, stock: 240 },
    { sku: "MNM-003", barcode: "8992775002021", name: "Ultra Milk Full Cream 250ml", category: "Minuman", brand: "Ultra Milk", unit: "CAN", purchasePrice: 5500, sellingPrice: 6500, minStock: 48, stock: 5, isFeatured: true },
    { sku: "MNM-004", barcode: "8964000344010", name: "Kopi Kapal Api Sachet", category: "Minuman", unit: "SACHET", purchasePrice: 1500, sellingPrice: 2000, minStock: 100, stock: 800 },

    // Makanan
    { sku: "MKN-001", barcode: "8998866202401", name: "Indomie Goreng Special", category: "Makanan", brand: "Indomie", unit: "PACK", purchasePrice: 2800, sellingPrice: 3500, minStock: 100, stock: 640, isFeatured: true },
    { sku: "MKN-002", barcode: "8992775003011", name: "Sosis Ayam 400g", category: "Makanan", unit: "PACK", purchasePrice: 12000, sellingPrice: 14500, minStock: 20, stock: 75 },
    { sku: "MKN-003", barcode: "8992775003028", name: "Nasi Goreng Instant", category: "Makanan", unit: "PACK", purchasePrice: 8000, sellingPrice: 9500, minStock: 25, stock: 90, hasExpiry: true },

    // Snack
    { sku: "SNK-001", barcode: "8998964101214", name: "Keripik Kentang Chitato 68g", category: "Snack", brand: "Chitato", unit: "PACK", purchasePrice: 9000, sellingPrice: 11000, minStock: 30, stock: 180 },
    { sku: "SNK-002", barcode: "8992775004018", name: "Biskuit Kelapa Sari Roti", category: "Snack", unit: "PACK", purchasePrice: 7000, sellingPrice: 9000, minStock: 30, stock: 12 },
    { sku: "SNK-003", barcode: "8992775004025", name: "Cokelat Batang SilverQueen", category: "Snack", unit: "PCS", purchasePrice: 14000, sellingPrice: 16500, minStock: 20, stock: 96 },

    // Kebersihan
    { sku: "KBR-001", barcode: "8992775005015", name: "Sabun Mandi Cair Lifebuoy 450ml", category: "Produk Kebersihan", brand: "Lifebuoy", unit: "BOTTLE", purchasePrice: 19000, sellingPrice: 22500, minStock: 24, stock: 3, isFeatured: true },
    { sku: "KBR-002", barcode: "8992775005022", name: "Deterjen Bubuk 800g", category: "Produk Kebersihan", unit: "PACK", purchasePrice: 14500, sellingPrice: 17000, minStock: 20, stock: 88 },
    { sku: "KBR-003", barcode: "8992775005039", name: "Pewangi Piring Sunlight 755ml", category: "Produk Kebersihan", brand: "Sunlight", unit: "BOTTLE", purchasePrice: 13500, sellingPrice: 16000, minStock: 20, stock: 0 },

    // Perawatan Diri
    { sku: "PDR-001", barcode: "8992775006012", name: "Pasta Gigi Pepsodent 190g", category: "Perawatan Diri", brand: "Pepsodent", unit: "TUBE", purchasePrice: 11000, sellingPrice: 13500, minStock: 20, stock: 72 },
    { sku: "PDR-002", barcode: "8992775006029", name: "Sabun Mandi Batang Lifebuoy", category: "Perawatan Diri", brand: "Lifebuoy", unit: "PCS", purchasePrice: 4500, sellingPrice: 5500, minStock: 40, stock: 210 },

    // Rumah Tangga
    { sku: "RHT-001", barcode: "8992775007019", name: "Kantong Sampah 30L", category: "Produk Rumah Tangga", unit: "PCS", purchasePrice: 22000, sellingPrice: 27500, minStock: 15, stock: 45 },
    { sku: "RHT-002", barcode: "8992775007026", name: "Sapu Plastik", category: "Produk Rumah Tangga", unit: "PCS", purchasePrice: 12000, sellingPrice: 15000, minStock: 15, stock: 52 },

    // Frozen Food
    { sku: "FRZ-001", barcode: "8992775008016", name: "Frozen Chicken Nugget 250g", category: "Frozen Food", unit: "PACK", purchasePrice: 18000, sellingPrice: 22000, minStock: 20, stock: 64, hasExpiry: true },
    { sku: "FRZ-002", barcode: "8992775008023", name: "Es Krim Cup 6s", category: "Frozen Food", unit: "PACK", purchasePrice: 15000, sellingPrice: 18500, minStock: 24, stock: 2, hasExpiry: true },

    // ATK
    { sku: "ATK-001", barcode: "8992775009010", name: "Buku Tulis 38 Lembar", category: "ATK", unit: "PCS", purchasePrice: 4500, sellingPrice: 6000, minStock: 30, stock: 150 },
    { sku: "ATK-002", barcode: "8992775009027", name: "Pulpen Biru (Pak isi 10)", category: "ATK", unit: "PACK", purchasePrice: 8000, sellingPrice: 10000, minStock: 25, stock: 80 },
  ];

  const products: Record<string, { id: string }> = {};
  for (const p of productSeeds) {
    const data = {
      sku: p.sku,
      barcode: p.barcode,
      name: p.name,
      slug: slugify(p.name),
      description: p.description ?? null,
      categoryId: categories[p.category].id,
      brandId: p.brand ? brands[p.brand]?.id ?? null : null,
      unit: p.unit,
      purchasePrice: p.purchasePrice,
      sellingPrice: p.sellingPrice,
      minStock: p.minStock,
      stock: p.stock,
      hasExpiry: p.hasExpiry ?? false,
      isFeatured: p.isFeatured ?? false,
    };
    const product = await prisma.product.upsert({
      where: { sku: p.sku },
      update: data,
      create: data,
      select: { id: true },
    });
    products[p.sku] = product;
  }
  console.log(`  ✓ ${productSeeds.length} products`);

  // ── Stock: record an opening-balance movement per product ────────────────
  // Seeded stock should not appear from nowhere: every unit gets a ledger entry
  // so the inventory history stays consistent with Product.stock.
  const movementCount = await prisma.inventoryMovement.count();
  if (movementCount === 0) {
    await prisma.inventoryMovement.createMany({
      data: productSeeds.map((p) => ({
        productId: products[p.sku].id,
        type: "ADJUSTMENT_IN" as const,
        quantity: p.stock,
        previousStock: 0,
        newStock: p.stock,
        referenceType: "SEED",
        referenceId: null,
        note: "Saldo awal / opening balance saat seeding",
        userId: users.gudang.id,
      })),
    });
    console.log(`  ✓ ${productSeeds.length} opening-balance stock movements`);
  }

  // ── Batches for expiry-tracked products ─────────────────────────────────
  const batchCount = await prisma.productBatch.count();
  if (batchCount === 0) {
    const today = new Date();
    const inDays = (d: number) => {
      const date = new Date(today);
      date.setDate(date.getDate() + d);
      return date;
    };
    await prisma.productBatch.createMany({
      data: [
        { productId: products["FRZ-001"].id, batchNumber: "FRZ-2501A", expiryDate: inDays(12), quantity: 40, purchasePrice: 18000 },
        { productId: products["FRZ-001"].id, batchNumber: "FRZ-2502B", expiryDate: inDays(75), quantity: 24, purchasePrice: 18000 },
        { productId: products["FRZ-002"].id, batchNumber: "FRZ-2503C", expiryDate: inDays(5), quantity: 2, purchasePrice: 15000 },
        { productId: products["MKN-003"].id, batchNumber: "MKN-2504D", expiryDate: inDays(45), quantity: 90, purchasePrice: 8000 },
      ],
    });
    console.log("  ✓ product batches (incl. expiring-soon + near-expiry fixtures)");
  }

  // ── Customers ────────────────────────────────────────────────────────────
  const customerSeeds = [
    { name: "Budi Santoso", phone: "081300000001", email: "budi@example.com", isMember: true, memberNumber: "MBR-0001" },
    { name: "Siti Aminah", phone: "081300000002", email: "siti@example.com", isMember: true, memberNumber: "MBR-0002" },
    { name: "Andi Wijaya", phone: "081300000003", email: null, isMember: false, memberNumber: null },
    { name: "Dewi Lestari", phone: "081300000004", email: "dewi@example.com", isMember: true, memberNumber: "MBR-0003" },
    { name: "Agus Prasetyo", phone: "081300000005", email: null, isMember: false, memberNumber: null },
  ];

  for (const c of customerSeeds) {
    await prisma.customer.upsert({
      where: { memberNumber: c.memberNumber ?? `phone:${c.phone}` },
      update: { name: c.name, isMember: c.isMember },
      create: {
        name: c.name,
        phone: c.phone,
        email: c.email,
        isMember: c.isMember,
        memberNumber: c.memberNumber,
      },
    });
  }
  console.log(`  ✓ ${customerSeeds.length} customers`);

  // ── Promotions ───────────────────────────────────────────────────────────
  const now = new Date();
  const daysFromNow = (d: number) => {
    const date = new Date(now);
    date.setDate(date.getDate() + d);
    return date;
  };

  const promotionSeeds = [
    {
      code: "PROMO-QRIS-5",
      name: "Diskon 5% QRIS",
      description: "Diskon 5% untuk semua pembayaran QRIS.",
      type: "PERCENTAGE" as const,
      value: 5,
      startDate: now,
      endDate: daysFromNow(90),
      isActive: true,
    },
    {
      code: "PROMO-MEMBER-10K",
      name: "Potongan Rp10.000 Member",
      description: "Potongan Rp10.000 untuk member, min. belanja Rp50.000.",
      // FIXED, not MINIMUM_PURCHASE: that type is a *percentage* type, so a value
      // of 10000 became 10000% and every qualifying basket got a 100%-off verdict
      // — which checkout then refused as a zero total. The seeded code could never
      // actually be used.
      type: "FIXED" as const,
      value: 10000,
      minPurchaseAmount: 50000,
      startDate: now,
      endDate: daysFromNow(90),
      isActive: true,
    },
    {
      code: "PROMO-BOGO-INDOMIE",
      name: "Beli 2 Indomie Gratis 1",
      description: "Beli 2 bungkus Indomie Goreng, gratis 1.",
      type: "BUY_X_GET_Y" as const,
      value: 0,
      buyQuantity: 2,
      getQuantity: 1,
      startDate: now,
      endDate: daysFromNow(30),
      isActive: true,
    },
    {
      code: "PROMO-MINUMAN-15",
      name: "Diskon 15% Kategori Minuman",
      description: "Diskon 15% untuk kategori Minuman.",
      type: "CATEGORY" as const,
      value: 15,
      categoryId: categories["Minuman"].id,
      startDate: now,
      endDate: daysFromNow(60),
      isActive: true,
    },
  ];

  for (const promo of promotionSeeds) {
    await prisma.promotion.upsert({
      where: { code: promo.code },
      update: { ...promo, isActive: true },
      create: promo,
    });
  }
  console.log(`  ✓ ${promotionSeeds.length} promotions`);

  // ── Store settings ───────────────────────────────────────────────────────
  const settings = [
    { key: "store.name", value: "Swalayaku", description: "Nama toko (ditampilkan di struk & landing page)" },
    { key: "store.tagline", value: "Belanja Lebih Mudah, Kebutuhan Lebih Lengkap", description: "Tagline utama" },
    { key: "store.address", value: "Jl. Raya Swalaya No. 123, Jakarta Barat, DKI Jakarta 11530", description: "Alamat toko" },
    { key: "store.phone", value: "(021) 555-0123", description: "Nomor telepon toko" },
    { key: "store.whatsapp", value: "628115550123", description: "Nomor WhatsApp (format internasional)" },
    { key: "store.email", value: "halo@swalayaku.test", description: "Email toko" },
    { key: "store.openTime", value: "07:00", description: "Jam buka" },
    { key: "store.closeTime", value: "22:00", description: "Jam tutup" },
{
      key: "store.about",
      // This text is rendered verbatim on the public landing page, so it has to
      // be the store's own description: no placeholder, no filler.
      value:
        "Swalayaku adalah minimarket swasta yang melayani warga sejak 2019. " +
        "Kami menyediakan kebutuhan harian dengan produk berkualitas, harga " +
        "bersahabat, dan pelayanan terbaik.",
      description: "Tentang toko",
    },
    { key: "loyalty.enabled", value: true, description: "Aktifkan sistem loyalitas member" },
    { key: "loyalty.ratio", value: 10000, description: "Setiap Rp10.000 = 1 poin" },
    { key: "loyalty.pointValue", value: 100, description: "Nilai tukar 1 poin saat penukaran (Rp)" },
    { key: "expiry.warningDays", value: 30, description: "Peringatan kedaluwarsa H berapa hari" },
    // Tax is gated on `tax.enabled`, so a database missing these two keys can
    // never charge tax at all no matter what the settings screen shows. Seeded
    // off, because a retail POS should not silently add 11% to a price the
    // operator never agreed to.
    { key: "tax.enabled", value: false, description: "Aktifkan pajak pada transaksi" },
    { key: "tax.rate", value: 0.11, description: "Tarif pajak (0.11 = 11%)" },
    {
      key: "invoice.footer",
      value: "Terima kasih telah berbelanja",
      description: "Teks tambahan yang dicetak di bagian bawah struk",
    },
  ];

  for (const s of settings) {
    await prisma.storeSetting.upsert({
      where: { key: s.key },
      update: { value: s.value as never, description: s.description },
      create: { key: s.key, value: s.value as never, description: s.description },
    });
  }
  console.log(`  ✓ ${settings.length} store settings`);

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log("\n✅ Seed complete.\n");
  console.log("─".repeat(58));
  console.log("  ⚠️  DEVELOPMENT ACCOUNTS — CHANGE ALL PASSWORDS");
  console.log("─".repeat(58));
  console.log(`  Password for every account: ${DEV_PASSWORD}\n`);
  for (const u of userSeeds) {
    console.log(`  ${u.role.padEnd(15)} ${u.username.padEnd(12)} ${u.email}`);
  }
  console.log("─".repeat(58));
  console.log("  Low-stock fixtures seeded (stock <= minStock) for testing alerts.");
  console.log("  Expiring-soon batches seeded for testing expiry alerts.");
  console.log("─".repeat(58));
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error("❌ Seed failed:", error);
    await prisma.$disconnect();
    process.exit(1);
  });