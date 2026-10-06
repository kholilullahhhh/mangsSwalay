"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { formatCurrency } from "@/lib/format";
import {
  calculateChange,
  suggestCashAmounts,
} from "@/lib/pos/cart";

const METHODS = [
  { value: "CASH", label: "Tunai" },
  { value: "QRIS", label: "QRIS" },
  { value: "DEBIT", label: "Debit" },
  { value: "CREDIT_CARD", label: "Kredit" },
  { value: "TRANSFER", label: "Transfer" },
  { value: "E_WALLET", label: "E-Wallet" },
] as const;

export type PaymentMethod = (typeof METHODS)[number]["value"];

/**
 * Payment dialog.
 *
 * Non-cash methods settle at exactly the total, so the amount field is disabled
 * and change is implicitly zero. Cash requires at least the total; underpayment
 * shows the shortfall rather than being silently rounded, so the cashier cannot
 * accidentally complete a sale for less than owed.
 */
export function PaymentDialog({
  open,
  onOpenChange,
  total,
  hasOpenShift,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  total: number;
  hasOpenShift: boolean;
  onConfirm: (
    method: PaymentMethod,
    amountPaid: number,
  ) => Promise<void>;
}) {
  const [method, setMethod] = useState<PaymentMethod>("CASH");
  // Defaults to the exact total, so the common case needs no typing. Only cash
  // reads this field; other methods settle at the total.
  const [amountInput, setAmountInput] = useState(() => String(total));
  const [isPending, setIsPending] = useState(false);

  const isCash = method === "CASH";

  const amountPaid = isCash
    ? Number.parseInt(amountInput, 10) || 0
    : total;

  const { change, shortfall, isSufficient } = calculateChange(
    isCash ? amountPaid : total,
    total,
  );

  /**
   * Switching method resets the cash field through the click handler rather than
   * an effect, so switching to a non-cash method and back always returns to the
   * exact total instead of keeping a stale figure.
   */
  function selectMethod(next: PaymentMethod) {
    setMethod(next);
    setAmountInput(next === "CASH" ? String(total) : "");
  }

  async function confirm() {
    if (!isSufficient) return;

    setIsPending(true);
    try {
      await onConfirm(method, isCash ? amountPaid : total);
    } finally {
      setIsPending(false);
    }
  }

  const canConfirm =
    !isPending && total > 0 && (isCash ? isSufficient : hasOpenShift);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-md"
        onKeyDown={(event) => {
          // Enter settles the payment, which is what a cashier expects.
          if (event.key === "Enter" && canConfirm) {
            event.preventDefault();
            void confirm();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>Pembayaran</DialogTitle>
          <DialogDescription className="tabular text-base font-semibold text-foreground">
            Total {formatCurrency(total)}
          </DialogDescription>
        </DialogHeader>

        {!hasOpenShift ? (
          <Alert>
            <AlertDescription>
              Shift kasir belum dibuka. Buka shift sebelum menerima pembayaran
              tunai agar kas tercatat dengan benar.
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Metode pembayaran</Label>
            <div className="grid grid-cols-3 gap-2">
              {METHODS.map((entry) => (
                <Button
                  key={entry.value}
                  type="button"
                  variant={
                    method === entry.value ? "default" : "outline"
                  }
                  onClick={() => selectMethod(entry.value)}
                  aria-pressed={method === entry.value}
                  className="h-10 text-sm"
                >
                  {entry.label}
                </Button>
              ))}
            </div>
          </div>

          {isCash ? (
            <div className="space-y-2">
              <Label htmlFor="amount-paid">Uang diterima</Label>
              <Input
                id="amount-paid"
                type="number"
                inputMode="numeric"
                step={1000}
                min={0}
                value={amountInput}
                onChange={(event) => setAmountInput(event.target.value)}
                className="tabular h-12 text-lg"
                autoFocus
              />

              <div className="flex flex-wrap gap-1.5">
                {suggestCashAmounts(total).map((suggestion) => (
                  <Button
                    key={suggestion.amount}
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setAmountInput(String(suggestion.amount))}
                  >
                    {suggestion.label}
                  </Button>
                ))}
              </div>

              <div className="rounded-md border p-3 text-sm">
                {shortfall > 0 ? (
                  <p className="text-destructive">
                    Kurang{" "}
                    <span className="tabular font-semibold">
                      {formatCurrency(shortfall)}
                    </span>
                  </p>
                ) : (
                  <p className="flex justify-between">
                    <span className="text-muted-foreground">Kembalian</span>
                    <span className="tabular font-semibold text-stock-ok">
                      {formatCurrency(change)}
                    </span>
                  </p>
                )}
              </div>
            </div>
          ) : (
            <Alert>
              <AlertDescription>
                Pembayaran {METHODS.find((entry) => entry.value === method)
                  ?.label}{" "}
                dicatat sebesar{" "}
                <span className="tabular font-semibold">
                  {formatCurrency(total)}
                </span>
                . Verifikasi pembayaran sudah diterima dari pelanggan sebelum
                menyelesaikan transaksi.
              </AlertDescription>
            </Alert>
          )}

          <Button
            className="h-12 w-full text-base"
            disabled={!canConfirm}
            onClick={() => void confirm()}
          >
            {isPending ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden />
                Memproses…
              </>
            ) : (
              "Selesaikan Transaksi"
            )}
          </Button>

          <p className="text-center text-xs text-muted-foreground">
            Tekan Enter untuk menyelesaikan
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}