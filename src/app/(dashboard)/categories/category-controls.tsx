"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";

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

import {
  createCategoryAction,
  deleteCategoryAction,
  updateCategoryAction,
} from "../customers/actions";

interface CategoryValues {
  id: string;
  name: string;
  description: string;
  isActive: boolean;
}

/** Create or edit a category. Rendered as a bare trigger when no values given. */
export function CategoryDialog({ category }: { category?: CategoryValues }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const isEditing = Boolean(category);

  return (
    <>
      <Button
        variant={isEditing ? "ghost" : "default"}
        size={isEditing ? "icon" : "sm"}
        onClick={() => setOpen(true)}
        aria-label={isEditing ? "Edit " + category?.name : "Tambah Kategori"}
        title={isEditing ? "Edit" : "Tambah Kategori"}
      >
        {isEditing ? (
          <Pencil className="size-4" aria-hidden />
        ) : (
          <>
            <Plus className="size-4" aria-hidden />
            Tambah Kategori
          </>
        )}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {isEditing ? "Edit Kategori" : "Tambah Kategori"}
            </DialogTitle>
            <DialogDescription>
              Slug dibuat otomatis dari nama. Kategori yang sudah dipakai produk
              tetap mempertahankan slug lamanya agar link produk tidak rusak.
            </DialogDescription>
          </DialogHeader>

          <form
            action={(formData: FormData) => {
              setError(null);
              setFieldErrors({});

              if (category) formData.set("id", category.id);

              startTransition(async () => {
                const result = isEditing
                  ? await updateCategoryAction(formData)
                  : await createCategoryAction(formData);

                if (result.error) {
                  setError(result.error);
                  return;
                }

                if (result.fieldErrors) {
                  setFieldErrors(result.fieldErrors);
                  return;
                }

                toast.success(
                  isEditing ? "Kategori diperbarui." : "Kategori ditambahkan.",
                );
                setOpen(false);
                router.refresh();
              });
            }}
            className="space-y-4"
          >
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}

            <div className="space-y-1.5">
              <Label htmlFor="category-name">Nama *</Label>
              <Input
                id="category-name"
                name="name"
                required
                defaultValue={category?.name ?? ""}
              />
              {fieldErrors.name ? (
                <p className="text-sm text-destructive">{fieldErrors.name}</p>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="category-description">Deskripsi</Label>
              <Input
                id="category-description"
                name="description"
                defaultValue={category?.description ?? ""}
              />
            </div>

            {isEditing ? (
              <div className="flex items-center gap-2">
                <Checkbox
                  id="category-active"
                  name="isActive"
                  value="true"
                  defaultChecked={category?.isActive}
                />
                <Label htmlFor="category-active" className="font-normal">
                  Aktif
                </Label>
              </div>
            ) : null}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={isPending}
              >
                Batal
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending ? (
                  <>
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                    Menyimpan…
                  </>
                ) : (
                  "Simpan"
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * Delete a category.
 *
 * Blocked when products still reference it — the server enforces this too, and
 * the button explains the constraint rather than failing silently.
 */
export function DeleteCategoryButton({
  id,
  name,
  productCount,
}: {
  id: string;
  name: string;
  productCount: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const blocked = productCount > 0;

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        disabled={blocked}
        onClick={() => setOpen(true)}
        aria-label={"Hapus " + name}
        title={blocked ? name + " masih memiliki produk" : "Hapus"}
      >
        <Trash2 className="size-4" aria-hidden />
      </Button>

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus kategori &quot;{name}&quot;?</AlertDialogTitle>
            <AlertDialogDescription>
              Kategori akan dihapus permanen. Tindakan ini tidak bisa dibatalkan.
            </AlertDialogDescription>
          </AlertDialogHeader>

          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Batal</AlertDialogCancel>
            <AlertDialogAction
              disabled={isPending}
              onClick={(event) => {
                event.preventDefault();

                const formData = new FormData();
                formData.set("id", id);

                startTransition(async () => {
                  const result = await deleteCategoryAction(formData);

                  if (result.error) {
                    setError(result.error);
                    return;
                  }

                  toast.success("Kategori dihapus.");
                  setOpen(false);
                  router.refresh();
                });
              }}
            >
              {isPending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : null}
              Hapus
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

