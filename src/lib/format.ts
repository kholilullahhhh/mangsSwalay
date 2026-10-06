/**
 * Formatting helpers for currency, dates, and numbers.
 *
 * The store operates in WIB (UTC+7) and Rupiah. Database values are stored in
 * UTC, so every displayed timestamp is converted explicitly rather than relying
 * on the server's local timezone.
 */

/** Store timezone. All reporting and receipt timestamps use this zone. */
export const STORE_TIME_ZONE = "Asia/Jakarta";

/**
 * Formats a Rupiah amount, e.g. `Rp 68.000`.
 *
 * Accepts Prisma Decimal, number, or string. Rupiah has no subunit in practice,
 * so values are rounded to the nearest whole unit for display.
 */
export function formatCurrency(value: unknown): string {
  const amount = toNumber(value);

  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  }).format(amount);
}

/** Compact currency for dashboard tiles, e.g. `Rp 1,2 jt`. */
export function formatCurrencyCompact(value: unknown): string {
  const amount = toNumber(value);
  const absolute = Math.abs(amount);

  if (absolute >= 1_000_000_000) {
    return `Rp ${trim(amount / 1_000_000_000)} M`;
  }

  if (absolute >= 1_000_000) {
    return `Rp ${trim(amount / 1_000_000)} jt`;
  }

  if (absolute >= 1_000) {
    return `Rp ${trim(amount / 1_000)} rb`;
  }

  return formatCurrency(amount);
}

function trim(value: number): string {
  return new Intl.NumberFormat("id-ID", {
    maximumFractionDigits: 1,
  }).format(value);
}

/** Plain number with Indonesian digit grouping, e.g. `1.250`. */
export function formatNumber(value: unknown): string {
  return new Intl.NumberFormat("id-ID").format(toNumber(value));
}

/**
 * Converts a Decimal, number, or numeric string to a plain number.
 * Returns 0 for null/undefined/NaN so callers never render "NaN".
 */
export function toNumber(value: unknown): number {
  if (value === null || value === undefined) {
    return 0;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  // Prisma.Decimal and other numeric objects expose toString/toNumber.
  if (typeof value === "object") {
    const candidate = value as { toNumber?: () => number; toString: () => string };
    if (typeof candidate.toNumber === "function") {
      return candidate.toNumber();
    }
    const parsed = Number(candidate.toString());
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

/** Formats a date as `7 Okt 2026`. */
export function formatDate(value: Date | string | null | undefined): string {
  const date = toDate(value);
  if (!date) return "-";

  return new Intl.DateTimeFormat("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: STORE_TIME_ZONE,
  }).format(date);
}

/** Formats a date and time as `7 Okt 2026, 14:32`. */
export function formatDateTime(
  value: Date | string | null | undefined,
): string {
  const date = toDate(value);
  if (!date) return "-";

  return new Intl.DateTimeFormat("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: STORE_TIME_ZONE,
  }).format(date);
}

/** Time only, e.g. `14:32`. */
export function formatTime(value: Date | string | null | undefined): string {
  const date = toDate(value);
  if (!date) return "-";

  return new Intl.DateTimeFormat("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: STORE_TIME_ZONE,
  }).format(date);
}

