import { useId, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { CROSSHAIR, ChartTooltip, EMPTY_INK, YGrid, niceMax, useWidth } from "./chartShared";

/**
 * A small time-series chart for operational counts: stacked columns for
 * volume, a hairline grid, a hover crosshair with a tooltip, and a legend when there is more than
 * one series. Colour lives on the marks only; every label is ink.
 */

export interface ChartSeries {
  key: string;
  name: string;
  color: string;
  values: number[];
}

export interface ColumnChartProps {
  labels: string[];
  /** Longer per-bucket label for the tooltip header. */
  titles?: string[];
  series: ChartSeries[];
  height?: number;
  /** What a screen reader hears; the visible title lives in the card header. */
  ariaLabel: string;
  emptyText?: string;
  /** Columns stack into one total by default; "grouped" draws them side by side for measures that do not add up. */
  layout?: "stacked" | "grouped";
  /** A click on a bucket picks it (SPEC-tasks-12 FR-2); without it the chart is hover only. */
  onPick?: (index: number) => void;
  /** The picked bucket, drawn as if hovered while nothing else is. */
  picked?: number | null;
  className?: string;
}

const PAD = { top: 10, right: 12, bottom: 22, left: 30 };
const MAX_COLUMN = 22;

export function ColumnChart({ labels, titles, series, height = 150, ariaLabel, emptyText = "No activity in this period", layout = "stacked", onPick, picked = null, className }: ColumnChartProps) {
  const [hostRef, width] = useWidth<HTMLDivElement>();
  const [hovered, setHover] = useState<number | null>(null);
  const hover = hovered ?? picked;
  const clipId = useId();
  const n = labels.length;
  const columns = series;
  const grouped = layout === "grouped";

  const totals = useMemo(() => labels.map((_, index) => grouped
    ? columns.reduce((max, item) => Math.max(max, item.values[index] || 0), 0)
    : columns.reduce((sum, item) => sum + (item.values[index] || 0), 0)), [labels, columns, grouped]);
  const empty = totals.every((value) => value === 0);
  const max = niceMax(Math.max(...totals, 1));

  // New values reshape the drawn columns in place (CSS transitions on `d`); only a different set of
  // buckets or series redraws the chart and replays the grow-in.
  const shapeKey = `${layout}:${labels.join(",")}:${series.map((item) => item.key).join("|")}`;

  const plotW = Math.max(1, width - PAD.left - PAD.right);
  const plotH = Math.max(1, height - PAD.top - PAD.bottom);
  const slot = n ? plotW / n : plotW;
  const groupSize = grouped ? Math.max(1, columns.length) : 1;
  const groupGap = grouped ? 2 : 0;
  const colW = grouped
    ? Math.min(MAX_COLUMN, (slot * 0.64 - groupGap * (groupSize - 1)) / groupSize)
    : Math.min(MAX_COLUMN, slot * 0.56);
  const groupW = colW * groupSize + groupGap * (groupSize - 1);
  const x = (index: number) => PAD.left + slot * (index + 0.5);
  const y = (value: number) => PAD.top + plotH * (1 - value / max);
  const gridValues = [0, max / 2, max];

  // Show roughly seven axis labels whatever the bucket count.
  const every = Math.max(1, Math.ceil(n / 7));
  // The last label always shows; a stepped label within one step of it is dropped so the two never collide.
  const showLabel = (index: number) => index === n - 1 || (index % every === 0 && n - 1 - index >= every);

  return (
    <div ref={hostRef} className={cn("relative w-full", className)} style={{ height }}>
      <svg key={shapeKey} role="img" aria-label={ariaLabel} width={width} height={height} className="block overflow-visible text-ink-5">
        <defs>
          <clipPath id={clipId}><rect x={PAD.left - 2} y={PAD.top - 6} width={plotW + 4} height={plotH + 8} /></clipPath>
        </defs>
        <YGrid values={gridValues} y={y} left={PAD.left} right={PAD.right} width={width} />
        {labels.map((label, index) => showLabel(index) ? (
          <text key={label + index} x={x(index)} y={height - 7} textAnchor="middle" fontSize={10.5} fill="currentColor">{label}</text>
        ) : null)}

        {!empty ? (
          <g clipPath={`url(#${clipId})`}>
            {labels.map((_, index) => {
              if (grouped) {
                return columns.map((item, order) => {
                  const value = item.values[index] || 0;
                  if (value <= 0) return null;
                  const top = y(value);
                  const bottom = y(0);
                  const h = Math.max(0, bottom - top);
                  const left = x(index) - groupW / 2 + order * (colW + groupGap);
                  const r = Math.min(4, h);
                  const d = `M${left},${bottom} V${top + r} Q${left},${top} ${left + r},${top} H${left + colW - r} Q${left + colW},${top} ${left + colW},${top + r} V${bottom} Z`;
                  return <path key={item.key} d={d} fill={item.color} className="chart-col" style={{ animationDelay: `${index * 18}ms` }} opacity={hover === null || hover === index ? 1 : 0.55} />;
                });
              }
              let acc = 0;
              const drawn = columns.filter((item) => (item.values[index] || 0) > 0);
              return drawn.map((item, order) => {
                const value = item.values[index] || 0;
                const top = y(acc + value);
                const bottom = y(acc);
                acc += value;
                const isTop = order === drawn.length - 1;
                const gap = order > 0 ? 2 : 0;
                const h = Math.max(0, bottom - top - gap);
                const left = x(index) - colW / 2;
                const r = isTop ? Math.min(4, h) : 0;
                const d = `M${left},${bottom} V${top + r} Q${left},${top} ${left + r},${top} H${left + colW - r} Q${left + colW},${top} ${left + colW},${top + r} V${bottom} Z`;
                return <path key={item.key} d={d} fill={item.color} className="chart-col" style={{ animationDelay: `${index * 18}ms` }} opacity={hover === null || hover === index ? 1 : 0.55} />;
              });
            })}
          </g>
        ) : (
          <text x={PAD.left + plotW / 2} y={PAD.top + plotH / 2 + 4} textAnchor="middle" fontSize={12} fill={EMPTY_INK}>{emptyText}</text>
        )}

        {hover !== null && !empty ? (
          <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + plotH} stroke={CROSSHAIR} strokeWidth={1} strokeDasharray="2 3" pointerEvents="none" />
        ) : null}

        {labels.map((_, index) => (
          <rect key={index} x={PAD.left + slot * index} y={PAD.top} width={slot} height={plotH} fill="transparent" onMouseEnter={() => setHover(index)} onMouseLeave={() => setHover(null)} onClick={onPick ? () => onPick(index) : undefined} className={onPick ? "cursor-pointer" : undefined} data-testid={onPick ? "chart-pick" : undefined} />
        ))}
      </svg>

      {hover !== null && !empty ? (
        <ChartTooltip title={titles?.[hover] ?? labels[hover]} series={series} index={hover} format={String} style={{ top: PAD.top, left: Math.min(Math.max(x(hover) + 10, 0), Math.max(0, width - 170)) }} />
      ) : null}
    </div>
  );
}

export function ChartLegend({ series, className }: { series: ChartSeries[]; className?: string }) {
  if (series.length < 2) return null;
  return (
    <ul className={cn("flex flex-wrap items-center gap-4 text-[12.5px] text-ink-3", className)}>
      {series.map((item) => (
        <li key={item.key} className="flex items-center gap-1.5">
          <i className={cn("inline-block h-2.5 w-2.5 rounded-[3px]",)} style={{ background: item.color }} aria-hidden="true" />
          {item.name}
        </li>
      ))}
    </ul>
  );
}
