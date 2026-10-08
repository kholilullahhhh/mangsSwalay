"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Bell, LogOut, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { ROLE_LABELS, roleHasPermission, type RoleName } from "@/lib/rbac";

import { getNavGroupsForRole, NAV_ICONS, findNavItem } from "./nav-config";
import { ThemeToggle } from "@/components/theme-toggle";

export interface DashboardTopbarProps {
  user: { name: string; role: RoleName; username: string };
  unreadCount: number;
  openShift: { number: string; openedAt: Date } | null;
}

/**
 * Search index built from the role's own navigation.
 *
 * Using the full list meant a cashier searching for the audit log was offered
 * `/audit-log` and `/settings`, which their role cannot open — so the search led
 * straight to a 403. The server enforces it either way; this just stops offering
 * the destination.
 */
function searchableFor(role: RoleName) {
  return getNavGroupsForRole(role)
    .flatMap((group) => group.items)
    .filter((item) => item.href !== "/dashboard");
}

/** Cmd/Ctrl+K opens the menu search, matching common admin-tool muscle memory. */
function useCommandK(onOpen: () => void) {
  // Held in a ref so the listener is attached once rather than torn down and
  // re-added on every render of the topbar — the most-mounted component here.
  const handler = useRef(onOpen);

  useEffect(() => {
    handler.current = onOpen;
  }, [onOpen]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        handler.current();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}

export function DashboardTopbar({
  user,
  unreadCount,
  openShift,
}: DashboardTopbarProps) {
  const pathname = usePathname();
  const activeItem = findNavItem(pathname);
  const [searchOpen, setSearchOpen] = useState(false);

  useCommandK(() => setSearchOpen(true));

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-1.5 border-b bg-background/95 px-2 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:gap-2 sm:px-3 md:px-5">
      <SidebarTrigger className="-ml-1" />

      <div className="min-w-0 flex-1">
        {/* Not an <h1>: every page renders its own and the shell renders inside
            the layout, so an <h1> here gave each dashboard page two of them.
            A screen reader announces a document by its first heading. */}
        <p
          aria-hidden
          className="truncate text-sm font-semibold tracking-tight md:text-base"
        >
          {activeItem?.title ?? "Dashboard"}
        </p>
        {openShift ? (
          <p className="hidden text-xs text-muted-foreground sm:block">
            Shift terbuka: {openShift.number}
          </p>
        ) : null}
      </div>

      {/* Desktop: search trigger. Mobile: icon-only, since space is scarce. */}
      <Button
        variant="outline"
        size="sm"
        onClick={() => setSearchOpen(true)}
        className="hidden gap-2 text-muted-foreground md:inline-flex"
      >
        <Search className="size-4" aria-hidden />
        <span>Cari…</span>
        <kbd className="pointer-events-none hidden rounded border bg-muted px-1.5 font-mono text-[10px] lg:inline-block">
          Ctrl K
        </kbd>
      </Button>

      <Button
        variant="outline"
        size="icon"
        onClick={() => setSearchOpen(true)}
        className="md:hidden"
        aria-label="Cari menu"
      >
        <Search className="size-4" aria-hidden />
      </Button>

      <ThemeToggle />

      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon" asChild className="relative">
            <Link
              href="/notifications"
              aria-label={
                unreadCount > 0
                  ? `Notifikasi, ${unreadCount} belum dibaca`
                  : "Notifikasi"
              }
            >
              <Bell className="size-4" aria-hidden />
              {unreadCount > 0 ? (
                <span className="absolute right-1 top-1 flex size-4 items-center justify-center rounded-full bg-destructive text-[10px] font-medium text-destructive-foreground">
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              ) : null}
            </Link>
          </Button>
        </TooltipTrigger>
        <TooltipContent>Notifikasi</TooltipContent>
      </Tooltip>

      <UserMenu
        name={user.name}
        role={user.role}
        username={user.username}
      />

      <Popover open={searchOpen} onOpenChange={setSearchOpen}>
        <PopoverTrigger asChild>
          <span className="hidden" />
        </PopoverTrigger>
        <PopoverContent
          className="w-[min(92vw,28rem)] p-0"
          align="end"
          sideOffset={8}
        >
          <QuickSearch
            role={user.role}
            onNavigate={() => setSearchOpen(false)}
          />
        </PopoverContent>
      </Popover>
    </header>
  );
}

/**
 * Menu search. Filters navigation entries client side and routes to a page,
 * where real search happens with server-side database filtering.
 */
function QuickSearch({
  role,
  onNavigate,
}: {
  role: RoleName;
  onNavigate: () => void;
}) {
  const [query, setQuery] = useState("");
  const router = useRouter();

  const trimmed = query.trim().toLowerCase();
  const searchable = searchableFor(role);

  const results = trimmed
    ? searchable
        .filter((entry) => entry.title.toLowerCase().includes(trimmed))
        .slice(0, 8)
    : searchable.slice(0, 8);

  return (
    <div className="flex flex-col">
      <div className="border-b p-2">
        <Input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Cari halaman atau fitur…"
          className="border-0 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        />
      </div>

      <div className="max-h-72 overflow-y-auto p-1">
        {results.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">
            Tidak ada hasil untuk &quot;{query.trim()}&quot;.
          </p>
        ) : (
          results.map((entry) => {
            const Icon = NAV_ICONS[entry.icon];

            return (
              <button
                key={entry.href}
                type="button"
                onClick={() => {
                  router.push(entry.href);
                  onNavigate();
                }}
                className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground"
              >
                <Icon
                  className="size-4 shrink-0 text-muted-foreground"
                  aria-hidden
                />
                <span className="truncate">{entry.title}</span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

function UserMenu({
  name,
  role,
  username,
}: {
  name: string;
  role: RoleName;
  username: string;
}) {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);

  async function handleLogout() {
    setIsPending(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      router.push("/login");
      router.refresh();
    } finally {
      setIsPending(false);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="h-9 gap-2 px-2" aria-label="Menu akun">
          <span
            className="flex size-7 items-center justify-center rounded-full bg-brand-600 text-xs font-medium text-white"
            aria-hidden
          >
            {name.slice(0, 1).toUpperCase()}
          </span>
          <span className="hidden max-w-32 truncate text-sm md:inline">{name}</span>
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="font-normal">
          <p className="text-sm font-medium">{name}</p>
          <p className="text-xs text-muted-foreground">@{username}</p>
        </DropdownMenuLabel>

        <div className="px-2 pb-2">
          <Badge variant="secondary">{ROLE_LABELS[role]}</Badge>
        </div>

        <Separator />

        <DropdownMenuItem asChild>
          <Link href="/dashboard">Dashboard</Link>
        </DropdownMenuItem>

        {/* Gated on the same permission the page enforces, so the menu never offers a
            destination that answers 403 for this role. */}
        {roleHasPermission(role, "settings:view") ? (
          <DropdownMenuItem asChild>
            <Link href="/settings">Pengaturan</Link>
          </DropdownMenuItem>
        ) : null}

        <Separator />

        <DropdownMenuItem
          variant="destructive"
          disabled={isPending}
          onSelect={(event) => {
            // Keep the menu open so the pending state is visible while the
            // logout request and redirect are in flight.
            event.preventDefault();
            void handleLogout();
          }}
        >
          <LogOut className="size-4" aria-hidden />
          Keluar
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}