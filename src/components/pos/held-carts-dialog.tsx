"use client";

import { Pause, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatCurrency } from "@/lib/format";
import { calculateTotals, type CartLine } from "@/lib/pos/cart";

/**
 * Held-transaction dialog.
 *
 * Held carts are a queue, not a setting: a cashier parks a basket to serve the
 * next customer and comes back to it. The running total is shown per entry
 * because the question on reopening the dialog is "which basket was how much",
 * and that is answered by money, not by item count.
 */

export interface HeldCartEntry {
  id: string;
  label: string;
  lines: CartLine[];
}

export function HeldCartsDialog({
  open,
  onOpenChange,
  held,
  onHoldCurrent,
  onResume,
  onDiscard,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  held: HeldCartEntry[];
  onHoldCurrent: () => void;
  onResume: (id: string) => void;
  onDiscard: (id: string) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Transaksi Tersimpan</DialogTitle>
          <DialogDescription>
            Simpan keranjang sementara untuk dilayani pelanggan lain.
          </DialogDescription>
        </DialogHeader>

        <Button onClick={onHoldCurrent} className="w-full">
          <Pause className="size-4" aria-hidden />
          Simpan keranjang saat ini
        </Button>

        {held.length > 0 ? (
          <ul className="divide-y">
            {held.map((entry) => (
              <li
                key={entry.id}
                className="flex items-center justify-between gap-2 py-2 text-sm"
              >
                <span className="min-w-0">
                  <span className="block font-medium">{entry.label}</span>
                  <span className="text-xs text-muted-foreground">
                    {entry.lines.length} item ·{" "}
                    {formatCurrency(calculateTotals({ lines: entry.lines }).total)}
                  </span>
                </span>

                <div className="flex shrink-0 gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onResume(entry.id)}
                  >
                    Lanjutkan
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => onDiscard(entry.id)}
                    aria-label={`Hapus ${entry.label}`}
                  >
                    <X className="size-4" aria-hidden />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="py-4 text-center text-sm text-muted-foreground">
            Belum ada transaksi tersimpan.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}