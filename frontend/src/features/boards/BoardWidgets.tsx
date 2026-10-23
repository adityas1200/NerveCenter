/* eslint-disable react-refresh/only-export-components */
import { ArrowDown, ArrowUp, Scaling, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { BoardFix, BoardWidget, ChartKind, WidgetCell, WidgetResult, WidgetSize } from "@/api/boards";
import { AGENT_NAME } from "@/components/ops/agentPanelContext";
import { AnimatedNumber } from "@/components/ops/AnimatedNumber";
import { AskSonicButton, PickedPoint } from "@/components/ops/AskSonic";
import { BarChart } from "@/components/ops/charts/BarChart";
import { ChartLegend, ColumnChart, type ChartSeries } from "@/components/ops/charts/ColumnChart";
import { formatValue } from "@/components/ops/charts/chartShared";
import { DonutChart } from "@/components/ops/charts/DonutChart";
import { LineChart } from "@/components/ops/charts/LineChart";
import { Sparkline } from "@/components/ops/charts/Sparkline";
import { Markdown } from "@/components/ops/Markdown";
import { OperationalStatus } from "@/components/ops/OperationalStatus";
import { OpsBody, OpsHead, OpsRow, OpsTable, OpsTableEmpty, OpsTd, OpsTh } from "@/components/ops/OpsTable";
import { OverflowMenu } from "@/components/ops/OverflowMenu";
import type { StatTone } from "@/components/ops/StatStrip";
import { Button, RelativeTime, Skeleton, Tooltip, TooltipContent, TooltipTrigger, formatRelativeTime } from "@/components/ui";
import { cn } from "@/lib/utils";
import { FunnelBody, GanttBody, GaugeBody, HeatmapBody } from "./BoardViz";
import { chartPoint, pointLabel, rowPoint, type WidgetPoint } from "./boardSelection";

/**
 * How a board draws one widget. The backend has already computed columns and rows for the reader's
 * filters; these components only lay the data out in the house style: metrics as flat number cells,
 * tables as an OpsTable, charts as a column, bar, line, area, donut, pie, heatmap, funnel or gantt chart
 * picked by `viz.chart`, a metric with `viz.gauge` as a ring against its target, notes as Markdown. Every widget is one flat card in a four-column grid; `sm` takes a quarter, `md` a
 * half, `lg` the full row. While Sonic builds the board, new widgets rise in and removed ones fade out.
 */

export const SIZE_CLASS: Record<WidgetSize, string> = {
  sm: "col-span-1",
  md: "col-span-1 md:col-span-2",
  lg: "col-span-1 md:col-span-2 xl:col-span-4",
};

const SIZE_ORDER: WidgetSize[] = ["sm", "md", "lg"];
export const nextSize = (size: WidgetSize): WidgetSize => SIZE_ORDER[(SIZE_ORDER.indexOf(size) + 1) % SIZE_ORDER.length];

const SKELETON_HEIGHT: Record<BoardWidget["type"], number> = { metric: 72, chart: 180, table: 220, text: 96 };

/**
 * One chart palette. Status words take the status colours the Overview uses (emerald-600 good,
 * rose-600 bad, amber-500 warning); neutral counts take ink-5 grey; the first series takes the brand;
 * anything else steps through slate, violet and blue in a fixed order so a colour follows its series.
 */
const COLOR = { good: "#059669", bad: "#E11D48", warning: "#F59E0B", neutral: "#94A3B8", brand: "#6366F1" };
const EXTRA = ["#64748B", "#7C3AED", "#2563EB", "#0891B2", "#1E3A5F"];

function statusColor(text: string): string | null {
  if (/succeeded|success|resolved|passed|healthy|completed|\bdone\b|\blow\b/.test(text)) return COLOR.good;
  if (/failed|failure|error|critical/.test(text)) return COLOR.bad;
  if (/warning|overdue|\blate\b|\bhigh\b|waiting/.test(text)) return COLOR.warning;
  return null;
}

export function seriesColor(name: string, index: number): string {
  const text = name.toLowerCase();
  const status = statusColor(text);
  if (status) return status;
  if (/raised|finished|total|opened|created|count/.test(text)) return index === 0 ? COLOR.brand : COLOR.neutral;
  return index === 0 ? COLOR.brand : EXTRA[(index - 1) % EXTRA.length];
}

/** Donut and pie slices are categories, not series: a status word keeps its colour, the rest step through the palette in order. */
export function sliceColor(label: string, index: number): string {
  const text = label.toLowerCase();
  const status = statusColor(text);
  if (status) return status;
  if (/medium|in progress|running/.test(text)) return COLOR.brand;
  if (/other|unknown|none|paused/.test(text)) return COLOR.neutral;
  return [COLOR.brand, ...EXTRA, COLOR.neutral][index % (EXTRA.length + 2)];
}

/** Colour on a metric only when its label names a state; everything else stays ink. */
function labelTone(label: string): StatTone {
  const text = label.toLowerCase();
  if (/failed|failure|error|critical/.test(text)) return "rose";
  if (/overdue|warning|late|high/.test(text)) return "amber";
  if (/healthy|passed|succeeded|resolved|successful/.test(text)) return "emerald";
  return "slate";
}

const VIZ_TONE: Record<string, StatTone> = { good: "emerald", bad: "rose", warning: "amber", neutral: "slate" };
const VALUE_TONE: Record<StatTone, string> = { rose: "text-rose-700", amber: "text-amber-700", emerald: "text-emerald-700", blue: "text-blue-700", violet: "text-violet-700", slate: "text-ink-1" };

const isNumber = (value: WidgetCell): value is number => typeof value === "number" && Number.isFinite(value);
const isIso = (value: WidgetCell): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value) && !Number.isNaN(Date.parse(value));

