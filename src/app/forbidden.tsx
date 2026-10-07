import Link from "next/link";
import { Lock } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Rendered by Next.js when `forbidden()` is called, which is how a page whose
 * permission check failed ends up here.
 *
 * Distinct from the error boundary on purpose: reaching this means the
 * session is valid but the account lacks the permission. That is a routine
 * outcome, not a fault, so there is no "retry" button and no error code to
 * report.
 */
export default function Forbidden() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 text-center">
      <span
        className="flex size-12 items-center justify-center rounded-full bg-stock-low/15 text-stock-low"
        aria-hidden
      >
        <Lock className="size-6" />
      </span>

      <div className="space-y-1.5">
        <h1 className="text-lg font-semibold">Akses ditolak</h1>
        <p className="max-w-md text-sm text-muted-foreground">
          Akun Anda tidak memiliki izin untuk membuka bagian ini. Hubungi
          administrator toko bila Anda merasa ini keliru.
        </p>
      </div>

      <div className="flex gap-2">
        <Button size="sm" asChild>
          <Link href="/dashboard">Kembali ke dashboard</Link>
        </Button>
        <Button variant="outline" size="sm" asChild>
          <Link href="/pos">Buka kasir</Link>
        </Button>
      </div>
    </div>
  );
}
