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

import { createExpenseAction } from "../customers/actions";

export function NewExpenseButton({ categories }: { categories: Record<string, string> }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [category, setCategory] = useState("OPERATIONAL");

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="size-4" aria-hidden />
        Catat Pengeluaran
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Catat Pengeluaran</DialogTitle>
            <DialogDescription>
              Pengeluaran mengurangi laba pada laporan profit.
            </DialogDescription>
          </DialogHeader>

          <form
            action={(formData: FormData) => {
              setError(null);
              setFieldErrors({});
              formData.set("category", category);

              startTransition(async () => {
                const result = await createExpenseAction(formData);

                if (result.error) {
                  setError(result.error);
                  return;
                }

                if (result.fieldErrors) {
                  setFieldErrors(result.fieldErrors);
                  return;
                }

                toast.success("Pengeluaran tercatat.");
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
              <Label>Kategori</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(categories).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="expense-amount">Nominal (Rp) *</Label>
              <Input
                id="expense-amount"
                name="amount"
                type="number"
                min={1}
                step={1000}
                required
                className="tabular"
              />
              {fieldErrors.amount ? (
                <p className="text-sm text-destructive">{fieldErrors.amount}</p>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="expense-date">Tanggal *</Label>
              <Input
                id="expense-date"
                name="date"
                type="date"
                required
                defaultValue={new Date().toISOString().slice(0, 10)}
              />
              {fieldErrors.date ? (
                <p className="text-sm text-destructive">{fieldErrors.date}</p>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="expense-description">Keterangan</Label>
              <Input
                id="expense-description"
                name="description"
                placeholder="Contoh: tagihan listrik bulan ini"
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
