"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, RotateCcw, Undo2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";

import { refundSaleAction, voidSaleAction } from "../actions";

/**
 * Void control.
 *
 * Always renders the reason field, and when void is not permitted it explains
 * why rather than disappearing — a missing button leaves the operator guessing
 * whether the page is broken.
 */
export function SaleActions({
  saleId,
  canVoid,
  voidBlockedReason,
}: {
  saleId: string;
  canVoid: boolean;
  voidBlockedReason: string | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (voidBlockedReason) {
    return (
      <Button variant="outline" size="sm" disabled title={voidBlockedReason}>
        <Undo2 className="size-4" aria-hidden />
        Void
      </Button>
    );
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        disabled={!canVoid || isPending}
        onClick={() => setOpen(true)}
      >
        <Undo2 className="size-4" aria-hidden />
        Void
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Batalkan transaksi (void)?</DialogTitle>
            <DialogDescription>
              Seluruh barang akan dikembalikan ke stok dan transaksi ditandai
              void. Tindakan ini tidak bisa dibatalkan.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="void-reason">Alasan void *</Label>
            <Input
              id="void-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Contoh: salah input barang"
            />
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={isPending}
            >
              Batal
            </Button>
            <Button
              variant="destructive"
              disabled={isPending || reason.trim().length < 3}
              onClick={() => {
                setError(null);

                const formData = new FormData();
                formData.set("id", saleId);
                formData.set("reason", reason);

                startTransition(async () => {
                  const result = await voidSaleAction(formData);

                  if (result.error) {
                    setError(result.error);
                    return;
                  }

                  toast.success("Transaksi dibatalkan. Stok telah dikembalikan.");
                  setOpen(false);
                  router.refresh();
                });
              }}
            >
              {isPending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : null}
              Ya, voidkan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

interface RefundItem {
  saleItemId: string;
  name: string;
  remaining: number;
}

/**
 * Refund sheet.
 *
 * Damaged units can be ticked per row. They are refunded to the customer but
 * deliberately not returned to sellable stock, so the choice is explicit rather
 * than implied.
 */
export function RefundForm({
  saleId,
  items,
}: {
  saleId: string;
  items: RefundItem[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [damaged, setDamaged] = useState<Record<string, boolean>>({});
  const [quantities, setQuantities] = useState<Record<string, string>>({});

  const selectedCount = Object.values(selected).filter(Boolean).length;

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <RotateCcw className="size-4" aria-hidden />
        Retur
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Retur Barang</DialogTitle>
            <DialogDescription>
              Pilih barang yang diretur. Barang rusak tetap dibayarkan ke
              pelanggan tetapi tidak dikembalikan ke stok jual.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {error ? (
              <p
                role="alert"
                className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
              >
                {error}
              </p>
            ) : null}

            <ul className="divide-y rounded-lg border">
              {items.map((item) => (
                <li key={item.saleItemId} className="space-y-2 p-3">
                  <div className="flex items-start gap-2">
                    <Checkbox
                      checked={Boolean(selected[item.saleItemId])}
                      onCheckedChange={() =>
                        setSelected((current) => ({
                          ...current,
                          [item.saleItemId]: !current[item.saleItemId],
                        }))
                      }
                      disabled={item.remaining <= 0}
                      aria-label={"Retur " + item.name}
                    />

                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{item.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {item.remaining > 0
                          ? "maksimal " + item.remaining + " unit"
                          : "sudah diretur seluruhnya"}
                      </p>
                    </div>

                    {selected[item.saleItemId] ? (
                      <Input
                        type="number"
                        min={1}
                        max={item.remaining}
                        value={quantities[item.saleItemId] ?? "1"}
                        onChange={(event) =>
                          setQuantities((current) => ({
                            ...current,
                            [item.saleItemId]: event.target.value,
                          }))
                        }
                        className="tabular h-8 w-20 text-right"
                        aria-label={"Jumlah retur " + item.name}
                      />
                    ) : null}
                  </div>

                  {selected[item.saleItemId] ? (
                    <label className="ml-6 flex items-center gap-2 text-xs">
                      <Checkbox
                        checked={Boolean(damaged[item.saleItemId])}
                        onCheckedChange={() =>
                          setDamaged((current) => ({
                            ...current,
                            [item.saleItemId]: !current[item.saleItemId],
                          }))
                        }
                        aria-label={"Barang rusak " + item.name}
                      />
                      Barang dalam kondisi rusak (tidak kembali ke stok jual)
                    </label>
                  ) : null}
                </li>
              ))}
            </ul>

            <div className="space-y-2">
              <Label htmlFor="refund-reason">Alasan retur *</Label>
              <Input
                id="refund-reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Contoh: barang tidak sesuai pesanan"
              />
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={isPending}
              >
                Batal
              </Button>
              <Button
                disabled={isPending || selectedCount === 0 || reason.trim().length < 3}
                onClick={() => {
                  setError(null);

                  const formData = new FormData();
                  formData.set("saleId", saleId);
                  formData.set("reason", reason);

                  for (const item of items) {
                    if (!selected[item.saleItemId]) continue;
                    formData.append("saleItemId", item.saleItemId);
                    formData.append(
                      "quantity",
                      quantities[item.saleItemId] ?? "1",
                    );
                    formData.append(
                      "condition",
                      damaged[item.saleItemId] ? "DAMAGED" : "GOOD",
                    );
                  }

                  startTransition(async () => {
                    const result = await refundSaleAction(formData);

                    if (result.error) {
                      setError(result.error);
                      return;
                    }

                    toast.success(
                      "Retur " +
                        (result.reference ?? "") +
                        " diproses. " +
                        "Barang dalam kondisi baik sudah kembali ke stok.",
                    );
                    setOpen(false);
                    router.refresh();
                  });
                }}
              >
                {isPending ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : null}
                Proses Retur
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

