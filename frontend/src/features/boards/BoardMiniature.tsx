import { useQuery } from "@tanstack/react-query";
import { boardKeys, boardsApi, type BoardWidget } from "@/api/boards";
import { cn } from "@/lib/utils";
import { FRESH } from "@/api/queryPolicy";

/**
 * A board in miniature: its real widgets, in their real order and sizes, on the same four-column
 * grid the board page uses. Each block is drawn by the kind of widget it is (a figure, columns, a
 * line, a ring, rows of a table, lines of text), the way a file icon says "spreadsheet" without
 * showing the numbers. Nothing here is data: the shapes describe the layout, so the preview is
 * honest and still reads at a glance which board is which.
 */

const SPAN: Record<BoardWidget["size"], string> = { sm: "col-span-1", md: "col-span-2", lg: "col-span-4" };
const MAX_BLOCKS = 8;

export function BoardMiniature({ boardId, count }: { boardId: string; count: number }) {
  const board = useQuery({ queryKey: boardKeys.detail(boardId), queryFn: ({ signal }) => boardsApi.get(boardId, signal), staleTime: FRESH.long, enabled: count > 0 });
  const widgets = (board.data?.widgets ?? []).slice(0, MAX_BLOCKS);
  return (
    <span aria-hidden="true" className="relative block h-[112px] overflow-hidden rounded-t-[11px] border-b border-line bg-surface-panel px-3 pt-3 [mask-image:linear-gradient(to_bottom,black_72%,transparent)]">
      <span className="absolute inset-0 bg-[radial-gradient(rgb(var(--c-ink-1)/0.05)_1px,transparent_1px)] bg-[size:10px_10px]" />
      <span className="relative grid grid-cols-4 gap-1.5 transition-transform duration-500 ease-out group-hover:-translate-y-1">
        {widgets.length
          ? widgets.map((widget, index) => <Block key={widget.id} widget={widget} index={index} />)
          : Array.from({ length: count ? Math.min(count, 6) : 4 }, (_, index) => <span key={index} className={cn("h-[34px] rounded-md bg-raised/70 shadow-[0_0_0_1px_rgb(var(--c-line))]", index % 3 === 2 ? "col-span-2" : "col-span-1", board.isPending && count ? "animate-pulse" : "")} />)}
      </span>
    </span>
  );
}

function Block({ widget, index }: { widget: BoardWidget; index: number }) {
  const tall = widget.type === "chart" || widget.type === "table";
  return (
    <span
      className={cn("stagger-in flex min-w-0 flex-col justify-end overflow-hidden rounded-md bg-raised px-1.5 py-1.5 shadow-[0_0_0_1px_rgb(var(--c-line)),var(--shadow-card)]", SPAN[widget.size], tall ? "h-[52px]" : "h-[34px]")}
      style={{ animationDelay: `${index * 35}ms` }}
    >
      <Glyph widget={widget} />
    </span>
  );
}

/** The kind of widget as a shape. Heights and lengths are fixed per kind, never taken from data. */
function Glyph({ widget }: { widget: BoardWidget }) {
  const chart = widget.viz?.chart ?? "column";
  if (widget.type === "metric") {
    return <span className="flex flex-col gap-1"><span className="h-1 w-6 rounded-full bg-ink-5/40" /><span className="h-2 w-4 rounded-sm bg-ink-3/70" /></span>;
  }
  if (widget.type === "text") {
    return <span className="flex flex-col gap-1">{[90, 70, 80].map((width) => <span key={width} className="h-1 rounded-full bg-ink-5/35" style={{ width: `${width}%` }} />)}</span>;
  }
  if (widget.type === "table") {
    return <span className="flex flex-col gap-[3px]">{[0, 1, 2, 3].map((row) => <span key={row} className={cn("h-[3px] rounded-full", row === 0 ? "bg-ink-5/55" : "bg-ink-5/25")} />)}</span>;
  }
  if (chart === "donut" || chart === "pie") {
    return (
      <svg viewBox="0 0 36 36" className="mx-auto h-8 w-8">
        <circle cx="18" cy="18" r="13" fill="none" stroke="rgb(var(--c-subtle))" strokeWidth="6" />
        <circle cx="18" cy="18" r="13" fill="none" stroke="rgb(var(--c-brand))" strokeOpacity="0.75" strokeWidth="6" strokeDasharray="48 82" transform="rotate(-90 18 18)" />
        <circle cx="18" cy="18" r="13" fill="none" stroke="rgb(var(--c-brand))" strokeOpacity="0.35" strokeWidth="6" strokeDasharray="20 82" strokeDashoffset="-48" transform="rotate(-90 18 18)" />
      </svg>
    );
  }
  if (chart === "line" || chart === "area") {
    return (
      <svg viewBox="0 0 100 32" preserveAspectRatio="none" className="h-8 w-full overflow-visible">
        {chart === "area" ? <path d="M0 26 C 18 22, 26 12, 42 15 S 70 6, 100 9 L100 32 L0 32 Z" fill="rgb(var(--c-brand))" fillOpacity="0.12" /> : null}
        <path d="M0 26 C 18 22, 26 12, 42 15 S 70 6, 100 9" fill="none" stroke="rgb(var(--c-brand))" strokeOpacity="0.8" strokeWidth="2" vectorEffect="non-scaling-stroke" className="chart-line" pathLength={1} />
      </svg>
    );
  }
  const bars = chart === "bar" ? [80, 60, 45, 30] : [45, 70, 55, 85, 60, 75];
  if (chart === "bar") return <span className="flex flex-col gap-[3px]">{bars.map((width, index) => <span key={index} className="h-[4px] rounded-full bg-brand/60" style={{ width: `${width}%` }} />)}</span>;
  return <span className="flex h-8 items-end gap-[3px]">{bars.map((height, index) => <span key={index} className="chart-col flex-1 rounded-t-[2px] bg-brand/55" style={{ height: `${height}%`, animationDelay: `${index * 40}ms` }} />)}</span>;
}
