"use client";

import { useEffect } from "react";
import { Printer } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { paymentMethodLabel } from "@/lib/payments/constants";

import type { CheckoutResult } from "./actions";

/**
 * Post-checkout receipt.
 *
 * Formatted for an 80mm thermal printer: monospace, narrow, and marked up so the
 * print stylesheet can print only the receipt body.
 *
 * Everything printed comes from `result`, which the server computed inside the
 * checkout transaction. The store header comes from settings passed by the page.
 * Nothing here is recomputed from the client's cart: the receipt is the customer's
 * record of what they were charged, so it must match the Sale row exactly rather
 * than a second guess at it.
 */
export function ReceiptDialog({
  result,
  store,
  onClose,
}: {
  result: CheckoutResult | null;
  store: { name: string; address: string; phone: string };
  onClose: () => void;
}) {
  useEffect(() => {
    if (!result) return;
    document.title = `Struk ${result.invoiceNumber}`;
    return () => {
      document.title = "Swalayaku";
    };
  }, [result]);

  function print() {
    window.print();
  }

  const paymentLabel = paymentMethodLabel(result?.paymentMethod);

  return (
    <Dialog open={Boolean(result)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="sm:max-w-sm print:border-0 print:shadow-none"
        // Lets the print stylesheet target the receipt body specifically.
        data-receipt-root
      >
        {result ? (
          <>
            <DialogHeader className="print:hidden">
              <DialogTitle>Transaksi Berhasil</DialogTitle>
              <DialogDescription>
                Invoice {result.invoiceNumber} telah disimpan.
              </DialogDescription>
            </DialogHeader>

            <div className="receipt-paper mx-auto border rounded-md p-4 font-mono text-[11px] leading-relaxed print:border-0 print:p-0">
              <div className="text-center">
                <p className="text-sm font-bold uppercase tracking-wide">
                  {store.name}
                </p>
                {store.address ? <p>{store.address}</p> : null}
                {store.phone ? <p>Telp. {store.phone}</p> : null}
              </div>

              <div className="my-2 border-t border-dashed" />

              <div className="flex justify-between gap-2">
                <span>Invoice</span>
                <span>{result.invoiceNumber}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span>Tanggal</span>
                <span>{formatDateTime(new Date(result.date))}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span>Kasir</span>
                <span>{result.cashierName}</span>
              </div>
              {result.customerName ? (
                <div className="flex justify-between gap-2">
                  <span>Pelanggan</span>
                  <span className="truncate">{result.customerName}</span>
                </div>
              ) : null}

              <div className="my-2 border-t border-dashed" />

              {/* Itemised lines: a receipt without them cannot be checked
                  against the goods the customer is carrying. */}
              <ul className="space-y-1">
                {result.lines.map((line, index) => (
                  <li key={index}>
                    <div className="flex justify-between gap-2">
                      <span className="flex-1">{line.name}</span>
                      <span className="tabular">
                        {formatCurrency(line.subtotal)}
                      </span>
                    </div>

                    <div className="flex justify-between gap-2 text-[10px] text-muted-foreground">
                      <span>
                        {line.quantity} {line.unit} x{" "}
                        {formatCurrency(line.unitPrice)}
                      </span>
                      {line.discount > 0 ? (
                        <span>-{formatCurrency(line.discount)}</span>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>

              <div className="my-2 border-t border-dashed" />

              <div className="flex justify-between gap-2">
                <span>Subtotal</span>
                <span className="tabular">{formatCurrency(result.subtotal)}</span>
              </div>

              {result.discount > 0 ? (
                <div className="flex justify-between gap-2">
                  <span>
                    Diskon{result.promotionCode ? ` (${result.promotionCode})` : ""}
                  </span>
                  <span className="tabular">-{formatCurrency(result.discount)}</span>
                </div>
              ) : null}

              {result.tax > 0 ? (
                <div className="flex justify-between gap-2">
                  <span>Pajak</span>
                  <span className="tabular">{formatCurrency(result.tax)}</span>
                </div>
              ) : null}

              <div className="mt-1 flex justify-between gap-2 text-sm font-bold">
                <span>TOTAL</span>
                <span className="tabular">{formatCurrency(result.total)}</span>
              </div>

              <div className="my-2 border-t border-dashed" />

              <div className="flex justify-between gap-2">
                <span>Metode</span>
                <span>{paymentLabel}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span>Bayar</span>
                <span className="tabular">{formatCurrency(result.amountPaid)}</span>
              </div>
              {result.change > 0 ? (
                <div className="flex justify-between gap-2 font-bold">
                  <span>Kembali</span>
                  <span className="tabular">{formatCurrency(result.change)}</span>
                </div>
              ) : null}

              {result.pointsEarned > 0 ? (
                <>
                  <div className="my-2 border-t border-dashed" />
                  <p>Poin member: +{result.pointsEarned}</p>
                </>
              ) : null}

              <div className="my-2 border-t border-dashed" />

              <p className="text-center">
                Terima kasih telah berbelanja
                <br />
                di {store.name}
              </p>
            </div>

            <div className="flex gap-2 print:hidden">
              <Button onClick={print} className="flex-1">
                <Printer className="size-4" aria-hidden />
                Cetak Struk
              </Button>
              <Button
                variant="outline"
                onClick={onClose}
                className="flex-1"
                autoFocus
              >
                Transaksi Baru
              </Button>
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}