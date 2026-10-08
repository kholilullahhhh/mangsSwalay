import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

/**
 * Removes sessions that have already expired.
 *
 * `createSession` now sweeps these on every login, which is what keeps the table
 * from growing without bound on a shared till. This script exists for the case
 * that sweep cannot cover: a database that already accumulated expired rows
 * before the sweep existed, or one where nobody logs in again.
 */
async function main() {
  const result = await prisma.session.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });

  console.log(`Pruned ${result.count} expired session(s).`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());