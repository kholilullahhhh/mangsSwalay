import "server-only";

import { cache } from "react";
import { cookies, headers } from "next/headers";
import { forbidden, redirect } from "next/navigation";
import { SignJWT, jwtVerify } from "jose";

import { prisma } from "@/lib/db";
import type { Role } from "@/generated/prisma/enums";
import {
  roleHasAll,
  roleHasAny,
  roleHasPermission,
  type Permission,
  type RoleName,
} from "@/lib/rbac";

/**
 * Session handling.
 *
 * Strategy: a signed JWT in an httpOnly cookie identifies a `Session` row. The
 * JWT alone is deliberately NOT trusted for authorisation — every request that
 * needs identity re-reads the user from the database. That means:
 *
 * - deactivating a user or changing their role takes effect immediately
 *   (an Auth.js-style self-contained token would keep stale claims alive),
 * - sessions can be revoked centrally (logout-all, forced logout on shift close),
 * - and the audit log can attribute activity to a real, current user record.
 *
 * The JWT carries only `{ sessionId }` — never role or permission claims.
 */

const SESSION_COOKIE = "swalayaku_session";
const SESSION_TTL_SECONDS = 60 * 60 * 12; // 12 hours: one working shift.

function getSecretKey(): Uint8Array {
  const secret = process.env.AUTH_SECRET;

  if (!secret) {
    throw new Error(
      "AUTH_SECRET is not set. Generate one with: openssl rand -base64 32",
    );
  }

  if (secret.length < 32) {
    throw new Error("AUTH_SECRET must be at least 32 characters long.");
  }

  return new TextEncoder().encode(secret);
}

export interface SessionUser {
  id: string;
  username: string;
  name: string;
  email: string;
  role: RoleName;
}

/** Creates a Session row and sets the cookie. Call from a Server Action. */
export async function createSession(userId: string): Promise<void> {
  const headerList = await headers();

  // Store a hash of the token rather than the token itself, so a database leak
  // cannot be replayed as a live session.
  const token = crypto.randomUUID() + crypto.randomUUID();
  const tokenHash = await sha256(token);

  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000);

  // Sweep expired rows before adding another. Sessions are only ever removed by
  // the user who held them coming back with the cookie, so a shared till would
  // accumulate every session ever opened, forever. Deleting on the write path
  // keeps that self-healing with no cron job to deploy on Vercel.
  await prisma.session.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });

  await prisma.session.create({
    data: {
      token: tokenHash,
      userId,
      expiresAt,
      ipAddress:
        headerList.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
      userAgent: headerList.get("user-agent"),
    },
  });

  const jwt = await new SignJWT({ tokenHash })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(getSecretKey());

  const cookieStore = await cookies();

  cookieStore.set(SESSION_COOKIE, jwt, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

/** Deletes the session row and clears the cookie. */
export async function destroySession(): Promise<void> {
  const tokenHash = await readSessionTokenHash();

  if (tokenHash) {
    await prisma.session.deleteMany({ where: { token: tokenHash } });
  }

  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
}

/** Deletes every session belonging to a user (logout everywhere). */
export async function destroyAllSessions(userId: string): Promise<void> {
  await prisma.session.deleteMany({ where: { userId } });
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function readSessionTokenHash(): Promise<string | null> {
  const cookieStore = await cookies();
  const jwt = cookieStore.get(SESSION_COOKIE)?.value;

  if (!jwt) {
    return null;
  }

  try {
    const { payload } = await jwtVerify(jwt, getSecretKey(), {
      algorithms: ["HS256"],
    });
    return typeof payload.tokenHash === "string" ? payload.tokenHash : null;
  } catch {
    // Expired or tampered cookie — treat as unauthenticated.
    return null;
  }
}

/**
 * Resolves the current user from the session cookie, or null.
 *
 * Wrapped in React `cache()` so that calling it from several components during
 * one render hits the database only once. Always re-reads from the database so
 * role changes and deactivation take effect immediately.
 */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const tokenHash = await readSessionTokenHash();

  if (!tokenHash) {
    return null;
  }

  const session = await prisma.session.findUnique({
    where: { token: tokenHash },
    select: {
      expiresAt: true,
      user: {
        select: {
          id: true,
          username: true,
          name: true,
          email: true,
          role: true,
          isActive: true,
        },
      },
    },
  });

  if (!session) {
    return null;
  }

  if (session.expiresAt < new Date() || !session.user.isActive) {
    // Opportunistically clean up an expired or revoked session.
    await prisma.session.deleteMany({ where: { token: tokenHash } });
    return null;
  }

  return {
    id: session.user.id,
    username: session.user.username,
    name: session.user.name,
    email: session.user.email,
    role: session.user.role,
  };
});

