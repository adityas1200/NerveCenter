/* eslint-disable react-refresh/only-export-components */
import { useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { cn } from "@/lib/utils";
import type { ChartSeries } from "./ColumnChart";

/**
 * What every board chart shares: the width of its host, a quiet axis top, number formatting and the
 * visually hidden table a screen reader gets instead of the picture.
 */

export function useWidth<T extends HTMLElement>(initial = 600): [RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(initial);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const measure = () => setWidth(Math.max(120, Math.round(node.getBoundingClientRect().width) || initial));
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [initial]);
  return [ref, width];
}

/** Axis top that keeps the midpoint a whole number: 2, 4, 6, 8, 10, then 20, 50, 100… */
export function niceMax(value: number): number {
  if (value <= 10) return Math.max(2, Math.ceil(value / 2) * 2);
  const magnitude = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 5, 10]) {
    const candidate = step * magnitude;
    if (candidate >= value && (candidate / 2) % 1 === 0) return candidate;
  }
  return 10 * magnitude;
}

export function formatValue(value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (Number.isInteger(value)) return value.toLocaleString();
  return value.toLocaleString(undefined, { maximumFractionDigits: Math.abs(value) < 10 ? 2 : 1 });
}

/** Roughly how wide a label draws at the chart's 10.5px type. */
export const textWidth = (text: string, size = 10.5) => text.length * size * 0.58;

/** How many labels to skip so none of them touch: every n-th label plus the last one. */
export function labelStep(labels: string[], plotWidth: number): number {
  const widest = labels.reduce((max, label) => Math.max(max, textWidth(label)), 0) + 10;
  const perLabel = labels.length ? plotWidth / labels.length : plotWidth;
  return Math.max(1, Math.ceil(widest / Math.max(1, perLabel)));
}

/** The chart's data as a table only assistive tech sees; `caption` is the same sentence the image is labelled with. */
export function HiddenDataTable({ caption, labels, series, percentOf }: { caption: string; labels: string[]; series: ChartSeries[]; /** Donut and pie add a share column against this total. */ percentOf?: number }) {
  return (
    <table className="sr-only" data-testid="chart-data">
      <caption>{caption}</caption>
      <thead>
        <tr>
          <th scope="col">Label</th>
          {series.map((item) => <th key={item.key} scope="col">{item.name}</th>)}
          {percentOf !== undefined ? <th scope="col">Share</th> : null}
        </tr>
      </thead>
      <tbody>
        {labels.map((label, index) => (
          <tr key={`${label}-${index}`}>
            <th scope="row">{label}</th>
            {series.map((item) => <td key={item.key}>{formatValue(item.values[index] ?? 0)}</td>)}
            {percentOf !== undefined ? <td>{percentOf > 0 ? `${Math.round(((series[0]?.values[index] ?? 0) / percentOf) * 100)}%` : "—"}</td> : null}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Chart chrome follows the theme: the baseline and grid are hairlines, the crosshair and empty text are muted ink. */
export const GRID_BASE = "rgb(var(--c-line-strong))";
export const GRID_LINE = "rgb(var(--chart-grid))";
export const CROSSHAIR = "rgb(var(--c-ink-5))";
export const EMPTY_INK = "rgb(var(--c-ink-5))";
/** The ring drawn around a highlighted point so it lifts off the line: the card's own colour. */
export const POINT_RING = "rgb(var(--c-raised))";

/** Horizontal hairlines at 0, half and max with the value at the left of each (column and line charts). */
export function YGrid({ values, y, left, right, width }: { values: number[]; y: (value: number) => number; left: number; right: number; width: number }) {
  return (
    <>
      {values.map((value) => (
        <g key={value}>
          <line x1={left} x2={width - right} y1={y(value)} y2={y(value)} stroke={value === 0 ? GRID_BASE : GRID_LINE} strokeWidth={1} shapeRendering="crispEdges" />
          <text x={left - 6} y={y(value) + 3.5} textAnchor="end" fontSize={10.5} fill="currentColor">{value}</text>
        </g>
      ))}
    </>
  );
}

/** The hover card: a header and one swatch-and-value row per series. `format` defaults to the shared number format. */
export function ChartTooltip({ title, series, index, style, line = false, format = formatValue }: { title: string; series: ChartSeries[]; index: number; style: CSSProperties; /** Draw the swatch as a short line instead of a square. */ line?: boolean; format?: (value: number) => string | number }) {
  return (
    <div role="tooltip" className="pointer-events-none absolute z-10 min-w-[150px] rounded-lg border border-line bg-raised px-3 py-2 text-[13px] shadow-card-hover" style={style}>
      <p className="mb-1 font-medium text-ink-2">{title}</p>
      {series.map((item) => (
        <p key={item.key} className="flex items-center justify-between gap-4 text-ink-3">
          <span className="flex items-center gap-1.5"><i className={cn("inline-block", line ? "h-0.5 w-3" : "h-2 w-2 rounded-sm")} style={{ background: item.color }} aria-hidden="true" />{item.name}</span>
          <span className="tabular-nums text-ink-1">{format(item.values[index] || 0)}</span>
        </p>
      ))}
    </div>
  );
}
