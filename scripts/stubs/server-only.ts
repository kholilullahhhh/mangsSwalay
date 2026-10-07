/**
 * Stub for the `server-only` package, used when running verification scripts
 * outside the Next.js build.
 *
 * `server-only` deliberately throws when a module is pulled into a client
 * bundle. The scripts in this folder are plain Node programs, so the real
 * package would refuse to load even though nothing is being bundled. Mapping
 * the import to this empty module via tsconfig.scripts.json keeps the guard
 * active in the application while letting the scripts import server modules.
 */
export {};
