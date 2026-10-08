"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowDownToLine, ArrowUpFromLine, Loader2, Lock, Unlock } from "lucide-react";

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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { formatCurrency } from "@/lib/format";

import { cashMovementAction, closeShiftAction, openShiftAction } from "../sales/actions";

/**
 * Open/close shift and cash in/out.
 *
 * Closing is confirmed rather than submitted directly: it is irreversible, and
 * the variance it records becomes part of the audit trail.
 */
export function ShiftControls({
  shift,
  canManage,
}: {
  shift: { id: string; number: string; expected: number } | null;
  canManage: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [openDialog, setOpenDialog] = useState(false);
  const [closeDialog, setCloseDialog] = useState(false);
  const [movementDialog, setMovementDialog] = useState<"CASH_IN" | "CASH_OUT" | null>(
    null,
  );

  const [openingCash, setOpeningCash] = useState("");
  const [actualCash, setActualCash] = useState("");
  const [amount, setAmount] = useState("");
const [reason, setReason] = useState("");
  // Separate from `reason`: sharing the state let a half-typed cash-movement
  // reason become the shift's closing note.
  const [closeNotes, setCloseNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setError(null);
    setOpeningCash("");
    setActualCash("");
    setAmount("");
    setReason("");
    setCloseNotes("");
  }

  if (!shift) {
    return (
      <>
        <Button
          size="sm"
          disabled={isPending}
          onClick={() => setOpenDialog(true)}
        >
          <Unlock className="size-4" aria-hidden />
          Buka Shift
        </Button>

        <Dialog open={openDialog} onOpenChange={setOpenDialog}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>Buka Shift</DialogTitle>
              <DialogDescription>
                Masukkan jumlah kas awal yang tersedia di laci. Angka ini menjadi
                acuan perhitungan selisih saat shift ditutup.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-2">
              <Label htmlFor="opening-cash">Kas awal (Rp)</Label>
              <Input
                id="opening-cash"
                type="number"
                min={0}
                step={10000}
                value={openingCash}
                onChange={(event) => setOpeningCash(event.target.value)}
                placeholder="0"
                className="tabular"
                autoFocus
              />
              {error ? (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              ) : null}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setOpenDialog(false)}>
                Batal
              </Button>
              <Button
                disabled={isPending}
                onClick={() => {
                  setError(null);
                  const formData = new FormData();
                  formData.set("openingCash", openingCash || "0");

                  startTransition(async () => {
                    const result = await openShiftAction(formData);

                    if (result.error) {
                      setError(result.error);
                      return;
                    }

                    toast.success("Shift " + (result.reference ?? "") + " dibuka.");
                    setOpenDialog(false);
                    reset();
                    router.refresh();
                  });
                }}
              >
                {isPending ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : null}
                Buka Shift
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </>
    );
  }

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setMovementDialog("CASH_IN")}
        >
          <ArrowDownToLine className="size-4" aria-hidden />
          Kas Masuk
        </Button>

        <Button
          variant="outline"
          size="sm"
          onClick={() => setMovementDialog("CASH_OUT")}
        >
          <ArrowUpFromLine className="size-4" aria-hidden />
          Kas Keluar
        </Button>

{canManage ? (
          <Button
            size="sm"
            disabled={isPending}
            onClick={() => {
              // Deliberately blank, not pre-filled with the expected figure. The
              // counted cash is the one control that makes the variance mean
              // anything, and arriving pre-filled with the answer means a cashier
              // can open the dialog and close the shift without counting
              // anything — producing a perfect "Seimbang" that never happened.
              setActualCash("");
              setCloseNotes("");
              setCloseDialog(true);
            }}
          >
            <Lock className="size-4" aria-hidden />
            Tutup Shift
          </Button>
        ) : null}
      </div>

      <p className="mt-2 text-xs text-muted-foreground">
        Ekspektasi kas saat tutup:{" "}
        <span className="tabular font-medium">
          {formatCurrency(shift.expected)}
        </span>
      </p>

      {/* Cash in / out */}
      <Dialog
        open={movementDialog !== null}
        onOpenChange={(open) => !open && setMovementDialog(null)}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {movementDialog === "CASH_IN" ? "Catat Kas Masuk" : "Catat Kas Keluar"}
            </DialogTitle>
            <DialogDescription>
              {movementDialog === "CASH_IN"
                ? "Tambahan uang ke laci, misalnya kembalian dari kantor."
                : "Pengeluaran kas kecil dari laci, misalnya belanja Necessitas."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="movement-amount">Nominal (Rp)</Label>
              <Input
                id="movement-amount"
                type="number"
                min={1}
                step={1000}
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                className="tabular"
                autoFocus
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="movement-reason">Alasan *</Label>
              <Input
                id="movement-reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Contoh: tambahan kembalian dari kasir sebelumnya"
              />
            </div>

            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setMovementDialog(null)}
              disabled={isPending}
            >
              Batal
            </Button>
            <Button
              disabled={isPending || reason.trim().length < 3 || !amount}
              onClick={() => {
                setError(null);
                const formData = new FormData();
                formData.set("shiftId", shift.id);
                formData.set("type", movementDialog ?? "CASH_IN");
                formData.set("amount", amount);
                formData.set("reason", reason);

                startTransition(async () => {
                  const result = await cashMovementAction(formData);

                  if (result.error) {
                    setError(result.error);
                    return;
                  }

                  toast.success(
                    (movementDialog === "CASH_IN" ? "Kas masuk" : "Kas keluar") +
                      " tercatat.",
                  );
                  setMovementDialog(null);
                  reset();
                  router.refresh();
                });
              }}
            >
              {isPending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : null}
              Catat
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Close shift */}
      <AlertDialog open={closeDialog} onOpenChange={setCloseDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Tutup shift {shift.number}?</AlertDialogTitle>
            <AlertDialogDescription>
              Masukkan jumlah kas fisik yang benar-benar dihitung. Selisih
              terhadap ekspektasi{" "}
              <strong>{formatCurrency(shift.expected)}</strong> akan dicatat
              otomatis. Tindakan ini tidak bisa dibatalkan.
            </AlertDialogDescription>
          </AlertDialogHeader>

<div className="space-y-2">
            <Label htmlFor="actual-cash">Jumlah kas aktual (Rp)</Label>
            <Input
              id="actual-cash"
              type="number"
              min={0}
              step={1000}
              value={actualCash}
              onChange={(event) => setActualCash(event.target.value)}
              className="tabular"
              // Blank by design — see the button above. Required so the shift
              // cannot be closed on an empty count, which would silently record
              // the whole float as missing.
              required
            />

            <Label htmlFor="close-notes" className="mt-3">
              Catatan selisih
            </Label>
            <Input
              id="close-notes"
              placeholder="Opsional, tapi wajib bila ada selisih"
              // Its own state, not the cash-movement `reason`: sharing it meant a
              // half-typed movement reason could become the closing note.
              value={closeNotes}
              onChange={(event) => setCloseNotes(event.target.value)}
            />

            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Batal</AlertDialogCancel>
            <AlertDialogAction
              disabled={isPending || actualCash.trim() === ""}
              onClick={(event) => {
                event.preventDefault();

                const formData = new FormData();
                formData.set("shiftId", shift.id);
                formData.set("actualCash", actualCash);
                formData.set("notes", closeNotes);

                startTransition(async () => {
                  const result = await closeShiftAction(formData);

                  if (result.error) {
                    setError(result.error);
                    return;
                  }

                  toast.success("Shift ditutup.");
                  setCloseDialog(false);
                  reset();
                  router.refresh();
                });
              }}
            >
              {isPending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : null}
              Tutup Shift
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
