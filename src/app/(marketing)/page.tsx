import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/auth/session";

/**
 * Marketing landing page (public).
 *
 * Route group `(marketing)` gives the public site its own layout, separate from
 * the auth screens and the dashboard shell. See `(marketing)/layout.tsx`.
 */
export default async function HomePage() {
  const user = await getCurrentUser();

  // Signed-in staff go straight to the app; visitors stay on the landing page.
  if (user) {
    redirect("/dashboard");
  }

  return (
    <main className="flex min-h-screen items-center justify-center">
      <div className="max-w-md text-center">
        <p className="text-sm font-medium text-brand-600 dark:text-brand-400">
          Swalayaku
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          Sistem Manajemen Toko Swalayan
        </h1>
        <p className="mt-3 text-muted-foreground">
          Halaman marketing sedang dibangun. Sistem kasir dan manajemen stok
          tersedia di{" "}
          <a href="/login" className="font-medium text-brand-600 underline">
            /login
          </a>
          .
        </p>
      </div>
    </main>
  );
}