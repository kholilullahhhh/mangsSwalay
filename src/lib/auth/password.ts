import "server-only";

import { hash } from "bcryptjs";

/**
 * Password hashing.
 *
 * bcrypt with cost 12, matching the hash the seed script writes, so a seeded
 * development password and one set through the users screen are interchangeable.
 * Kept in its own module so the only place a plaintext password becomes a hash
 * is obvious to find.
 */

/** bcrypt work factor. Higher is slower to brute-force and slower to log in. */
export const BCRYPT_COST = 12;

export async function hashPassword(plain: string): Promise<string> {
  return hash(plain, BCRYPT_COST);
}