"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Plus, Trash2 } from "lucide-react";

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
import { formatCurrency, formatNumber } from "@/lib/format";
import { computePurchaseTotals } from "@/lib/purchases/state-machine";
import { createPurchaseAction } from "./actions";

interface Line {
  productId: string;
  quantity: number;
  purchasePrice: number;
  /** Required for perishable products; carried to the batch on receipt. */
  expiryDate: string | null;
  batchNumber: string | null;
}

export interface PurchaseProductOption {
  id: string;
  sku: string;
  name: string;
  hasExpiry: boolean;
  purchasePrice: number;
}

/**
 * Create-purchase dialog.
 *
 * The total shown here uses `computePurchaseTotals` — the same pure function the
 * server calls on save — so the preview can never disagree with what gets saved.
 * The server recomputes it regardless; the client copy is convenience only.
 */
export function NewPurchaseButton({
  suppliers,
  products,
  defaultOpen = false,
}: {
  suppliers: Array<{ id: string; name: string }>;
  products: PurchaseProductOption[];
  /** Opens on mount, for the dedicated /purchases/new page. */
  defaultOpen?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(defaultOpen);
  const [isPending, startTransition] = useTransition();

  const [supplierId, setSupplierId] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [discount, setDiscount] = useState(0);
  const [tax, setTax] = useState(0);
  const [shippingCost, setShippingCost] = useState(0);
  const [notes, setNotes] = useState("");
  const [productId, setProductId] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [price, setPrice] = useState(0);
  const [expiryInput, setExpiryInput] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [formError, setFormError] = useState<string | null>(null);

  const selectedProduct = products.find((entry) => entry.id === productId);
  const isPerishable = Boolean(selectedProduct?.hasExpiry);

  const totals = useMemo(
    () => computePurchaseTotals(lines, { discount, tax, shippingCost }),
    [lines, discount, tax, shippingCost],
  );

  function addLine() {
    if (!productId) {
      setFormError("Pilih produk terlebih dahulu.");
      return;
    }

    if (quantity < 1) {
      setFormError("Jumlah harus minimal 1.");
      return;
    }

    if (price < 0) {
      setFormError("Harga beli tidak boleh negatif.");
      return;
    }

    // Caught here rather than after saving, so the operator is not told to go and
    // edit a purchase that does not exist yet.
    if (isPerishable && !expiryInput) {
      setFormError(
        `${selectedProduct?.name ?? "Produk"} perlu tanggal kedaluwarsa. Tulis tanggal yang tertera pada kemasan.`,
      );
      return;
    }

    setFormError(null);

    const line: Line = {
      productId,
      quantity,
      purchasePrice: price,
      expiryDate: isPerishable ? expiryInput : null,
      batchNumber: null,
    };

    setLines((current) => {
      const existing = current.find((entry) => entry.productId === productId);

      // Merge rather than duplicate: two rows for one product would break the
      // per-line ledger and the COGS report.
      if (existing) {
        return current.map((entry) =>
          entry.productId === productId
            ? {
                ...entry,
                quantity: entry.quantity + quantity,
                purchasePrice: price,
                expiryDate: line.expiryDate ?? entry.expiryDate,
              }
            : entry,
        );
      }

      return [...current, line];
    });

    setQuantity(1);
    setExpiryInput("");
  }

  function submit() {
    setFormError(null);

    if (!supplierId) {
      setFormError("Pilih supplier.");
      return;
    }

    if (lines.length === 0) {
      setFormError("Tambahkan minimal satu barang.");
      return;
    }

    const missingExpiry = lines.find(
      (line) =>
        products.find((entry) => entry.id === line.productId)?.hasExpiry &&
        !line.expiryDate,
    );

    if (missingExpiry) {
      setFormError(
        "Semua barang perishable harus memiliki tanggal kedaluwarsa.",
      );
      return;
    }

    const formData = new FormData();
    formData.set("supplierId", supplierId);
    formData.set("date", date);
    formData.set("discount", String(discount));
    formData.set("tax", String(tax));
    formData.set("shippingCost", String(shippingCost));
    formData.set("notes", notes);

    for (const line of lines) {
      formData.append("line", JSON.stringify(line));
    }

    startTransition(async () => {
      const result = await createPurchaseAction(formData);

      if (result.error) {
        setFormError(
          result.error +
            (result.fieldErrors?.expiryDate ? ` (${result.fieldErrors.expiryDate})` : ""),
        );
        return;
      }

      toast.success("Pesanan pembelian dibuat. Stok bertambah saat barang diterima.");
      setOpen(false);
      setLines([]);
      setSupplierId("");
      setDiscount(0);
      setTax(0);
      setShippingCost(0);
      setNotes("");
      router.refresh();

      if (result.id) {
        router.push(`/purchases/${result.id}`);
      }
    });
  }

  return (
    <>
      {/* On its own page the dialog opens on mount, so the trigger would just
          reopen a form the user already sees. */}
      {defaultOpen ? null : (
        <Button size="sm" onClick={() => setOpen(true)}>
          <Plus className="size-4" aria-hidden />
          Pembelian Baru
        </Button>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Pesanan Pembelian Baru</DialogTitle>
            <DialogDescription>
              Disimpan sebagai Draft. Stok hanya bertambah setelah barang
              diterima.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5">
            {formError ? (
              <p
                role="alert"
                className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
              >
                {formError}
              </p>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="supplier">Supplier</Label>
                <Select value={supplierId} onValueChange={setSupplierId}>
                  <SelectTrigger id="supplier">
                    <SelectValue placeholder="Pilih supplier" />
                  </SelectTrigger>
                  <SelectContent>
                    {suppliers.map((supplier) => (
                      <SelectItem key={supplier.id} value={supplier.id}>
                        {supplier.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="date">Tanggal</Label>
                <Input
                  id="date"
                  type="date"
                  value={date}
                  onChange={(event) => setDate(event.target.value)}
                />
              </div>
            </div>

            <div className="space-y-2 rounded-lg border p-4">
              <Label>Tambah Barang</Label>

              <div className="grid gap-2 sm:grid-cols-[2fr_1fr_1fr_auto]">
                <Select
                  value={productId}
                  onValueChange={(next) => {
                    setProductId(next);
                    setExpiryInput("");
                    // Default the cost to the product's current one; the operator
                    // still types the real figure, which is what the line records.
                    const match = products.find((entry) => entry.id === next);
                    if (match) setPrice(match.purchasePrice);
                  }}
                >
                  <SelectTrigger aria-label="Produk">
                    <SelectValue placeholder="Pilih produk" />
                  </SelectTrigger>
                  <SelectContent>
                    {products.map((product) => (
                      <SelectItem key={product.id} value={product.id}>
                        {product.name} ({product.sku})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  type="number"
                  min={1}
                  value={quantity}
                  onChange={(event) =>
                    setQuantity(Number.parseInt(event.target.value, 10) || 1)
                  }
                  aria-label="Jumlah"
                  placeholder="Qty"
                />
                <Input
                  type="number"
                  min={0}
                  step={100}
                  value={price || ""}
                  onChange={(event) =>
                    setPrice(Number(event.target.value) || 0)
                  }
                  aria-label="Harga beli"
                  placeholder="Harga"
                  className="tabular"
                />
                <Button type="button" variant="outline" onClick={addLine}>
                  <Plus className="size-4" aria-hidden />
                  Tambah
                </Button>
              </div>

              {isPerishable ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="line-expiry">
                      Kedaluwarsa ({selectedProduct?.name})
                    </Label>
                    <Input
                      id="line-expiry"
                      type="date"
                      value={expiryInput}
                      onChange={(event) => setExpiryInput(event.target.value)}
                    />
                  </div>
                  <p className="self-end text-xs text-muted-foreground">
                    Tanggal ini dipakai untuk batch dan peringatan kedaluwarsa,
                    jadi isi sesuai kemasan.
                  </p>
                </div>
              ) : null}

              {lines.length > 0 ? (
                <ul className="divide-y rounded border">
                  {lines.map((line) => {
                    const meta = products.find(
                      (entry) => entry.id === line.productId,
                    );

                    return (
                      <li
                        key={line.productId}
                        className="flex items-center justify-between gap-2 px-3 py-2 text-sm"
                      >
                        <span className="min-w-0 truncate">
                          <span className="block truncate text-sm font-medium">
                            {meta?.name ?? line.productId}
                          </span>
                          <span className="font-mono text-[11px] text-muted-foreground">
                            {meta?.sku ?? line.productId}
                            {line.expiryDate ? ` · exp ${line.expiryDate}` : ""}
                          </span>
                        </span>
                        <span className="tabular shrink-0 text-muted-foreground">
                          {line.quantity} × {formatCurrency(line.purchasePrice)}
                        </span>
                        <span className="tabular shrink-0 font-medium">
                          {formatCurrency(line.quantity * line.purchasePrice)}
                        </span>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7 shrink-0 text-muted-foreground hover:text-destructive"
                          onClick={() =>
                            setLines((current) =>
                              current.filter(
                                (entry) => entry.productId !== line.productId,
                              ),
                            )
                          }
                          aria-label={`Hapus baris ${meta?.name ?? line.productId}`}
                        >
                          <Trash2 className="size-3.5" aria-hidden />
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="py-2 text-center text-sm text-muted-foreground">
                  Belum ada barang.
                </p>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="discount">Diskon (Rp)</Label>
                <Input
                  id="discount"
                  type="number"
                  min={0}
                  step={1000}
                  value={discount || ""}
                  onChange={(event) =>
                    setDiscount(Number(event.target.value) || 0)
                  }
                  className="tabular"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tax">Pajak (Rp)</Label>
                <Input
                  id="tax"
                  type="number"
                  min={0}
                  step={1000}
                  value={tax || ""}
                  onChange={(event) => setTax(Number(event.target.value) || 0)}
                  className="tabular"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="shipping">Ongkos Kirim (Rp)</Label>
                <Input
                  id="shipping"
                  type="number"
                  min={0}
                  step={1000}
                  value={shippingCost || ""}
                  onChange={(event) =>
                    setShippingCost(Number(event.target.value) || 0)
                  }
                  className="tabular"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="notes">Catatan</Label>
              <textarea
                id="notes"
                rows={2}
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>

            <dl className="space-y-1.5 rounded-lg border bg-muted/40 p-4 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Subtotal</dt>
                <dd className="tabular">{formatCurrency(totals.subtotal)}</dd>
              </div>
              {totals.discount > 0 ? (
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Diskon</dt>
                  <dd className="tabular">
                    -{formatCurrency(totals.discount)}
                  </dd>
                </div>
              ) : null}
              {totals.tax > 0 ? (
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Pajak</dt>
                  <dd className="tabular">{formatCurrency(totals.tax)}</dd>
                </div>
              ) : null}
              {totals.shippingCost > 0 ? (
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Ongkir</dt>
                  <dd className="tabular">
                    {formatCurrency(totals.shippingCost)}
                  </dd>
                </div>
              ) : null}
              <div className="flex justify-between border-t pt-1.5 text-base font-semibold">
                <dt>Total</dt>
                <dd className="tabular">{formatCurrency(totals.grandTotal)}</dd>
              </div>
              <p className="pt-1 text-xs text-muted-foreground">
                {formatNumber(lines.length)} jenis barang,{" "}
                {formatNumber(
                  lines.reduce((sum, line) => sum + line.quantity, 0),
                )}{" "}
                unit.
              </p>
            </dl>

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
                disabled={isPending || lines.length === 0}
              >
                {isPending ? (
                  <>
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                    Menyimpan…
                  </>
                ) : (
                  "Simpan Draft"
                )}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}