import "server-only";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

/**
 * Prisma 7 requires a driver adapter to be passed to the client. We use the pg
 * adapter rather than the Neon HTTP adapter on purpose:
 *
 * - Server Actions need interactive transactions (`$transaction` with a
 *   callback), which require a persistent connection. The Neon serverless HTTP
 *   driver opens a fresh WebSocket per transaction, which is slow and gets
 *   throttled under concurrent checkout load.
 * - Neon exposes a pooled (transaction-mode) endpoint. Pointing the pg adapter
 *   at the *pooled* URL is what makes this serverless-safe: it caps concurrent
 *   connections instead of letting every lambda open its own.
 *
 * See docs/DEPLOYMENT.md for which Neon URL belongs in which environment.
 */

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Salin .env.example menjadi .env lalu isi nilainya.",
    );
  }

  const adapter = new PrismaPg({ connectionString });

  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

function getClient(): PrismaClient {
  // Constructed lazily on first *use*, not at module import. Building a module
  // graph that touches the database must not require the env var to be present —
  // otherwise `next build` crashes during page-data collection on any machine
  // without production credentials, and the failure looks like a code error
  // rather than a configuration one.
  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = createClient();
  }

  return globalForPrisma.prisma;
}

/**
 * Cached across hot reloads in development, so editing a server file does not
 * open a fresh connection pool on every change.
 */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, property, receiver) {
    const value = Reflect.get(getClient(), property, receiver);
    return typeof value === "function" ? value.bind(getClient()) : value;
  },
  has(_target, property) {
    return Reflect.has(getClient(), property);
  },
  ownKeys() {
    return Reflect.ownKeys(getClient());
  },
  getOwnPropertyDescriptor(_target, property) {
    return Reflect.getOwnPropertyDescriptor(getClient(), property);
  },
});