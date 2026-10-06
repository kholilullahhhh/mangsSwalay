import "dotenv/config";
import { defineConfig } from "prisma/config";

/**
 * Prisma 7 CLI configuration.
 *
 * The datasource URL lives here rather than in schema.prisma — Prisma 7 removed
 * `url` from the datasource block. `process.env` is read directly (not via
 * `env()`) so that `prisma generate` still works in CI without a database.
 */
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: process.env.DATABASE_URL ?? "",
  },
});