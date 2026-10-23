import { useId, useState } from "react";
import { cn } from "@/lib/utils";
import { CROSSHAIR, ChartTooltip, EMPTY_INK, HiddenDataTable, POINT_RING, YGrid, formatValue, labelStep, niceMax, useWidth } from "./chartShared";
import type { ChartSeries } from "./ColumnChart";

/**
 * Change over time for one or more measures on one axis: a 2px line per series that draws itself in,
 * an optional 12% fill under it (area), an end dot, a hairline grid and a hover crosshair that lists
 * every series' value for that bucket. Axis labels thin themselves so none overlap.
 */

export interface LineChartProps {
  labels: string[];
  /** Longer per-bucket label for the tooltip header. */
  titles?: string[];
  series: ChartSeries[];
  height?: number;
  ariaLabel: string;
  variant?: "line" | "area";
  /** A value over each drawn axis label's point. */
  showValues?: boolean;
  emptyText?: string;
  /** A click on a bucket picks it (SPEC-tasks-12 FR-2); without it the chart is hover only. */
  onPick?: (index: number) => void;
  /** The picked bucket, drawn as if hovered while nothing else is. */
  picked?: number | null;
  className?: string;
}

const PAD = { top: 12, right: 14, bottom: 22, left: 30 };

export function LineChart({ labels, titles, series, height = 160, ariaLabel, variant = "line", showValues = false, emptyText = "No activity in this period", onPick, picked = null, className }: LineChartProps) {
  const [hostRef, width] = useWidth<HTMLDivElement>();
  const [hovered, setHover] = useState<number | null>(null);
  const hover = hovered ?? picked;
  const clipId = useId();
  const n = labels.length;
  const max = niceMax(series.reduce((top, item) => Math.max(top, ...item.values.filter(Number.isFinite)), 0) || 1);
  const empty = !n || !series.length || series.every((item) => item.values.every((value) => !value));

  // New values move the drawn line in place; a different set of points or series redraws it.
  const shapeKey = `${variant}:${labels.join(",")}:${series.map((item) => item.key).join("|")}`;

  const plotW = Math.max(1, width - PAD.left - PAD.right);
  const plotH = Math.max(1, height - PAD.top - PAD.bottom);
  const x = (index: number) => (n > 1 ? PAD.left + (plotW * index) / (n - 1) : PAD.left + plotW / 2);
  const y = (value: number) => PAD.top + plotH * (1 - Math.max(0, value) / max);
  const gridValues = [0, max / 2, max];
  const every = labelStep(labels, plotW);
  // The last label always shows; a stepped label within one step of it is dropped so the two never collide.
  const showLabel = (index: number) => index === n - 1 || (index % every === 0 && n - 1 - index >= every);

  const paths = series.map((item) => {
    const points = labels.map((_, index) => `${x(index).toFixed(1)},${y(item.values[index] || 0).toFixed(1)}`);
    const line = points.map((point, index) => `${index ? "L" : "M"}${point}`).join(" ");
    const area = `${line} L${x(n - 1).toFixed(1)},${y(0).toFixed(1)} L${x(0).toFixed(1)},${y(0).toFixed(1)} Z`;
    return { item, line, area };
  });

  const slot = n > 1 ? plotW / (n - 1) : plotW;

  return (
    <div ref={hostRef} className={cn("relative w-full", className)} style={{ height }}>
      <svg key={shapeKey} role="img" aria-label={ariaLabel} width={width} height={height} className="block overflow-visible text-ink-5">
        <defs>
          <clipPath id={clipId}><rect x={PAD.left - 6} y={PAD.top - 8} width={plotW + 12} height={plotH + 10} /></clipPath>
        </defs>
        <YGrid values={gridValues} y={y} left={PAD.left} right={PAD.right} width={width} />
        {labels.map((label, index) => showLabel(index) ? (
          <text key={label + index} x={x(index)} y={height - 7} textAnchor={index === 0 ? "start" : index === n - 1 ? "end" : "middle"} fontSize={10.5} fill="currentColor">{label}</text>
        ) : null)}

        {!empty ? (
          <g clipPath={`url(#${clipId})`}>
            {paths.map(({ item, line, area }, order) => (
              <g key={item.key} data-series={item.key}>
                {variant === "area" ? <path d={area} fill={item.color} fillOpacity={0.12} className="chart-area" style={{ animationDelay: `${240 + order * 80}ms` }} /> : null}
                <path d={line} fill="none" stroke={item.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" pathLength={1} className="chart-line" data-line style={{ animationDelay: `${120 + order * 80}ms` }} />
                <circle cx={x(n - 1)} cy={y(item.values[n - 1] || 0)} r={4} fill={item.color} stroke={POINT_RING} strokeWidth={2} className="chart-dot" />
                {showValues ? labels.map((_, index) => showLabel(index) ? (
                  <text key={index} x={x(index)} y={y(item.values[index] || 0) - 7} textAnchor="middle" fontSize={10.5} fill="var(--ops-ink-3)" className="chart-label tabular-nums" style={{ animationDelay: `${600 + order * 80}ms` }}>{formatValue(item.values[index] || 0)}</text>
                ) : null) : null}
              </g>
            ))}
          </g>
        ) : (
          <text x={PAD.left + plotW / 2} y={PAD.top + plotH / 2 + 4} textAnchor="middle" fontSize={12} fill={EMPTY_INK}>{emptyText}</text>
        )}

        {hover !== null && !empty ? (
          <g pointerEvents="none">
            <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + plotH} stroke={CROSSHAIR} strokeWidth={1} strokeDasharray="2 3" />
            {series.map((item) => <circle key={item.key} cx={x(hover)} cy={y(item.values[hover] || 0)} r={3.5} fill={POINT_RING} stroke={item.color} strokeWidth={2} />)}
          </g>
        ) : null}

        {!empty ? labels.map((_, index) => (
          <rect key={index} x={x(index) - slot / 2} y={PAD.top} width={slot} height={plotH} fill="transparent" onMouseEnter={() => setHover(index)} onMouseLeave={() => setHover(null)} onClick={onPick ? () => onPick(index) : undefined} className={onPick ? "cursor-pointer" : undefined} data-testid={onPick ? "chart-pick" : undefined} />
        )) : null}
      </svg>

      {hover !== null && !empty ? (
        <ChartTooltip title={titles?.[hover] ?? labels[hover]} series={series} index={hover} line style={{ top: PAD.top, left: Math.min(Math.max(x(hover) + 10, 0), Math.max(0, width - 170)) }} />
      ) : null}

      <HiddenDataTable caption={ariaLabel} labels={labels} series={series} />
    </div>
  );
}
