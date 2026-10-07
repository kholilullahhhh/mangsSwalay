"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Plus } from "lucide-react";

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
import { createSupplierAction } from "../purchases/actions";

/** Create-supplier dialog. */
export function NewSupplierButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  function submit(formData: FormData) {
    setFieldErrors({});
    setFormError(null);

    startTransition(async () => {
      const result = await createSupplierAction(formData);

      if (result.error) {
        if (result.fieldErrors) setFieldErrors(result.fieldErrors);
        else setFormError(result.error);
        return;
      }

      toast.success("Supplier ditambahkan.");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="size-4" aria-hidden />
        Tambah Supplier
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Tambah Supplier</DialogTitle>
            <DialogDescription>
              Kode supplier dibuat otomatis bila dikosongkan.
            </DialogDescription>
          </DialogHeader>

          <form action={submit} className="space-y-4">
            {formError ? (
              <p
                role="alert"
                className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
              >
                {formError}
              </p>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="sup-name">Nama *</Label>
                <Input
                  id="sup-name"
                  name="name"
                  required
                  aria-invalid={Boolean(fieldErrors.name)}
                />
                {fieldErrors.name ? (
                  <p className="text-sm text-destructive">{fieldErrors.name}</p>
                ) : null}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="sup-code">Kode</Label>
                <Input
                  id="sup-code"
                  name="code"
                  placeholder="SUP-001"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="sup-company">Badan Usaha</Label>
                <Input id="sup-company" name="company" />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="sup-contact">Narahubung</Label>
                <Input id="sup-contact" name="contactPerson" />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="sup-phone">Telepon</Label>
                <Input id="sup-phone" name="phone" inputMode="tel" />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="sup-email">Email</Label>
                <Input id="sup-email" name="email" type="email" />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="sup-address">Alamat</Label>
              <Input id="sup-address" name="address" />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="sup-notes">Catatan</Label>
              <textarea
                id="sup-notes"
                name="notes"
                rows={2}
                className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
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
                  "Simpan Supplier"
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}