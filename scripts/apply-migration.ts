import "dotenv/config";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

async function main() {
  const migrationsDir = join(process.cwd(), "prisma", "migrations");

  const folders = (await readdir(migrationsDir, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  const applied = new Set(
    (
      await prisma.$queryRaw<Array<{ migration_name: string }>>`
        SELECT migration_name FROM "_prisma_migrations"
        WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
      `
    ).map((row) => row.migration_name),
  );

  console.log("migrations on disk: " + folders.length);
  console.log("already applied:    " + applied.size);
  console.log("");

  for (const folder of folders) {
    if (applied.has(folder)) {
      console.log("  = " + folder + " (already applied)");
      continue;
    }

    const sqlPath = join(migrationsDir, folder, "migration.sql");
    const sql = await readFile(sqlPath, "utf8");

    const statements = splitStatements(sql);

    console.log("  + " + folder);

    for (const statement of statements) {
      await prisma.$executeRawUnsafe(statement);
    }

    await prisma.$queryRaw`
      INSERT INTO "_prisma_migrations"
        (id, checksum, migration_name, started_at, finished_at, logs, rolled_back_at)
      VALUES (
        ${randomUUID()},
        ${createHash("sha256").update(sql).digest("hex")},
        ${folder},
        NOW(),
        NOW(),
        NULL,
        NULL
      )
    `;

    console.log("      applied " + statements.length + " statement(s)");
  }

  console.log("");
  console.log("migrations up to date");
}

function splitStatements(sql: string): string[] {
  return sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .split(/;\s*$/m)
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error("migration failed:", error);
    await prisma.$disconnect();
    process.exit(1);
  });
