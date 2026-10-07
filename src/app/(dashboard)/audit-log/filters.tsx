"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { X } from "lucide-react";

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
 * Audit log filters.
 *
 * Filters live in the URL so the server does the work and a filtered view is
 * shareable or bookmarkable. Changing a filter resets to page 1: staying on page
 * 7 of a result set that now has one page would show an empty table with no
 * explanation.
 */
export function AuditFilters({
  actions,
  users,
  current,
}: {
  actions: string[];
  users: Array<{ id: string; name: string; username: string; role: string }>;
  current: {
    action?: string;
    userId?: string;
    search?: string;
    dateFrom?: string;
    dateTo?: string;
  };
}) {
  const router = useRouter();
  const existing = useSearchParams();
  const [search, setSearch] = useState(current.search ?? "");

  function push(changes: Record<string, string | undefined>) {
    const params = new URLSearchParams(existing.toString());

    for (const [key, value] of Object.entries(changes)) {
      if (value === undefined || value === "") {
        params.delete(key);
      } else {
        params.set(key, value);
      }
    }

    params.delete("page");

    const query = params.toString();
    router.push(query ? "/audit-log?" + query : "/audit-log");
  }

  function clearAll() {
    setSearch("");
    router.push("/audit-log");
  }

  const activeCount = [
    current.action,
    current.userId,
    current.dateFrom,
    current.dateTo,
    current.search,
  ].filter(Boolean).length;

  return (
    <div className="space-y-3 rounded-lg border p-3">
      <div className="flex flex-wrap items-end gap-3">
        <form
          className="flex flex-1 items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            push({ search: search || undefined });
          }}
        >
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="audit-search">Cari</Label>
            <Input
              id="audit-search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Aksi, entitas, atau ID…"
            />
          </div>

          <Button type="submit" variant="secondary">
            Cari
          </Button>
        </form>

        <div className="space-y-1.5">
          <Label htmlFor="audit-action">Aksi</Label>
          <Select
            value={current.action ?? "all"}
            onValueChange={(value) =>
              push({ action: value === "all" ? undefined : value })
            }
          >
            <SelectTrigger id="audit-action" className="w-56">
              <SelectValue placeholder="Semua aksi" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua aksi</SelectItem>
              {actions.map((action) => (
                <SelectItem key={action} value={action}>
                  {action}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="audit-user">Pengguna</Label>
          <Select
            value={current.userId ?? "all"}
            onValueChange={(value) =>
              push({ userId: value === "all" ? undefined : value })
            }
          >
            <SelectTrigger id="audit-user" className="w-52">
              <SelectValue placeholder="Semua pengguna" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua pengguna</SelectItem>
              {users.map((user) => (
                <SelectItem key={user.id} value={user.id}>
                  {user.name} ({user.username})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="audit-from">Dari tanggal</Label>
          <Input
            id="audit-from"
            type="date"
            value={current.dateFrom ?? ""}
            onChange={(event) =>
              push({ dateFrom: event.target.value || undefined })
            }
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="audit-to">Sampai tanggal</Label>
          <Input
            id="audit-to"
            type="date"
            value={current.dateTo ?? ""}
            onChange={(event) =>
              push({ dateTo: event.target.value || undefined })
            }
          />
        </div>

        <Button
          variant="ghost"
          size="sm"
          onClick={clearAll}
          disabled={activeCount === 0}
          className="ml-auto"
        >
          <X className="size-4" aria-hidden />
          Bersihkan filter
          {activeCount > 0 ? (
            <span className="ml-1 rounded bg-muted px-1 text-[10px]">
              {activeCount}
            </span>
          ) : null}
        </Button>
      </div>
    </div>
  );
}