type ColumnKind = "number" | "time" | "status" | "text";

function columnKind(column: string, index: number, rows: WidgetCell[][], statusColumn?: string | null): ColumnKind {
  if (statusColumn ? column === statusColumn : /^(status|health|state)$/i.test(column)) return "status";
  const sample = rows.map((row) => row[index]).filter((cell) => cell !== null && cell !== undefined && cell !== "").slice(0, 8);
  if (sample.length && sample.every(isNumber)) return "number";
  if (sample.length && sample.every(isIso)) return "time";
  return "text";
}

/** Chart labels come from the backend as bucket labels; an ISO bucket is shortened to a day or an hour. */
function axisLabel(cell: WidgetCell): string {
  if (isIso(cell)) {
    const date = new Date(cell);
    return date.getHours() || date.getMinutes() ? date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false }) : date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  }
  return String(cell ?? "");
}

export interface WidgetEditControls {
  onMove: (direction: -1 | 1) => void;
  onResize: () => void;
  onRemove: () => void;
  /** Hand this widget to Sonic with a "Change widget …" opener. */
  onAsk?: () => void;
  first: boolean;
  last: boolean;
}

/** How a widget arrived while Sonic builds: it is new to the board, or it has just been removed and is fading out. */
export type WidgetTransition = "enter" | "leave" | null;

/**
 * Counts changes to a widget's figures under the same filters; each change replays a soft ring so a
 * refreshed or rebuilt widget is easy to spot. A filter change (a new `dataKey`) does not count.
 */
function useDataChanges(result: WidgetResult | undefined, dataKey: string | undefined): number {
  const signature = result && !result.error ? JSON.stringify([result.columns, result.rows, result.markdown]) : null;
  const seen = useRef<{ key: string | undefined; signature: string | null }>({ key: dataKey, signature });
  const [changes, setChanges] = useState(0);
  useEffect(() => {
    const before = seen.current;
    seen.current = { key: dataKey, signature };
    if (signature && before.signature && before.key === dataKey && before.signature !== signature) setChanges((count) => count + 1);
  }, [signature, dataKey]);
  return changes;
}

/** A picked chart bucket or table row: where it sits in the data, and what it says. */
interface Picked { index: number; point: WidgetPoint }

