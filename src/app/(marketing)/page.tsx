import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/auth/session";
import { getStoreProfile } from "@/lib/queries/store-profile";
import { StoreFacts, StaffEntry } from "@/components/landing/store-facts";
import { ThemeToggle } from "@/components/theme-toggle";

/**
 * Public landing page.
 *
 * Built from the store's own settings rather than marketing filler. There is no
 * hero-plus-six-cards layout here because a neighbourhood minimarket does not
 * have a product story to tell: what a visitor actually needs is what the store
 * sells, where it is, when it opens, and how to reach it. Everything on this page
 * answers one of those.
 *
 * The catalogue counts come from the database, so they are true, and they disappear
 * entirely when the store is still empty rather than showing a proud "0".
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

export default async function HomePage() {
  const user = await getCurrentUser();

  // Staff do not need a storefront; they need the till.
  if (user) {
    redirect("/dashboard");
  }

  const store = await getStoreProfile();

  const hasCatalogue = store.productCount > 0;

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-16 sm:py-24">
      {/* Theme control on the page itself. This is one of only two places a
          visitor can be before signing in, and both were previously stuck in
          whatever `next-themes` resolved with no way to change it. */}
      <div className="fixed end-4 top-4 z-10">
        <ThemeToggle />
      </div>

      <div className="space-y-10">
        <header className="space-y-4">
          {/* A shop sign, not a hero banner: the store's name is the strongest
              thing it has, and type size is enough to establish it. */}
          <p className="text-sm font-medium tracking-wide text-brand-600 dark:text-brand-400">
            {store.name}
          </p>

          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            {store.tagline || "Kebutuhan harian, lengkap dan dekat."}
          </h1>

          {store.about ? (
            <p className="max-w-prose text-muted-foreground">{store.about}</p>
          ) : null}

          {hasCatalogue ? (
            <p className="text-sm text-muted-foreground">
              {store.categoryCount} kategori · {store.productCount} produk
              tersedia
            </p>
          ) : null}
        </header>

        <StoreFacts
          address={store.address}
          hours={store.hours}
          phone={store.phone}
          whatsapp={store.whatsapp}
          email={store.email}
        />

        <StaffEntry storeName={store.name} />
      </div>
    </main>
  );
}