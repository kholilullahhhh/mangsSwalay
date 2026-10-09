import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowRight,
  BadgePercent,
  Banknote,
  BarChart3,
  Boxes,
  ClipboardCheck,
  LayoutDashboard,
  Lock,
  Package,
  ScanBarcode,
  ShieldCheck,
  Truck,
  Users,
  Wallet,
} from "lucide-react";

import { getCurrentUser } from "@/lib/auth/session";
import { getStoreProfile } from "@/lib/queries/store-profile";
import { StaffEntry, StoreFacts } from "@/components/landing/store-facts";
import { HeroPreview } from "@/components/landing/hero-preview";
import { LandingNav } from "@/components/landing/landing-nav";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";

/**
 * Public storefront.
 *
 * Two audiences, one page. A visitor needs to know what the shop sells, where it
 * is, when it opens, and how to reach it. Staff need a door in. Everything here
 * serves one of those two, which is why there is no pricing table, no testimonial
 * wall, and no invented statistics — a minimarket has none of those things to
 * show, and fabricating them is the fastest way to make a real shop's website a
 * lie.
 *
 * The feature list is drawn from modules that exist in this repository today
 * (`components/dashboard/nav-config.ts` is the authority on what is actually
 * shipped and permission-gated). Nothing is claimed that a staff member cannot
 * open from the menu.
 *
 * Store facts come from `StoreSetting` via `getStoreProfile`, so editing the
 * settings screen updates this page with no deploy. A store that has entered
 * nothing renders a shorter page rather than a page of empty labels.
 */

export async function generateMetadata(): Promise<Metadata> {
  const store = await getStoreProfile();

  return {
    title: store.name + (store.tagline ? " — " + store.tagline : ""),
    description:
      store.about ||
      store.tagline ||
      "Katalog dan informasi toko " + store.name + ".",
  };
}

/** Sections, used for both the feature grid and the "how it works" flow. */
const FEATURES = [
  {
    icon: Package,
    title: "Produk dan Kategori",
    description:
      "Katalog lengkap dengan SKU, barcode, harga beli dan jual, satuan, dan stok minimum per item.",
  },
  {
    icon: Boxes,
    title: "Stok dan Batch",
    description:
      "Setiap perubahan stok tercatat sebagai pergerakan, dengan batch dan tanggal kedaluwarsa untuk barang yang punya masa simpan.",
  },
  {
    icon: ScanBarcode,
    title: "Kasir (POS)",
    description:
      "Pindai barcode atau cari produk, kelola keranjang, terapkan promo, dan terima pembayaran tunai maupun nontunai.",
  },
  {
    icon: Truck,
    title: "Pembelian dan Supplier",
    description:
      "Pesanan pembelian dari draft sampai diterima. Stok baru bertambah saat barang benar-benar diterima.",
  },
  {
    icon: ClipboardCheck,
    title: "Stock Opname",
    description:
      "Hitung fisik, bandingkan dengan sistem, dan selisihnya tercatat sebagai penyesuaian stok yang bisa ditelusuri.",
  },
  {
    icon: Users,
    title: "Pelanggan dan Loyalty",
    description:
      "Data pelanggan, member, dan poin yang bisa ditukar saat pembayaran.",
  },
  {
    icon: BadgePercent,
    title: "Promo",
    description:
      "Kode diskon dengan batas waktu, minimum belanja, dan kuota pemakaian yang terpantau.",
  },
  {
    icon: Wallet,
    title: "Shift Kasir",
    description:
      "Kas dihitung dari modal awal, penjualan tunai, refund, dan penyesuaian, lalu dibandingkan dengan uang aktual saat tutup.",
  },
  {
    icon: BarChart3,
    title: "Laporan",
    description:
      "Laporan penjualan, produk, stok, pembelian, dan profit — dengan filter rentang tanggal dan ekspor CSV.",
  },
  {
    icon: Banknote,
    title: "Pengeluaran dan Arus Kas",
    description:
      "Catat pengeluaran operasional dan pantau arus kas toko dalam satu tempat.",
  },
  {
    icon: ShieldCheck,
    title: "Hak Akses dan Audit Log",
    description:
      "Setiap peran melihat menu yang sesuai kewenangannya, dan aktivitas penting tersimpan di audit log.",
  },
  {
    icon: LayoutDashboard,
    title: "Dashboard Ringkas",
    description:
      "Ringkasan penjualan, produk terlaris, dan stok menipis untuk melihat kondisi toko hari ini.",
  },
] as const;

