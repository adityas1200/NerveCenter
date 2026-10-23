import { useEffect, useRef } from "react";
import { pageOf } from "@/components/ops/Pager";
import { useUrlFilters } from "@/lib/useUrlFilters";

/** Rows-per-page choices for tables and lists, and for card grids (multiples of the 2, 3 and 4 column layouts). SPEC-platform-11. */
export const LIST_PAGE_SIZES = [10, 25, 50, 100] as const;
export const GRID_PAGE_SIZES = [12, 24, 48] as const;

/**
 * Page and page size for a long list, kept in the URL (`page`, `size`, or `<prefix>Page` beside another list) so a link lands on
 * the same page. Returns to page 1 when `resetKey` changes (a filter or a search). The size is one of `sizes`; the smallest is the
 * default and is left out of the URL. `total` is the item count, from the server when it pages.
 */
export function usePager(total: number, { sizes = LIST_PAGE_SIZES, prefix = "", resetKey = "" }: { sizes?: readonly number[]; prefix?: string; resetKey?: string } = {}) {
  const urlFilters = useUrlFilters();
  const pageKey = prefix ? `${prefix}Page` : "page";
  const sizeKey = prefix ? `${prefix}Size` : "size";
  const requested = Number(urlFilters.get(sizeKey));
  const size = sizes.includes(requested) ? requested : sizes[0];
  const pages = Math.max(1, Math.ceil(total / size));
  const page = Math.min(Math.max(1, Math.trunc(Number(urlFilters.get(pageKey))) || 1), pages);
  // Only a change of filter resets the page; the first render keeps a linked page.
  const previous = useRef(resetKey);
  useEffect(() => {
    if (previous.current === resetKey) return;
    previous.current = resetKey;
    if (urlFilters.get(pageKey)) urlFilters.clear(pageKey);
  }, [resetKey, pageKey, urlFilters]);
  const setPage = (next: number) => urlFilters.update((params) => { if (next <= 1) params.delete(pageKey); else params.set(pageKey, String(next)); });
  const setSize = (next: number) => urlFilters.update((params) => { if (next === sizes[0]) params.delete(sizeKey); else params.set(sizeKey, String(next)); params.delete(pageKey); });
  return {
    page, size, offset: (page - 1) * size,
    slice: <T,>(items: T[]) => pageOf(items, page, size),
    pagerProps: { page, total, size, onChange: setPage, sizes, onSizeChange: setSize },
  };
}
