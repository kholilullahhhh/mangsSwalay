"use client";

import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/**
 * Light/dark toggle.
 *
 * Both icons are always rendered and swapped with CSS (`dark:` variants), so the
 * correct one is visible on the very first paint. Reading `resolvedTheme` into
 * state would instead require a mount-then-correct render, which causes a
 * hydration mismatch or a cascading re-render — hence the CSS approach.
 *
 * Its own module because the marketing and login layouts need it too: they are
 * the only two places a visitor can be *before* signing in, so they are also the
 * only two where a visitor stuck in dark mode previously had no way out.
 */
export function ThemeToggle() {
  const { setTheme } = useTheme();

  function toggleTheme() {
    // next-themes reads the current value from the DOM class it owns, so this
    // flips the active theme without needing it in React state.
    const isDark =
      typeof document !== "undefined" &&
      document.documentElement.classList.contains("dark");

    setTheme(isDark ? "light" : "dark");
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleTheme}
          aria-label="Ganti tema terang dan gelap"
        >
          <Sun className="hidden size-4 dark:block" aria-hidden />
          <Moon className="size-4 dark:hidden" aria-hidden />
        </Button>
      </TooltipTrigger>
      <TooltipContent>Ganti tema</TooltipContent>
    </Tooltip>
  );
}