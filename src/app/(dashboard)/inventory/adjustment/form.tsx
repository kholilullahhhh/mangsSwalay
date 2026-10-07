"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, Loader2, Save } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { formatCurrency, formatNumber } from "@/lib/format";
import { previewAdjustment } from "@/lib/inventory/rules";

import { adjustStockAction } from "../actions";

interface Candidate {
  id: string;
  sku: string;
  name: string;
  unit: string;
  stock: number;
  cost: number;
  category: string;
}

/**
 * Stock correction form.
 *
 * Rows are selected explicitly rather than submitting the whole page, so an
 * operator correcting two products out of a hundred does not create a hundred
 * ledger rows. The difference preview uses the shared pure function, so what is
 * shown here is exactly what the server will compute.
 */
export function AdjustmentForm({
  products,
  reasons,
}: {
  products: Candidate[];
  reasons: Array<{ value: string; label: string }>;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const previews = useMemo(() => {
    const rows = products
      .filter((product) => selected[product.id])
      .map((product) => {
        const raw = counts[product.id];
        return previewAdjustment({
          productId: product.id,
          productName: product.name,
          systemStock: product.stock,
          actualStock: raw === undefined || raw === "" ? product.stock : Number(raw),
          unitCost: product.cost,
        });
      });

    return rows;
  }, [products, selected, counts]);

  const changed = previews.filter((preview) => preview.difference !== 0);
  const netValue = previews.reduce(
    (sum, preview) => sum + preview.valueDifference,
    0,
  );

  function toggle(productId: string) {
    setSelected((current) => ({ ...current, [productId]: !current[productId] }));
  }

  function submit() {
    setFormError(null);

    if (!reason) {
      setFormError("Alasan penyesuaian wajib dipilih.");
      return;
    }

    if (changed.length === 0) {
      setFormError(
        "Belum ada perbedaan stok. Masukkan jumlah fisik yang berbeda dari stok sistem.",
      );
      return;
    }

    const formData = new FormData();
    formData.set("reason", reason);
    formData.set("note", note);

const selectedProducts = products.filter(
      (product) => selected[product.id],
    );

    for (const product of selectedProducts) {
      formData.append("productId", product.id);

      // An untouched row submits the current system stock, which yields a zero
      // difference and is dropped by the server rather than written as noise.
      formData.append(
        "actualStock",
        counts[product.id] ?? String(product.stock),
      );
      formData.append("note", note);
    }

    startTransition(async () => {
      const result = await adjustStockAction(formData);

      if (result.error) {
        setFormError(result.error);
        setConfirming(false);
        return;
      }

      toast.success(
        changed.length + " produk disesuaikan. Perubahan tercatat di riwayat stok.",
      );
      setSelected({});
      setCounts({});
      setNote("");
      setConfirming(false);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-muted/30 p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="reason">Alasan Penyesuaian *</Label>
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger id="reason">
                <SelectValue placeholder="Pilih alasan" />
              </SelectTrigger>
              <SelectContent>
                {reasons.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="note">Catatan</Label>
            <Input
              id="note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Wajib diisi untuk alasan Lainnya / Kedaluwarsa"
            />
          </div>
        </div>

        {formError ? (
          <p
            role="alert"
            className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {formError}
          </p>
        ) : null}
      </div>

      <div className="overflow-hidden rounded-lg border">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40">
              <tr>
                <th className="w-10 px-3 py-2" />
                <th className="px-3 py-2 text-left font-medium">Produk</th>
                <th className="px-3 py-2 text-right font-medium">Stok Sistem</th>
                <th className="px-3 py-2 text-right font-medium">Stok Fisik</th>
                <th className="px-3 py-2 text-right font-medium">Selisih</th>
                <th className="px-3 py-2 text-right font-medium">Nilai</th>
              </tr>
            </thead>

            <tbody>
              {products.map((product) => {
                const isSelected = Boolean(selected[product.id]);
                const raw = counts[product.id];
                const actual = raw === undefined || raw === "" ? null : Number(raw);
                const difference =
                  actual === null || !Number.isFinite(actual)
                    ? null
                    : actual - product.stock;

                return (
                  <tr
                    key={product.id}
                    className={isSelected ? "bg-brand-50/40 dark:bg-brand-950/20" : ""}
                  >
                    <td className="px-3 py-2">
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => toggle(product.id)}
                        aria-label={"Pilih " + product.name}
                      />
                    </td>

                    <td className="px-3 py-2">
                      <p className="font-medium">{product.name}</p>
                      <p className="font-mono text-xs text-muted-foreground">
                        {product.sku}
                      </p>
                    </td>

                    <td className="tabular px-3 py-2 text-right">
                      {formatNumber(product.stock)}
                    </td>

                    <td className="px-3 py-2 text-right">
                      <Input
                        type="number"
                        min={0}
                        value={raw ?? ""}
                        onChange={(event) =>
                          setCounts((current) => ({
                            ...current,
                            [product.id]: event.target.value,
                          }))
                        }
                        disabled={!isSelected}
                        placeholder={String(product.stock)}
                        className="tabular h-8 w-24 text-right"
                        aria-label={"Stok fisik " + product.name}
                      />
                    </td>

                    <td
                      className={
                        difference === null
                          ? "tabular px-3 py-2 text-right text-muted-foreground"
                          : difference === 0
                            ? "tabular px-3 py-2 text-right text-muted-foreground"
                            : difference > 0
                              ? "tabular px-3 py-2 text-right font-medium text-stock-ok"
                              : "tabular px-3 py-2 text-right font-medium text-stock-out"
                      }
                    >
                      {difference === null ? "-" : difference > 0 ? "+" + difference : difference}
                    </td>

                    <td className="tabular px-3 py-2 text-right text-muted-foreground">
                      {difference === null
                        ? "-"
                        : formatCurrency(difference * product.cost)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {products.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">
            Tidak ada produk untuk ditampilkan. Gunakan pencarian di atas.
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-4">
        <div className="text-sm">
          <p>
            <span className="font-medium">{formatNumber(changed.length)}</span>{" "}
            produk akan disesuaikan
            {changed.length > 0 ? (
              <>
                {" "}dengan nilai bersih{" "}
                <span className={netValue >= 0 ? "text-stock-ok" : "text-stock-out"}>
                  {netValue >= 0 ? "+" : ""}
                  {formatCurrency(netValue)}
                </span>
              </>
            ) : null}
          </p>
          {previews.length > 0 && changed.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Selisih nol tidak akan dicatat sebagai pergerakan stok.
            </p>
          ) : null}
        </div>

        <Button
          disabled={isPending || changed.length === 0}
          onClick={() => setConfirming(true)}
        >
          <Save className="size-4" aria-hidden />
          Simpan Penyesuaian
        </Button>
      </div>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Terapkan penyesuaian stok?</AlertDialogTitle>
            <AlertDialogDescription>
              {formatNumber(changed.length)} produk akan diubah dan setiap
              perubahan tercatat di riwayat stok dengan alasan{" "}
              <strong>{reasons.find((item) => item.value === reason)?.label}</strong>.
              Tindakan ini tidak bisa dibatalkan.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Batal</AlertDialogCancel>
            <AlertDialogAction
              disabled={isPending}
              onClick={(event) => {
                event.preventDefault();
                submit();
              }}
            >
              {isPending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <AlertTriangle className="size-4" aria-hidden />
              )}
              Ya, terapkan
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
