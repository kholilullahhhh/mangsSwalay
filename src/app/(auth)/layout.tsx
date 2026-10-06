import Link from "next/link";
import { redirect } from "next/navigation";
import { type Metadata } from "next";
import { Lock, Store } from "lucide-react";

import { getCurrentUser } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "Masuk",
  description: "Masuk ke sistem Swalayaku.",
};

/**
 * Auth layout — intentionally minimal and distinct from both the marketing site
 * and the dashboard shell, so staff signing in get no operational chrome.
 */
export default async function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();

  if (user) {
    redirect("/dashboard");
  }

  return (
    <div className="flex min-h-screen flex-col bg-muted/40">
      <header className="flex items-center justify-center py-8">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-lg font-semibold tracking-tight"
        >
          <span className="flex size-9 items-center justify-center rounded-lg bg-brand-600 text-white">
            <Store className="size-5" aria-hidden />
          </span>
          Swalayaku
        </Link>
      </header>

      <main className="flex flex-1 items-start justify-center px-4 pb-16">
        {children}
      </main>

      <footer className="py-6 text-center">
<p className="text-xs text-muted-foreground">
            <Lock className="mr-1 inline size-3" aria-hidden />
            Akses hanya untuk staff terdaftar.
          </p>
      </footer>
    </div>
  );
}