/**
 * The operational flow, in the order it actually happens in the system.
 *
 * Described from the implemented rules rather than an idealised one: stock only
 * rises when a purchase is RECEIVED, a cash sale requires an open shift, and
 * stock never goes negative.
 */
const FLOW = [
  {
    step: "01",
    title: "Stok masuk",
    description:
      "Pembelian dicatat dari draft, dikirim ke supplier, lalu barang diterima. Stok bertambah hanya di tahap diterima, bukan saat pesanan dibuat.",
  },
  {
    step: "02",
    title: "Kasir membuka shift",
    description:
      "Shift dibuka dengan uang modal awal yang dicatat. Semua penjualan tunai berikutnya terikat ke shift ini, sehingga uang di laci bisa direkonsiliasi saat tutup.",
  },
  {
    step: "03",
    title: "Penjualan diproses",
    description:
      "Produk dipindai atau dicari, dimasukkan ke keranjang, dan pembayaran dicatat. Harga dan promo selalu dihitung ulang dari database, jadi tidak bisa dimanipulasi dari layar kasir.",
  },
  {
    step: "04",
    title: "Stop dan retur",
    description:
      "Penjualan yang tidak bisa dibatalkan karena barang sudah keluar; retur mengembalikan stok dan dana sesuai kondisi barang.",
  },
  {
    step: "05",
    title: "Tutup shift",
    description:
      "Sistem menghitung berapa seharusnya ada di laci, lalu kasir menghitung fisik. Selisih lebih dari toleransi wajib dijelaskan dan tercatat.",
  },
  {
    step: "06",
    title: "Opname dan laporan",
    description:
      "Stock opname mengoreksi selisih fisik, dan laporan merangkum penjualan, pembelian, serta profit dari data yang sama.",
  },
] as const;

