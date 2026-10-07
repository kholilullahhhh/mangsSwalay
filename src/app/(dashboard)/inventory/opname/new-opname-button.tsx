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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { createOpnameAction } from "../actions";

/** Opens a counting session. */
export function NewOpnameButton({
  categories,
  label = "Sesi Opname Baru",
}: {
  categories: Array<{ id: string; name: string }>;
  label?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState("all");
  const [notes, setNotes] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  function submit() {
    setFormError(null);

    const formData = new FormData();
    formData.set("name", name);
    formData.set("notes", notes);
    if (categoryId !== "all") formData.set("categoryId", categoryId);

    startTransition(async () => {
      const result = await createOpnameAction(formData);

      if (result.error) {
        setFormError(result.error);
        return;
      }

      toast.success("Sesi opname dibuat. Mulai menghitung stok fisik.");
      setOpen(false);
      setName("");
      setNotes("");

      if (result.id) {
        router.push("/inventory/opname/" + result.id);
      }
      router.refresh();
    });
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="size-4" aria-hidden />
        {label}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Sesi Stock Opname Baru</DialogTitle>
            <DialogDescription>
              Stok sistem dibekukan saat sesi dibuat, sehingga penjualan yang
              berjalan selama penghitungan tidak mengacaukan hasilnya.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {formError ? (
              <p
                role="alert"
                className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
              >
                {formError}
              </p>
            ) : null}

            <div className="space-y-1.5">
              <Label htmlFor="opname-name">Nama Sesi *</Label>
              <Input
                id="opname-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Opname Bulanan Agustus"
              />
            </div>

            <div className="space-y-1.5">
              <Label>Kategori</Label>
              <Select value={categoryId} onValueChange={setCategoryId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua kategori</SelectItem>
                  {categories.map((category) => (
                    <SelectItem key={category.id} value={category.id}>
                      {category.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="opname-notes">Catatan</Label>
              <Input
                id="opname-notes"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Opsional"
              />
            </div>

            <p className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
              Maksimal 500 produk per sesi. Untuk produk yang lebih banyak,
              buat beberapa sesi sekaligus per kategori.
            </p>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={isPending}
              >
                Batal
              </Button>
              <Button
                type="button"
                onClick={submit}
                disabled={isPending || name.trim().length < 3}
              >
                {isPending ? (
                  <>
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                    Menyimpan…
                  </>
                ) : (
                  "Buat Sesi"
                )}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
