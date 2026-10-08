"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

/**
 * Customer picker.
 *
 * Split out of the terminal because it is self-contained: it owns a search box
 * and a list, and communicates only through `onSelect` / `onClear`. Leaving it
 * inline meant the terminal file grew past a thousand lines and the one dialog a
 * manager touches twice a day was impossible to find in it.
 *
 * Filtering happens here rather than in the terminal so the terminal does not
 * have to hold a search string it only passes straight back.
 */

export interface PosCustomerOption {
  id: string;
  name: string;
  phone: string | null;
  memberNumber: string | null;
  isMember: boolean;
  /** Loyalty balance, so the cashier can see it while choosing a member. */
  points?: number;
}

export function CustomerPickerDialog({
  open,
  onOpenChange,
  customers,
  query,
  onQueryChange,
  selected,
  onSelect,
  onClear,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customers: PosCustomerOption[];
  query: string;
  onQueryChange: (query: string) => void;
  selected: PosCustomerOption | null;
  onSelect: (customer: PosCustomerOption) => void;
  onClear: () => void;
}) {
  const trimmed = query.trim().toLowerCase();

  // Matched on all three fields because a customer may know any one of them: the
  // name at the counter, the number they dialled, or the printed card.
  //
  // Capped at 50 because the list is a scannable index, not a report — a shop
  // with 5,000 customers still needs the first few on screen immediately.
  const filtered = (
    trimmed
      ? customers.filter(
          (entry) =>
            entry.name.toLowerCase().includes(trimmed) ||
            (entry.phone ?? "").includes(trimmed) ||
            (entry.memberNumber ?? "").toLowerCase().includes(trimmed),
        )
      : customers
  ).slice(0, 50);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Pilih Pelanggan</DialogTitle>
          <DialogDescription>
            Member mendapat poin loyalitas. Pelanggan umum tetap boleh bertransaksi
            tanpa membership.
          </DialogDescription>
        </DialogHeader>

        <Input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Cari nama, nomor telepon, atau nomor member…"
          autoFocus
          aria-label="Cari pelanggan"
        />

        <div className="max-h-80 overflow-y-auto">
          {filtered.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Pelanggan tidak ditemukan.
            </p>
          ) : (
            <ul className="divide-y">
              {filtered.map((entry) => (
                <li key={entry.id}>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-3 px-2 py-2.5 text-left text-sm hover:bg-accent"
                    onClick={() => onSelect(entry)}
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">
                        {entry.name}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {entry.phone ?? "—"}
                      </span>
                    </span>

                    {entry.isMember ? (
                      <Badge variant="secondary" className="shrink-0">
                        {entry.memberNumber ?? "Member"}
                      </Badge>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {selected ? (
          <Button variant="outline" className="w-full" onClick={onClear}>
            Hapus pelanggan
          </Button>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}