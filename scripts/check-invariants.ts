import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

/** Reports whether the new columns and constraints are live in the database. */
async function main() {
  const columns = await prisma.$queryRaw<Array<{ table: string; column: string }>>`
    SELECT table_name AS table, column_name AS column
    FROM information_schema.columns
    WHERE column_name IN ('pointsRedeemed', 'expiryDate', 'batchNumber')
      AND table_name IN ('Sale', 'PurchaseItem')
    ORDER BY table_name, column_name
  `;

  const constraints = await prisma.$queryRaw<Array<{ name: string }>>`
    SELECT conname AS name FROM pg_constraint
    WHERE conname IN (
      'Product_stock_non_negative',
      'ProductBatch_quantity_non_negative'
    )
    UNION ALL
    SELECT indexname AS name FROM pg_indexes
    WHERE indexname = 'CashShift_one_open_per_user'
  `;

  console.log("columns:   " + JSON.stringify(columns));
  console.log("database:  " + JSON.stringify(constraints));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());