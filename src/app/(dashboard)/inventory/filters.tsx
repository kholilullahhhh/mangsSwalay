"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
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
import { Badge } from "@/components/ui/badge";

/**
 * Stock list filters, held in the URL so the server does the filtering.
 *
 * The low-stock and out-of-stock shortcuts are buttons rather than hidden
 * selects because they are the two views an operator opens daily, and each
 * carries its own count so the reason for opening them is visible.
 */
export function StockFilters({
  categories,
  current,
  lowStockCount,
  outOfStockCount,
}: {
  categories: Array<{ id: string; name: string }>;
  current: {
    search?: string;
    categoryId?: string;
    stock?: string;
    hasExpiry?: string;
  };
  lowStockCount: number;
  outOfStockCount: number;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [search, setSearch] = useState(current.search ?? "");

  function push(changes: Record<string, string | undefined>) {
    const params = new URLSearchParams(searchParams.toString());

    for (const [key, value] of Object.entries(changes)) {
      if (value === undefined || value === "") {
        params.delete(key);
      } else {
        params.set(key, value);
      }
    }

    params.delete("page");

    const query = params.toString();
    router.push(query ? "/inventory?" + query : "/inventory");
  }

  const activeCount = [current.categoryId, current.hasExpiry].filter(
    Boolean,
  ).length;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          push({ search: search || undefined });
        }}
        className="min-w-48 flex-1 sm:max-w-xs"
      >
        <Label htmlFor="stock-search" className="sr-only">
          Cari produk
        </Label>
        <Input
          id="stock-search"
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Cari nama atau SKU..."
        />
      </form>

      <Button
        size="sm"
        variant={current.stock === "low" ? "secondary" : "outline"}
        onClick={() =>
          push({ stock: current.stock === "low" ? undefined : "low" })
        }
        aria-pressed={current.stock === "low"}
      >
        Perlu restock
        {lowStockCount > 0 ? (
          <Badge variant="outline" className="ml-1 border-stock-low/40 text-stock-low">
            {lowStockCount}
          </Badge>
        ) : null}
      </Button>

      <Button
        size="sm"
        variant={current.stock === "out" ? "secondary" : "outline"}
        onClick={() =>
          push({ stock: current.stock === "out" ? undefined : "out" })
        }
        aria-pressed={current.stock === "out"}
      >
        Stok habis
        {outOfStockCount > 0 ? (
          <Badge variant="outline" className="ml-1 border-stock-out/40 text-stock-out">
            {outOfStockCount}
          </Badge>
        ) : null}
      </Button>

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

        <PopoverContent align="end" className="w-64 space-y-4">
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
            <Label>Kedaluwarsa</Label>
            <Select
              value={current.hasExpiry ?? "all"}
              onValueChange={(value) =>
                push({ hasExpiry: value === "all" ? undefined : value })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua produk</SelectItem>
                <SelectItem value="true">Memiliki batch</SelectItem>
                <SelectItem value="false">Tanpa batch</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {current.stock || activeCount > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              className="w-full"
              onClick={() =>
                push({
                  stock: undefined,
                  categoryId: undefined,
                  hasExpiry: undefined,
                })
              }
            >
              <X className="size-4" aria-hidden />
              Hapus semua filter
            </Button>
          ) : null}
        </PopoverContent>
      </Popover>
    </div>
  );
}
