import { useState } from "react";
import { cn } from "@/lib/utils";
import { ChartTooltip, EMPTY_INK, GRID_BASE, GRID_LINE, HiddenDataTable, formatValue, niceMax, textWidth, useWidth } from "./chartShared";
import type { ChartSeries } from "./ColumnChart";

/**
 * Ranked or named categories read left to right: one horizontal bar per label, grouped when there
 * is more than one series. Labels sit to the left, values to the right when asked. Bars grow from
 * the left on mount, staggered per row; a hovered row lifts and shows every series' value.
 */

export interface BarChartProps {
  labels: string[];
  series: ChartSeries[];
  height?: number;
  ariaLabel: string;
  /** The value of each bar at the right edge. */
  showValues?: boolean;
  emptyText?: string;
  /** A click on a bucket picks it (SPEC-tasks-12 FR-2); without it the chart is hover only. */
  onPick?: (index: number) => void;
  /** The picked bucket, drawn as if hovered while nothing else is. */
  picked?: number | null;
  className?: string;
}

const PAD = { top: 4, right: 10, bottom: 18 };
const MAX_BAR = 18;
const MIN_BAR = 4;

export function BarChart({ labels, series, height = 160, ariaLabel, showValues = false, emptyText = "Nothing to show", onPick, picked = null, className }: BarChartProps) {
  const [hostRef, width] = useWidth<HTMLDivElement>();
  const [hovered, setHover] = useState<number | null>(null);
  const hover = hovered ?? picked;
  const n = labels.length;
  const max = niceMax(series.reduce((top, item) => Math.max(top, ...item.values.filter(Number.isFinite)), 0) || 1);
  const empty = !n || !series.length || series.every((item) => item.values.every((value) => !value));

  // New values resize the drawn bars in place; a different set of rows or series redraws the chart.
  const shapeKey = `${labels.join(",")}:${series.map((item) => item.key).join("|")}`;

  const labelW = Math.min(150, Math.max(48, labels.reduce((top, label) => Math.max(top, textWidth(label, 12)), 0) + 10));
  const valueW = showValues ? Math.max(32, series.reduce((top, item) => Math.max(top, ...item.values.map((value) => textWidth(formatValue(value), 12))), 0) + 10) : 0;
  const left = labelW;
  const plotW = Math.max(1, width - left - valueW - PAD.right);
  const plotH = Math.max(1, height - PAD.top - PAD.bottom);
  const rowH = n ? plotH / n : plotH;
  const groupSize = Math.max(1, series.length);
  const barGap = groupSize > 1 ? 2 : 0;
  const barH = Math.max(MIN_BAR, Math.min(MAX_BAR, (rowH * 0.7 - barGap * (groupSize - 1)) / groupSize));
  const groupH = barH * groupSize + barGap * (groupSize - 1);
  const rowY = (index: number) => PAD.top + rowH * index;
  const x = (value: number) => left + (plotW * Math.max(0, value)) / max;
  const gridValues = [0, max / 2, max];

  return (
    <div ref={hostRef} className={cn("relative w-full", className)} style={{ height }}>
      <svg key={shapeKey} role="img" aria-label={ariaLabel} width={width} height={height} className="block overflow-visible text-ink-5">
        {gridValues.map((value) => (
          <g key={value}>
            <line x1={x(value)} x2={x(value)} y1={PAD.top} y2={PAD.top + plotH} stroke={value === 0 ? GRID_BASE : GRID_LINE} strokeWidth={1} shapeRendering="crispEdges" />
            <text x={x(value)} y={height - 5} textAnchor={value === 0 ? "start" : value === max ? "end" : "middle"} fontSize={10.5} fill="currentColor">{value}</text>
          </g>
        ))}

        {labels.map((label, index) => (
          <text key={label + index} x={left - 8} y={rowY(index) + rowH / 2 + 4} textAnchor="end" fontSize={12} fill="var(--ops-ink-3)" opacity={hover === null || hover === index ? 1 : 0.55}>
            {label.length * 12 * 0.58 > labelW - 8 ? `${label.slice(0, Math.max(3, Math.floor((labelW - 8) / (12 * 0.58)) - 1))}…` : label}
          </text>
        ))}

        {!empty ? labels.map((_, index) => {
          const top = rowY(index) + (rowH - groupH) / 2;
          return (
            <g key={index} data-row={labels[index]}>
              {series.map((item, order) => {
                const value = item.values[index] || 0;
                const w = Math.max(0, x(value) - left);
                const barY = top + order * (barH + barGap);
                const r = Math.min(4, barH / 2, w);
                const d = w > 0 ? `M${left},${barY} H${left + w - r} Q${left + w},${barY} ${left + w},${barY + r} V${barY + barH - r} Q${left + w},${barY + barH} ${left + w - r},${barY + barH} H${left} Z` : "";
                return (
                  <g key={item.key}>
                    {w > 0 ? <path d={d} data-bar={item.key} fill={item.color} className="chart-bar" style={{ animationDelay: `${index * 30 + order * 20}ms` }} opacity={hover === null || hover === index ? 1 : 0.5} /> : <path d="" data-bar={item.key} fill="none" />}
                    {showValues ? (
                      <text
                        x={groupSize > 1 ? left + w + 5 : width - PAD.right}
                        y={barY + barH / 2 + 3.5}
                        textAnchor={groupSize > 1 ? "start" : "end"}
                        fontSize={12}
                        fill="var(--ops-ink-2)"
                        className="chart-label tabular-nums"
                        style={{ animationDelay: `${480 + index * 30}ms` }}
                      >
                        {formatValue(value)}
                      </text>
                    ) : null}
                  </g>
                );
              })}
            </g>
          );
        }) : (
          <text x={left + plotW / 2} y={PAD.top + plotH / 2 + 4} textAnchor="middle" fontSize={12} fill={EMPTY_INK}>{emptyText}</text>
        )}

        {!empty ? labels.map((_, index) => (
          <rect key={index} x={0} y={rowY(index)} width={width} height={rowH} fill="transparent" onMouseEnter={() => setHover(index)} onMouseLeave={() => setHover(null)} onClick={onPick ? () => onPick(index) : undefined} className={onPick ? "cursor-pointer" : undefined} data-testid={onPick ? "chart-pick" : undefined} />
        )) : null}
      </svg>

      {hover !== null && !empty ? (
        <ChartTooltip title={labels[hover]} series={series} index={hover} style={{ top: Math.min(rowY(hover) + rowH, Math.max(0, height - 40)), left: Math.min(left + 8, Math.max(0, width - 170)) }} />
      ) : null}

      <HiddenDataTable caption={ariaLabel} labels={labels} series={series} />
    </div>
  );
}
