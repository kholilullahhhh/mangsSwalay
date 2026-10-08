"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Pencil, UserPlus } from "lucide-react";

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
  createCustomerAction,
  updateCustomerAction,
  type CustomerFormValue,
} from "./actions";

/**
 * Customer create/edit dialog.
 *
 * One component for both, because the fields are identical and the alternative —
 * a create dialog plus a separate edit dialog — guarantees the two drift apart as
 * soon as one gains a field. Update and deactivate were implemented and
 * permission-guarded on the server but had no client half at all, so a mistyped
 * phone number or a member who moved could never be corrected.
 */
export function CustomerDialog({
  customer,
  trigger = "button",
}: {
  customer?: CustomerFormValue;
  trigger?: "button" | "icon";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const isEdit = Boolean(customer);

  return (
    <>
      {trigger === "icon" ? (
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          onClick={() => setOpen(true)}
          aria-label={isEdit ? "Ubah pelanggan" : "Tambah pelanggan"}
        >
          {isEdit ? (
            <Pencil className="size-4" aria-hidden />
          ) : (
            <UserPlus className="size-4" aria-hidden />
          )}
        </Button>
      ) : (
        <Button size="sm" onClick={() => setOpen(true)}>
          <UserPlus className="size-4" aria-hidden />
          Tambah Pelanggan
        </Button>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {isEdit ? "Ubah Pelanggan" : "Tambah Pelanggan"}
            </DialogTitle>
            <DialogDescription>
              {isEdit
                ? "Perubahan berlaku untuk transaksi berikutnya. Riwayat penjualan tidak berubah."
                : "Nomor member dibuat otomatis bila pelanggan ditandai sebagai member."}
            </DialogDescription>
          </DialogHeader>

          <form
            action={(formData: FormData) => {
              setError(null);
              setFieldErrors({});

              startTransition(async () => {
                const result = customer
                  ? await updateCustomerAction(customer.id, formData)
                  : await createCustomerAction(formData);

                if (result.error) {
                  setError(result.error);
                  return;
                }

                if (result.fieldErrors) {
                  setFieldErrors(result.fieldErrors);
                  return;
                }

                toast.success(
                  isEdit ? "Pelanggan diperbarui." : "Pelanggan ditambahkan.",
                );
                setOpen(false);
                router.refresh();
              });
            }}
            className="space-y-4"
          >
            {error ? (
              <p
                role="alert"
                className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
              >
                {error}
              </p>
            ) : null}

            <div className="space-y-1.5">
              <Label htmlFor="customer-name">Nama *</Label>
              <Input
                id="customer-name"
                name="name"
                required
                defaultValue={customer?.name ?? ""}
              />
              {fieldErrors.name ? (
                <p className="text-sm text-destructive">{fieldErrors.name}</p>
              ) : null}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="customer-phone">Telepon</Label>
                <Input
                  id="customer-phone"
                  name="phone"
                  inputMode="tel"
                  defaultValue={customer?.phone ?? ""}
                />
                {fieldErrors.phone ? (
                  <p className="text-sm text-destructive">{fieldErrors.phone}</p>
                ) : null}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="customer-email">Email</Label>
                <Input
                  id="customer-email"
                  name="email"
                  type="email"
                  defaultValue={customer?.email ?? ""}
                />
                {fieldErrors.email ? (
                  <p className="text-sm text-destructive">{fieldErrors.email}</p>
                ) : null}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="customer-address">Alamat</Label>
              <Input
                id="customer-address"
                name="address"
                defaultValue={customer?.address ?? ""}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="customer-notes">Catatan</Label>
              <Input
                id="customer-notes"
                name="notes"
                defaultValue={customer?.notes ?? ""}
              />
            </div>

            <div className="flex items-center gap-2">
              <Checkbox
                id="customer-member"
                name="isMember"
                value="true"
                defaultChecked={customer?.isMember ?? false}
              />
              <Label htmlFor="customer-member" className="font-normal">
                Daftarkan sebagai member (dapat poin loyalitas)
              </Label>
            </div>

            {isEdit ? (
              <div className="flex items-center gap-2">
                <Checkbox
                  id="customer-active"
                  name="isActive"
                  value="true"
                  defaultChecked={customer?.isActive ?? true}
                />
                <Label htmlFor="customer-active" className="font-normal">
                  Pelanggan aktif
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
                ) : isEdit ? (
                  "Simpan Perubahan"
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

/** Kept so existing imports keep working. */
export const NewCustomerButton = CustomerDialog;