/** "3 menit lalu" style relative time, for feeds and audit logs. */
export function formatRelative(
  value: Date | string | null | undefined,
): string {
  const date = toDate(value);
  if (!date) return "-";

  const diffSeconds = Math.round((date.getTime() - Date.now()) / 1000);
  const absolute = Math.abs(diffSeconds);

  const formatter = new Intl.RelativeTimeFormat("id-ID", { numeric: "auto" });

  if (absolute < 60) return formatter.format(diffSeconds, "second");
  if (absolute < 3600) return formatter.format(Math.round(diffSeconds / 60), "minute");
  if (absolute < 86400) return formatter.format(Math.round(diffSeconds / 3600), "hour");
  if (absolute < 2592000) {
    return formatter.format(Math.round(diffSeconds / 86400), "day");
  }

  return formatDate(date);
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;

  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Start of the current day in the store timezone, as a UTC Date.
 *
 * "Today" for reporting must mean today in WIB, not the server's day. The
 * offset is derived from the zone rather than hardcoded to +7 so the helper
 * stays correct if the store timezone is ever configurable.
 */
export function startOfStoreDay(reference: Date = new Date()): Date {
  return startOfDayInZone(reference);
}

/** Start of the day `days` before today (store timezone). */
export function startOfStoreDayOffset(
  days: number,
  reference: Date = new Date(),
): Date {
  const shifted = new Date(reference.getTime() - days * 86_400_000);
  return startOfDayInZone(shifted);
}

/** Start of the current month in the store timezone. */
export function startOfStoreMonth(reference: Date = new Date()): Date {
  const parts = getZoneParts(reference);
  return zonedTimeToUtc(parts.year, parts.month, 1, 0, 0, 0);
}

/** Start of the current week (Monday) in the store timezone. */
export function startOfStoreWeek(reference: Date = new Date()): Date {
  const dayStart = startOfDayInZone(reference);
  const weekday = getZoneParts(reference).weekday;
  // getWeekday: Monday = 0 … Sunday = 6
  const daysSinceMonday = weekday;
  return new Date(dayStart.getTime() - daysSinceMonday * 86_400_000);
}

function startOfDayInZone(reference: Date): Date {
  const parts = getZoneParts(reference);
  return zonedTimeToUtc(parts.year, parts.month, parts.day, 0, 0, 0);
}

/**
 * Reads the wall-clock parts of `date` in the store timezone.
 */
function getZoneParts(date: Date): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number;
} {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: STORE_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
    hour12: false,
  });

  const parts: Record<string, string> = {};

  for (const part of formatter.formatToParts(date)) {
    if (part.type !== "literal") {
      parts[part.type] = part.value;
    }
  }

  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const weekdayIndex = weekdays.indexOf(parts.weekday ?? "Sun");

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: weekdayIndex === -1 ? 0 : (weekdayIndex + 6) % 7,
  };
}

/**
 * Converts a wall-clock time in the store timezone to the equivalent UTC Date.
 *
 * Computed by measuring the zone's offset at that instant and subtracting it,
 * which stays correct across daylight-saving boundaries in zones that observe
 * them (WIB does not, but this avoids assuming that).
 */
function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
): Date {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second);
  const guessAsDate = new Date(utcGuess);
  const offsetMs = getZoneOffsetMs(guessAsDate);
  return new Date(utcGuess - offsetMs);
}

/** Offset of the store timezone from UTC, in milliseconds, at a given instant. */
function getZoneOffsetMs(date: Date): number {
  const parts = getZoneParts(date);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  // `hour` can be "24" in some locales at midnight under hour12: false.
  const normalizedHour = parts.hour === 24 ? 0 : parts.hour;
  const correctedAsUtc =
    normalizedHour === parts.hour
      ? asUtc
      : Date.UTC(
          parts.year,
          parts.month - 1,
          parts.day,
          normalizedHour,
          parts.minute,
          parts.second,
        );

  return correctedAsUtc - date.getTime();
}

/** Percentage change between two periods, guarding divide-by-zero. */
export function percentChange(current: number, previous: number): number | null {
  if (previous === 0) {
    return current === 0 ? 0 : null;
  }
  return ((current - previous) / Math.abs(previous)) * 100;
}

/** Formats a percentage delta for a trend badge. */
export function formatPercentChange(
  current: number,
  previous: number,
): { text: string; direction: "up" | "down" | "flat" } | null {
  const change = percentChange(current, previous);

  if (change === null) {
    return null;
  }

  if (Math.abs(change) < 0.05) {
    return { text: "Sama seperti periode lalu", direction: "flat" };
  }

  const rounded = Math.abs(change) >= 100
    ? Math.round(change).toString()
    : change.toFixed(1);

  return {
    text: `${change > 0 ? "+" : ""}${rounded}%`,
    direction: change > 0 ? "up" : "down",
  };
}