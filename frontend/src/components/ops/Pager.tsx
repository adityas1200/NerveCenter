/* eslint-disable react-refresh/only-export-components */
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui";
import { cn } from "@/lib/utils";

/**
 * Page switcher for a long table: "1–10 of 23" on the left, numbered pages on
 * the right. Long ranges collapse to the first, last and the neighbours of the
 * current page. Renders nothing when everything fits on one page. With `sizes` and `onSizeChange`
 * a "20 / page" picker sits beside the numbers, and the bar stays while there is more than the
 * smallest size, so a reader can always switch back.
 */

export const PAGE_SIZE = 10;

export function pageOf<T>(items: T[], page: number, size = PAGE_SIZE): T[] {
  return items.slice((page - 1) * size, page * size);
}

function pageNumbers(current: number, total: number): Array<number | "gap"> {
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);
  const pages = new Set<number>([1, total, current - 1, current, current + 1].filter((page) => page >= 1 && page <= total));
  const sorted = [...pages].sort((left, right) => left - right);
  const result: Array<number | "gap"> = [];
  sorted.forEach((page, index) => {
    if (index && page - (sorted[index - 1] as number) > 1) result.push("gap");
    result.push(page);
  });
  return result;
}

export function Pager({ page, total, size = PAGE_SIZE, onChange, noun = "items", className, sizes, onSizeChange }: { page: number; total: number; size?: number; onChange: (page: number) => void; noun?: string; className?: string; sizes?: readonly number[]; onSizeChange?: (size: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / size));
  const picker = sizes?.length && onSizeChange ? sizes : null;
  if (pages <= 1 && !(picker && total > Math.min(...picker))) return null;
  const first = (page - 1) * size + 1;
  const last = Math.min(total, page * size);
  return (
    <nav aria-label="Pages" className={cn("flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-2", className)}>
      <p className="text-[12.5px] tabular-nums text-ink-4">{first}–{last} of {total} {noun}</p>
      <div className="flex items-center gap-1">
        {picker ? (
          <Select value={String(size)} onValueChange={(value) => onSizeChange?.(Number(value))}>
            <SelectTrigger aria-label={`${noun.charAt(0).toUpperCase()}${noun.slice(1)} per page`} className="mr-2 h-7 w-auto gap-1.5 px-2 text-[12.5px]"><SelectValue /></SelectTrigger>
            <SelectContent>{picker.map((choice) => <SelectItem key={choice} value={String(choice)}>{choice} / page</SelectItem>)}</SelectContent>
          </Select>
        ) : null}
        <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Previous page" disabled={page <= 1} onClick={() => onChange(page - 1)}><ChevronLeft className="h-3.5 w-3.5" /></Button>
        {pageNumbers(page, pages).map((item, index) => item === "gap" ? (
          <span key={`gap-${index}`} className="px-1 text-[12.5px] text-ink-5">…</span>
        ) : (
          <button
            key={item}
            type="button"
            aria-current={item === page ? "page" : undefined}
            onClick={() => onChange(item)}
            className={cn("h-7 min-w-7 rounded-lg px-2 text-[13px] tabular-nums transition-colors", item === page ? "bg-ink-1 font-semibold text-raised" : "text-ink-3 hover:bg-surface-subtle hover:text-ink-1")}
          >
            {item}
          </button>
        ))}
        <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Next page" disabled={page >= pages} onClick={() => onChange(page + 1)}><ChevronRight className="h-3.5 w-3.5" /></Button>
      </div>
    </nav>
  );
}