export function WidgetCard({ widget, result, editing, onFix, onAsk, fix = null, index, transition = null, dataKey }: {
  widget: BoardWidget;
  result: WidgetResult | undefined;
  /** Present in edit mode: the label row grows move, size and remove controls. */
  editing?: WidgetEditControls | null;
  /** Builders get a way to hand a failing widget to Sonic. */
  onFix?: (widget: BoardWidget, error: string) => void;
  /** People who can chat ask Sonic about the widget or a point on it (SPEC-tasks-12 FR-1, FR-2). */
  onAsk?: (widget: BoardWidget, point: WidgetPoint | null) => void;
  /** The latest fix Sonic applied to the data behind this widget (SPEC-tasks-13 FR-18). */
  fix?: BoardFix | null;
  index?: number;
  transition?: WidgetTransition;
  /** The filters the shown figures belong to; see `useDataChanges`. */
  dataKey?: string;
}) {
  const changes = useDataChanges(result, dataKey);
  const [picked, setPicked] = useState<Picked | null>(null);
  // New figures or filters move the points, so a pick made on the old ones is dropped.
  const figures = result && !result.error ? JSON.stringify([result.columns, result.rows]) : null;
  useEffect(() => { setPicked(null); }, [figures, dataKey]);
  // Escape lets go of a pick, wherever focus is (FR-2).
  useEffect(() => {
    if (!picked) return undefined;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setPicked(null); };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, [picked]);
  const pick = onAsk && !editing ? (next: Picked) => setPicked((current) => (current && current.index === next.index ? null : next)) : undefined;
  const meta = result?.error ? null : widget.note || (result?.source || result?.at ? [result.source, result.at ? `updated ${formatRelativeTime(result.at)}` : null].filter(Boolean).join(" · ") : null);
  const staggered = transition === null && index !== undefined && index < 12;
  return (
    <section
      aria-label={widget.title}
      aria-hidden={transition === "leave" || undefined}
      data-widget-id={widget.id}
      data-transition={transition ?? undefined}
      className={cn("group/widget motion-surface relative flex min-w-0 flex-col overflow-hidden rounded-2xl border border-line bg-raised px-4 pb-3.5 pt-3 shadow-card hover:border-line-strong", SIZE_CLASS[widget.size], staggered && "stagger-in", transition === "enter" && "board-widget-enter", transition === "leave" && "board-widget-leave")}
      style={staggered ? { animationDelay: `${index * 30}ms` } : undefined}
    >
      {changes ? <span key={changes} aria-hidden="true" data-testid="widget-updated" className="widget-updated pointer-events-none absolute inset-0 rounded-[inherit]" /> : null}
      <div className="mb-3 flex min-h-[26px] items-center justify-between gap-3 text-[12px] leading-4">
        <span className="flex min-w-0 items-center gap-2">
          <h3 className="min-w-0 truncate text-[13px] font-semibold text-ink-1" title={widget.size === "sm" && meta ? `${widget.title} · ${meta}` : widget.title}>{widget.title}</h3>
        </span>
        <span className="flex min-w-0 shrink items-center gap-1.5">
          {editing ? <EditControls widget={widget} controls={editing} /> : meta && widget.size !== "sm" ? <span className="min-w-0 shrink truncate text-ink-5" title={meta}>{meta}</span> : null}
          {onAsk && !editing && transition !== "leave" ? <AskSonicButton about={widget.title} onClick={() => onAsk(widget, null)} className="opacity-0 transition-opacity focus-visible:opacity-100 group-hover/widget:opacity-100 group-focus-within/widget:opacity-100" /> : null}
        </span>
      </div>
      {fix ? <FixMarker fix={fix} /> : null}
      {picked && onAsk ? <PickedPoint className="mb-2.5" label={pointLabel(picked.point)} onAsk={() => onAsk(widget, picked.point)} onClear={() => setPicked(null)} /> : null}
      <div className="min-w-0 flex-1">
        {!result ? <WidgetShimmer widget={widget} />
          : result.error ? <WidgetError widget={widget} error={result.error} onFix={onFix} />
          : <WidgetBody widget={widget} result={result} picked={picked?.index ?? null} onPick={pick} />}
      </div>
    </section>
  );
}

/**
 * A widget's figures without its frame, for a board and for a fix preview ("Now" and "After fix", SPEC-tasks-13
 * FR-8). With `onPick`, chart buckets and table rows can be picked.
 */
export function WidgetBody({ widget, result, picked = null, onPick }: { widget: BoardWidget; result: WidgetResult; picked?: number | null; onPick?: (picked: Picked) => void }) {
  if (widget.type === "metric") return <MetricBody widget={widget} result={result} />;
  if (widget.type === "table") return <TableBody widget={widget} result={result} picked={picked} onPick={onPick} />;
  if (widget.type === "chart") return <ChartBody key={`${widget.id}:${JSON.stringify(widget.viz ?? {})}`} widget={widget} result={result} picked={picked} onPick={onPick} />;
  return <Markdown className="text-[13.5px]">{result.markdown ?? widget.source.markdown ?? ""}</Markdown>;
}

