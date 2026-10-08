import { NextResponse } from "next/server";

import { AuthorizationError } from "@/lib/auth/session";

/**
 * Shared error handling for Route Handlers and Server Actions.
 *
 * The spec requires specific, actionable messages instead of a generic
 * "something went wrong". Known domain errors therefore map to precise
 * messages, while anything unexpected is logged server-side and returned as a
 * neutral fallback — the raw error is never leaked to the client.
 */

export interface ActionError {
  error: string;
  /** Present when the client should focus a specific form field. */
  field?: string;
}

export class ValidationError extends Error {
  readonly code = "VALIDATION";

  constructor(message: string, readonly field?: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export class BusinessRuleError extends Error {
  readonly code = "BUSINESS_RULE";

  constructor(message: string) {
    super(message);
    this.name = "BusinessRuleError";
  }
}

export class NotFoundError extends Error {
  readonly code = "NOT_FOUND";

  constructor(message = "Data tidak ditemukan.") {
    super(message);
    this.name = "NotFoundError";
  }
}

/**
 * Converts a thrown error into a user-facing message.
 *
 * Domain errors carry their own Indonesian copy because that text is part of
 * the product. Everything else becomes a neutral message and is logged with its
 * stack for diagnosis.
 */
export function toErrorResponse(error: unknown): {
  status: number;
  body: ActionError;
} {
  if (error instanceof ValidationError) {
    return {
      status: 400,
      body: { error: error.message, field: error.field },
    };
  }

  if (error instanceof AuthorizationError) {
    return { status: 403, body: { error: error.message } };
  }

  if (error instanceof NotFoundError) {
    return { status: 404, body: { error: error.message } };
  }

  if (error instanceof BusinessRuleError) {
    return { status: 422, body: { error: error.message } };
  }

  // Domain errors from the state machines and the stock layer carry the same
  // actionable Indonesian copy the user should see. Falling through to the
  // generic handler turned "already received" and "not enough stock" — the two
  // most common refusals in the app — into "server error", which both misleads
  // the operator and teaches them to retry the thing that must not be retried.
  if (hasDomainCode(error)) {
    return { status: 422, body: { error: error.message } };
  }

  // Prisma unique-constraint violations are common on duplicate SKU/barcode.
  if (isPrismaUniqueViolation(error)) {
    return {
      status: 409,
      body: { error: uniqueViolationMessage(error) },
    };
  }

  if (isPrismaNotFoundViolation(error)) {
    return { status: 404, body: { error: "Data tidak ditemukan." } };
  }

  console.error("[unhandled]", error);

  return {
    status: 500,
    body: {
      error:
        "Terjadi kesalahan pada server. Silakan coba lagi, atau hubungi administrator jika berlanjut.",
    },
  };
}

function isPrismaUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

/**
 * Domain errors that are not subclasses of the base classes above, matched on the
 * `code` they carry. Importing each module would create a cycle: those modules
 * import `BusinessRuleError` from here.
 */
const DOMAIN_ERROR_CODES = new Set([
  "PURCHASE_TRANSITION",
  "INSUFFICIENT_STOCK",
  "UNKNOWN_PRODUCT",
]);

function hasDomainCode(error: unknown): error is { code: string; message: string } {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    DOMAIN_ERROR_CODES.has(String((error as { code?: unknown }).code))
  );
}

/**
 * Names the field that actually collided.
 *
 * `P2002` is raised for every unique constraint in the schema, and telling an
 * operator who duplicated a supplier code to fix a product's SKU sends them to
 * entirely the wrong place.
 */
function uniqueViolationMessage(error: unknown): string {
  const target =
    typeof error === "object" && error !== null && "meta" in error
      ? (error as { meta?: { target?: unknown } }).meta?.target
      : undefined;

  const fields = Array.isArray(target)
    ? target.join(", ")
    : typeof target === "string"
      ? target
      : "";

  if (fields.includes("sku") || fields.includes("barcode")) {
    return "Data duplikat: SKU atau barcode sudah digunakan.";
  }

  if (fields.includes("email")) return "Email sudah digunakan pengguna lain.";
  if (fields.includes("username")) return "Username sudah digunakan.";
  if (fields.includes("code")) return "Kode sudah digunakan. Gunakan kode lain.";
  if (fields.includes("slug")) return "Slug sudah digunakan produk/kategori lain.";
  if (fields.includes("name")) return "Nama sudah digunakan.";
  if (fields.includes("number") || fields.includes("invoiceNumber")) {
    return "Nomor dokumen sudah ada. Coba lagi.";
  }
  if (fields.includes("dedupeKey")) {
    return "Notifikasi ini sudah ada.";
  }

  return "Data duplikat: nilai ini sudah digunakan.";
}

function isPrismaNotFoundViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2025"
  );
}

/** Wraps a Route Handler so thrown errors become proper JSON responses. */
export function withErrorHandling<Args extends unknown[]>(
  handler: (...args: Args) => Promise<Response>,
): (...args: Args) => Promise<Response> {
  return async (...args: Args) => {
    try {
      return await handler(...args);
    } catch (error) {
      const { status, body } = toErrorResponse(error);
      return NextResponse.json(body, { status });
    }
  };
}

/** Converts a thrown error into an `ActionError` for Server Actions. */
export function toActionError(error: unknown): ActionError {
  return toErrorResponse(error).body;
}