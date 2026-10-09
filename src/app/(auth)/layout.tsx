import { redirect } from "next/navigation";
import { type Metadata } from "next";

import { getCurrentUser } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "Masuk",
  description: "Masuk ke sistem Swalayaku.",
};

/**
 * Auth layout — intentionally minimal and distinct from both the marketing site
 * and the dashboard shell, so staff signing in get no operational chrome.
 *
 * It renders no page furniture of its own: the sign-in card owns the whole
 * viewport (see `login/page.tsx`), including the header, the footer and the
 * theme toggle. Wrapping it here would clip that full-screen layout and put
 * two competing theme controls on screen.
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

  return children;
}