import type { Metadata } from "next";

import { requirePagePermission } from "@/lib/auth/session";
import { ProductImport } from "./product-import";

export const metadata: Metadata = {
  title: "Impor Produk",
};

/**
 * Bulk catalogue import.
 *
 * The parse runs before any write, so a file with mistakes produces a full list
 * of errors and changes nothing. That ordering is the whole point of this screen:
 * a half-imported catalogue cannot be reconciled against the stock ledger.
 */
export default async function ProductImportPage() {
  await requirePagePermission("products:create");

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Impor Produk</h1>
        <p className="text-sm text-muted-foreground">
          Unggah daftar produk dari berkas CSV. Semua baris diperiksa dulu; tidak
          ada produk yang tersimpan bila ada satu baris pun bermasalah.
        </p>
      </div>

      <ProductImport />
    </div>
  );
}