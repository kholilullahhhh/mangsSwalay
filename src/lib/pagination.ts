/**
 * Server-side pagination, sorting, and search-parameter parsing.
 *
 * The spec requires that large tables are never loaded into the browser, so
 * every list page filters, sorts, and counts in Postgres and returns only the
 * current page. This module holds the parameter parsing and page maths; the
 * actual queries live in `src/lib/queries/*` where each one can select exactly
 * the columns it needs.
 */

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

export type SortDirection = "asc" | "desc";

export interface PaginationParams {
  page: number;
  perPage: number;
}

/** Reads the first value of a search param that may arrive as an array. */
export function firstValue(
  value: string | string[] | undefined,
): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

/**
 * Parses `page` / `perPage`, clamping both to safe bounds.
 *
 * `perPage` is capped so a crafted URL cannot ask for the entire table, and the
 * page is forced to at least 1 so a negative value can't produce a negative
 * offset that Postgres would reject.
 */
export function parsePagination(
  searchParams: Record<string, string | string[] | undefined>,
  defaultPerPage: number = DEFAULT_PAGE_SIZE,
): PaginationParams {
  const parsedPage = Number.parseInt(firstValue(searchParams.page) ?? "", 10);
  const parsedPerPage = Number.parseInt(firstValue(searchParams.perPage) ?? "", 10);

  return {
    page: Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1,
    perPage:
      Number.isFinite(parsedPerPage) && parsedPerPage > 0
        ? Math.min(parsedPerPage, MAX_PAGE_SIZE)
        : Math.min(defaultPerPage, MAX_PAGE_SIZE),
  };
}

/**
 * Turns a page request into the `skip`/`take` Prisma needs, plus the total
 * page count for the pagination component.
 */
export function toPageRequest(
  total: number,
  { page, perPage }: PaginationParams,
): { skip: number; take: number; pageCount: number; page: number } {
  const pageCount = Math.max(1, Math.ceil(total / perPage));

  // A page number beyond the end (e.g. after deleting the last row) would
  // return an empty table, which reads as "no results". Clamping to the last
  // real page gives a more honest result.
  const currentPage = Math.min(page, pageCount);

  return {
    skip: (currentPage - 1) * perPage,
    take: perPage,
    pageCount,
    page: currentPage,
  };
}

/**
 * Resolves a requested sort field and direction into a validated ORDER BY clause.
 *
 * The field must be a key of `fields`; anything else falls back to
 * `defaultField`. Nothing from user input is ever interpolated into the clause
 * as a raw identifier, so a crafted `?sort=` value cannot probe the schema.
 *
 * @param fields  Maps an allowed sort name to its Prisma field name.
 */
export function resolveSort<TField extends string>(
  sort: string | undefined,
  direction: string | undefined,
  fields: Readonly<Record<TField, string>>,
  defaultField: TField,
  defaultDirection: SortDirection = "asc",
): Record<string, SortDirection> {
  const requested = sort as TField;
  const isKnownField =
    requested !== undefined &&
    Object.prototype.hasOwnProperty.call(fields, requested);

  // An unknown sort field resets both the column and the direction. Honouring a
  // `direction` paired with a rejected column would silently reorder by the
  // fallback column in a direction the user never chose.
  if (!isKnownField) {
    return { [fields[defaultField]]: defaultDirection };
  }

  return {
    [fields[requested]]: direction === "desc" ? "desc" : "asc",
  };
}

/**
 * Builds a case-insensitive `contains` filter, skipping it when empty so an
 * empty search box doesn't issue a pointless LIKE against every row.
 */
export function searchFilter(
  value: string | undefined,
  fields: readonly string[],
): Record<string, unknown> {
  const trimmed = value?.trim();

  if (!trimmed) {
    return {};
  }

  return {
    OR: fields.map((field) => ({
      [field]: { contains: trimmed, mode: "insensitive" },
    })),
  };
}

/** Serialises params back to a query string, dropping empty values. */
export function toQueryString(
  params: Record<string, string | number | undefined | null>,
): string {
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    search.set(key, String(value));
  }

  const query = search.toString();
  return query ? `?${query}` : "";
}