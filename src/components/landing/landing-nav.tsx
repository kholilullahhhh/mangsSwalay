"use client";

import Link from "next/link";
import { useState } from "react";
import { Menu, Store } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

/**
 * Landing page header.
 *
 * Client-side only because the mobile menu needs open state. It receives plain
 * strings — the store name and the section list are decided in the Server
 * Component — so the only JavaScript shipped for the header is this toggle.
 *
 * The menu is a Radix `Sheet` rather than a bespoke drawer because it already
 * handles the parts that are easy to get wrong by hand: focus trapping, Escape to
 * close, `aria-modal` semantics, scroll locking, and restoring focus to the
 * trigger. A visitor who tabs through the page should never be able to tab into
 * the page *behind* an open menu.
 */

const SECTIONS = [
  { href: "#tentang", label: "Tentang" },
  { href: "#fitur", label: "Fitur" },
  { href: "#cara-kerja", label: "Cara Kerja" },
  { href: "#informasi", label: "Informasi Toko" },
] as const;

export function LandingNav({ storeName }: { storeName: string }) {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur-sm">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-4 px-4 sm:px-6">
        {/* The wordmark links home rather than being inert text: it is the one
            element a returning visitor aims for. */}
        <Link
          href="/"
          className="flex min-w-0 items-center gap-2 rounded-md font-semibold tracking-tight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span
            className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-600 text-white"
            aria-hidden
          >
            <Store className="size-4" />
          </span>
          <span className="truncate">{storeName}</span>
        </Link>

        {/* Desktop navigation. Hidden below md, where the Sheet menu takes over —
            two menus both in the tab order would double the stops for no reason. */}
        <nav aria-label="Navigasi utama" className="hidden md:flex md:items-center">
          <ul className="flex items-center gap-1">
            {SECTIONS.map((section) => (
              <li key={section.href}>
                <a
                  href={section.href}
                  className="inline-flex h-9 items-center rounded-md px-3 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {section.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="ms-auto flex items-center gap-2">
          {/* The sign-in link points at the real login route; no auth is
              duplicated or handled here. */}
          <Button asChild size="sm" className="hidden sm:inline-flex">
            <Link href="/login">Login Staf</Link>
          </Button>

          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                className="md:hidden"
                aria-label="Buka menu navigasi"
              >
                <Menu className="size-4" aria-hidden />
              </Button>
            </SheetTrigger>

            <SheetContent side="right" className="w-72">
              <SheetHeader>
                <SheetTitle className="text-base">Menu</SheetTitle>
              </SheetHeader>

              <nav aria-label="Navigasi seluler" className="px-4 pb-4">
                <ul className="flex flex-col gap-1">
                  {SECTIONS.map((section) => (
                    <li key={section.href}>
                      {/* SheetClose asChild so selecting a section also closes the
                          overlay — otherwise the visitor is dropped at an anchor
                          behind a still-open drawer. */}
                      <SheetClose asChild>
                        <a
                          href={section.href}
                          className="flex h-11 items-center rounded-md px-3 text-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {section.label}
                        </a>
                      </SheetClose>
                    </li>
                  ))}
                </ul>

                <SheetClose asChild>
                  <Button asChild className="mt-4 w-full">
                    <Link href="/login">Login Staf</Link>
                  </Button>
                </SheetClose>
              </nav>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}
