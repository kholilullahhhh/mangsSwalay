"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Filter, X } from "lucide-react";

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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

/**
 * Product list filters.
 *
 * Implemented as URL state rather than component state so filters survive a
 * refresh, can be shared in a link, and keep the server as the source of truth.
 * Selects apply immediately; the text box debounces.
 */
export function ProductFilters({
  categories,
  brands,
  current,
}: {
  categories: Array<{ id: string; name: string }>;
  brands: Array<{ id: string; name: string }>;
  current: {
    search?: string;
    categoryId?: string;
    brandId?: string;
    stock?: string;
    isActive?: string;
    isFeatured?: string;
  };
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function push(changes: Record<string, string | undefined>) {
    const params = new URLSearchParams(searchParams.toString());

    for (const [key, value] of Object.entries(changes)) {
      if (value === undefined || value === "") {
        params.delete(key);
      } else {
        params.set(key, value);
      }
    }

    // Any filter change invalidates the current page offset.
    params.delete("page");

    const query = params.toString();
    router.push(query ? `/products?${query}` : "/products");
  }

  const activeCount = [
    current.categoryId,
    current.brandId,
    current.stock,
    current.isActive,
    current.isFeatured,
  ].filter(Boolean).length;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/*
        The search box is remounted via `key` whenever the URL's search value
        changes, so it picks up external navigations (browser back, "hapus
        filter") without an effect that mirrors props into state — which would
        cause an extra render pass on every keystroke and on every navigation.
      */}
      <DebouncedSearchInput
        key={current.search ?? ""}
        initialValue={current.search ?? ""}
        onSubmit={(value) => push({ search: value || undefined })}
      />

      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm">
            <Filter className="size-4" aria-hidden />
            Filter
            {activeCount > 0 ? (
              <span className="ml-1 rounded-full bg-brand-600 px-1.5 text-[10px] font-medium text-white">
                {activeCount}
              </span>
            ) : null}
          </Button>
        </PopoverTrigger>

        <PopoverContent align="end" className="w-72 space-y-4">
          <div className="space-y-1.5">
            <Label>Kategori</Label>
            <Select
              value={current.categoryId ?? "all"}
              onValueChange={(value) =>
                push({ categoryId: value === "all" ? undefined : value })
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Semua kategori" />
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
            <Label>Merek</Label>
            <Select
              value={current.brandId ?? "all"}
              onValueChange={(value) =>
                push({ brandId: value === "all" ? undefined : value })
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Semua merek" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua merek</SelectItem>
                {brands.map((brand) => (
                  <SelectItem key={brand.id} value={brand.id}>
                    {brand.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Status Stok</Label>
            <Select
              value={current.stock ?? "all"}
              onValueChange={(value) =>
                push({ stock: value === "all" ? undefined : value })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua stok</SelectItem>
                <SelectItem value="low">Perlu restock</SelectItem>
                <SelectItem value="out">Stok habis</SelectItem>
                <SelectItem value="in">Stok tersedia</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Status Produk</Label>
            <Select
              value={current.isActive ?? "active"}
              onValueChange={(value) =>
                push({
                  isActive:
                    value === "active"
                      ? undefined
                      : value === "all"
                        ? "all"
                        : "false",
                })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Aktif saja</SelectItem>
                <SelectItem value="all">Aktif & nonaktif</SelectItem>
                <SelectItem value="false">Nonaktif saja</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Produk unggulan</Label>
            <Select
              value={current.isFeatured ?? "all"}
              onValueChange={(value) =>
                push({ isFeatured: value === "all" ? undefined : value })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua</SelectItem>
                <SelectItem value="true">Produk unggulan</SelectItem>
                <SelectItem value="false">Bukan unggulan</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {activeCount > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              className="w-full"
              onClick={() =>
                push({
                  categoryId: undefined,
                  brandId: undefined,
                  stock: undefined,
                  isActive: undefined,
                  isFeatured: undefined,
                })
              }
            >
              <X className="size-4" aria-hidden />
              Hapus semua filter
            </Button>
          ) : null}
        </PopoverContent>
      </Popover>

      {current.search ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => push({ search: undefined })}
        >
          <X className="size-4" aria-hidden />
          Hapus pencarian
        </Button>
      ) : null}
    </div>
  );
}

const DEBOUNCE_MS = 350;

/**
 * Debounced search box.
 *
 * Owns its own local value so typing stays responsive, and commits to the URL
 * after a pause. Enter commits immediately. The parent remounts this via `key`
 * when the URL value changes externally, which is why it needs no effect to
 * reconcile with props.
 */
function DebouncedSearchInput({
  initialValue,
  onSubmit,
}: {
  initialValue: string;
  onSubmit: (value: string) => void;
}) {
  const [value, setValue] = useState(initialValue);

  // Debounce keystrokes so typing doesn't push a navigation per character.
  useEffect(() => {
    if (value === initialValue) return;

    const timeout = setTimeout(() => {
      onSubmit(value);
    }, DEBOUNCE_MS);

    return () => clearTimeout(timeout);
  }, [value, initialValue, onSubmit]);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(value);
      }}
      className="min-w-52 flex-1 sm:max-w-xs"
    >
      <Label htmlFor="product-search" className="sr-only">
        Cari produk
      </Label>
      <Input
        id="product-search"
        type="search"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="Cari nama, SKU, atau barcode…"
      />
    </form>
  );
}