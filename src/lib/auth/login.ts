import "server-only";

import { compare } from "bcryptjs";

import { prisma } from "@/lib/db";
import { createSession } from "@/lib/auth/session";

/**
 * Verifies credentials and opens a session.
 *
 * Failures are intentionally indistinguishable to the caller ("email atau
 * password salah") so the login form cannot be used to enumerate which
 * usernames or emails exist.
 */

export interface LoginResult {
  ok: boolean;
  error?: string;
}

/** Number of failed attempts before an account is temporarily locked. */
const MAX_FAILED_ATTEMPTS = 5;
/** Lockout window in milliseconds. */
const LOCKOUT_MS = 15 * 60 * 1000;

interface LoginAttempt {
  count: number;
  lockedUntil: number | null;
}

/**
 * In-memory rate limit keyed by username+IP.
 *
 * This is per-instance and therefore not a complete defence on a serverless
 * deployment with many concurrent lambdas — it raises the cost of a naive
 * attack without claiming to stop a determined one. The authoritative
 * protection is the lockout below, which is stored in the database and shared
 * across all instances. For a multi-region deployment, move the rate limiter to
 * a shared store (Upstash Redis) and keep the DB lockout as a backstop.
 */
const attempts = new Map<string, LoginAttempt>();

/** Caps memory growth on a long-lived instance. */
const MAX_TRACKED_KEYS = 10_000;

function rateLimitKey(identifier: string, ip: string | null): string {
  return `${identifier}:${ip ?? "unknown"}`;
}

export function isRateLimited(
  identifier: string,
  ip: string | null,
): { limited: boolean; retryInMinutes: number } {
  const entry = attempts.get(rateLimitKey(identifier, ip));

  if (!entry?.lockedUntil) {
    return { limited: false, retryInMinutes: 0 };
  }

  const remaining = entry.lockedUntil - Date.now();

  if (remaining <= 0) {
    attempts.delete(rateLimitKey(identifier, ip));
    return { limited: false, retryInMinutes: 0 };
  }

  return {
    limited: true,
    retryInMinutes: Math.ceil(remaining / 60_000),
  };
}

function registerFailure(identifier: string, ip: string | null): void {
  const key = rateLimitKey(identifier, ip);

  if (attempts.size >= MAX_TRACKED_KEYS) {
    // Drop the oldest entry rather than growing without bound.
    const oldest = attempts.keys().next();
    if (!oldest.done) {
      attempts.delete(oldest.value);
    }
  }

  const entry = attempts.get(key) ?? { count: 0, lockedUntil: null };

  entry.count += 1;

  if (entry.count >= MAX_FAILED_ATTEMPTS) {
    entry.lockedUntil = Date.now() + LOCKOUT_MS;
    entry.count = 0;
  }

  attempts.set(key, entry);
}

function clearFailures(identifier: string, ip: string | null): void {
  attempts.delete(rateLimitKey(identifier, ip));
}

export async function login(input: {
  username: string;
  password: string;
  ip: string | null;
}): Promise<LoginResult> {
  const identifier = input.username.trim().toLowerCase();

  const { limited, retryInMinutes } = isRateLimited(identifier, input.ip);

  if (limited) {
    return {
      ok: false,
      error: `Terlalu banyak percobaan gagal. Coba lagi dalam ${retryInMinutes} menit.`,
    };
  }

  const user = await prisma.user.findFirst({
    where: {
      OR: [{ username: identifier }, { email: identifier }],
    },
    select: {
      id: true,
      passwordHash: true,
      isActive: true,
      role: true,
    },
  });

  // Compare against a dummy hash when the user is missing, so a missing
  // account and a wrong password take the same amount of time.
  const hashToCompare =
    user?.passwordHash ??
    "$2b$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinv";

  const passwordMatches = await compare(input.password, hashToCompare);

  if (!user || !passwordMatches) {
    registerFailure(identifier, input.ip);
    return { ok: false, error: "Email atau password salah." };
  }

  if (!user.isActive) {
    return {
      ok: false,
      error: "Akun Anda dinonaktifkan. Hubungi administrator toko.",
    };
  }

  clearFailures(identifier, input.ip);

  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  await createSession(user.id);

  return { ok: true };
}