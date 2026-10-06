"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { Bell, LogOut, Moon, Search, Sun } from "lucide-react";

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
import { ROLE_LABELS, type RoleName } from "@/lib/rbac";

import { NAV_GROUPS, findNavItem } from "./nav-config";

export interface DashboardTopbarProps {
  user: { name: string; role: RoleName; username: string };
  unreadCount: number;
  openShift: { number: string; openedAt: Date } | null;
}

const ALL_SEARCHABLE = NAV_GROUPS.flatMap((group) => group.items).filter(
  (item) => item.href !== "/dashboard",
);

/** Cmd/Ctrl+K opens the menu search, matching common admin-tool muscle memory. */
function useCommandK(onOpen: () => void) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        onOpen();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onOpen]);
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
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b bg-background/95 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/80 md:px-5">
      <SidebarTrigger className="-ml-1" />

      <div className="min-w-0 flex-1">
        <h1 className="truncate text-sm font-semibold tracking-tight md:text-base">
          {activeItem?.title ?? "Dashboard"}
        </h1>
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
          <QuickSearch onNavigate={() => setSearchOpen(false)} />
        </PopoverContent>
      </Popover>
    </header>
  );
}

/**
 * Menu search. Filters navigation entries client side and routes to a page,
 * where real search happens with server-side database filtering.
 */
function QuickSearch({ onNavigate }: { onNavigate: () => void }) {
  const [query, setQuery] = useState("");
  const router = useRouter();

  const trimmed = query.trim().toLowerCase();
  const results = trimmed
    ? ALL_SEARCHABLE.filter((entry) =>
        entry.title.toLowerCase().includes(trimmed),
      ).slice(0, 8)
    : ALL_SEARCHABLE.slice(0, 8);

  return (
    <div className="flex flex-col">
      <div className="border-b p-2">
        <Input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Cari halaman atau fitur…"
          className="border-0 focus-visible:ring-0"
        />
      </div>

      <div className="max-h-72 overflow-y-auto p-1">
        {results.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">
            Tidak ada hasil untuk &quot;{query.trim()}&quot;.
          </p>
        ) : (
          results.map((entry) => (
            <button
              key={entry.href}
              type="button"
              onClick={() => {
                router.push(entry.href);
                onNavigate();
              }}
              className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground"
            >
              <entry.icon
                className="size-4 shrink-0 text-muted-foreground"
                aria-hidden
              />
              <span className="truncate">{entry.title}</span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

/**
 * Theme toggle.
 *
 * Both icons are always rendered and swapped with CSS (`dark:` variants), so the
 * correct one is visible on the very first paint. Reading `resolvedTheme` into
 * state would instead require a mount-then-correct render, which causes a
 * hydration mismatch or a cascading re-render — hence the CSS approach.
 */
function ThemeToggle() {
  const { setTheme } = useTheme();

  function toggleTheme() {
    // next-themes reads the current value from the DOM class it owns, so this
    // flips the active theme without needing it in React state.
    const isDark =
      typeof document !== "undefined" &&
      document.documentElement.classList.contains("dark");

    setTheme(isDark ? "light" : "dark");
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleTheme}
          aria-label="Ganti tema terang dan gelap"
        >
          <Sun
            className="hidden size-4 dark:block"
            aria-hidden
          />
          <Moon
            className="size-4 dark:hidden"
            aria-hidden
          />
        </Button>
      </TooltipTrigger>
      <TooltipContent>Ganti tema</TooltipContent>
    </Tooltip>
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

        <DropdownMenuItem asChild>
          <Link href="/settings">Pengaturan</Link>
        </DropdownMenuItem>

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