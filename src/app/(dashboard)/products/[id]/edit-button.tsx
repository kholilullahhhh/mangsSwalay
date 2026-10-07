"use client";

import { useState } from "react";
import { Pencil } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ProductDialog } from "@/components/products/product-dialog";

/** Opens the edit dialog for a single product. */
export function EditProductButton({
  product,
  categories,
  brands,
}: {
  product: Parameters<typeof ProductDialog>[0]["product"];
  categories: Array<{ id: string; name: string }>;
  brands: Array<{ id: string; name: string }>;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Pencil className="size-4" aria-hidden />
        Edit Produk
      </Button>

      <ProductDialog
        open={open}
        onOpenChange={setOpen}
        product={product}
        categories={categories}
        brands={brands}
      />
    </>
  );
}
