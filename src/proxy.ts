import { NextResponse, type NextRequest } from "next/server";

/**
 * Optimistic route guard (Next.js 16 `proxy` convention, formerly `middleware`).
 *
 * This runs before rendering and only inspects whether a session cookie is
 * present — it deliberately does NOT decrypt the token or hit the database,
 * because proxy runs on every request including prefetches, and a DB round trip
 * there would slow down every navigation.
 *
 * It is a convenience redirect, not the security boundary. The real checks are
 * `requireUser` / `requirePermission` in the DAL, which every Server Component,
 * Server Action, and Route Handler calls against live session data.
 */

const SESSION_COOKIE = "swalayaku_session";

/**
 * Routes reachable without a session.
 *
 * `/` is the public storefront, so it must be listed: without it every anonymous
 * visitor is bounced to the login screen and the landing page is unreachable, and
 * because the redirect lands on a 200 page nothing in a status-code check notices.
 */
const PUBLIC_PREFIXES = [
  "/",
  "/login",
  "/api/auth",
  "/_next",
  "/favicon.ico",
];

function hasSessionCookie(request: NextRequest): boolean {
  return Boolean(request.cookies.get(SESSION_COOKIE)?.value);
}

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  const isPublic = PUBLIC_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );

  if (isPublic) {
    return NextResponse.next();
  }

  if (!hasSessionCookie(request)) {
    const loginUrl = new URL("/login", request.url);
    // Preserve the destination so login can send the user back to it.
    loginUrl.searchParams.set("from", `${pathname}${search}`);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Everything except Next internals, static assets, and common image files.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};