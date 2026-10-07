import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

/**
 * Resets transactional tables so the seed can rebuild a known-good state.
 *
 * Verification scripts that commit (even unintentionally) leave the ledger and
 * Product.stock out of sync, and patching that by hand compounds the error. A
 * reset plus re-seed is the only reliable repair.
 */
async function main() {
  await prisma.saleRefundItem.deleteMany({});
  await prisma.saleRefund.deleteMany({});
  await prisma.saleItem.deleteMany({});
  await prisma.sale.deleteMany({});
  await prisma.cashMovement.deleteMany({});
  await prisma.cashShift.deleteMany({});
  await prisma.purchaseItem.deleteMany({});
  await prisma.purchase.deleteMany({});
  await prisma.stockOpnameItem.deleteMany({});
  await prisma.stockOpname.deleteMany({});
  await prisma.productBatch.deleteMany({});
  await prisma.inventoryMovement.deleteMany({});
  await prisma.session.deleteMany({});
  await prisma.auditLog.deleteMany({});
  await prisma.notification.deleteMany({});

  console.log("transactional tables cleared");

  const products = await prisma.product.count();
  const movements = await prisma.inventoryMovement.count();
  console.log("products: " + products + ", movements: " + movements);
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
