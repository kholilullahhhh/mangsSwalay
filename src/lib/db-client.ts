import type { Prisma } from "@/generated/prisma/client";

/**
 * Shared Prisma client types.
 *
 * Prisma's `TransactionClient` and `PrismaClient` are not interchangeable: the
 * client has lifecycle and raw-query methods the transaction does not. That
 * difference is usually papered over with a cast, which is how a function ends up
 * claiming it needs the whole client when it only reads a couple of models.
 *
 * The types here describe the *slice* a function actually uses, so the same
 * signature accepts either a transaction or the global client. A helper that can
 * join a caller's transaction is what makes a multi-step operation atomic
 * instead of secretly committing on its own.
 */

/** A Prisma transaction: model delegates only. */
export type TxClient = Prisma.TransactionClient;

/** Model delegates shared by the stock helpers. */
export type StockClient = Pick<
  TxClient,
  "product" | "inventoryMovement" | "productBatch"
>;

/** Model delegates needed to read expiry batches. */
export type BatchClient = Pick<TxClient, "productBatch">;

/** Model delegates needed to write an audit row inside a transaction. */
export type AuditClient = Pick<TxClient, "auditLog">;