/**
 * Hero visual.
 *
 * A static illustration of the POS screen, not a screenshot and not live data.
 *
 * That distinction matters twice over. A screenshot rots the moment the UI
 * changes and drags megabytes of image weight onto the page's LCP. Live data
 * would be worse: it would either leak another customer's sale or require a
 * public query the storefront has no business making. So this is plain markup
 * styled with the app's own tokens — it inherits light and dark mode for free,
 * costs no network request, and shifts nothing once painted.
 *
 * It is `aria-hidden`. The figures inside are illustrative, so exposing them to a
 * screen reader would announce numbers that are not real. The marketing copy
 * beside it carries the actual message.
 */

const ROWS = [
  { name: "Indomie Goreng", qty: "×4", total: "Rp 14.000" },
  { name: "Air Mineral 600ml", qty: "×2", total: "Rp 8.000" },
  { name: "Susu UHT Cokelat", qty: "×1", total: "Rp 19.500" },
];

export function HeroPreview() {
  return (
    <div
      aria-hidden
      className="w-full rounded-xl border bg-card p-4 text-start shadow-sm sm:p-5"
    >
      <div className="flex items-center justify-between gap-3 border-b pb-3">
        <div className="flex items-center gap-2">
          <span className="size-2 rounded-full bg-stock-out" />
          <span className="text-xs font-medium text-muted-foreground">
            Transaksi berjalan
          </span>
        </div>
        <span className="rounded-md bg-muted px-2 py-1 text-[11px] text-muted-foreground">
          INV/…
        </span>
      </div>

      <ul className="divide-y">
        {ROWS.map((row) => (
          <li
            key={row.name}
            className="flex items-baseline justify-between gap-3 py-2.5 text-sm"
          >
            <span className="min-w-0 truncate">
              {row.name}
              <span className="ms-1 text-muted-foreground">{row.qty}</span>
            </span>
            <span className="shrink-0 tabular">{row.total}</span>
          </li>
        ))}
      </ul>

      <div className="space-y-1.5 border-t pt-3 text-sm">
        <div className="flex justify-between text-muted-foreground">
          <span>Subtotal</span>
          <span className="tabular">Rp 41.500</span>
        </div>
        <div className="flex justify-between text-muted-foreground">
          <span>Diskon</span>
          <span className="tabular">− Rp 4.000</span>
        </div>
        <div className="flex justify-between font-semibold">
          <span>Total</span>
          <span className="tabular">Rp 37.500</span>
        </div>
      </div>

      {/* The stock warning is the point of the illustration: it shows the system
          catching a shortfall at the till, which is the thing a shopkeeper is
          actually buying. */}
      <p className="mt-3 flex items-start gap-2 rounded-md bg-stock-low/15 p-2.5 text-xs text-stock-low">
        <span className="ms-0.5 mt-px size-1.5 shrink-0 rounded-full bg-current" />
        Stok Air Mineral 600ml tersisa 2, tidak dapat ditambah ke keranjang
        melebihi jumlah tersedia.
      </p>
    </div>
  );
}
