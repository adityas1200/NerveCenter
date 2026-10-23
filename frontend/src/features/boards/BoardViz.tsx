/* eslint-disable react-refresh/only-export-components */
import type { BoardWidget, WidgetCell, WidgetResult } from "@/api/boards";
import type { BarState, Block } from "@/features/tasks/cards/blocks";
import { FunnelBlock, GanttBlock, GaugesBlock, HeatmapBlock } from "@/features/tasks/cards/VizBlocks";

/**
 * Board widgets drawn with Sonic's visualisations (SPEC-boards-03 FR-11): the widget's rows are turned into
 * the same data the task page draws, so a heatmap, funnel, gantt or gauge looks the same in both places.
 * Rows that do not fit the kind give a plain sentence instead of a broken chart.
 */

type Of<K extends Block["kind"]> = Extract<Block, { kind: K }>;
type Rows = { columns: string[]; rows: WidgetCell[][] };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const numberOf = (cell: WidgetCell): number | null => (typeof cell === "number" && Number.isFinite(cell) ? cell : typeof cell === "string" && cell.trim() !== "" && Number.isFinite(Number(cell)) ? Number(cell) : null);
const find = (columns: string[], picked: string | null | undefined, pattern: RegExp) => (picked && columns.includes(picked) ? columns.indexOf(picked) : columns.findIndex((column) => pattern.test(column)));
/** Day buckets come as "09/25"; the grid reads them as "25 Sep". */
const bucketLabel = (column: string) => { const day = /^(\d{2})\/(\d{2})$/.exec(column); return day ? `${Number(day[2])} ${MONTHS[Number(day[1]) - 1] ?? day[1]}` : column; };

function NoFit({ children }: { children: string }) {
  return <p className="py-2 text-[13.5px] text-ink-5">{children}</p>;
}

export function heatmapFrom({ columns, rows }: Rows, viz: BoardWidget["viz"] = {}, title = ""): Of<"heatmap"> | null {
  const x = Math.max(0, find(columns, viz.xColumn, /^$/));
  const pivot = viz.pivotColumn ? columns.indexOf(viz.pivotColumn) : -1;
  const scale = viz.scale ?? "neutral";
  if (pivot >= 0) {
    // Long rows (row, column, value): the first series, or the first other numeric column, is the value.
    const value = viz.seriesColumns?.length && columns.includes(viz.seriesColumns[0]) ? columns.indexOf(viz.seriesColumns[0]) : columns.findIndex((_, index) => index !== x && index !== pivot && rows.some((row) => numberOf(row[index]) !== null));
    if (value < 0) return null;
    const across = [...new Set(rows.map((row) => String(row[pivot] ?? "")))].slice(0, 62);
    const down = [...new Set(rows.map((row) => String(row[x] ?? "")))].slice(0, 40);
    const grid = new Map(down.map((label) => [label, across.map((): number | null => null)]));
    for (const row of rows) { const cells = grid.get(String(row[x] ?? "")); const at = across.indexOf(String(row[pivot] ?? "")); if (cells && at >= 0) cells[at] = numberOf(row[value]); }
    return down.length && across.length ? { kind: "heatmap", title, columns: across.map(bucketLabel), rows: down.map((label) => ({ label, values: grid.get(label) ?? [] })), scale, unit: viz.unit ?? null, note: null } : null;
  }
  const wanted = viz.seriesColumns?.filter((column) => columns.includes(column)) ?? [];
  const names = wanted.length ? wanted : columns.filter((column, index) => index !== x && rows.every((row) => row[index] === null || numberOf(row[index]) !== null) && rows.some((row) => numberOf(row[index]) !== null));
  if (!names.length || !rows.length) return null;
  const indexes = names.map((name) => columns.indexOf(name));
  return { kind: "heatmap", title, columns: names.map(bucketLabel), rows: rows.slice(0, 40).map((row) => ({ label: String(row[x] ?? "—"), values: indexes.map((index) => numberOf(row[index])) })), scale, unit: viz.unit ?? null, note: rows.length > 40 ? `Showing 40 of ${rows.length} rows` : null };
}