/**
 * Requires an authenticated user. Redirects to login otherwise.
 * Use in Server Components, Server Actions, and Route Handlers.
 */
export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  return user;
}

/**
 * Requires a specific permission. Throws (→ error boundary / 403) when the
 * user lacks it. Call this *inside* every Server Action and Route Handler that
 * mutates data; do not rely on the UI having hidden the control.
 */
export async function requirePermission(
  permission: Permission,
): Promise<SessionUser> {
  const user = await requireUser();

  if (!roleHasPermission(user.role, permission)) {
    throw new AuthorizationError(permission);
  }

  return user;
}

/**
 * Page-level permission check.
 *
 * Uses Next.js `forbidden()`, which renders the app's `forbidden.tsx` and
 * returns a real 403 status. A thrown AuthorizationError would reach the error
 * boundary as a 500, which is wrong twice over: the status misleads monitoring,
 * and the boundary shows a generic failure for what is a routine, expected
 * outcome.
 *
 * Deliberately separate from `requirePermission`, which must *throw* so Server
 * Actions can convert it into an inline error message. `forbidden()` aborts the
 * render, which is right for a page and wrong for an action.
 */
export async function requirePagePermission(
  permission: Permission,
): Promise<SessionUser> {
  const user = await requireUser();

  if (!roleHasPermission(user.role, permission)) {
    forbidden();
  }

  return user;
}

/** Requires all of the given permissions. */
export async function requireAllPermissions(
  permissions: readonly Permission[],
): Promise<SessionUser> {
  const user = await requireUser();

  if (!roleHasAll(user.role, permissions)) {
    throw new AuthorizationError(permissions[0]);
  }

  return user;
}

/** Requires at least one of the given permissions. */
export async function requireAnyPermission(
  permissions: readonly Permission[],
): Promise<SessionUser> {
  const user = await requireUser();

  if (!roleHasAny(user.role, permissions)) {
    throw new AuthorizationError(permissions[0]);
  }

  return user;
}

/** Requires one of the given roles. */
export async function requireRole(
  roles: readonly RoleName[],
): Promise<SessionUser> {
  const user = await requireUser();

  if (!roles.includes(user.role)) {
    throw new AuthorizationError("role");
  }

  return user;
}

/**
 * Non-throwing permission check, for conditional UI inside Server Components.
 * Use only to decide what to *render*; never as the sole guard on a mutation.
 */
export async function hasPermission(
  permission: Permission,
): Promise<boolean> {
  const user = await getCurrentUser();
  return user ? roleHasPermission(user.role, permission) : false;
}

/** Thrown when a session lacks the required permission. */
export class AuthorizationError extends Error {
  readonly code = "FORBIDDEN";

  constructor(readonly required: Permission | "role") {
    super(
      required === "role"
        ? "Anda tidak memiliki akses ke bagian ini."
        : "Anda tidak memiliki izin untuk melakukan tindakan ini.",
    );
    this.name = "AuthorizationError";
  }
}

/** Narrow a Prisma `Role` to our RBAC role union. */
export function toRoleName(role: Role): RoleName {
  return role as RoleName;
}
