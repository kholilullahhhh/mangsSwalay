"use client";

import { useEffect } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Dashboard error boundary.
 *
 * Reports a specific, actionable message rather than "something went wrong".
 * A failed database connection, a missing session, and a permissions problem
 * all surface differently so staff know whether to retry, log in again, or call
 * a manager.
 */
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[dashboard]", error);
  }, [error]);

  const message = describe(error);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-4 text-center">
      <span
        className="flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive"
        aria-hidden
      >
        <AlertTriangle className="size-6" />
      </span>

      <div className="space-y-1.5">
        <h1 className="text-lg font-semibold">Dashboard tidak dapat dimuat</h1>
        <p className="max-w-md text-sm text-muted-foreground">{message}</p>
      </div>

      {error.digest ? (
        <p className="font-mono text-xs text-muted-foreground">
          Kode kesalahan: {error.digest}
        </p>
      ) : null}

      <Button onClick={reset} size="sm">
        <RefreshCw className="size-4" aria-hidden />
        Coba lagi
      </Button>
    </div>
  );
}

function describe(error: Error & { digest?: string }): string {
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

  if (raw.includes("tidak memiliki akses") || raw.includes("forbidden")) {
    return "Anda tidak memiliki izin untuk membuka halaman ini. Hubungi administrator.";
  }

  return "Terjadi kesalahan saat memuat data. Silakan coba lagi beberapa saat lagi.";
}