export function funnelFrom({ columns, rows }: Rows, viz: BoardWidget["viz"] = {}, title = ""): Of<"funnel"> | null {
  const x = Math.max(0, find(columns, viz.xColumn, /^$/));
  const value = viz.seriesColumns?.length && columns.includes(viz.seriesColumns[0]) ? columns.indexOf(viz.seriesColumns[0]) : columns.findIndex((_, index) => index !== x && rows.some((row) => numberOf(row[index]) !== null));
  if (value < 0 || rows.length < 2) return null;
  return { kind: "funnel", title, stages: rows.slice(0, 8).map((row) => ({ label: String(row[x] ?? "—"), value: Math.max(0, numberOf(row[value]) ?? 0), note: null })), unit: viz.unit ?? null, note: null };
}

/** A run's state from whatever word the source used. */
export function barState(cell: WidgetCell): BarState {
  const text = String(cell ?? "").toLowerCase();
  if (/fail|error|timed ?out|cancel/.test(text)) return "failed";
  if (/succe|pass|healthy|complete|\bok\b|\bdone\b/.test(text)) return "ok";
  if (/warn|late|miss|overdue|slow/.test(text)) return "warning";
  if (/run|progress|queued|pending|start/.test(text)) return "running";
  return "skipped";
}

export function ganttFrom({ columns, rows }: Rows, viz: BoardWidget["viz"] = {}, title = ""): Of<"gantt"> | null {
  const lane = Math.max(0, find(columns, viz.xColumn, /^(pipeline|job|lane|name)$/i));
  const start = find(columns, viz.startColumn, /^(started|start|start time|started at|start_time)$/i);
  const end = find(columns, viz.endColumn, /^(ended|end|end time|ended at|end_time|finished)$/i);
  const state = find(columns, viz.stateColumn, /^(status|state|result)$/i);
  const label = viz.labelColumn && columns.includes(viz.labelColumn) ? columns.indexOf(viz.labelColumn) : -1;
  if (start < 0) return null;
  const time = (cell: WidgetCell) => { const at = typeof cell === "string" ? Date.parse(cell) : NaN; return Number.isFinite(at) ? at : null; };
  const lanes = new Map<string, Of<"gantt">["lanes"][number]>();
  for (const row of rows) {
    const from = time(row[start]); if (from === null) continue;
    const to = end >= 0 ? time(row[end]) : null;
    const name = String(row[lane] ?? "—");
    if (!lanes.has(name)) { if (lanes.size >= 20) continue; lanes.set(name, { label: name, sub: null, bars: [] }); }
    lanes.get(name)?.bars.push({ start: from, end: to !== null && to >= from ? to : null, state: state >= 0 ? barState(row[state]) : "ok", label: label >= 0 && row[label] !== null ? String(row[label]) : null, ask: null });
  }
  return lanes.size ? { kind: "gantt", title, lanes: [...lanes.values()], markers: [], note: null } : null;
}

export function HeatmapBody({ widget, result }: { widget: BoardWidget; result: WidgetResult }) {
  const block = heatmapFrom({ columns: result.columns ?? [], rows: result.rows ?? [] }, widget.viz, widget.title);
  return block ? <HeatmapBlock block={block} compact={widget.size === "sm"} bare /> : <NoFit>No numeric columns to shade</NoFit>;
}

export function FunnelBody({ widget, result }: { widget: BoardWidget; result: WidgetResult }) {
  const block = funnelFrom({ columns: result.columns ?? [], rows: result.rows ?? [] }, widget.viz, widget.title);
  return block ? <FunnelBlock block={block} compact={widget.size === "sm"} bare /> : <NoFit>A funnel needs at least two stages with a count</NoFit>;
}

export function GanttBody({ widget, result }: { widget: BoardWidget; result: WidgetResult }) {
  const block = ganttFrom({ columns: result.columns ?? [], rows: result.rows ?? [] }, widget.viz, widget.title);
  return block ? <GanttBlock block={block} compact={widget.size === "sm"} bare /> : <NoFit>No runs with a start time in this period</NoFit>;
}

/** A metric drawn as a ring against its target; the label and value are what the plain metric would show. */
export function GaugeBody({ widget, label, value }: { widget: BoardWidget; label: string; value: WidgetCell }) {
  const gauge = widget.viz?.gauge;
  const number = numberOf(value);
  if (!gauge || number === null) return null;
  const block: Of<"gauges"> = { kind: "gauges", title: null, items: [{ label, value: number, max: gauge.max, target: gauge.target, unit: widget.viz?.suffix ?? null, higherIsBetter: gauge.higherIsBetter, sub: null, tone: null }], note: null };
  return <GaugesBlock block={block} compact bare />;
}