const FIX_WORD: Record<string, string> = { passed: "verified", failed: "check failed", inconclusive: "not verified" };

/** "Fixed by Sonic · verified · T-1042" under the widget's title, linking the task that did it. */
function FixMarker({ fix }: { fix: BoardFix }) {
  const good = fix.status === "passed";
  return (
    <Link to={`/tasks/${encodeURIComponent(fix.taskId)}`} className="-mt-1.5 mb-2.5 inline-flex min-w-0 max-w-full items-center gap-1.5 self-start truncate text-[12px] text-ink-4 hover:text-ink-1" title={`${fix.title} · applied ${formatRelativeTime(fix.appliedAt)}`} data-testid="widget-fix">
      <span aria-hidden="true" className={cn("h-1.5 w-1.5 shrink-0 rounded-full", good ? "bg-emerald-500" : "bg-amber-500")} />
      <span className="truncate">Fixed by {AGENT_NAME} · <span className={good ? "text-emerald-700" : "text-amber-700"}>{FIX_WORD[fix.status] ?? fix.status}</span> · {fix.taskId}</span>
    </Link>
  );
}

/** A light gradient sweep sized to the widget, while its data is on the way. */
function WidgetShimmer({ widget }: { widget: BoardWidget }) {
  return <div className="board-shimmer w-full rounded-lg" style={{ height: SKELETON_HEIGHT[widget.type] }} aria-hidden="true" data-testid="widget-shimmer" />;
}

/** The grid placeholder while the board's data loads: one card per widget at its size. */
export function WidgetSkeleton({ widget }: { widget: BoardWidget }) {
  return (
    <div className={cn("flex flex-col rounded-2xl border border-line bg-raised px-4 pb-3.5 pt-3 shadow-card", SIZE_CLASS[widget.size])} aria-hidden="true">
      <div className="mb-3 flex items-center justify-between"><span className="flex items-center gap-2"><Skeleton className="h-6 w-6 rounded-md" /><Skeleton className="h-2.5 w-28" /></span><Skeleton className="h-2.5 w-16" /></div>
      <WidgetShimmer widget={widget} />
    </div>
  );
}

function EditControls({ widget, controls }: { widget: BoardWidget; controls: WidgetEditControls }) {
  const icon = "h-6 w-6 rounded-md text-ink-4 hover:bg-surface-subtle hover:text-ink-1";
  return (
    <span className="flex shrink-0 items-center gap-0.5" data-no-row-open>
      <Button size="icon" variant="ghost" className={icon} disabled={controls.first} onClick={() => controls.onMove(-1)} aria-label={`Move ${widget.title} up`}><ArrowUp className="h-3.5 w-3.5" /></Button>
      <Button size="icon" variant="ghost" className={icon} disabled={controls.last} onClick={() => controls.onMove(1)} aria-label={`Move ${widget.title} down`}><ArrowDown className="h-3.5 w-3.5" /></Button>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button size="icon" variant="ghost" className={cn(icon, "w-auto gap-1 px-1.5 text-[11px] font-semibold uppercase")} onClick={controls.onResize} aria-label={`Resize ${widget.title}, now ${widget.size}`}><Scaling className="h-3.5 w-3.5" />{widget.size}</Button>
        </TooltipTrigger>
        <TooltipContent>Size {widget.size} → {nextSize(widget.size)}</TooltipContent>
      </Tooltip>
      <Button size="icon" variant="ghost" className={cn(icon, "hover:text-rose-700")} onClick={controls.onRemove} aria-label={`Remove ${widget.title}`}><X className="h-3.5 w-3.5" /></Button>
      {controls.onAsk ? <OverflowMenu className="h-6 w-6 rounded-md" label={`More actions for ${widget.title}`} items={[{ label: `Ask ${AGENT_NAME} to change this`, onSelect: controls.onAsk }]} /> : null}
    </span>
  );
}

function WidgetError({ widget, error, onFix }: { widget: BoardWidget; error: string; onFix?: (widget: BoardWidget, error: string) => void }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 py-1 text-[13.5px] leading-5 text-ink-3">
      <span className="inline-flex items-center gap-2"><span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-rose-500" />{error}</span>
      {onFix ? <button type="button" className="font-medium text-brand hover:text-brand-hover hover:underline" onClick={() => onFix(widget, error)}>Ask Sonic to fix it</button> : null}
    </div>
  );
}

