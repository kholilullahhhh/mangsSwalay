/**
 * Sequential document numbering (INV-20261006-0001).
 *
 * Numbering is atomic with record creation: the helper receives a `create`
 * callback and runs inside the caller's transaction, so the number and the row
 * it labels commit together or not at all.
 *
 * We deliberately do NOT compute the next number by reading MAX() + 1 — that is
 * a classic race where two concurrent transactions read the same maximum and
 * both try to write it. Instead we attempt an insert and let the unique
 * constraint arbitrate, retrying with a fresh suffix on collision.
 */

/** Builds the document prefix for a date, e.g. `INV-20261006-`. */
export function documentPrefix(prefix: string, date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${prefix}-${year}${month}${day}-`;
}

/** Attempts before giving up on finding an unused number. */
const MAX_ATTEMPTS = 5;

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

/**
 * Runs `create` with a generated, collision-free document number.
 *
 * @param prefix   Document prefix, e.g. `INV`, `PO`, `RFN`.
 * @param date     Date the number is anchored to (usually the document date).
 * @param create   Receives the number and persists the record. Must throw a
 *                 Prisma unique violation (P2002) if the number is taken.
 */
export async function withDocumentNumber<T>(
  prefix: string,
  date: Date,
  create: (number: string) => Promise<T>,
): Promise<T> {
  const base = documentPrefix(prefix, date);

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const candidate = `${base}${suffixFor(attempt)}`;

    try {
      return await create(candidate);
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }
      // Another transaction claimed this number; try another.
    }
  }

  throw new Error(
    `Gagal membuat nomor ${prefix} unik untuk ${base} setelah ${MAX_ATTEMPTS} percobaan.`,
  );
}

/**
 * Builds a 4-digit suffix for an attempt.
 *
 * Attempt 0 uses a random number in 1..9999. Later attempts jump into a
 * disjoint range so retries cannot collide with the numbers another terminal
 * would pick on its first try.
 */
function suffixFor(attempt: number): string {
  const random = Math.floor(Math.random() * 9000) + 1000;

  const value = attempt === 0 ? random : random + attempt * 10_000;

  return String(value % 100_000).padStart(4, "0");
}