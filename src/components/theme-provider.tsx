"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

/**
 * Dark mode. `next-themes` writes the class onto <html> before hydration to
 * avoid a flash; the root layout sets suppressHydrationWarning for that reason.
 *
 * The theme resolves to Swalayaku's green palette in both modes (see the
 * `@theme` and `.dark` blocks in globals.css) rather than inverting colours.
 */
export function ThemeProvider({
  children,
  ...props
}: React.ComponentProps<typeof NextThemesProvider>) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>;
}