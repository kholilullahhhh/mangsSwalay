"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2, Loader2, PackageCheck, Send, XCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
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
import type { PurchaseStatus } from "@/generated/prisma/enums";

import { transitionPurchaseAction } from "./actions";

/**
 * Status transition buttons.
 *
 * Two destructive-or-irreversible steps — receiving (which raises stock) and
 * cancelling — go through a confirmation dialog, because a mis-click here has a
 * real inventory consequence and is not obvious from a toast afterwards.
 */
export function StatusActions({
  purchaseId,
  availableStatuses,
  canUpdate,
  canReceive,
  canCancel,
}: {
  purchaseId: string;
  availableStatuses: readonly string[];
  canUpdate: boolean;
  canReceive: boolean;
  canCancel: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState<PurchaseStatus | null>(null);

  function submit(status: PurchaseStatus) {
    const formData = new FormData();
    formData.set("id", purchaseId);
    formData.set("status", status);

    startTransition(async () => {
      const result = await transitionPurchaseAction(formData);

      if (result.error) {
        toast.error(result.error);
        return;
      }

      toast.success(`Status diubah ke ${status}.`);
      setConfirming(null);
      router.refresh();
    });
  }

  const visible = availableStatuses.filter((status) => {
    if (status === "RECEIVED") return canReceive;
    if (status === "CANCELLED") return canCancel;
    return canUpdate;
  });

  if (visible.length === 0) {
    return null;
  }

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {visible.map((status) => {
          const isReceive = status === "RECEIVED";
          const isCancel = status === "CANCELLED";

          const Icon = isReceive
            ? PackageCheck
            : isCancel
              ? XCircle
              : status === "ORDERED"
                ? Send
                : CheckCircle2;

          const label =
            status === "ORDERED"
              ? "Tandai Dipesan"
              : status === "RECEIVED"
                ? "Terima Barang"
                : status === "COMPLETED"
                  ? "Selesaikan"
                  : "Batalkan";

          // Straightforward forward steps run immediately; stock-affecting and
          // cancelling steps are confirmed first.
          const needsConfirm = isReceive || isCancel;

          if (needsConfirm) {
            return (
              <Button
                key={status}
                size="sm"
                variant={isReceive ? "default" : "outline"}
                disabled={isPending}
                onClick={() => setConfirming(status as PurchaseStatus)}
              >
                <Icon className="size-4" aria-hidden />
                {label}
              </Button>
            );
          }

          return (
            <Button
              key={status}
              size="sm"
              variant="outline"
              disabled={isPending}
              onClick={() => submit(status as PurchaseStatus)}
            >
              {isPending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <Icon className="size-4" aria-hidden />
              )}
              {label}
            </Button>
          );
        })}
      </div>

      <AlertDialog
        open={confirming !== null}
        onOpenChange={(open: boolean) => !open && setConfirming(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirming === "RECEIVED"
                ? "Terima barang dan tambah stok?"
                : "Batalkan pesanan pembelian?"}
            </AlertDialogTitle>

            <AlertDialogDescription>
              {confirming === "RECEIVED" ? (
                <>
                  Menerima barang akan <strong>menambah stok</strong> untuk
                  seluruh item dan mencatat pergerakan stok. Tindakan ini tidak
                  bisa dibatalkan.
                </>
              ) : (
                <>
                  Pesanan akan berstatus Dibatalkan. Tindakan ini tidak bisa
                  dibatalkan.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Batal</AlertDialogCancel>
            <AlertDialogAction
              disabled={isPending}
              onClick={(event: React.MouseEvent) => {
                // Keep the dialog mounted while the action runs so the pending
                // state stays visible.
                event.preventDefault();
                if (confirming) submit(confirming);
              }}
            >
              {isPending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : null}
              {confirming === "RECEIVED" ? "Ya, terima barang" : "Ya, batalkan"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}