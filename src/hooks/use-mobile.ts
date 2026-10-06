"use client";

import * as React from "react";

const MOBILE_BREAKPOINT = 768;

function subscribe(callback: () => void): () => void {
  const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
  mql.addEventListener("change", callback);
  return () => mql.removeEventListener("change", callback);
}

/**
 * Tracks the mobile breakpoint.
 *
 * Uses `useSyncExternalStore` so the value is read from the media query
 * directly on the client. That avoids the mount-then-correct pattern, which
 * would render desktop and mobile differently on first paint and cause a
 * cascading re-render in an effect.
 */
export function useIsMobile(): boolean {
  return React.useSyncExternalStore(
    subscribe,
    () => window.innerWidth < MOBILE_BREAKPOINT,
    // Server snapshot: assume desktop so the first paint matches SSR markup.
    () => false,
  );
}