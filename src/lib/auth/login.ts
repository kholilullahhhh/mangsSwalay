import "server-only";

import { compare, hash } from "bcryptjs";

import { prisma } from "@/lib/db";
import { BCRYPT_COST } from "@/lib/auth/password";
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
 * Per-instance, so it is not a complete defence on a serverless deployment with
 * many concurrent lambdas — it raises the cost of a naive attack rather than
 * stopping a determined one. The authoritative protection is the lockout on the
 * `User` row itself (`failedAttempts` / `lockedUntil`), which is stored in the
 * database and therefore shared by every instance; see `assertNotLocked` below.
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
/**
 * A real bcrypt hash of a value nobody knows.
 *
 * The point of the dummy comparison is that a request for a non-existent
 * username costs the same as one for an existing username. The previous
 * placeholder was not a valid bcrypt hash at all — cryptjs rejects any string
 * whose length is not exactly 60 characters and returns alse *before* doing any
 * work — so it answered in ~0 ms while a real comparison took ~220 ms. That gap is
 * a working enumeration oracle: one request per candidate username, with no rate
 * limit needed to read the answer.
 *
 * Generated once at module load so both paths run the same KDF.
 */
const DUMMY_HASH = await hash(
  // A random value that is never stored and could never be guessed.
  "swalayaku-timing-equaliser-" + crypto.randomUUID(),
  BCRYPT_COST,
);

export async function login(input: {
  username: string;
  password: string;
  ip: string | null;
}): Promise<LoginResult> {
  const identifier = input.username.trim().toLowerCase();

  const user = await prisma.user.findFirst({
    where: {
      OR: [{ username: identifier }, { email: identifier }],
    },
    select: {
      id: true,
      passwordHash: true,
      isActive: true,
      role: true,
      failedAttempts: true,
      lockedUntil: true,
    },
  });

  // The database lockout is checked before the expensive comparison, and it is
  // shared across every instance — unlike the in-memory map, rotating
  // X-Forwarded-For cannot buy a fresh bucket.
  if (user?.lockedUntil && user.lockedUntil > new Date()) {
    registerFailure(identifier, input.ip);

    return {
      ok: false,
      error:
        "Akun terkunci sementara. Coba lagi dalam " +
        Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000) +
        " menit.",
    };
  }

  const { limited, retryInMinutes } = isRateLimited(identifier, input.ip);

  if (limited) {
    return {
      ok: false,
      error: `Terlalu banyak percobaan gagal. Coba lagi dalam ${retryInMinutes} menit.`,
    };
  }

  // Compared against a dummy hash when the user is missing, so a missing account
  // and a wrong password take the same amount of time.
  const hashToCompare = user?.passwordHash ?? DUMMY_HASH;

  const passwordMatches = await compare(input.password, hashToCompare);

  if (!user || !passwordMatches) {
    registerFailure(identifier, input.ip);
    await recordFailureOnUser(user?.id ?? null);
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
    // The counter lives on the row, so a successful login clears the shared
    // lockout as well as this instance's.
    data: { lastLoginAt: new Date(), failedAttempts: 0, lockedUntil: null },
  });

  await createSession(user.id);

  return { ok: true };
}

/**
 * Increments the shared failure counter and locks the account at the threshold.
 *
 * A no-op for an unknown username: there is no row to count against, and
 * inventing one would let an anonymous caller write rows keyed by whatever they
 * typed. The in-memory limiter still covers that case.
 */
async function recordFailureOnUser(userId: string | null): Promise<void> {
  if (!userId) {
    return;
  }

  try {
    const updated = await prisma.user.update({
      where: { id: userId },
      data: { failedAttempts: { increment: 1 } },
      select: { failedAttempts: true },
    });

    if (updated.failedAttempts >= MAX_FAILED_ATTEMPTS) {
      await prisma.user.update({
        where: { id: userId },
        data: {
          failedAttempts: 0,
          lockedUntil: new Date(Date.now() + LOCKOUT_MS),
        },
      });
    }
  } catch (error) {
    // A bookkeeping failure must never turn a wrong password into a success, and
    // must not mask the real rejection either.
    console.error("[login] failed to record attempt", error);
  }
}