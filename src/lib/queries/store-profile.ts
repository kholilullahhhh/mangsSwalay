import "server-only";

import { prisma } from "@/lib/db";

/**
 * Public store profile.
 *
 * Every value comes from `StoreSetting`, which is what the owner edits on the
 * settings screen. The landing page therefore shows the real store name, address,
 * and hours without anyone editing the page — and a change in settings appears on
 * the public site immediately.
 *
 * Deliberately absent: testimonials, customer counts, star ratings, and partner
 * logos. A store that has not supplied them has nothing truthful to show, and
 * inventing them is the fastest way to make a real shop's website a lie.
 */

export interface StoreProfile {
  name: string;
  tagline: string;
  about: string;
  address: string;
  phone: string;
  whatsapp: string;
  email: string;
  openTime: string;
  closeTime: string;
  /** `null` when the store has not configured hours. */
  hours: string | null;
  /** Real catalogue counts, shown only because they are true. */
  categoryCount: number;
  productCount: number;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function getStoreProfile(): Promise<StoreProfile> {
  const [rows, categoryCount, productCount] = await Promise.all([
    prisma.storeSetting.findMany({
      where: {
        key: {
          in: [
            "store.name",
            "store.tagline",
            "store.about",
            "store.address",
            "store.phone",
            "store.whatsapp",
            "store.email",
            "store.openTime",
            "store.closeTime",
          ],
        },
      },
      select: { key: true, value: true },
    }),
    prisma.category.count({ where: { isActive: true } }),
    prisma.product.count({ where: { isActive: true } }),
  ]);

  const byKey = new Map(rows.map((row) => [row.key, row.value]));

  const name = asString(byKey.get("store.name")) || "Swalayaku";
  const openTime = asString(byKey.get("store.openTime"));
  const closeTime = asString(byKey.get("store.closeTime"));

  return {
    name,
    tagline: asString(byKey.get("store.tagline")),
    about: asString(byKey.get("store.about")),
    address: asString(byKey.get("store.address")),
    phone: asString(byKey.get("store.phone")),
    // Stored in international format for wa.me links; kept digits-only here.
    whatsapp: asString(byKey.get("store.whatsapp")).replace(/\D/g, ""),
    email: asString(byKey.get("store.email")),
    openTime,
    closeTime,
    hours: openTime && closeTime ? `${openTime} - ${closeTime}` : null,
    categoryCount,
    productCount,
  };
}