"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

import {
  createPromotionAction,
  updatePromotionAction,
  type CrudResult,
} from "@/actions/admin-actions";
import { CheckboxField, Field, FormError } from "./fields";

/**
 * Promotion create/edit dialog.
 *
 * The form changes shape with the selected type, because a "buy 2 get 1" promo
 * has no meaning with a percentage value. Each type therefore declares which
 * inputs it needs, and the shared builder below renders only those — the server
 * validates the same conditions again, because a shape the client hides is not a
 * guarantee the server can rely on.
 */

export interface PromotionFormValues {
  id: string;
  code: string;
  name: string;
  description: string | null;
  type: string;
  value: number;
  minPurchaseAmount: number | null;
  buyQuantity: number | null;
  getQuantity: number | null;
  categoryId: string | null;
  /** ISO date, `YYYY-MM-DD`. */
  startDate: string;
  /** ISO date, `YYYY-MM-DD`. */
  endDate: string;
  usageLimit: number | null;
  usedCount: number;
  isActive: boolean;
  productIds: string[];
}

interface TypeDefinition {
  value: string;
  label: string;
  description: string;
  /** Which extra inputs this type needs, besides code/name/dates. */
  needs: Array<"value" | "minPurchaseAmount" | "quantities" | "category" | "products">;
  valueLabel: string;
  valueHint: string;
}

const TYPES: TypeDefinition[] = [
  {
    value: "PERCENTAGE",
    label: "Persentase",
    description: "Potongan persen dari seluruh belanja.",
    needs: ["value"],
    valueLabel: "Potongan (%)",
    valueHint: "Contoh: 10 berarti potongan 10%.",
  },
  {
    value: "FIXED",
    label: "Nominal Tetap",
    description: "Potongan rupiah tetap per transaksi.",
    needs: ["value"],
    valueLabel: "Potongan (Rp)",
    valueHint: "Contoh: 5000 berarti potongan Rp5.000.",
  },
  {
    value: "MINIMUM_PURCHASE",
    label: "Minimum Belanja",
    description: "Persentase, hanya berlaku di atas ambang belanja.",
    needs: ["value", "minPurchaseAmount"],
    valueLabel: "Potongan (%)",
    valueHint: "Contoh: 15 untuk 15% di atas minimum belanja.",
  },
  {
    value: "BUY_X_GET_Y",
    label: "Beli Gratis",
    description: "Produk gratis setelah pembelian tertentu.",
    needs: ["quantities"],
    valueLabel: "",
    valueHint: "",
  },
  {
    value: "CATEGORY",
    label: "Kategori",
    description: "Persentase untuk satu kategori.",
    needs: ["value", "category"],
    valueLabel: "Potongan (%)",
    valueHint: "Hanya produk dalam kategori terpilih yang gets diskon.",
  },
  {
    value: "PRODUCT",
    label: "Produk Tertentu",
    description: "Persentase untuk produk yang dipilih.",
    needs: ["value", "products"],
    valueLabel: "Potongan (%)",
    valueHint: "Hanya produk terpilih yang gets diskon.",
  },
];

function typeDefinition(type: string): TypeDefinition {
  return TYPES.find((entry) => entry.value === type) ?? TYPES[0];
}

