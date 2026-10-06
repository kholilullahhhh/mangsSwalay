import "server-only";

import { headers } from "next/headers";
import { prisma } from "@/lib/db";
import type { TxClient } from "@/lib/inventory/stock";

/**
 * Audit logging.
 *
 * Every mutation that changes money, stock, permissions, or store data records
 * an entry here. Logging must never break the operation it describes, so all
 * errors are swallowed after being reported to the server log.
 */

export type AuditAction =
  // auth
  | "LOGIN"
  | "LOGIN_FAILED"
  | "LOGOUT"
  // catalogue
  | "PRODUCT_CREATE"
  | "PRODUCT_UPDATE"
  | "PRODUCT_DELETE"
  | "PRODUCT_IMPORT"
  | "CATEGORY_CREATE"
  | "CATEGORY_UPDATE"
  | "CATEGORY_DELETE"
  // inventory
  | "STOCK_ADJUSTMENT"
  | "STOCK_OPNAME_CREATE"
  | "STOCK_OPNAME_APPROVE"
  | "BATCH_CREATE"
  | "BATCH_EXPIRE"
  // purchasing
  | "PURCHASE_CREATE"
  | "PURCHASE_UPDATE"
  | "PURCHASE_RECEIVE"
  | "PURCHASE_CANCEL"
  | "SUPPLIER_CREATE"
  | "SUPPLIER_UPDATE"
  | "SUPPLIER_DELETE"
  // sales
  | "SALE_CREATE"
  | "SALE_VOID"
  | "SALE_REFUND"
  // customers & marketing
  | "CUSTOMER_CREATE"
  | "CUSTOMER_UPDATE"
  | "CUSTOMER_DELETE"
  | "PROMOTION_CREATE"
  | "PROMOTION_UPDATE"
  | "PROMOTION_DELETE"
  // finance
  | "EXPENSE_CREATE"
  | "EXPENSE_UPDATE"
  | "EXPENSE_DELETE"
  | "SHIFT_OPEN"
  | "SHIFT_CLOSE"
  | "CASH_IN"
  | "CASH_OUT"
  // system
  | "USER_CREATE"
  | "USER_UPDATE"
  | "USER_DELETE"
  | "SETTINGS_UPDATE";

export interface AuditInput {
  userId: string | null;
  action: AuditAction;
  entity: string;
  entityId?: string | null;
  oldData?: unknown;
  newData?: unknown;
}

/** Strips secrets and bulky fields before persisting an audit payload. */
function sanitise(value: unknown): unknown {
  if (value === null || value === undefined) {
    return null;
  }

  if (Array.isArray(value)) {
    return value.slice(0, 20).map(sanitise);
  }

  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};

    for (const [key, entry] of Object.entries(record)) {
      const lower = key.toLowerCase();

      if (
        lower === "passwordhash" ||
        lower === "password" ||
        lower === "token" ||
        lower === "authsecret"
      ) {
        continue;
      }

      output[key] = sanitise(entry);
    }

    return output;
  }

  return value;
}

/**
 * Writes an audit entry. Fire-and-forget: the caller's transaction commits
 * regardless, because failing a sale because an audit insert hiccuped would be
 * worse than a missing log line.
 */
export async function audit(input: AuditInput): Promise<void> {
  try {
    const headerList = await headers();

    await prisma.auditLog.create({
      data: {
        userId: input.userId,
        action: input.action,
        entity: input.entity,
        entityId: input.entityId ?? null,
        oldData: sanitise(input.oldData) as never,
        newData: sanitise(input.newData) as never,
        ipAddress:
          headerList.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
        userAgent: headerList.get("user-agent"),
      },
    });
  } catch (error) {
    console.error("[audit] failed to record entry", {
      action: input.action,
      entity: input.entity,
      error,
    });
  }
}

/**
 * Writes an audit entry using a transaction-scoped client, so the log entry
 * commits or rolls back together with the change it describes. Use this inside
 * `$transaction` callbacks where atomicity matters.
 */
export async function auditWithClient(
  client: TxClient,
  input: AuditInput,
  req?: { ipAddress: string | null; userAgent: string | null },
): Promise<void> {
  try {
    await client.auditLog.create({
      data: {
        userId: input.userId,
        action: input.action,
        entity: input.entity,
        entityId: input.entityId ?? null,
        oldData: sanitise(input.oldData) as never,
        newData: sanitise(input.newData) as never,
        ipAddress: req?.ipAddress ?? null,
        userAgent: req?.userAgent ?? null,
      },
    });
  } catch (error) {
    console.error("[audit] failed to record transactional entry", {
      action: input.action,
      error,
    });
  }
}

/** Reads client IP and user-agent for audit rows. */
export async function getRequestMeta(): Promise<{
  ipAddress: string | null;
  userAgent: string | null;
}> {
  try {
    const headerList = await headers();
    return {
      ipAddress:
        headerList.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
      userAgent: headerList.get("user-agent"),
    };
  } catch {
    return { ipAddress: null, userAgent: null };
  }
}