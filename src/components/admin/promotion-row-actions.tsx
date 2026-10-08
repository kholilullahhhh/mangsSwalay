"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { MoreHorizontal, Pencil, Power, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import {
  deletePromotionAction,
  togglePromotionAction,
} from "@/actions/admin-actions";
import { PromotionDialog, type PromotionFormValues } from "./promotion-dialog";

/**
 * Per-row actions for a promotion.
 *
 * Toggle and delete are separate intents: disabling a promo is reversible and
 * immediate, while deleting one that has been used is refused by the server and
 * downgraded to a deactivation, so historical invoices keep a promo they can
 * still explain.
 */
export function PromotionRowActions({
  promotion,
  categories,
  products,
}: {
  promotion: PromotionFormValues;
  categories: Array<{ id: string; name: string }>;
  products: Array<{ id: string; name: string; sku: string }>;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [editOpen, setEditOpen] = useState(false);

  function toggle() {
    const formData = new FormData();
    formData.set("id", promotion.id);

    startTransition(async () => {
      const result = await togglePromotionAction(formData);

      if (result.error) {
        toast.error(result.error);
        return;
      }

      toast.success(promotion.isActive ? "Promo dinonaktifkan." : "Promo diaktifkan.");
      router.refresh();
    });
  }

  function remove() {
    const formData = new FormData();
    formData.set("id", promotion.id);

    startTransition(async () => {
      const result = await deletePromotionAction(formData);

      if (result.error) {
        // The server downgrades a delete to a deactivation for used promos and
        // says so; that is a partial success, not a hard failure.
        toast.warning(result.error);
        router.refresh();
        return;
      }

      toast.success("Promo dihapus.");
      router.refresh();
    });
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Aksi untuk ${promotion.code}`}
            disabled={isPending}
          >
            <MoreHorizontal className="size-4" aria-hidden />
          </Button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onSelect={(event) => {
              // The menu must close before the dialog opens, otherwise two
              // overlays stack and the dialog ends up behind the menu.
              event.preventDefault();
              setEditOpen(true);
            }}
          >
            <Pencil className="size-4" aria-hidden />
            Edit promo
          </DropdownMenuItem>

          <DropdownMenuItem onSelect={toggle}>
            <Power className="size-4" aria-hidden />
            {promotion.isActive ? "Nonaktifkan" : "Aktifkan"}
          </DropdownMenuItem>

          <DropdownMenuItem
            onSelect={remove}
            // A used promo cannot be deleted, only deactivated, so the menu says
            // which will happen instead of letting the server refuse.
            disabled={promotion.usedCount > 0}
          >
            <Trash2 className="size-4" aria-hidden />
            {promotion.usedCount > 0 ? "Tidak bisa dihapus (sudah dipakai)" : "Hapus"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <PromotionDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        promotion={promotion}
        categories={categories}
        products={products}
        trigger={<span className="sr-only">Edit {promotion.code}</span>}
      />
    </>
  );
}