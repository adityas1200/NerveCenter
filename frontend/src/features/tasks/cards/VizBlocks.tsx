import { useMemo, useState, type FocusEvent, type MouseEvent, type ReactNode } from "react";
import { formatValue, useWidth } from "@/components/ops/charts/chartShared";
import { cn } from "@/lib/utils";
import { AgentCard } from "./AgentCard";
import type { BarState, Block, HeatScale, Tone } from "./blocks";
import { useTaskActions } from "./taskActions";

/**
 * The catalog's richer visualisations (SPEC-tasks-10 FR-25): heatmap, gauges, funnel and gantt. Same rules
 * as the other blocks: house frame, theme colours, colour only where it carries a state or a magnitude and
 * never alone (every mark has a word or a number on hover or beside it), thin marks with rounded ends.
 */

type Of<K extends Block["kind"]> = Extract<Block, { kind: K }>;
/** `bare` drops the house frame, for a board widget that draws its own card and title. */
type Props<K extends Block["kind"]> = { block: Of<K>; compact?: boolean; className?: string; bare?: boolean };

function Frame({ bare, title, note, compact, className, children }: { bare?: boolean; title?: string | null; note?: string | null; compact?: boolean; className?: string; children: ReactNode }) {
  if (bare) return <div className={cn("min-w-0 text-[14px] text-ink-2", className)}>{children}</div>;
  return <AgentCard title={title} note={note} compact={compact} className={className}>{children}</AgentCard>;
}

/** The status families as RGB triplets, so a sequential step is one hue at a stronger alpha in both themes. */
const RGB = { bad: "225 29 72", good: "5 150 105", warning: "245 158 11", brand: "var(--c-brand)", neutral: "148 163 184" } as const;
const rgb = (key: keyof typeof RGB, alpha = 1) => (key === "brand" ? `rgb(${RGB.brand} / ${alpha})` : `rgb(${RGB[key]} / ${alpha})`);
const TONE_KEY: Record<Tone, keyof typeof RGB> = { good: "good", bad: "bad", warning: "warning", neutral: "brand" };
const TONE_TEXT: Record<Tone, string> = { neutral: "text-ink-1", good: "text-emerald-700", bad: "text-rose-700", warning: "text-amber-700" };

/** A small floating label for the mark under the pointer; positioned in the card's own box. */
function Tip({ at, children }: { at: { x: number; y: number } | null; children: ReactNode }) {
  if (!at) return null;
  return (
    <div role="tooltip" className="pointer-events-none absolute z-10 max-w-[260px] -translate-x-1/2 -translate-y-full rounded-lg border border-line bg-raised px-2.5 py-1.5 text-[12px] leading-[17px] text-ink-2 shadow-card" style={{ left: at.x, top: at.y - 8 }}>
      {children}
    </div>
  );
}

/* ---------------------------------------------------------------- heatmap */

const HEAT_HUE: Record<HeatScale, keyof typeof RGB> = { high_is_bad: "bad", high_is_good: "good", neutral: "brand" };
/** Five steps of one hue, light to dark: stepped rather than continuous so two cells are easy to compare. */
const STEPS = [0.1, 0.28, 0.48, 0.7, 0.92];

