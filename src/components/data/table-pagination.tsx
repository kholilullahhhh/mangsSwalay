"use client";

import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { formatNumber } from "@/lib/format";

export interface PaginationMeta {
  page: number;
  pageCount: number;
  skip: number;
  take: number;
  total?: number;
}

/**
 * Pagination control.
 *
 * Link-based, so paging works without JavaScript and each page is a real,
 * shareable URL. Prev/next plus a compact page readout — a full page-number
 * grid is noise for the 10-100 row pages this app deals with, but the totals
 * are always visible so the user knows how much data they are not seeing.
 */
export function TablePagination({
  pagination,
  searchParams,
  total,
}: {
  pagination: PaginationMeta;
  searchParams: Record<string, string | string[] | undefined>;
  total?: number;
}) {
  const { page, pageCount } = pagination;

  if (pageCount <= 1) {
    return total !== undefined ? (
      <p className="border-t px-4 py-3 text-xs text-muted-foreground">
        Menampilkan {formatNumber(total)} data
      </p>
    ) : null;
  }

  const buildHref = (targetPage: number) => {
    const params = new URLSearchParams();

    for (const [key, value] of Object.entries(searchParams)) {
      if (value === undefined) continue;
      params.set(key, Array.isArray(value) ? value[0] : value);
    }

    // Changing page resets perPage only when it was customised; keeping it
    // avoids a jarring resize mid-navigation.
    if (targetPage <= 1) {
      params.delete("page");
    } else {
      params.set("page", String(targetPage));
    }

    const query = params.toString();
    return query ? `?${query}` : "?";
  };

  const firstRow = pagination.skip + 1;
  const lastRow = pagination.skip + pagination.take;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3">
      <p className="text-xs text-muted-foreground">
        Menampilkan {formatNumber(firstRow)}–{formatNumber(lastRow)}
        {total !== undefined ? ` dari ${formatNumber(total)} data` : null}
      </p>

      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="sm"
          asChild={page > 1}
          disabled={page <= 1}
        >
          {page > 1 ? (
            <Link href={buildHref(page - 1)}>
              <ChevronLeft className="size-4" aria-hidden />
              Sebelumnya
            </Link>
          ) : (
            <>
              <ChevronLeft className="size-4" aria-hidden />
              Sebelumnya
            </>
          )}
        </Button>

        <span className="px-2 text-xs text-muted-foreground tabular">
          Halaman {page} dari {pageCount}
        </span>

        <Button
          variant="outline"
          size="sm"
          asChild={page < pageCount}
          disabled={page >= pageCount}
        >
          {page < pageCount ? (
            <Link href={buildHref(page + 1)}>
              Berikutnya
              <ChevronRight className="size-4" aria-hidden />
            </Link>
          ) : (
            <>
              Berikutnya
              <ChevronRight className="size-4" aria-hidden />
            </>
          )}
        </Button>
      </div>
    </div>
  );
}