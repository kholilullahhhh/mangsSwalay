"use client";

import { useEffect, useState } from "react";
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

import type { CheckoutResult } from "./actions";

/**
 * Post-checkout receipt.
 *
 * Formatted for an 80mm thermal printer: monospace, narrow, and marked up so a
 * print stylesheet can hide the dialog chrome and print only the receipt body.
 *
 * Printable receipt rendering lives in `printable.tsx`, which renders from the
 * same data so the on-screen preview and the printed output cannot drift.
 */
export function ReceiptDialog({
  result,
  onClose,
}: {
  result: CheckoutResult | null;
  onClose: () => void;
}) {
  const [storeName] = useState("Swalayaku");
  const [storeAddress] = useState(
    "Jl. Raya Swalaya No. 123, Jakarta Barat, DKI Jakarta 11530",
  );
  const [storePhone] = useState("(021) 555-0123");

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

  return (
    <Dialog open={Boolean(result)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="sm:max-w-sm print:border-0 print:shadow-none"
        // Let the browser print only the receipt body via the print stylesheet.
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
                  {storeName}
                </p>
                <p>{storeAddress}</p>
                <p>Telp. {storePhone}</p>
              </div>

              <div className="my-2 border-t border-dashed" />

              <div className="flex justify-between">
                <span>Invoice</span>
                <span>{result.invoiceNumber}</span>
              </div>
              <div className="flex justify-between">
                <span>Tanggal</span>
                <span>{formatDateTime(new Date())}</span>
              </div>

              <div className="my-2 border-t border-dashed" />

              <div className="flex justify-between">
                <span>Total</span>
                <span>{formatCurrency(result.total)}</span>
              </div>
              <div className="flex justify-between">
                <span>Metode</span>
                <span>TUNAI</span>
              </div>
              <div className="flex justify-between">
                <span>Bayar</span>
                <span>{formatCurrency(result.total + result.change)}</span>
              </div>
              <div className="flex justify-between font-bold">
                <span>Kembali</span>
                <span>{formatCurrency(result.change)}</span>
              </div>

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
                di {storeName}
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