function MetricBody({ widget, result }: { widget: BoardWidget; result: WidgetResult }) {
  const columns = result.columns ?? [];
  const rows = result.rows ?? [];
  const viz = widget.viz ?? {};
  const toneFor = (label: string): StatTone => (viz.tone && viz.tone !== "auto" ? VIZ_TONE[viz.tone] : labelTone(label));
  if (!rows.length) return <p className="py-2 text-[13.5px] text-ink-5">No data</p>;

  if (viz.gauge) {
    const valueIndex = viz.valueColumn && columns.includes(viz.valueColumn) ? columns.indexOf(viz.valueColumn) : rows[0].findIndex(isNumber);
    const labelIndex = viz.labelColumn ? columns.indexOf(viz.labelColumn) : -1;
    // The row names what the number is ("Succeeded"); a lone value falls back to its column.
    const textIndex = rows[0].findIndex((cell) => typeof cell === "string" && cell.trim() !== "");
    const label = labelIndex >= 0 ? String(rows[0][labelIndex] ?? "") : textIndex >= 0 ? String(rows[0][textIndex]) : columns[valueIndex] ?? widget.title;
    if (valueIndex >= 0 && isNumber(rows[0][valueIndex])) return <GaugeBody widget={widget} label={label} value={rows[0][valueIndex]} />;
  }

  // A trend: the result is a Period column plus one numeric column. The number is the last value.
  const periodIndex = columns.findIndex((column) => /^period$/i.test(column));
  const numeric = columns.map((column, index) => ({ column, index })).filter(({ column, index }) => index !== periodIndex && columnKind(column, index, rows) === "number");
  if (viz.sparkline && periodIndex >= 0 && numeric.length === 1) {
    const { column, index } = numeric[0];
    const values = rows.map((row) => (isNumber(row[index]) ? row[index] : 0));
    return <MetricCell label={column} value={values[values.length - 1]} suffix={viz.suffix ?? undefined} tone={toneFor(column)} single trend={values} />;
  }

  const valueIndex = viz.valueColumn ? columns.indexOf(viz.valueColumn) : -1;
  if (valueIndex >= 0) {
    const labelIndex = viz.labelColumn ? columns.indexOf(viz.labelColumn) : -1;
    const label = labelIndex >= 0 ? String(rows[0][labelIndex] ?? "") : viz.valueColumn ?? "";
    return <MetricCell label={label} value={rows[0][valueIndex]} suffix={viz.suffix ?? undefined} tone={toneFor(label)} single />;
  }

  if (columns.length === 2 && rows.length <= 4 && rows.every((row) => isNumber(row[1]) || row[1] === null)) {
    return (
      <div className={cn("grid divide-x divide-line", rows.length === 1 ? "grid-cols-1" : rows.length === 2 ? "grid-cols-2" : rows.length === 3 ? "grid-cols-3" : "grid-cols-2 sm:grid-cols-4")}>
        {rows.map((row, position) => {
          const label = String(row[0] ?? columns[0]);
          return <MetricCell key={`${label}-${position}`} label={label} value={row[1]} tone={toneFor(label)} className={position ? "pl-4" : ""} />;
        })}
      </div>
    );
  }

  for (const row of rows) {
    const cellIndex = row.findIndex(isNumber);
    if (cellIndex >= 0) return <MetricCell label={columns[cellIndex] ?? widget.title} value={row[cellIndex]} suffix={viz.suffix ?? undefined} tone={toneFor(columns[cellIndex] ?? "")} single />;
  }
  return <MetricCell label={columns[0] ?? widget.title} value={rows[0][0]} single />;
}

/** "+3", "-2" or "0": the last value against the first, for a trend's delta. */
const signed = (delta: number) => (delta > 0 ? `+${formatValue(delta)}` : delta < 0 ? `-${formatValue(Math.abs(delta))}` : "0");

