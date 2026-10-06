"use client";

import { useState } from "react";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ProductDialog } from "@/components/products/product-dialog";

/**
 * Opens the create-product dialog.
 *
 * A tiny client wrapper so the server-rendered page can still own the dialog's
 * open/close state; the dialog itself is a client component either way.
 */
export function NewProductButton({
  categories,
  brands,
  label = "Tambah Produk",
}: {
  categories: Array<{ id: string; name: string }>;
  brands: Array<{ id: string; name: string }>;
  label?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="size-4" aria-hidden />
        {label}
      </Button>

      <ProductDialog
        open={open}
        onOpenChange={setOpen}
        categories={categories}
        brands={brands}
      />
    </>
  );
}