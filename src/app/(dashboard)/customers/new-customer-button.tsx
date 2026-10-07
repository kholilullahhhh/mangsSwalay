"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, UserPlus } from "lucide-react";

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

import { createCustomerAction } from "./actions";

export function NewCustomerButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <UserPlus className="size-4" aria-hidden />
        Tambah Pelanggan
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Tambah Pelanggan</DialogTitle>
            <DialogDescription>
              Nomor member dibuat otomatis bila pelanggan ditandai sebagai member.
            </DialogDescription>
          </DialogHeader>

          <form
            action={(formData: FormData) => {
              setError(null);
              setFieldErrors({});

              startTransition(async () => {
                const result = await createCustomerAction(formData);

                if (result.error) {
                  setError(result.error);
                  return;
                }

                if (result.fieldErrors) {
                  setFieldErrors(result.fieldErrors);
                  return;
                }

                toast.success("Pelanggan ditambahkan.");
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
              <Input id="customer-name" name="name" required />
              {fieldErrors.name ? (
                <p className="text-sm text-destructive">{fieldErrors.name}</p>
              ) : null}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="customer-phone">Telepon</Label>
                <Input id="customer-phone" name="phone" inputMode="tel" />
                {fieldErrors.phone ? (
                  <p className="text-sm text-destructive">{fieldErrors.phone}</p>
                ) : null}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="customer-email">Email</Label>
                <Input id="customer-email" name="email" type="email" />
                {fieldErrors.email ? (
                  <p className="text-sm text-destructive">{fieldErrors.email}</p>
                ) : null}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="customer-address">Alamat</Label>
              <Input id="customer-address" name="address" />
            </div>

            <div className="flex items-center gap-2">
              <Checkbox id="customer-member" name="isMember" value="true" />
              <Label htmlFor="customer-member" className="font-normal">
                Daftarkan sebagai member (dapat poin loyalitas)
              </Label>
            </div>

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
