/**
 * Client/server boundary audit.
 *
 * Walks the real import graph from every "use client" entry point and reports any
 * module reachable from it that imports "server-only", the Prisma client, or the
 * database module. That is the only reliable way to catch a leak, because the
 * failure surfaces far from its cause: a shared constant re-exported from a query
 * file drags `pg` into the browser bundle and breaks every page that renders the
 * component, not the file where the mistake was made.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const SRC = join(process.cwd(), "src");

const ALIASES: Record<string, string> = {
  "@": SRC,
};

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, acc);
    else if (/\.(ts|tsx)$/.test(entry) && !entry.endsWith(".d.ts")) acc.push(full);
  }
  return acc;
}

/** Resolves an import specifier to a file inside src/, or null. */
function resolveSpecifier(specifier: string, fromFile: string): string | null {
  if (!specifier.startsWith(".") && !specifier.startsWith("@/")) return null;

  const base = specifier.startsWith("@/")
    ? join(ALIASES["@"], specifier.slice(2))
    : resolve(dirname(fromFile), specifier);

  const candidates = [
    base + ".ts",
    base + ".tsx",
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }

  return null;
}

/** Import specifiers in a file, ignoring type-only ones. */
function readImports(file: string): string[] {
  const source = readFileSync(file, "utf8");
  const specifiers: string[] = [];

  for (const match of source.matchAll(/import\s+(?!type\s)([\s\S]*?)\s*from\s*["']([^"']+)["']/g)) {
    // `import type { X } from` is erased at build time and cannot leak.
    if (/^type\s/.test(match[1].trim())) continue;
    specifiers.push(match[2]);
  }

  // Side-effect imports: `import "server-only"`.
  for (const match of source.matchAll(/^import\s+["']([^"']+)["']/gm)) {
    specifiers.push(match[1]);
  }

  return specifiers;
}

/**
 * Whether a module is server-only in a way that must not reach the browser.
 *
 * A module marked `"use server"` is NOT one of these: Next replaces it with a
 * client-side reference at build time, so a client component may legitimately
 * import Server Actions from it. Those files are treated as a boundary by
 * `findLeaks` and never traversed, which is what makes this check about real
 * leaks rather than about the ordinary action pattern.
 */
function isServerOnly(file: string): boolean {
  const source = readFileSync(file, "utf8");

  if (/^import\s+["']server-only["']/m.test(source)) return true;
  if (/from\s+["']@\/lib\/db["']/.test(source)) return true;
  if (/from\s+["']@prisma\/adapter-pg["']/.test(source)) return true;

  // A *value* import from the generated client pulls the whole engine into the
  // bundle. `import type` is erased at compile time and is safe, so the
  // type-only form must be excluded or every rule module would be a false
  // positive.
  return /import\s+(?!type\s)[^;]*?from\s+["']@\/generated\/prisma\//.test(source);
}

/** True for a Server Actions module, which is a legal import from a client file. */
function isServerActionModule(file: string): boolean {
  return /^\s*(["'])use server\1/.test(readFileSync(file, "utf8"));
}

const allFiles = walk(SRC);
const cache = new Map<string, string[][]>();

/** Every server-only file reachable from `entry`, as import chains. */
function findLeaks(entry: string, chain: string[] = [], seen = new Set<string>()): string[][] {
  if (chain.includes(entry)) return [];

  const key = entry;
  if (cache.has(key)) return cache.get(key)!;

  const leaks: string[][] = [];
  seen.add(entry);

// Order matters: a Server Actions module legitimately imports `prisma`, because
  // that is where the work happens. It is compiled away to a client-side
  // reference, so it must be checked as a boundary BEFORE it is judged by its own
  // imports.
  if (isServerActionModule(entry)) {
    // Safe: Server Actions become client-side references at build time.
  } else if (isServerOnly(entry)) {
    leaks.push([...chain, entry]);
  } else {
    for (const specifier of readImports(entry)) {
      const resolved = resolveSpecifier(specifier, entry);
      if (!resolved || seen.has(resolved)) continue;
      leaks.push(...findLeaks(resolved, [...chain, entry], seen));
    }
  }

  if (chain.length === 0) cache.set(key, leaks);
  return leaks;
}

const clientEntries = allFiles.filter((file) => {
  const source = readFileSync(file, "utf8");
  return /^\s*(["'])use client\1/.test(source);
});

console.log("Client entry points: " + clientEntries.length);
console.log("");

let leakCount = 0;

for (const entry of clientEntries) {
  const leaks = findLeaks(entry);

  for (const leak of leaks) {
    leakCount++;
    console.log("LEAK  " + entry.replace(SRC + "\\", "").replace(/\\/g, "/"));
    for (const step of leak) {
      console.log("        " + step.replace(SRC + "\\", "").replace(/\\/g, "/"));
    }
    console.log("");
  }
}

console.log(leakCount + " leak(s) found");
if (leakCount > 0) process.exit(1);