export function HeatmapBlock({ block, compact = false, className, bare }: Props<"heatmap">) {
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
  const values = block.rows.flatMap((row) => row.values).filter((value): value is number => value !== null);
  const min = values.length ? Math.min(...values) : 0;
  const max = values.length ? Math.max(...values) : 0;
  // Zero is drawn empty, so the steps spread over the values above it.
  const low = values.some((value) => value > 0) ? Math.min(...values.filter((value) => value > 0)) : min;
  const step = (value: number) => (max === low ? 2 : Math.min(STEPS.length - 1, Math.floor(((value - low) / (max - low)) * STEPS.length)));
  const hue = HEAT_HUE[block.scale];
  const shortUnit = block.unit && block.unit.length <= 12 ? block.unit : null;
  const unit = shortUnit ? ` ${shortUnit}` : "";
  const showValues = !compact && block.columns.length <= 12;
  const cell = compact ? 18 : block.columns.length > 16 ? 20 : 28;
  return (
    <Frame bare={bare} title={block.title} note={shortUnit} compact={compact} className={className}>
      <div className="relative overflow-x-auto" role="group" aria-label={block.title} onMouseLeave={() => setTip(null)}>
        <table className="w-full border-separate" style={{ borderSpacing: 3 }} aria-label={`${block.title}${unit ? `, in${unit}` : ""}`}>
          <thead>
            <tr>
              <th scope="col" className="sr-only">Row</th>
              {block.columns.map((column, index) => <th key={`${column}-${index}`} scope="col" className="px-0 pb-1 text-center text-[10.5px] font-medium text-ink-5" style={{ minWidth: cell }}>{block.columns.length > 16 && index % 2 ? "" : column}</th>)}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row) => (
              <tr key={row.label}>
                <th scope="row" className="w-[1%] max-w-[200px] truncate whitespace-nowrap pr-2 text-left text-[12.5px] font-medium text-ink-2" title={row.label}>{row.label}</th>
                {row.values.map((value, index) => {
                  const label = `${row.label} · ${block.columns[index]}: ${value === null ? "no data" : `${formatValue(value)}${unit}`}`;
                  const level = value === null || value === 0 ? -1 : step(value);
                  return (
                    <td key={index} aria-label={label} title={label}
                      onMouseEnter={(event) => { const box = event.currentTarget.closest(".relative")?.getBoundingClientRect(); const own = event.currentTarget.getBoundingClientRect(); if (box) setTip({ x: own.left - box.left + own.width / 2, y: own.top - box.top, text: label }); }}
                      className={cn("rounded-[4px] p-0 text-center align-middle text-[10.5px] font-semibold tabular-nums", value === null ? "border border-dashed border-line-strong" : value === 0 && "bg-surface-subtle")}
                      style={{ height: cell, minWidth: cell, background: level >= 0 ? rgb(hue, STEPS[level]) : undefined, color: level >= 3 ? "white" : value === 0 ? "rgb(var(--c-ink-5))" : "rgb(var(--c-ink-2))" }}>
                      {showValues && value !== null ? formatValue(value) : null}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        <Tip at={tip}>{tip?.text}</Tip>
      </div>
      {values.length ? (
        <div className="mt-2 flex items-center gap-2 text-[11.5px] text-ink-4" aria-hidden="true">
          <span className="tabular-nums">{formatValue(min)}{unit}</span>
          <span className="flex gap-[2px]">{STEPS.map((alpha) => <span key={alpha} className="h-2.5 w-5 rounded-[3px]" style={{ background: rgb(hue, alpha) }} />)}</span>
          <span className="tabular-nums">{formatValue(max)}{unit}</span>
          <span className="ml-1">{block.scale === "high_is_bad" ? "darker is worse" : block.scale === "high_is_good" ? "darker is better" : "darker is more"}</span>
        </div>
      ) : null}
      {block.note || (block.unit && !shortUnit) ? <p className="mt-2 text-[12.5px] text-ink-4">{[block.unit && !shortUnit ? block.unit : null, block.note].filter(Boolean).join(" · ")}</p> : null}
    </Frame>
  );
}

/* ----------------------------------------------------------------- gauges */

/** Good when it meets the target in its direction, warning within a tenth of the target, bad beyond. */
function gaugeTone(item: Of<"gauges">["items"][number]): Tone {
  if (item.tone) return item.tone;
  if (item.target === null) return "neutral";
  const meets = item.higherIsBetter ? item.value >= item.target : item.value <= item.target;
  if (meets) return "good";
  const gap = Math.abs(item.value - item.target) / (Math.abs(item.target) || 1);
  return gap <= 0.1 ? "warning" : "bad";
}

const GAUGE_WORD: Record<Tone, string> = { good: "On target", warning: "Near target", bad: "Off target", neutral: "" };

export function GaugesBlock({ block, compact = false, className, bare }: Props<"gauges">) {
  const size = compact ? 92 : 116;
  const stroke = compact ? 8 : 10;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  return (
    <Frame bare={bare} title={block.title} compact={compact} className={className}>
      <ul className={cn("grid gap-4", block.items.length === 1 ? "grid-cols-1" : block.items.length === 2 ? "grid-cols-2" : compact ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-4")}>
        {block.items.map((item, index) => {
          const share = Math.max(0, Math.min(1, item.value / item.max));
          const toneOf = gaugeTone(item);
          const color = rgb(TONE_KEY[toneOf]);
          const target = item.target !== null ? Math.max(0, Math.min(1, item.target / item.max)) : null;
          const unit = item.unit || "";
          const angle = target !== null ? target * 2 * Math.PI - Math.PI / 2 : 0;
          return (
            <li key={`${item.label}-${index}`} className="flex flex-col items-center text-center">
              <div className="relative" style={{ width: size, height: size }}>
                <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${item.label}: ${formatValue(item.value)}${unit} of ${formatValue(item.max)}${unit}${item.target !== null ? `, target ${formatValue(item.target)}${unit}` : ""}`}>
                  <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="rgb(var(--chart-grid))" strokeWidth={stroke} />
                  <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
                    strokeDasharray={`${Math.max(share * circumference - 0.01, 0.01)} ${circumference}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} className="motion-safe:transition-[stroke-dasharray] motion-safe:duration-300" />
                  {target !== null ? (
                    <line x1={size / 2 + (radius - stroke / 2 - 2) * Math.cos(angle)} y1={size / 2 + (radius - stroke / 2 - 2) * Math.sin(angle)} x2={size / 2 + (radius + stroke / 2 + 2) * Math.cos(angle)} y2={size / 2 + (radius + stroke / 2 + 2) * Math.sin(angle)} stroke="rgb(var(--c-ink-1))" strokeWidth={2} strokeLinecap="round" />
                  ) : null}
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className={cn("font-display font-semibold leading-none tracking-[-0.02em] tabular-nums", compact ? "text-[20px]" : "text-[24px]", TONE_TEXT[toneOf])}>{formatValue(item.value)}<span className="text-[0.55em] font-medium text-ink-4">{unit}</span></span>
                  {target !== null ? <span className="mt-1 text-[11px] tabular-nums text-ink-4">target {formatValue(item.target as number)}{unit}</span> : null}
                </div>
              </div>
              <p className="mt-2 text-[13px] font-medium text-ink-1">{item.label}</p>
              {item.sub || GAUGE_WORD[toneOf] ? <p className="mt-0.5 text-[12px] text-ink-4">{item.sub || GAUGE_WORD[toneOf]}</p> : null}
            </li>
          );
        })}
      </ul>
      {block.note ? <p className="mt-3 text-[12.5px] text-ink-4">{block.note}</p> : null}
    </Frame>
  );
}

/* ----------------------------------------------------------------- funnel */

export function FunnelBlock({ block, compact = false, className, bare }: Props<"funnel">) {
  const top = Math.max(...block.stages.map((stage) => stage.value), 1);
  const unit = block.unit ? ` ${block.unit}` : "";
  return (
    <Frame bare={bare} title={block.title} note={block.unit} compact={compact} className={className}>
      <ol className="space-y-1">
        {block.stages.map((stage, index) => {
          const previous = index ? block.stages[index - 1].value : null;
          const lost = previous !== null ? previous - stage.value : 0;
          return (
            <li key={`${stage.label}-${index}`}>
              {previous !== null && lost > 0 ? (
                <p className="py-0.5 pl-3 text-[11.5px] tabular-nums text-rose-700">−{formatValue(lost)}{unit} ({((lost / (previous || 1)) * 100).toFixed(lost / (previous || 1) < 0.1 ? 1 : 0)}%){stage.note ? <span className="text-ink-4"> · {stage.note}</span> : null}</p>
              ) : stage.note && index ? <p className="py-0.5 pl-3 text-[11.5px] text-ink-4">{stage.note}</p> : null}
              <div className="flex items-center gap-3">
                <span className={cn("w-32 shrink-0 truncate text-[13px] text-ink-2", compact && "w-24")} title={stage.label}>{stage.label}</span>
                <span className="relative h-6 min-w-0 flex-1">
                  <span className="absolute inset-y-0 left-0 rounded-[4px] motion-safe:transition-[width] motion-safe:duration-300" style={{ width: `${Math.max((stage.value / top) * 100, 1.5)}%`, background: rgb("brand", 0.35 + 0.55 * (stage.value / top)) }} />
                </span>
                <span className="w-24 shrink-0 text-right text-[13px] font-semibold tabular-nums text-ink-1">{formatValue(stage.value)}</span>
              </div>
            </li>
          );
        })}
      </ol>
      {block.stages.length >= 2 ? <p className="mt-2 text-[12.5px] text-ink-4">{((block.stages[block.stages.length - 1].value / top) * 100).toFixed(1)}% of {block.stages[0].label.toLowerCase()} reached {block.stages[block.stages.length - 1].label.toLowerCase()}{block.note ? ` · ${block.note}` : ""}</p> : null}
    </Frame>
  );
}

/* ------------------------------------------------------------------ gantt */

const BAR: Record<BarState, string> = { ok: rgb("good", 0.55), failed: rgb("bad"), warning: rgb("warning"), running: rgb("brand", 0.7), skipped: rgb("neutral", 0.45) };
const BAR_WORD: Record<BarState, string> = { ok: "Succeeded", failed: "Failed", warning: "Warning", running: "Running", skipped: "Skipped" };
const MARKER: Record<Tone, string> = { bad: rgb("bad"), warning: rgb("warning"), good: rgb("good"), neutral: "rgb(var(--c-ink-3))" };

const pad2 = (value: number) => String(value).padStart(2, "0");
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** Times read in UTC, the platform's clock: "04:12" inside a day, "11 Oct" or "11 Oct 04:00" across days. */
function clock(at: number, span: number, withDay = false): string {
  const date = new Date(at);
  const time = `${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}`;
  const day = `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`;
  if (span > 3 * 86_400_000) return withDay ? `${day} ${time}` : day;
  return withDay || span > 86_400_000 ? `${day} ${time}` : time;
}
function duration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return `${Math.max(1, Math.round(ms / 1000))}s`;
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return minutes % 60 ? `${hours}h ${minutes % 60}m` : `${hours}h`;
}
const TICK_STEPS = [5, 10, 15, 30, 60, 120, 180, 360, 720, 1440, 2880, 10080].map((minutes) => minutes * 60_000);
/** Ticks on round clock times (every 15 min, every hour, every day...), as many as fit in `most`. */
function roundTicks(from: number, to: number, most: number): number[] {
  const step = TICK_STEPS.find((candidate) => (to - from) / candidate <= most) ?? TICK_STEPS[TICK_STEPS.length - 1];
  const ticks: number[] = [];
  for (let tick = Math.ceil(from / step) * step; tick <= to; tick += step) ticks.push(tick);
  return ticks;
}
const MAX_STACK = 6;
/**
 * Bars that overlap in a lane go to sub-rows, so concurrent runs show as a stack rather than hiding each other.
 * Past MAX_STACK at once a bar shares the row that frees up first, so a pile-up stays a few rows tall.
 */
function stack<T extends { start: number; end: number }>(bars: T[]): Array<T & { row: number; crowded: boolean }> {
  const ends: number[] = [];
  return [...bars].sort((a, b) => a.start - b.start).map((bar) => {
    let row = ends.findIndex((end) => end <= bar.start);
    let crowded = false;
    if (row < 0 && ends.length < MAX_STACK) { row = ends.length; ends.push(bar.end); }
    else if (row < 0) { row = ends.indexOf(Math.min(...ends)); ends[row] = Math.max(ends[row], bar.end); crowded = true; }
    else ends[row] = bar.end;
    return { ...bar, row, crowded };
  });
}

export function GanttBlock({ block, compact = false, className, bare }: Props<"gantt">) {
  const actions = useTaskActions();
  const [hostRef, width] = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
  const now = useMemo(() => Date.now(), []);
  const { from, to, lanes } = useMemo(() => {
    const all = block.lanes.flatMap((lane) => lane.bars);
    const starts = all.map((bar) => bar.start);
    const ends = all.map((bar) => bar.end ?? Math.max(bar.start, Math.min(now, Math.max(...starts) + 3_600_000)));
    const markers = block.markers.map((marker) => marker.at);
    let from = Math.min(...starts, ...markers);
    let to = Math.max(...ends, ...markers);
    if (to - from < 60_000) to = from + 60_000;
    const margin = (to - from) * 0.03; from -= margin; to += margin;
    const lanes = block.lanes.map((lane) => {
      const placed = stack(lane.bars.map((bar, index) => ({ ...bar, index, open: bar.end === null, end: bar.end ?? ends[all.indexOf(bar)] })));
      return { ...lane, placed, rows: Math.max(1, ...placed.map((bar) => bar.row + 1)) };
    });
    return { from, to, lanes };
  }, [block, now]);
  const span = to - from;
  const left = compact ? 96 : 150;
  const plot = Math.max(120, width - left - 8);
  const x = (at: number) => ((at - from) / span) * plot;
  const ticks = roundTicks(from, to, plot > 420 ? 6 : 3);
  const rowHeight = compact ? 14 : 18;
  const show = (event: MouseEvent | FocusEvent, text: string) => { const host = hostRef.current?.getBoundingClientRect(); const own = (event.currentTarget as HTMLElement).getBoundingClientRect(); if (host) setTip({ x: own.left - host.left + own.width / 2, y: own.top - host.top, text }); };
  return (
    <Frame bare={bare} title={block.title} note="UTC" compact={compact} className={className}>
      <div ref={hostRef} className="relative" role="group" aria-label={block.title} onMouseLeave={() => setTip(null)}>
        {/* Marker labels get their own row above the clock, so they never sit on a tick. */}
        <div className="relative" style={{ marginLeft: left, height: block.markers.length ? 36 : 18 }} aria-hidden="true">
          {block.markers.map((marker) => <span key={`${marker.label}-${marker.at}`} className={cn("absolute top-0 whitespace-nowrap text-[10.5px] font-semibold", x(marker.at) > plot * 0.6 && "-translate-x-full")} style={{ left: x(marker.at), color: MARKER[marker.tone] }}>{marker.label}</span>)}
          {ticks.map((tick) => <span key={tick} className="absolute bottom-0.5 -translate-x-1/2 whitespace-nowrap text-[10.5px] tabular-nums text-ink-5" style={{ left: x(tick) }}>{clock(tick, span)}</span>)}
        </div>
        <ul className="relative space-y-1.5" aria-label={block.title}>
          {/* Grid and markers sit behind the lanes, across their full height. */}
          <li aria-hidden="true" className="pointer-events-none absolute inset-y-0" style={{ left, width: plot }}>
            {ticks.map((tick) => <span key={tick} className="absolute inset-y-0 w-px bg-line-soft" style={{ left: x(tick) }} />)}
            {block.markers.map((marker) => (
              <span key={`${marker.label}-${marker.at}`} className="absolute -top-[20px] bottom-0 w-0 border-l-2 border-dashed" style={{ left: x(marker.at), borderColor: MARKER[marker.tone] }} />
            ))}
          </li>
          {lanes.map((lane) => (
            <li key={lane.label} className="flex items-start">
              <div className="shrink-0 pr-3" style={{ width: left }}>
                <p className="truncate text-[12.5px] font-medium leading-[18px] text-ink-1" title={lane.label}>{lane.label}</p>
                {lane.sub && !compact ? <p className="truncate text-[11px] leading-4 text-ink-5">{lane.sub}</p> : null}
              </div>
              <div className="relative rounded-[4px] bg-surface-subtle/60" style={{ width: plot, height: lane.rows * (rowHeight + 3) + 3 }}>
                {lane.placed.map((bar) => {
                  const text = `${lane.label}${bar.label ? ` · ${bar.label}` : ""}: ${BAR_WORD[bar.state]}, ${clock(bar.start, span, true)}${bar.open ? ", still going" : ` to ${clock(bar.end, span, true)} (${duration(bar.end - bar.start)})`}`;
                  const style = { left: x(bar.start), width: Math.max(4, x(bar.end) - x(bar.start)), top: 3 + bar.row * (rowHeight + 3), height: rowHeight, background: BAR[bar.state] };
                  const classes = cn("absolute rounded-[4px] ring-2 ring-raised", bar.state === "running" && "motion-safe:animate-pulse");
                  return bar.ask && actions.canAsk
                    ? <button key={bar.index} type="button" aria-label={`${text}. Ask about it`} className={cn(classes, "cursor-pointer hover:brightness-110 focus-visible:outline-none focus-visible:ring-brand")} style={style} onMouseEnter={(event) => show(event, text)} onFocus={(event) => show(event, text)} onClick={() => actions.ask?.(bar.ask as string)} />
                    : <span key={bar.index} role="img" aria-label={text} className={classes} style={style} onMouseEnter={(event) => show(event, text)} />;
                })}
              </div>
            </li>
          ))}
        </ul>
        <Tip at={tip}>{tip?.text}</Tip>
      </div>
      <div className="mt-2.5 flex flex-wrap gap-x-3 gap-y-1 text-[11.5px] text-ink-4">
        {(Object.keys(BAR) as BarState[]).filter((state) => lanes.some((lane) => lane.placed.some((bar) => bar.state === state))).map((state) => <span key={state} className="flex items-center gap-1.5"><span className="h-2 w-3 rounded-[2px]" style={{ background: BAR[state] }} />{BAR_WORD[state]}</span>)}
        {lanes.some((lane) => lane.rows > 1) ? <span>Stacked bars ran at the same time</span> : null}
        {lanes.some((lane) => lane.placed.some((bar) => bar.crowded)) ? <span>Over {MAX_STACK} at once overlap in place</span> : null}
        {bare ? <span className="ml-auto">Times in UTC</span> : null}
      </div>
      {block.note ? <p className="mt-2 text-[12.5px] text-ink-4">{block.note}</p> : null}
    </Frame>
  );
}
