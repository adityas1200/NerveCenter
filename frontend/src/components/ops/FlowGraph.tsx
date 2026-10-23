import { ChevronLeft, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { COL_GAP, HEAD, layoutFlow, NODE_H, NODE_W, ROW_GAP, type FlowEdge, type FlowNode, type FlowTone } from "./flowLayout";

export type { FlowEdge, FlowNode, FlowTone } from "./flowLayout";

/**
 * A left-to-right graph of up to a few dozen nodes: data lineage (source → table → board) and a
 * task's journey (asked → checked → found → fixed). Nodes sit in columns, by the column given or by
 * their distance from the first node; edges are drawn as curves behind them. Colour only on status.
 * Each node is a button, so the graph is keyboard-reachable and a screen reader reads it column by
 * column; `onSelect` opens what a node stands for.
 */

const TONE_NODE: Record<FlowTone, string> = {
  neutral: "border-line bg-raised",
  muted: "border-line border-dashed bg-surface-subtle text-ink-4",
  good: "border-emerald-300 bg-raised",
  bad: "border-rose-300 bg-rose-50",
  warning: "border-amber-300 bg-amber-50",
  focus: "border-brand bg-raised ring-1 ring-brand",
};
const TONE_DOT: Record<FlowTone, string> = { neutral: "bg-ink-5", muted: "bg-line-strong", good: "bg-emerald-500", bad: "bg-rose-500", warning: "bg-amber-500", focus: "bg-brand" };
const TONE_EDGE: Record<FlowTone, string> = { neutral: "stroke-line-strong", muted: "stroke-line", good: "stroke-emerald-400", bad: "stroke-rose-400", warning: "stroke-amber-400", focus: "stroke-brand" };
const TONE_BADGE: Record<FlowTone, string> = { neutral: "text-ink-4", muted: "text-ink-5", good: "text-emerald-700", bad: "text-rose-700", warning: "text-amber-800", focus: "text-brand" };

export function FlowGraph({ nodes, edges, columnLabels, selected, onSelect, label, className }: {
  nodes: FlowNode[];
  edges: FlowEdge[];
  /** Words above each column ("Upstream", "Checked"…), in column order. */
  columnLabels?: string[];
  selected?: string | null;
  onSelect?: (id: string) => void;
  /** What the graph shows, for assistive technology. */
  label: string;
  className?: string;
}) {
  const layout = useMemo(() => layoutFlow(nodes, edges), [nodes, edges]);
  const head = columnLabels?.length ? HEAD : 0;
  const width = layout.columns * NODE_W + (layout.columns - 1) * COL_GAP;
  const height = head + layout.rows * NODE_H + (layout.rows - 1) * ROW_GAP;
  const at = (id: string) => { const place = layout.positions.get(id); return place ? { x: place.column * (NODE_W + COL_GAP), y: head + place.row * (NODE_H + ROW_GAP) } : null; };
  const ordered = [...nodes].sort((a, b) => { const pa = layout.positions.get(a.id); const pb = layout.positions.get(b.id); return (pa?.column ?? 0) - (pb?.column ?? 0) || (pa?.row ?? 0) - (pb?.row ?? 0); });
  // A graph wider than its pane scrolls sideways; the fades and arrows say there is more.
  const scroller = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState({ left: false, right: false });
  const measure = useCallback(() => { const el = scroller.current; if (!el) return; setMore({ left: el.scrollLeft > 4, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 4 }); }, []);
  useEffect(() => { measure(); const el = scroller.current; if (!el || typeof ResizeObserver === "undefined") return undefined; const observer = new ResizeObserver(measure); observer.observe(el); return () => observer.disconnect(); }, [measure, width]);
  const page = (direction: 1 | -1) => scroller.current?.scrollBy({ left: direction * Math.max(NODE_W + COL_GAP, (scroller.current.clientWidth || 0) * 0.8), behavior: "smooth" });
  return (
    <div className={cn("relative", className)}>
      {more.left ? <><div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-10 bg-gradient-to-r from-raised to-transparent" aria-hidden="true" /><button type="button" onClick={() => page(-1)} aria-label="Show earlier steps" className="absolute left-1 top-1/2 z-20 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-line bg-raised text-ink-3 shadow-card hover:text-ink-1"><ChevronLeft className="h-4 w-4" aria-hidden="true" /></button></> : null}
      {more.right ? <><div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-10 bg-gradient-to-l from-raised to-transparent" aria-hidden="true" /><button type="button" onClick={() => page(1)} aria-label="Show later steps" className="absolute right-1 top-1/2 z-20 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-line bg-raised text-ink-3 shadow-card hover:text-ink-1"><ChevronRight className="h-4 w-4" aria-hidden="true" /></button></> : null}
      <div ref={scroller} onScroll={measure} className="overflow-x-auto overscroll-x-contain pb-1" role="group" aria-label={label}>
        <div className="relative" style={{ width, height, minWidth: width }}>
          {columnLabels?.length ? columnLabels.slice(0, layout.columns).map((text, index) => (
            <span key={`${text}-${index}`} className="absolute top-0 text-[11.5px] font-medium text-ink-5" style={{ left: index * (NODE_W + COL_GAP) }} aria-hidden="true">{text}</span>
          )) : null}
          <svg className="pointer-events-none absolute inset-0" width={width} height={height} aria-hidden="true">
            {edges.map((edge, index) => {
              const from = at(edge.from); const to = at(edge.to); if (!from || !to) return null;
              const x1 = from.x + NODE_W; const y1 = from.y + NODE_H / 2; const x2 = to.x; const y2 = to.y + NODE_H / 2;
              const bend = Math.max(24, Math.abs(x2 - x1) / 2);
              return <path key={`${edge.from}-${edge.to}-${index}`} d={`M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`} fill="none" strokeWidth={1.5} strokeDasharray={edge.dashed ? "4 4" : undefined} className={TONE_EDGE[edge.tone ?? "neutral"]} />;
            })}
          </svg>
          {ordered.map((node) => {
            const place = at(node.id); if (!place) return null;
            const tone = node.tone ?? "neutral"; const Icon = node.icon;
            const isSelected = selected === node.id;
            return (
              <button key={node.id} type="button" onClick={onSelect ? () => onSelect(node.id) : undefined} disabled={!onSelect}
                aria-pressed={onSelect ? isSelected : undefined}
                aria-label={[node.title, node.badge, node.subtitle].filter(Boolean).join(", ")}
                title={[node.title, node.subtitle].filter(Boolean).join("\n")}
                className={cn("absolute flex flex-col justify-center rounded-lg border px-3 text-left transition-shadow duration-200 disabled:cursor-default", TONE_NODE[tone], onSelect && "hover:shadow-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30", isSelected && "shadow-card ring-2 ring-brand/40")}
                style={{ left: place.x, top: place.y, width: NODE_W, height: NODE_H }}>
                <span className="flex min-w-0 items-center gap-1.5">
                  {Icon ? <Icon className="h-3.5 w-3.5 shrink-0 text-ink-4" aria-hidden="true" /> : <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", TONE_DOT[tone])} aria-hidden="true" />}
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink-1">{node.title}</span>
                </span>
                {node.subtitle || node.badge ? (
                  <span className="mt-0.5 flex min-w-0 items-baseline gap-2">
                    <span className="min-w-0 flex-1 truncate text-[12px] text-ink-4">{node.subtitle}</span>
                    {node.badge ? <span className={cn("shrink-0 text-[11.5px] font-medium tabular-nums", TONE_BADGE[tone])}>{node.badge}</span> : null}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