/** One label over one number, no border of its own: several sit side by side inside the widget's card. With `trend`, a sparkline and the delta vs the first value sit under the number. */
function MetricCell({ label, value, suffix, tone = "slate", single, className, trend }: { label: string; value: WidgetCell; suffix?: string; tone?: StatTone; single?: boolean; className?: string; trend?: number[] }) {
  const numeric = isNumber(value) ? value : Number(String(value ?? "").replace(/[^\d.-]/g, ""));
  const emphasised = !Number.isNaN(numeric) && numeric > 0;
  const shown = value === null || value === undefined || value === "" ? "—" : isNumber(value) ? formatValue(value) : String(value);
  const delta = trend && trend.length > 1 ? trend[trend.length - 1] - trend[0] : null;
  return (
    <div className={cn("min-w-0", className)} aria-label={`${label}: ${shown}${suffix ? ` ${suffix}` : ""}${delta !== null ? `, ${signed(delta)} since the start of the period` : ""}`}>
      <span className="block truncate text-[12.5px] font-medium text-ink-4">{label}</span>
      <span className="mt-1 flex items-baseline gap-1.5">
        <span className={cn("font-display font-semibold leading-[1.1] tracking-[-0.02em] tabular-nums", single ? "text-[34px]" : "text-[26px]", emphasised ? VALUE_TONE[tone] : "text-ink-1")}>{isNumber(value) ? <AnimatedNumber value={value} format={formatValue} /> : shown}</span>
        {suffix ? <span className="truncate text-[13.5px] font-medium tabular-nums text-ink-5">{suffix}</span> : null}
      </span>
      {trend && delta !== null ? (
        <span className="mt-1.5 flex items-center gap-2">
          <Sparkline values={trend} color={emphasised && tone !== "slate" ? { rose: "#E11D48", amber: "#F59E0B", emerald: "#059669", blue: "#2563EB", violet: "#7C3AED", slate: "#6366F1" }[tone] : "#6366F1"} ariaLabel={`${label} over the period`} />
          <span className="text-[12.5px] tabular-nums text-ink-5" data-testid="metric-delta">{signed(delta)}</span>
        </span>
      ) : null}
    </div>
  );
}

const COLUMN_WIDTH: Record<ColumnKind, string> = { number: "110px", time: "130px", status: "150px", text: "170px" };

function TableBody({ widget, result, picked = null, onPick }: { widget: BoardWidget; result: WidgetResult; picked?: number | null; onPick?: (picked: Picked) => void }) {
  const viz = widget.viz ?? {};
  const allColumns = result.columns ?? [];
  const rows = result.rows ?? [];
  const limit = viz.limit && viz.limit > 0 ? viz.limit : 50;
  const chosen = viz.columns?.length ? viz.columns.filter((column) => allColumns.includes(column)) : allColumns;
  const columns = chosen.map((column) => {
    const index = allColumns.indexOf(column);
    return { name: column, index, kind: columnKind(column, index, rows, viz.statusColumn) };
  });
  const shown = rows.slice(0, limit);
  // The first text column takes the remaining width; the others have a width by kind, so rows line up.
  const flexible = columns.findIndex((column) => column.kind === "text");
  const minWidth = columns.reduce((sum, column, position) => sum + (position === flexible ? 220 : parseInt(COLUMN_WIDTH[column.kind], 10)), 0);

  if (!columns.length) return <p className="py-2 text-[13.5px] text-ink-5">No data</p>;
  return (
    <div className="-mx-4 overflow-x-auto">
      <OpsTable minWidth={Math.min(minWidth, 960)} className="text-[13px]">
        <OpsHead>
          {columns.map((column, position) => (
            <OpsTh key={column.name} align={column.kind === "number" ? "right" : "left"} width={position === flexible ? undefined : COLUMN_WIDTH[column.kind]}>{column.name}</OpsTh>
          ))}
        </OpsHead>
        <OpsBody>
          {shown.map((row, rowIndex) => (
            <OpsRow key={rowIndex} className="h-10" selected={picked === rowIndex} onOpen={onPick ? () => onPick({ index: rowIndex, point: rowPoint(allColumns, row) }) : undefined}>
              {columns.map((column) => (
                <OpsTd key={column.name} align={column.kind === "number" ? "right" : "left"} className="py-1.5">
                  <Cell value={row[column.index]} kind={column.kind} href={result.links?.[column.name]?.[rowIndex]} />
                </OpsTd>
              ))}
            </OpsRow>
          ))}
          {!shown.length ? <OpsTableEmpty colSpan={columns.length}>No rows</OpsTableEmpty> : null}
        </OpsBody>
      </OpsTable>
      {rows.length > shown.length ? <p className="px-4 pt-2 text-[12.5px] tabular-nums text-ink-4">Showing {shown.length} of {rows.length}</p> : null}
    </div>
  );
}

