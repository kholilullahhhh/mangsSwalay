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

  // Prisma unique-constraint violations are common on duplicate SKU/barcode.
  if (isPrismaUniqueViolation(error)) {
    return {
      status: 409,
      body: { error: "Data duplikat: SKU atau barcode sudah digunakan." },
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