export default async function HomePage() {
  const user = await getCurrentUser();

  // Staff do not need a storefront; they need the till.
  if (user) {
    redirect("/dashboard");
  }

  const store = await getStoreProfile();

  // Real counts, and only because they are true. A store with nothing catalogued
  // says nothing rather than announcing a proud zero.
  const hasCatalogue = store.productCount > 0;

  // Only claim what the owner actually entered. Used to decide whether the
  // contact section is worth showing at all.
  const hasContact =
    Boolean(store.address) ||
    Boolean(store.phone) ||
    Boolean(store.whatsapp) ||
    Boolean(store.email);

  const year = new Date().getFullYear();

  return (
    <>
      <a
        href="#konten-utama"
        className="sr-only focus:not-sr-only focus:absolute focus:start-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-background focus:px-4 focus:py-2 focus:text-sm focus:shadow-lg"
      >
        Lewati ke konten utama
      </a>

      <LandingNav storeName={store.name} />

      <main id="konten-utama" className="flex-1">
        {/* ── Hero ────────────────────────────────────────────────────────
            Two columns from lg upward, stacked below it so the copy and the
            illustration both stay readable on a phone. */}
        <section className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6 sm:py-20 lg:py-24">
          <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-14">
            <div className="min-w-0">
              <p className="text-sm font-medium tracking-wide text-brand-700 dark:text-brand-400">
                Sistem Manajemen Toko Swalayan
              </p>

              <h1 className="mt-3 text-3xl font-semibold tracking-tight text-balance sm:text-4xl lg:text-5xl">
                {store.tagline || "Kebutuhan harian, lengkap dan dekat."}
              </h1>

              <p className="mt-4 max-w-prose text-base text-muted-foreground sm:text-lg">
                {store.about ||
                  "Kelola produk, stok, kasir, pembelian, dan laporan toko dari satu sistem yang berjalan sesuai alur kerja nyata."}
              </p>

              {hasCatalogue ? (
                <p className="mt-3 text-sm text-muted-foreground">
                  {store.categoryCount} kategori · {store.productCount} produk
                  tersedia
                </p>
              ) : null}

              <div className="mt-7 flex flex-wrap gap-3">
                <Button asChild size="lg">
                  <Link href="/login">
                    Login Staf
                    <ArrowRight className="size-4" aria-hidden />
                  </Link>
                </Button>

                <Button asChild size="lg" variant="outline">
                  <a href="#fitur">Lihat Fitur</a>
                </Button>
              </div>
            </div>

            <HeroPreview />
          </div>
        </section>

        {/* ── Tentang ──────────────────────────────────────────────────── */}
        <section
          id="tentang"
          aria-labelledby="tentang-heading"
          className="scroll-mt-20 border-y bg-muted/40"
        >
          <div className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6 sm:py-20">
            <div className="max-w-prose">
              <h2
                id="tentang-heading"
                className="text-2xl font-semibold tracking-tight sm:text-3xl"
              >
                Tentang sistem ini
              </h2>

              <p className="mt-4 text-muted-foreground">
                Halaman ini adalah sisi publik dari {store.name}. Pengunjung bisa
                melihat nama toko, alamat, jam buka, dan cara menghubungi — hal
                yang paling sering dicari sebelum datang ke lokasi.
              </p>

              <p className="mt-3 text-muted-foreground">
                Seluruh bagian di baliknya adalah area kerja staf. Kasir,
                operator stok, dan administrator masuk ke sistem yang sama untuk
                menjalankan transaksi, memperbarui inventori, dan membaca
                laporan. Setiap tindakan yang mengubah uang atau stok dicatat di
                audit log, sehingga jejaknya bisa ditelusuri kemudian.
              </p>
            </div>
          </div>
        </section>

        {/* ── Fitur ───────────────────────────────────────────────────────
            A plain grid rather than a card deck: each feature is an icon, a
            title, and one sentence, and a borderless list keeps the page from
            reading as a stack of interchangeable panels. */}
        <section
          id="fitur"
          aria-labelledby="fitur-heading"
          className="scroll-mt-20"
        >
          <div className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6 sm:py-20">
            <div className="max-w-prose">
              <h2
                id="fitur-heading"
                className="text-2xl font-semibold tracking-tight sm:text-3xl"
              >
                Fitur yang tersedia
              </h2>
              <p className="mt-3 text-muted-foreground">
                Semua modul di bawah ini sudah aktif dan bisa dibuka staf sesuai
                kewenangannya.
              </p>
            </div>

            <ul className="mt-10 grid gap-x-8 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map((feature) => (
                <li key={feature.title} className="flex gap-3">
                  <span
                    className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-300"
                    aria-hidden
                  >
                    <feature.icon className="size-4" />
                  </span>

                  <div className="min-w-0">
                    <h3 className="font-medium">{feature.title}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {feature.description}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* ── Cara kerja ───────────────────────────────────────────────── */}
        <section
          id="cara-kerja"
          aria-labelledby="cara-kerja-heading"
          className="scroll-mt-20 border-y bg-muted/40"
        >
          <div className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6 sm:py-20">
            <div className="max-w-prose">
              <h2
                id="cara-kerja-heading"
                className="text-2xl font-semibold tracking-tight sm:text-3xl"
              >
                Cara kerjanya
              </h2>
              <p className="mt-3 text-muted-foreground">
                Alur yang benar-benar dijalankan sistem, dari barang datang
                sampai laporan.
              </p>
            </div>

            {/* Ordered list: the sequence is the meaning, and a screen reader
                announcing "3 of 6" is more useful here than six equal items. */}
            <ol className="mt-10 grid gap-x-8 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
              {FLOW.map((item) => (
                <li key={item.step}>
                  <span
                    className="text-xs font-semibold tabular text-brand-700 dark:text-brand-400"
                    aria-hidden
                  >
                    {item.step}
                  </span>
                  <h3 className="mt-1.5 font-medium">{item.title}</h3>
                  <p className="mt-1.5 text-sm text-muted-foreground">
                    {item.description}
                  </p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* ── Informasi toko ───────────────────────────────────────────── */}
        <section
          id="informasi"
          aria-labelledby="informasi-heading"
          className="scroll-mt-20"
        >
          <div className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6 sm:py-20">
            <div className="max-w-prose">
              <h2
                id="informasi-heading"
                className="text-2xl font-semibold tracking-tight sm:text-3xl"
              >
                Informasi toko
              </h2>
            </div>

            {/* Rendered even when empty: StoreFacts hides every field the owner
                has not filled in, so an unconfigured store gets a short strip
                instead of a row of blanks. */}
            <div className="mt-8 max-w-prose">
              <StoreFacts
                address={store.address}
                hours={store.hours}
                phone={store.phone}
                whatsapp={store.whatsapp}
                email={store.email}
              />
            </div>

            {!hasContact && !store.hours ? (
              <p className="mt-6 max-w-prose text-sm text-muted-foreground">
                Informasi toko belum dilengkapi. Hubungi staf toko untuk
                mengetahui lokasi dan jam operasional.
              </p>
            ) : null}
          </div>
        </section>

        {/* ── Akses staf ───────────────────────────────────────────────── */}
        <section
          aria-labelledby="akses-heading"
          className="border-t bg-muted/40"
        >
          <div className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6 sm:py-20">
            <div className="max-w-prose">
              <h2
                id="akses-heading"
                className="text-2xl font-semibold tracking-tight sm:text-3xl"
              >
                Akses staf
              </h2>
              <p className="mt-3 text-muted-foreground">
                Halaman ini hanya untuk pengunjung. Staf masuk melalui halaman
                login dan memakai akun yang diberikan administrator toko.
              </p>
            </div>

            <div className="mt-8">
              <StaffEntry storeName={store.name} />
            </div>
          </div>
        </section>
      </main>

      {/* ── Footer ─────────────────────────────────────────────────────── */}
      <footer className="border-t">
        <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6">
          <div className="flex flex-col gap-8 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 max-w-sm">
              <p className="font-semibold tracking-tight">{store.name}</p>
              {store.tagline ? (
                <p className="mt-1 text-sm text-muted-foreground">
                  {store.tagline}
                </p>
              ) : null}
              {/* Only contact details that exist are rendered. */}
              {store.address ? (
                <p className="mt-3 text-sm text-muted-foreground">
                  {store.address}
                </p>
              ) : null}
              {store.hours ? (
                <p className="text-sm text-muted-foreground">
                  Jam buka {store.hours}
                </p>
              ) : null}
            </div>

            <nav aria-label="Navigasi footer" className="min-w-0">
              <h2 className="text-sm font-medium">Halaman</h2>
              <ul className="mt-3 grid gap-2 text-sm sm:grid-cols-2 sm:gap-x-8">
                {[
                  { href: "#tentang", label: "Tentang" },
                  { href: "#fitur", label: "Fitur" },
                  { href: "#cara-kerja", label: "Cara Kerja" },
                  { href: "#informasi", label: "Informasi Toko" },
                ].map((item) => (
                  <li key={item.href}>
                    <a
                      href={item.href}
                      className="rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {item.label}
                    </a>
                  </li>
                ))}
                <li>
                  <Link
                    href="/login"
                    className="rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    Login Staf
                  </Link>
                </li>
              </ul>
            </nav>

            <div className="shrink-0">
              <h2 className="text-sm font-medium">Tema</h2>
              <p className="mt-3 text-sm text-muted-foreground">
                Mode terang dan gelap mengikuti pengaturan sistem.
              </p>
              <div className="mt-2">
                <ThemeToggle />
              </div>
            </div>
          </div>

          <div className="mt-8 flex flex-wrap items-center gap-x-4 gap-y-2 border-t pt-6">
            <p className="text-xs text-muted-foreground">
              © {year} {store.name}
            </p>
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              <Lock className="size-3" aria-hidden />
              Akses hanya untuk staf terdaftar.
            </p>
          </div>
        </div>
      </footer>
    </>
  );
}
