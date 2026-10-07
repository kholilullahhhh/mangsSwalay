/**
 * Route coverage audit.
 *
 * Compares every href declared in the sidebar against the pages that actually
 * exist on disk. A nav entry with no page is a link that 404s for every role
 * that can see it — the exact "looks finished, isn't" failure this audit hunts.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const APP_DIR = join(process.cwd(), "src", "app");
const NAV_FILE = join(process.cwd(), "src", "components", "dashboard", "nav-config.ts");

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, acc);
    } else if (entry === "page.tsx") {
      acc.push(full);
    }
  }
  return acc;
}

/** Converts a page.tsx path into its route, stripping route groups. */
function toRoute(file: string): string {
  let rel = file.slice(APP_DIR.length + 1).replace(/\\/g, "/");
  rel = rel.replace(/page\.tsx$/, "");
  // Route groups may appear at the start of the path or mid-path.
  rel = rel.replace(/^\([^/]+\)\//, "");
  rel = rel.replace(/\/\([^/]+\)/g, "");
  rel = rel.replace(/\/\[(\w+)\]/g, ":$1");
  rel = rel.replace(/\/$/, "");
  return rel === "" ? "/" : "/" + rel;
}

const navSource = readFileSync(NAV_FILE, "utf8");
const navHrefs = [...navSource.matchAll(/href:\s*"([^"]+)"/g)]
  .map((m) => m[1])
  .filter((href, index, all) => all.indexOf(href) === index)
  .sort();

const pageFiles = walk(APP_DIR);
const routes = pageFiles.map(toRoute).sort();

/** Whether a concrete path is served by one of the dynamic route patterns. */
function routeMatches(path: string, route: string): boolean {
  if (route === path) return true;
  if (!route.includes(":")) return false;
  const pattern = new RegExp(
    "^" + route.replace(/:[^/]+/g, "[^/]+") + "$",
  );
  return pattern.test(path);
}

function isServed(path: string): boolean {
  return routes.some((route) => routeMatches(path, route));
}

/** Route handlers live under /api and have no page.tsx, so they are listed separately. */
function walkApi(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walkApi(full, acc);
    else if (entry === "route.ts") acc.push(full);
  }
  return acc;
}

const API_DIR = join(process.cwd(), "src", "app", "api");

/** `/api/.../route.ts` to `/api/...`, with dynamic segments as `:name`. */
function toApiRoute(file: string): string {
  return (
    // "/api" is the directory itself, so it is not part of the sliced path.
    "/api/" +
    file
      .slice(API_DIR.length + 1)
      .replace(/\\/g, "/")
      .replace(/route\.ts$/, "")
      .replace(/\/\[(\w+)\]/g, ":$1")
      .replace(/\/$/, "")
  );
}

const apiRoutes = existsSync(API_DIR)
  ? walkApi(API_DIR).map(toApiRoute).sort()
  : [];

/** Whether an href is served by a page or by an API route handler. */
function isServedAnywhere(path: string): boolean {
  return isServed(path) || apiRoutes.some((route) => routeMatches(path, route));
}

let missing = 0;

console.log("Nav links with NO page (these 404):");
for (const href of navHrefs) {
  if (!isServed(href)) {
    console.log("  MISSING  " + href);
    missing++;
  }
}

const allHrefs = collectHrefs();

console.log("");
console.log("Pages NOT reachable from the sidebar:");

const detailRoutes: string[] = [];

for (const route of routes) {
  if (route === "/" || route.startsWith("/_")) continue;

  // Reachable means linked from the sidebar *or* from anywhere else in the app.
  // A page linked only from its sibling is still reachable, and calling it an
  // orphan would be wrong.
  if (
    navHrefs.some((href) => isServed(href) && routeMatches(href, route))
  ) {
    continue;
  }

  if (allHrefs.some((href) => routeMatches(href, route))) continue;

  // A detail route (`/products/:id`) is reached from its list page, not from the
  // sidebar, so it is reported separately rather than as an orphan. Listing it
  // alongside real orphans would bury the ones that matter.
  if (route.includes(":")) {
    const parent = "/" + route.slice(1).split("/")[0];
    if (isServed(parent)) {
      detailRoutes.push(route);
      continue;
    }
  }

  console.log("  ORPHAN   " + route);
}

if (detailRoutes.length > 0) {
  console.log("");
  console.log("Detail routes (reached from their list page, not the sidebar):");
  for (const route of detailRoutes) console.log("  DETAIL   " + route);
}

console.log("");
console.log("Internal links in UI that 404:");

/** Every href used in a component/page, not just the nav config. */
function collectHrefs(): string[] {
  const found = new Set<string>();

  const scan = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        scan(full);
      } else if (/\.(tsx|ts)$/.test(entry)) {
        const source = readFileSync(full, "utf8");
        // String literals only; template literals are matched separately below.
        for (const m of source.matchAll(/(?:href=|href:\s*)\{?"(\/[A-Za-z0-9/_-]*)"/g)) {
          found.add(m[1]);
        }
        for (const m of source.matchAll(/["'`]\/(\/[A-Za-z0-9/_-]+)["'`]/g)) {
          found.add(m[1]);
        }
// `href={"/products/" + id}` style. The trailing slash is stripped
        // because the captured prefix is a static path that the dynamic segment
        // extends; keeping it would report "/products/" as dangling when
        // "/products" is served fine.
        for (const m of source.matchAll(/href=\{["`](\/[A-Za-z0-9/_-]*?)["'`] \+/g)) {
          found.add(m[1].replace(/\/$/, ""));
        }
      }
    }
  };

scan(join(process.cwd(), "src"));

  return [...found]
    .filter((href) => href.length > 1)
    // Trailing slashes are stripped: "/products/" and "/products" address the
    // same page, and Next redirects the former. Reporting one as dangling while
    // the other is fine would send someone chasing a non-bug.
    .map((href) => href.replace(/\/$/, "") || "/")
    .sort();
}

let dangling = 0;

for (const href of allHrefs) {
  if (href.includes(":") || href.includes("*")) continue;
  if (!isServedAnywhere(href)) {
    console.log("  DANGLING  " + href);
    dangling++;
  }
}

console.log("");
console.log(
  "summary: " +
    navHrefs.length +
    " nav links (" +
    missing +
    " missing), " +
    allHrefs.length +
    " internal hrefs (" +
    dangling +
    " dangling), " +
    routes.length +
    " routes on disk",
);

if (missing > 0 || dangling > 0) process.exit(1);

