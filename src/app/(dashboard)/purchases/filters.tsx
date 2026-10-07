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

/**
 * Purchase list filters, held in the URL.
 *
 * URL state keeps the view shareable and survives a refresh, and the server
 * does the actual filtering — this component only issues navigation.
 */
export function PurchaseFilters({
  suppliers,
  current,
}: {
  suppliers: Array<{ id: string; name: string }>;
  current: {
    search?: string;
    supplierId?: string;
    status?: string;
    paymentStatus?: string;
    dateFrom?: string;
    dateTo?: string;
  };
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
    router.push(query ? `/purchases?${query}` : "/purchases");
  }

  const activeCount = [
    current.supplierId,
    current.status,
    current.paymentStatus,
    current.dateFrom,
    current.dateTo,
  ].filter(Boolean).length;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          push({ search: search || undefined });
        }}
        className="min-w-48 flex-1 sm:max-w-xs"
      >
        <Label htmlFor="purchase-search" className="sr-only">
          Cari pembelian
        </Label>
        <Input
          id="purchase-search"
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Cari nomor PO…"
        />
      </form>

      {/* Quick status tabs — the most common filter by far. */}
      <div className="flex flex-wrap gap-1">
        {STATUS_TABS.map((tab) => {
          const active = (current.status ?? "") === tab.value;

          return (
            <Button
              key={tab.value}
              size="sm"
              variant={active ? "secondary" : "ghost"}
              onClick={() =>
                push({ status: tab.value === "all" ? undefined : tab.value })
              }
              aria-pressed={active}
            >
              {tab.label}
            </Button>
          );
        })}
      </div>

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
            <Label>Supplier</Label>
            <Select
              value={current.supplierId ?? "all"}
              onValueChange={(value) =>
                push({ supplierId: value === "all" ? undefined : value })
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Semua supplier" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua supplier</SelectItem>
                {suppliers.map((supplier) => (
                  <SelectItem key={supplier.id} value={supplier.id}>
                    {supplier.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Status pembayaran</Label>
            <Select
              value={current.paymentStatus ?? "all"}
              onValueChange={(value) =>
                push({ paymentStatus: value === "all" ? undefined : value })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua</SelectItem>
                <SelectItem value="UNPAID">Belum bayar</SelectItem>
                <SelectItem value="PARTIAL">Sebagian</SelectItem>
                <SelectItem value="PAID">Lunas</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="date-from">Dari</Label>
              <Input
                id="date-from"
                type="date"
                value={current.dateFrom ?? ""}
                onChange={(event) =>
                  push({ dateFrom: event.target.value || undefined })
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="date-to">Sampai</Label>
              <Input
                id="date-to"
                type="date"
                value={current.dateTo ?? ""}
                onChange={(event) =>
                  push({ dateTo: event.target.value || undefined })
                }
              />
            </div>
          </div>

          {activeCount > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              className="w-full"
              onClick={() =>
                push({
                  supplierId: undefined,
                  status: undefined,
                  paymentStatus: undefined,
                  dateFrom: undefined,
                  dateTo: undefined,
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

const STATUS_TABS = [
  { value: "all", label: "Semua" },
  { value: "DRAFT", label: "Draft" },
  { value: "ORDERED", label: "Dipesan" },
  { value: "RECEIVED", label: "Diterima" },
  { value: "COMPLETED", label: "Selesai" },
  { value: "CANCELLED", label: "Dibatalkan" },
] as const;