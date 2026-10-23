import { ChevronDown, ChevronUp } from "lucide-react";
import type { KeyboardEvent, MouseEvent, ReactNode } from "react";
import { Link } from "react-router-dom";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui";
import type { SortState } from "@/lib/tableSort";
import { cn } from "@/lib/utils";

type Align = "left" | "right";

/**
 * The compact operational table used on every list. Dense rows, sticky
 * uppercase headers, optional column sorting, and rows that can open something.
 *
 * Layout is fixed: every column but one declares a width on its OpsTh, and the one without takes the
 * rest. Cells stay on one line and truncate, so rows are the same height and a long title can never push
 * columns off the card. `minWidth` is where the table starts scrolling sideways instead of squeezing.
 */
export function OpsTable({ children, className, minWidth = 960 }: { children: ReactNode; className?: string; minWidth?: number }) {
  return <Table className={cn("table-fixed text-[13.5px]", className)} style={{ minWidth }}>{children}</Table>;
}

export function OpsHead({ children }: { children: ReactNode }) {
  return <TableHeader className="sticky top-0 z-[1]"><TableRow className="hover:bg-transparent">{children}</TableRow></TableHeader>;
}

export const OpsBody = TableBody;

export function OpsTh<K extends string>({ children, sortKey, sort, onSort, align = "left", className, width }: {
  children?: ReactNode;
  sortKey?: K;
  sort?: SortState<K>;
  onSort?: (key: K) => void;
  align?: Align;
  className?: string;
  width?: string;
}) {
  const active = sortKey !== undefined && sort?.key === sortKey;
  const base = cn("h-9 whitespace-nowrap bg-surface-subtle/60 px-4 text-[11px] font-semibold uppercase tracking-[0.05em] text-ink-5", align === "right" && "text-right", className);
  if (!sortKey || !onSort) return <TableHead className={base} style={width ? { width } : undefined}>{children}</TableHead>;
  const Chevron = sort?.dir === "desc" ? ChevronDown : ChevronUp;
  return (
    <TableHead className={cn(base, "p-0")} style={width ? { width } : undefined} aria-sort={active ? (sort?.dir === "asc" ? "ascending" : "descending") : "none"}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={cn("flex h-9 w-full items-center gap-1 px-4 uppercase tracking-[0.05em] transition-colors hover:text-ink-2", align === "right" && "justify-end", active && "text-ink-2")}
      >
        {children}
        <Chevron className={cn("h-3 w-3 shrink-0 transition-opacity", active ? "opacity-100" : "opacity-0")} aria-hidden="true" />
      </button>
    </TableHead>
  );
}

export function OpsRow({ children, onOpen, index, className, selected }: {
  children: ReactNode;
  /** Makes the whole row open something; the primary cell should still contain a real button or link. */
  onOpen?: () => void;
  index?: number;
  className?: string;
  selected?: boolean;
}) {
  const onKeyDown = (event: KeyboardEvent<HTMLTableRowElement>) => {
    if (!onOpen || event.target !== event.currentTarget) return;
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpen(); }
  };
  const onClick = onOpen ? (event: MouseEvent<HTMLTableRowElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest("a,button,input,select,textarea,[data-no-row-open]")) return;
    onOpen();
  } : undefined;
  return (
    <TableRow
      onClick={onClick}
      onKeyDown={onOpen ? onKeyDown : undefined}
      tabIndex={onOpen ? 0 : undefined}
      data-selected={selected || undefined}
      className={cn(
        "h-11 border-line",
        onOpen && "cursor-pointer focus-visible:bg-surface-subtle focus-visible:outline-none",
        selected && "bg-surface-tint",
        index !== undefined && index < 12 && "stagger-in",
        className,
      )}
      style={index !== undefined && index < 12 ? { animationDelay: `${index * 25}ms` } : undefined}
    >
      {children}
    </TableRow>
  );
}

export function OpsTd({ children, align = "left", mono, muted, nowrap, className, colSpan }: {
  children?: ReactNode;
  align?: Align;
  mono?: boolean;
  muted?: boolean;
  nowrap?: boolean;
  className?: string;
  colSpan?: number;
}) {
  return (
    <TableCell colSpan={colSpan} className={cn("truncate px-4 py-2 align-middle text-ink-2", align === "right" && "text-right tabular-nums", mono && "text-[13px] tabular-nums tracking-[0.01em]", muted && "text-ink-4", nowrap && "whitespace-nowrap", className)}>
      {children}
    </TableCell>
  );
}

/** Title with a quieter second line; the title can be the row's real control. */
export function TitleCell({ title, subtitle, onOpen, to, icon: Icon, className }: {
  title: ReactNode;
  subtitle?: ReactNode;
  onOpen?: () => void;
  to?: string;
  icon?: ReactNode;
  className?: string;
}) {
  const label = onOpen
    ? <button type="button" onClick={onOpen} className="block max-w-full truncate text-left font-semibold text-ink-1 hover:text-brand-hover hover:underline">{title}</button>
    : to
      ? <Link to={to} className="block max-w-full truncate font-semibold text-ink-1 hover:text-brand-hover hover:underline">{title}</Link>
      : <span className="block truncate font-semibold text-ink-1">{title}</span>;
  return (
    <div className={cn("flex min-w-0 items-center gap-2.5", className)}>
      {Icon ? <span className="flex h-6 w-6 shrink-0 items-center justify-center text-ink-5">{Icon}</span> : null}
      <div className="min-w-0">
        {label}
        {subtitle ? <p className="mt-0.5 truncate text-[11.5px] text-ink-5">{subtitle}</p> : null}
      </div>
    </div>
  );
}

export function OpsTableEmpty({ children, colSpan }: { children: ReactNode; colSpan: number }) {
  return (
    <TableRow className="hover:bg-transparent">
      <TableCell colSpan={colSpan} className="px-4 py-6 text-center text-[13.5px] text-ink-4">{children}</TableCell>
    </TableRow>
  );
}
