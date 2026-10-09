import type { Metadata } from "next";
import { Store } from "lucide-react";

import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Masuk",
  description: "Masuk ke sistem manajemen Swalayaku.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string | string[] }>;
}) {
  const params = await searchParams;
  const rawFrom = params.from;

  const from =
    typeof rawFrom === "string" && rawFrom.startsWith("/") && !rawFrom.startsWith("//")
      ? rawFrom
      : undefined;

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-br from-background to-muted/30">
      <header className="flex items-center gap-3 border-b bg-card px-6 py-4 shadow-sm">
        <div className="flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Store className="size-5" aria-hidden />
        </div>
        <div>
          <h1 className="text-lg font-bold tracking-tight">Swalayaku</h1>
          <p className="text-xs text-muted-foreground">Sistem Manajemen Minimarket</p>
        </div>
      </header>

      <main className="flex flex-1 items-center justify-center p-4">
        <div className="w-full max-w-6xl">
          <div className="grid gap-8 lg:grid-cols-2 lg:items-center">
            <div className="hidden space-y-6 lg:block">
              <div className="space-y-2">
                <h2 className="text-3xl font-bold tracking-tight">
                  Selamat datang kembali
                </h2>
                <p className="text-muted-foreground">
                  Kelola toko Anda dengan mudah — penjualan, stok, pembelian, dan laporan dalam satu sistem.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="rounded-lg border bg-card p-4">
                  <p className="text-2xl font-bold text-primary">POS</p>
                  <p className="text-sm text-muted-foreground">Kasir & transaksi</p>
                </div>
                <div className="rounded-lg border bg-card p-4">
                  <p className="text-2xl font-bold text-primary">Stok</p>
                  <p className="text-sm text-muted-foreground">Inventori & opname</p>
                </div>
                <div className="rounded-lg border bg-card p-4">
                  <p className="text-2xl font-bold text-primary">Laporan</p>
                  <p className="text-sm text-muted-foreground">Penjualan & profit</p>
                </div>
                <div className="rounded-lg border bg-card p-4">
                  <p className="text-2xl font-bold text-primary">Pembelian</p>
                  <p className="text-sm text-muted-foreground">PO & supplier</p>
                </div>
              </div>
            </div>

            <div className="w-full">
              <div className="mx-auto w-full max-w-md rounded-xl border bg-card p-6 shadow-lg sm:p-8">
                <div className="mb-6 space-y-1 text-center">
                  <h3 className="text-xl font-semibold">Masuk</h3>
                  <p className="text-sm text-muted-foreground">
                    Gunakan akun staff yang terdaftar untuk mengakses sistem.
                  </p>
                </div>
                <LoginForm from={from} />
              </div>
            </div>
          </div>
        </div>
      </main>

      <footer className="border-t bg-card px-6 py-3 text-center text-xs text-muted-foreground">
        Swalayaku POS &copy; {new Date().getFullYear()}
      </footer>
    </div>
  );
}