/** Today, in the `YYYY-MM-DD` form an `<input type="date">` expects. */
function todayISO(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

export function PromotionDialog({
  promotion,
  categories,
  products,
  trigger,
  open: controlledOpen,
  onOpenChange,
}: {
  promotion?: PromotionFormValues | null;
  categories: Array<{ id: string; name: string }>;
  products: Array<{ id: string; name: string; sku: string }>;
  trigger: ReactNode;
  /** Controlled, so a parent can open this dialog from outside the trigger. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const [type, setType] = useState(promotion?.type ?? "PERCENTAGE");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [selectedProducts, setSelectedProducts] = useState<string[]>(
    promotion?.productIds ?? [],
  );
  const [productPickerOpen, setProductPickerOpen] = useState(false);

  // Falls back to internal state when uncontrolled, so the same component works
  // as a self-opening dialog and as one a row action opens programmatically.
  const open = controlledOpen ?? uncontrolledOpen;

  const setOpen = (next: boolean) => {
    onOpenChange?.(next);
    if (controlledOpen === undefined) setUncontrolledOpen(next);
  };

  const isEditing = Boolean(promotion);
  const definition = typeDefinition(type);

  function handleSubmit(formData: FormData) {
    setFieldErrors({});
    setFormError(null);

    // The picker holds its selection in React state, so it has to be written into
    // the FormData explicitly: a set of checkboxes is not a form control.
    for (const productId of selectedProducts) {
      formData.append("productIds", productId);
    }

    startTransition(async () => {
      const result = isEditing
        ? await updatePromotionAction(formData)
        : await createPromotionAction(formData);

      if (!handleResult(result)) return;

      toast.success(isEditing ? "Promo diperbarui." : "Promo ditambahkan.");
      setOpen(false);
      router.refresh();
    });
  }

  function handleResult(result: CrudResult): boolean {
    if (result.error) {
      // A used promo that cannot be deleted reports through `error` but is still
      // a success from the user's point of view: it has been deactivated.
      if (result.error.includes("dinonaktifkan")) {
        toast.success(result.error);
        router.refresh();
        return true;
      }

      setFormError(result.error);
      return false;
    }

    if (result.fieldErrors) {
      setFieldErrors(result.fieldErrors);
      return false;
    }

    return true;
  }

  function toggleProduct(productId: string) {
    setSelectedProducts((current) =>
      current.includes(productId)
        ? current.filter((id) => id !== productId)
        : [...current, productId],
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setFormError(null);
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>

      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? "Edit Promo" : "Tambah Promo"}
          </DialogTitle>
          <DialogDescription>
            Kode promo diklik kasir di kasir. Aturan dihitung ulang di server
            setiap transaksi.
          </DialogDescription>
        </DialogHeader>

        <form action={handleSubmit} className="space-y-5">
          {isEditing ? (
            <input type="hidden" name="id" value={promotion!.id} />
          ) : null}

          <FormError message={formError} />

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Kode Promo"
              name="code"
              error={fieldErrors.code}
              hint="Huruf kapital, angka, dan tanda hubung."
              required
            >
              {(props) => (
                <Input
                  {...props}
                  defaultValue={promotion?.code}
                  placeholder="HEMAT10"
                  className="uppercase font-mono"
                  readOnly={isEditing}
                />
              )}
            </Field>

            <Field
              label="Nama Promo"
              name="name"
              error={fieldErrors.name}
              required
            >
              {(props) => (
                <Input
                  {...props}
                  defaultValue={promotion?.name}
                  placeholder="Hemat 10% Semua Belanja"
                />
              )}
            </Field>
          </div>

          <Field label="Deskripsi" name="description" error={fieldErrors.description}>
            {(props) => (
              <Textarea
                {...props}
                rows={2}
                defaultValue={promotion?.description ?? ""}
                placeholder="Catatan internal, tidak tampil di struk."
              />
            )}
          </Field>

          <Field
            label="Jenis Promo"
            name="type"
            error={fieldErrors.type}
            hint={definition.description}
            required
          >
            {(props) => (
              <Select
                name={props.name}
                value={type}
                onValueChange={(next) => {
                  setType(next);
                  // Product selection is meaningless for other types, so clearing
                  // it here prevents a hidden selection from being submitted.
                  if (next !== "PRODUCT") setSelectedProducts([]);
                }}
              >
                <SelectTrigger id={props.id}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TYPES.map((entry) => (
                    <SelectItem key={entry.value} value={entry.value}>
                      {entry.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </Field>

          {definition.needs.includes("value") ? (
            <Field
              label={definition.valueLabel}
              name="value"
              error={fieldErrors.value}
              hint={definition.valueHint}
              required
            >
              {(props) => (
                <Input
                  {...props}
                  type="number"
                  min={0}
                  step="any"
                  defaultValue={
                    promotion && promotion.type === type
                      ? promotion.value
                      : undefined
                  }
                />
              )}
            </Field>
          ) : null}

          {definition.needs.includes("minPurchaseAmount") ? (
            <Field
              label="Minimum Belanja (Rp)"
              name="minPurchaseAmount"
              error={fieldErrors.minPurchaseAmount}
              hint="Promo hanya berlaku jika belanja mencapai nominal ini."
              required
            >
              {(props) => (
                <Input
                  {...props}
                  type="number"
                  min={0}
                  step="any"
                  defaultValue={
                    promotion && promotion.type === type
                      ? (promotion.minPurchaseAmount ?? undefined)
                      : undefined
                  }
                />
              )}
            </Field>
          ) : null}

          {definition.needs.includes("quantities") ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Jumlah Beli"
                name="buyQuantity"
                error={fieldErrors.buyQuantity}
                hint="Contoh: 2 berarti beli 2."
                required
              >
                {(props) => (
                  <Input
                    {...props}
                    type="number"
                    min={1}
                    step={1}
                    defaultValue={promotion?.buyQuantity ?? undefined}
                  />
                )}
              </Field>

              <Field
                label="Jumlah Gratis"
                name="getQuantity"
                error={fieldErrors.getQuantity}
                hint="Produk termurah dalam kelompok itu yang gratis."
                required
              >
                {(props) => (
                  <Input
                    {...props}
                    type="number"
                    min={1}
                    step={1}
                    defaultValue={promotion?.getQuantity ?? undefined}
                  />
                )}
              </Field>
            </div>
          ) : null}

          {definition.needs.includes("category") ? (
            <Field
              label="Kategori"
              name="categoryId"
              error={fieldErrors.categoryId}
              required
            >
              {(props) => (
                <Select name={props.name} defaultValue={promotion?.categoryId ?? ""}>
                  <SelectTrigger id={props.id}>
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
          ) : null}

          {definition.needs.includes("products") ? (
            <div className="space-y-1.5">
              <span className="text-sm font-medium">
                Produk yang promo
                <span className="ml-0.5 text-destructive" aria-hidden>
                  *
                </span>
              </span>

              <Popover open={productPickerOpen} onOpenChange={setProductPickerOpen}>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full justify-start font-normal"
                  >
                    {selectedProducts.length === 0
                      ? "Pilih produk"
                      : selectedProducts.length + " produk dipilih"}
                  </Button>
                </PopoverTrigger>

                <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
                  <Command>
                    <CommandInput placeholder="Cari nama atau SKU…" />
                    <CommandList>
                      <CommandEmpty>Produk tidak ditemukan.</CommandEmpty>
                      <CommandGroup>
                        {products.map((product) => (
                          <CommandItem
                            key={product.id}
                            value={product.name + " " + product.sku}
                            onSelect={() => toggleProduct(product.id)}
                          >
                            <Checkbox
                              checked={selectedProducts.includes(product.id)}
                            />
                            <span className="ml-2 flex-1 truncate">
                              {product.name}
                            </span>
                            <span className="font-mono text-xs text-muted-foreground">
                              {product.sku}
                            </span>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>

              {fieldErrors.productIds ? (
                <p className="text-sm text-destructive">{fieldErrors.productIds}</p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Tanpa produk terpilih, promo tidak akan bisa dipakai.
                </p>
              )}
            </div>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Mulai"
              name="startDate"
              error={fieldErrors.startDate}
              required
            >
              {(props) => (
                <Input
                  {...props}
                  type="date"
                  defaultValue={promotion?.startDate ?? todayISO()}
                />
              )}
            </Field>

            <Field
              label="Berakhir"
              name="endDate"
              error={fieldErrors.endDate}
              hint="Berlaku sampai akhir hari tersebut."
              required
            >
              {(props) => (
                <Input
                  {...props}
                  type="date"
                  defaultValue={promotion?.endDate ?? todayISO()}
                />
              )}
            </Field>
          </div>

          <Field
            label="Batas Pemakaian"
            name="usageLimit"
            error={fieldErrors.usageLimit}
            hint="Kosongkan untuk tanpa batas."
          >
            {(props) => (
              <Input
                {...props}
                type="number"
                min={0}
                step={1}
                defaultValue={promotion?.usageLimit ?? undefined}
                placeholder="Tanpa batas"
              />
            )}
          </Field>

          <CheckboxField
            name="isActive"
            label="Promo aktif"
            defaultChecked={promotion?.isActive ?? true}
            hint="Promo nonaktif tidak bisa dipakai di kasir."
          />

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
              ) : isEditing ? (
                "Simpan Perubahan"
              ) : (
                "Tambah Promo"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}