function Cell({ value, kind, href }: { value: WidgetCell; kind: ColumnKind; href?: string }) {
  if (value === null || value === undefined || value === "") return <span className="text-ink-5">—</span>;
  const body: ReactNode = kind === "status" ? <OperationalStatus value={value} />
    : kind === "number" && isNumber(value) ? formatValue(value)
    : isIso(value) ? <RelativeTime value={value} className="text-[13px] text-ink-3" />
    : String(value);
  if (href && kind !== "status") return <Link to={href} className="font-medium text-ink-1 hover:text-brand-hover hover:underline">{body}</Link>;
  return <>{body}</>;
}

const CHART_HEIGHT: Record<WidgetSize, number> = { sm: 140, md: 170, lg: 200 };

function ChartBody({ widget, result, picked = null, onPick }: { widget: BoardWidget; result: WidgetResult; picked?: number | null; onPick?: (picked: Picked) => void }) {
  const viz = widget.viz ?? {};
  const kind: ChartKind = viz.chart ?? "column";
  if (kind === "heatmap") return <HeatmapBody widget={widget} result={result} />;
  if (kind === "funnel") return <FunnelBody widget={widget} result={result} />;
  if (kind === "gantt") return <GanttBody widget={widget} result={result} />;
  const columns = result.columns ?? [];
  const rows = result.rows ?? [];
  const xIndex = Math.max(0, viz.xColumn ? columns.indexOf(viz.xColumn) : 0);
  const wanted = viz.seriesColumns?.filter((column) => columns.includes(column)) ?? [];
  const names = wanted.length ? wanted : columns.filter((column, index) => index !== xIndex && columnKind(column, index, rows) === "number");
  const series: ChartSeries[] = names.map((name, position) => {
    const index = columns.indexOf(name);
    return { key: name, name, color: seriesColor(name, position), values: rows.map((row) => (isNumber(row[index]) ? row[index] : Number(row[index]) || 0)) };
  });
  const labels = rows.map((row) => axisLabel(row[xIndex]));
  const titles = rows.map((row) => String(row[xIndex] ?? ""));
  if (!series.length) return <p className="py-2 text-[13.5px] text-ink-5">No numeric columns to chart</p>;
  const height = CHART_HEIGHT[widget.size];
  const ariaLabel = `${widget.title}: ${series.map((item) => item.name).join(", ")} by ${columns[xIndex] ?? "period"}`;
  const showValues = viz.showValues === true;
  const pickAt = onPick ? (index: number) => onPick({ index, point: chartPoint(titles[index] ?? labels[index] ?? "", series, index) }) : undefined;

  if (kind === "donut" || kind === "pie") {
    // A share is one measure split by category; extra series are ignored and slices take category colours.
    const first = series[0];
    const pickSlice = onPick ? (index: number) => onPick({ index, point: chartPoint(titles[index] ?? "", [first], index) }) : undefined;
    return <DonutChart labels={titles} series={[first]} colors={titles.map(sliceColor)} height={height} ariaLabel={`${widget.title}: ${first.name} by ${columns[xIndex] ?? "category"}`} variant={kind} showValues={showValues} legend={widget.size === "sm" ? "below" : "right"} onPick={pickSlice} picked={picked} />;
  }
  return (
    <>
      <ChartLegend series={series} className="mb-1" />
      {kind === "line" || kind === "area"
        ? <LineChart labels={labels} titles={titles} series={series} height={height} ariaLabel={ariaLabel} variant={kind} showValues={showValues} onPick={pickAt} picked={picked} />
        : kind === "bar"
          ? <BarChart labels={titles} series={series} height={Math.max(height, 26 * titles.length + 24)} ariaLabel={ariaLabel} showValues={showValues} onPick={pickAt} picked={picked} />
          : <ColumnChart labels={labels} titles={titles} series={series} height={height} ariaLabel={ariaLabel} layout={viz.layout === "grouped" ? "grouped" : "stacked"} onPick={pickAt} picked={picked} />}
    </>
  );
}
