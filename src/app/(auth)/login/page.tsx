import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ShieldCheck, ShoppingBasket, Sparkles } from "lucide-react";

import { Card } from "@/components/ui/card";
import { ThemeToggle } from "@/components/theme-toggle";

import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Masuk",
  description: "Masuk ke sistem manajemen Swalayaku.",
};

const HIGHLIGHTS = [
  "Pengelolaan produk dan persediaan",
  "Pencatatan transaksi penjualan",
  "Pemantauan aktivitas operasional",
];

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string | string[] }>;
}) {
  const params = await searchParams;
  const rawFrom = params.from;

  // Only accept same-origin relative paths, so `?from=` cannot be used to build
  // an open redirect to an external host.
  const from =
    typeof rawFrom === "string" && rawFrom.startsWith("/") && !rawFrom.startsWith("//")
      ? rawFrom
      : undefined;

  return (
    // `min-h-dvh` rather than `min-h-screen`: mobile browser chrome makes
    // `100vh` taller than the visible area, which pushes the card's footer
    // below the fold.
    <main className="flex min-h-dvh w-full items-center justify-center bg-muted/40 lg:items-stretch">
      {/* One card, whole viewport: rounded and inset on small screens, edge to
          edge from lg up. `min-h-dvh` and not a fixed height because `Card` is
          `overflow-hidden` — a short laptop would clip the form instead of
          letting the card grow. */}
      <Card className="w-full max-w-md gap-0 rounded-none border-0 py-6 shadow-lg ring-1 ring-foreground/10 sm:rounded-2xl lg:min-h-dvh lg:max-w-none lg:rounded-none lg:py-0 lg:shadow-none lg:ring-0">
        {/* `flex-1` so the grid inherits the card's `min-h-dvh`; without it the
            card is taller than its content and the columns leave dead space. */}
        <div className="grid flex-1 lg:grid-cols-[1.05fr_1fr] lg:items-stretch">
          {/* Branding panel — desktop only. Padding and type scale step up with
              the viewport; the marketing copy drops out on short viewports so
              it can never push the layout taller than the screen. */}
          <aside className="relative hidden overflow-hidden bg-primary text-primary-foreground lg:flex lg:flex-col lg:justify-between lg:p-8 xl:p-12 2xl:p-16">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 overflow-hidden"
            >
              <div className="absolute -right-32 -top-24 size-96 rounded-full border border-primary-foreground/10" />
              <div className="absolute -right-20 -top-12 size-72 rounded-full border border-primary-foreground/10" />
              <div className="absolute -bottom-40 -left-24 size-[28rem] rounded-full bg-primary-foreground/5 blur-3xl" />
            </div>

            <Link
              href="/"
              className="relative flex w-fit shrink-0 items-center gap-3 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-foreground"
            >
              <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary-foreground/15 ring-1 ring-primary-foreground/20">
                <ShoppingBasket className="size-6" aria-hidden />
              </span>
              <span className="text-lg font-bold tracking-tight">SwalayanKu</span>
            </Link>

            <div className="relative max-w-xl py-8 xl:py-12">
              <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-primary-foreground/20 bg-primary-foreground/10 px-3 py-1.5 text-sm">
                <Sparkles className="size-4 shrink-0" aria-hidden />
                Sistem manajemen swalayan
              </div>

              <h1 className="text-4xl font-bold leading-tight tracking-tight xl:text-5xl">
                Operasional lebih teratur,
                <span className="block text-primary-foreground/70">
                  bisnis lebih terkendali.
                </span>
              </h1>

              <div className="[@media(max-height:820px)]:hidden">
                <p className="mt-6 max-w-md text-base leading-7 text-primary-foreground/75">
                  Kelola produk, persediaan, transaksi penjualan, dan laporan
                  operasional melalui satu sistem yang terintegrasi.
                </p>

                <ul className="mt-10 space-y-4">
                  {HIGHLIGHTS.map((item) => (
                    <li key={item} className="flex items-center gap-3 text-sm">
                      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary-foreground/15">
                        <ShieldCheck className="size-4 shrink-0" aria-hidden />
                      </span>
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <p className="relative shrink-0 text-sm text-primary-foreground/60">
              Akses sistem secara aman sesuai dengan hak akses akun kamu.
            </p>
          </aside>

          {/* Sign-in column. The blocks are capped at `max-w-md` and centred so
              the form does not stretch across a half-width column on wide
              monitors. */}
          <section className="flex flex-col justify-between gap-8 px-6 py-8 sm:gap-10 sm:px-10 lg:px-12 lg:py-12 xl:px-16">
            <header className="mx-auto flex w-full max-w-md items-center gap-2">
              <Link
                href="/"
                className="inline-flex min-w-0 items-center gap-2 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:hidden"
              >
                <ShoppingBasket className="size-5 shrink-0 text-primary" aria-hidden />
                <span className="truncate font-semibold">SwalayanKu</span>
              </Link>

              <Link
                href="/"
                aria-label="Kembali ke beranda"
                className="ml-auto inline-flex min-w-0 items-center gap-2 rounded-md text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <ArrowLeft className="size-4 shrink-0" aria-hidden />
                {/* Icon-only on the narrowest phones: logo + label + toggle no
                    longer fit on one row at 320px. */}
                <span className="hidden truncate sm:inline">Kembali ke beranda</span>
              </Link>

              {/* Pre-sign-in screen, so it needs its own theme control rather
                  than the dashboard topbar the user has not reached yet. */}
              <span className="shrink-0">
                <ThemeToggle />
              </span>
            </header>

            <div className="mx-auto w-full max-w-md">
              <p className="mb-3 hidden text-sm font-medium text-primary lg:block">
                Selamat datang kembali
              </p>
              <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
                Masuk ke akun
              </h2>
              <p className="mt-3 text-sm leading-6 text-muted-foreground sm:text-base">
                Masukkan username atau email dan password untuk melanjutkan ke
                sistem operasional.
              </p>

              <div className="mt-6 sm:mt-8">
                <LoginForm from={from} />
              </div>
            </div>

            <footer className="mx-auto flex w-full max-w-md flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <p>© {new Date().getFullYear()} SwalayanKu.</p>
              <p>Akses hanya untuk staff terdaftar.</p>
            </footer>
          </section>
        </div>
      </Card>
    </main>
  );
}
