"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Lock, RefreshCw, WifiOff } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Error boundary for every dashboard page.
 *
 * A permission denial is not a server fault, so `AuthorizationError` renders as
 * an explicit "no access" page instead of surfacing as a 500. That distinction
 * matters in practice: a 403 in the logs is routine, while a 500 would train
 * staff to ignore the error page as if the app were simply broken.
 */
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string; code?: string };
  reset: () => void;
}) {
  useEffect(() => {
    if (error.code !== "FORBIDDEN") {
      console.error("[dashboard]", error);
    }
  }, [error]);

  const forbidden = error.code === "FORBIDDEN";

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-4 text-center">
      <span
        className={
          forbidden
            ? "flex size-12 items-center justify-center rounded-full bg-stock-low/15 text-stock-low"
            : "flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive"
        }
        aria-hidden
      >
        {forbidden ? <Lock className="size-6" /> : <WifiOff className="size-6" />}
      </span>

      <div className="space-y-1.5">
        <h1 className="text-lg font-semibold">
          {forbidden ? "Akses ditolak" : "Halaman tidak dapat dimuat"}
        </h1>
        <p className="max-w-md text-sm text-muted-foreground">
          {forbidden
            ? "Akun Anda tidak memiliki izin untuk membuka bagian ini. Hubungi administrator bila Anda merasa ini keliru."
            : describe(error)}
        </p>
      </div>

      {error.digest ? (
        <p className="font-mono text-xs text-muted-foreground">
          Kode kesalahan: {error.digest}
        </p>
      ) : null}

      <div className="flex gap-2">
        <Button variant="outline" size="sm" asChild>
          <Link href="/dashboard">Kembali ke dashboard</Link>
        </Button>
        {!forbidden ? (
          <Button size="sm" onClick={reset}>
            <RefreshCw className="size-4" aria-hidden />
            Coba lagi
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function describe(error: Error & { code?: string }): string {
  const raw = error.message.toLowerCase();

  if (raw.includes("database_url")) {
    return "Konfigurasi database belum lengkap. Hubungi administrator untuk mengatur DATABASE_URL.";
  }

  if (raw.includes("econnrefused") || raw.includes("timeout")) {
    return "Tidak dapat terhubung ke database. Periksa koneksi internet, lalu coba lagi.";
  }

  if (raw.includes("auth_secret")) {
    return "Konfigurasi keamanan belum lengkap. Hubungi administrator untuk mengatur AUTH_SECRET.";
  }

  return "Terjadi kesalahan saat memuat data. Silakan coba lagi beberapa saat lagi.";
}
