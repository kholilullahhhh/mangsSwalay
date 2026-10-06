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
import {
  createProductAction,
  updateProductAction,
} from "@/app/(dashboard)/products/actions";

/**
 * Product create/edit dialog.
 *
 * Owns only its own field state and submits through a Server Action, so the
 * table below it never loses its filters or scroll position on save. Server-side
 * validation errors come back per field and are rendered inline.
 */
export function ProductDialog({
  open,
  onOpenChange,
  product,
  categories,
  brands,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product?: ProductFormValues | null;
  categories: Array<{ id: string; name: string }>;
  brands: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const isEditing = Boolean(product);

  function handleSubmit(formData: FormData) {
    setFieldErrors({});
    setFormError(null);

    startTransition(async () => {
      const result = isEditing
        ? await updateProductAction(product!.id, formData)
        : await createProductAction(formData);

      if (result.error) {
        if (result.fieldErrors) {
          setFieldErrors(result.fieldErrors);
        } else {
          setFormError(result.error);
        }
        return;
      }

      toast.success(isEditing ? "Produk diperbarui." : "Produk ditambahkan.");
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? "Edit Produk" : "Tambah Produk"}
          </DialogTitle>
          <DialogDescription>
            {isEditing
              ? "Perubahan harga dan atribut tidak mengubah riwayat stok."
              : "Stok awal akan tercatat sebagai penyesuaian masuk di riwayat stok."}
          </DialogDescription>
        </DialogHeader>

        <form action={handleSubmit} className="space-y-5">
          {formError ? (
            <p
              role="alert"
              className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {formError}
            </p>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Nama Produk"
              name="name"
              error={fieldErrors.name}
              required
            >
              {(props) => (
                <Input
                  {...props}
                  defaultValue={product?.name}
                  aria-invalid={Boolean(fieldErrors.name)}
                />
              )}
            </Field>

            <Field label="SKU" name="sku" error={fieldErrors.sku} required>
              {(props) => (
                <Input
                  {...props}
                  defaultValue={product?.sku}
                  placeholder="SMB-001"
                  aria-invalid={Boolean(fieldErrors.sku)}
                />
              )}
            </Field>

            <Field label="Barcode" name="barcode" error={fieldErrors.barcode}>
              {(props) => (
                <Input
                  {...props}
                  defaultValue={product?.barcode ?? ""}
                  inputMode="numeric"
                  placeholder="8992775001017"
                  aria-invalid={Boolean(fieldErrors.barcode)}
                />
              )}
            </Field>

            <Field
              label="Kategori"
              name="categoryId"
              error={fieldErrors.categoryId}
              required
            >
              {() => (
                <Select
                  name="categoryId"
                  defaultValue={product?.categoryId}
                >
                  <SelectTrigger aria-invalid={Boolean(fieldErrors.categoryId)}>
                    <SelectValue placeholder="Pilih kategori" />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map((category) => (
                      <SelectItem key={category.id} value={category.id}>
                        {category.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </Field>

            <Field label="Merek" name="brandId" error={fieldErrors.brandId}>
              {() => (
                <Select name="brandId" defaultValue={product?.brandId ?? undefined}>
                  <SelectTrigger>
                    <SelectValue placeholder="Opsional" />
                  </SelectTrigger>
                  <SelectContent>
                    {brands.map((brand) => (
                      <SelectItem key={brand.id} value={brand.id}>
                        {brand.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </Field>

            <Field label="Satuan" name="unit" error={fieldErrors.unit} required>
              {() => (
                <Select name="unit" defaultValue={product?.unit ?? "PCS"}>
                  <SelectTrigger aria-invalid={Boolean(fieldErrors.unit)}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {UNITS.map((unit) => (
                      <SelectItem key={unit} value={unit}>
                        {UNIT_LABELS[unit]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field
              label="Harga Beli"
              name="purchasePrice"
              error={fieldErrors.purchasePrice}
              required
            >
              {(props) => (
                <Input
                  {...props}
                  type="number"
                  step="100"
                  min="0"
                  defaultValue={
                    product ? String(Number(product.purchasePrice)) : "0"
                  }
                  className="tabular"
                  aria-invalid={Boolean(fieldErrors.purchasePrice)}
                />
              )}
            </Field>

            <Field
              label="Harga Jual"
              name="sellingPrice"
              error={fieldErrors.sellingPrice}
              required
            >
              {(props) => (
                <Input
                  {...props}
                  type="number"
                  step="100"
                  min="0"
                  defaultValue={
                    product ? String(Number(product.sellingPrice)) : "0"
                  }
                  className="tabular"
                  aria-invalid={Boolean(fieldErrors.sellingPrice)}
                />
              )}
            </Field>

            <Field
              label="Harga Minimum"
              name="minSellingPrice"
              error={fieldErrors.minSellingPrice}
            >
              {(props) => (
                <Input
                  {...props}
                  type="number"
                  step="100"
                  min="0"
                  placeholder="Opsional"
                  defaultValue={
                    product?.minSellingPrice
                      ? String(Number(product.minSellingPrice))
                      : ""
                  }
                  className="tabular"
                />
              )}
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field
              label="Stok"
              name="stock"
              error={fieldErrors.stock}
              required
              hint={
                isEditing
                  ? "Hanya berlaku saat produk baru dibuat. Ubah lewat adjustment atau pembelian."
                  : undefined
              }
            >
              {(props) => (
                <Input
                  {...props}
                  type="number"
                  min="0"
                  disabled={isEditing}
                  defaultValue={product ? String(product.stock) : "0"}
                  className="tabular"
                />
              )}
            </Field>

            <Field
              label="Stok Minimum"
              name="minStock"
              error={fieldErrors.minStock}
            >
              {(props) => (
                <Input
                  {...props}
                  type="number"
                  min="0"
                  defaultValue={product ? String(product.minStock) : "0"}
                  className="tabular"
                />
              )}
            </Field>

            <Field
              label="Stok Maksimum"
              name="maxStock"
              error={fieldErrors.maxStock}
            >
              {(props) => (
                <Input
                  {...props}
                  type="number"
                  min="0"
                  placeholder="Opsional"
                  defaultValue={product?.maxStock ? String(product.maxStock) : ""}
                  className="tabular"
                />
              )}
            </Field>
          </div>

          <Field label="Deskripsi" name="description" error={fieldErrors.description}>
            {(props) => (
              <textarea
                {...props}
                rows={3}
                defaultValue={product?.description ?? ""}
                className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            )}
          </Field>

          <div className="flex flex-wrap gap-4">
            <CheckboxField
              name="isActive"
              label="Aktif"
              defaultChecked={product?.isActive ?? true}
            />
            <CheckboxField
              name="isFeatured"
              label="Produk unggulan"
              defaultChecked={product?.isFeatured ?? false}
            />
            <CheckboxField
              name="hasExpiry"
              label="Punya tanggal kedaluwarsa"
              defaultChecked={product?.hasExpiry ?? false}
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
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
                <>
                  <Plus className="size-4" aria-hidden />
                  {isEditing ? "Simpan Perubahan" : "Tambah Produk"}
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const UNITS = [
  "PCS",
  "PACK",
  "BOX",
  "KG",
  "G",
  "L",
  "ML",
  "DOSE",
  "SACHET",
  "CAN",
  "BOTTLE",
  "ROLL",
  "TUBE",
] as const;

const UNIT_LABELS: Record<string, string> = {
  PCS: "Satuan (pcs)",
  PACK: "Kemasan",
  BOX: "Dus",
  KG: "Kilogram",
  G: "Gram",
  L: "Liter",
  ML: "Mililiter",
  DOSE: "Dosis",
  SACHET: "Sachet",
  CAN: "Kaleng",
  BOTTLE: "Botol",
  ROLL: "Roll",
  TUBE: "Tube",
};

/**
 * Label + control + error message.
 *
 * The error is associated with the input via aria-describedby so screen readers
 * announce it when focus lands on the invalid field.
 */
function Field({
  label,
  name,
  error,
  hint,
  required,
  children,
}: {
  label: string;
  name: string;
  error?: string;
  hint?: string;
  required?: boolean;
  children: (props: {
    id: string;
    name: string;
    "aria-describedby"?: string;
  }) => React.ReactNode;
}) {
  const errorId = `${name}-error`;
  const hintId = `${name}-hint`;

  return (
    <div className="space-y-1.5">
      <Label htmlFor={name}>
        {label}
        {required ? (
          <span className="ml-0.5 text-destructive" aria-hidden>
            *
          </span>
        ) : null}
      </Label>

      {children({
        id: name,
        name,
        "aria-describedby": error ? errorId : hint ? hintId : undefined,
      })}

      {error ? (
        <p id={errorId} className="text-sm text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

function CheckboxField({
  name,
  label,
  defaultChecked,
}: {
  name: string;
  label: string;
  defaultChecked?: boolean;
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        name={name}
        value="true"
        defaultChecked={defaultChecked}
        className="size-4 rounded border-input"
      />
      {label}
    </label>
  );
}

export interface ProductFormValues {
  id: string;
  name: string;
  sku: string;
  barcode: string | null;
  categoryId: string;
  brandId: string | null;
  unit: string;
  purchasePrice: number;
  sellingPrice: number;
  minSellingPrice: number | null;
  stock: number;
  minStock: number;
  maxStock: number | null;
  isActive: boolean;
  isFeatured: boolean;
  hasExpiry: boolean;
  description: string | null;
}

export interface ProductTableRow {
  id: string;
  name: string;
  sku: string;
  barcode: string | null;
  unit: string;
  purchasePrice: number;
  sellingPrice: number;
  minStock: number;
  categoryId: string;
  brandId: string | null;
  isActive: boolean;
  description: string | null;
  maxStock: number | null;
  minSellingPrice: number | null;
  hasExpiry: boolean;
  isFeatured: boolean;
  stock: number;
}