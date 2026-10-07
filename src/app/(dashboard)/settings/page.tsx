import type { Metadata } from "next";

import { requirePagePermission } from "@/lib/auth/session";
import { getAllSettings } from "@/lib/queries/catalog";
import { SettingsForm } from "./settings-form";

export const metadata: Metadata = {
  title: "Pengaturan Toko",
};

/**
 * Store settings.
 *
 * Grouped by what they affect, because a flat list of keys is unreadable and the
 * person editing "jam buka" has no reason to care about the tax rate row above
 * it. Only keys the server accepts are rendered; the allow-list lives with the
 * action, not here, so adding a setting to the UI cannot grant write access to
 * something unlisted.
 */
const GROUPS: Array<{
  title: string;
  description: string;
  keys: string[];
}> = [
  {
    title: "Identitas Toko",
    description: "Ditampilkan di struk, halaman depan, dan dokumen penjualan.",
    keys: [
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
  {
    title: "Pajak",
    description: "Disimpan sebagai persen dan diterapkan sebagai bagian dari total.",
    keys: ["tax.enabled", "tax.rate"],
  },
  {
    title: "Loyalitas",
    description: "Poin member diberikan per belanja dan nilainya saat penukaran.",
    keys: ["loyalty.enabled", "loyalty.ratio", "loyalty.pointValue"],
  },
  {
    title: "Kedaluwarsa",
    description: "Kapan barang dianggap perlu segera Habiskan.",
    keys: ["expiry.warningDays"],
  },
  {
    title: "Struk",
    description: "Teks tambahan yang dicetak di bagian bawah struk.",
    keys: ["invoice.footer"],
  },
];

/** Fields whose value is a number, so the input can be typed as one. */
const NUMBER_KEYS = new Set([
  "tax.rate",
  "loyalty.ratio",
  "loyalty.pointValue",
  "expiry.warningDays",
]);

/** Fields rendered as a toggle rather than a text box. */
const BOOLEAN_KEYS = new Set(["tax.enabled", "loyalty.enabled"]);

/** Longer fields get a textarea instead of a single-line input. */
const LONG_KEYS = new Set(["store.about", "store.address", "invoice.footer"]);

export default async function SettingsPage() {
  await requirePagePermission("settings:view");

  const rows = await getAllSettings();
  const byKey = new Map(rows.map((row) => [row.key, row]));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Pengaturan Toko</h1>
        <p className="text-sm text-muted-foreground">
          Perubahan berlaku langsung dan tercatat di log audit.
        </p>
      </div>

      <SettingsForm
        groups={GROUPS.map((group) => ({
          ...group,
          fields: group.keys
            .map((key) => byKey.get(key))
            .filter((row): row is NonNullable<typeof row> => Boolean(row))
            .map((row) => ({
              key: row.key,
              value: row.value as string | number | boolean | null,
              description: row.description,
              kind: BOOLEAN_KEYS.has(row.key)
                ? ("boolean" as const)
                : NUMBER_KEYS.has(row.key)
                  ? ("number" as const)
                  : LONG_KEYS.has(row.key)
                    ? ("long" as const)
                    : ("text" as const),
            })),
        }))}
      />
    </div>
  );
}