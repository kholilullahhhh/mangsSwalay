"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Search, X } from "lucide-react";

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

/**
 * Filters for the stock ledger.
 *
 * The query already supported product, type, date range and direction; none of it
 * was reachable except by hand-editing the URL. On the one screen whose stated
 * purpose is "explain why this product holds this quantity", being unable to ask
 * "what happened to SKU X" is the whole problem — hence the form.
 */
export function MovementFilters({
  initial,
  types,
  products,
}: {
  initial: {
    search: string;
    productId: string;
    type: string;
    dateFrom: string;
    dateTo: string;
    direction: string;
  };
  types: Array<{ value: string; label: string }>;
  products: Array<{ id: string; label: string }>;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [search, setSearch] = useState(initial.search);
  const [productId, setProductId] = useState(initial.productId);
  const [type, setType] = useState(initial.type);
  const [dateFrom, setDateFrom] = useState(initial.dateFrom);
  const [dateTo, setDateTo] = useState(initial.dateTo);
  const [direction, setDirection] = useState(initial.direction);

  function apply() {
    const params = new URLSearchParams();

    if (search.trim()) params.set("search", search.trim());
    if (productId) params.set("productId", productId);
    if (type) params.set("type", type);
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);
    if (direction) params.set("direction", direction);

    startTransition(() => {
      router.push(
        "/inventory/movements" +
          (params.toString() ? "?" + params.toString() : ""),
      );
    });
  }

  function reset() {
    setSearch("");
    setProductId("");
    setType("");
    setDateFrom("");
    setDateTo("");
    setDirection("");

    startTransition(() => {
      router.push("/inventory/movements");
    });
  }

  const activeCount = [
    initial.search,
    initial.productId,
    initial.type,
    initial.dateFrom,
    initial.dateTo,
    initial.direction,
  ].filter(Boolean).length;

  return (
    <form
      className="space-y-3 border-b p-4"
      onSubmit={(event) => {
        event.preventDefault();
        apply();
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1.5">
          <Label htmlFor="movement-search">Cari</Label>
          <Input
            id="movement-search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Nama atau SKU produk"
            className="h-9"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="movement-product">Produk</Label>
          <Select value={productId} onValueChange={setProductId}>
            <SelectTrigger id="movement-product" className="h-9">
              <SelectValue placeholder="Semua produk" />
            </SelectTrigger>
            <SelectContent>
              {products.map((product) => (
                <SelectItem key={product.id} value={product.id}>
                  {product.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="movement-type">Jenis</Label>
          <Select value={type} onValueChange={setType}>
            <SelectTrigger id="movement-type" className="h-9">
              <SelectValue placeholder="Semua jenis" />
            </SelectTrigger>
            <SelectContent>
              {types.map((entry) => (
                <SelectItem key={entry.value} value={entry.value}>
                  {entry.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="movement-direction">Arah</Label>
          <Select value={direction} onValueChange={setDirection}>
            <SelectTrigger id="movement-direction" className="h-9">
              <SelectValue placeholder="Masuk & keluar" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="IN">Barang masuk</SelectItem>
              <SelectItem value="OUT">Barang keluar</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="movement-from">Dari</Label>
          <Input
            id="movement-from"
            type="date"
            value={dateFrom}
            onChange={(event) => setDateFrom(event.target.value)}
            className="h-9"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="movement-to">Sampai</Label>
          <Input
            id="movement-to"
            type="date"
            value={dateTo}
            onChange={(event) => setDateTo(event.target.value)}
            className="h-9"
          />
        </div>

        <div className="flex items-end gap-2">
          <Button type="submit" size="sm" disabled={isPending}>
            {isPending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Search className="size-4" aria-hidden />
            )}
            Terapkan
          </Button>

          {activeCount > 0 ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={reset}
              disabled={isPending}
            >
              <X className="size-4" aria-hidden />
              Reset
            </Button>
          ) : null}
        </div>
      </div>
    </form>
  );
}