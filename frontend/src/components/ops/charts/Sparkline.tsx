import { POINT_RING } from "./chartShared";
import { cn } from "@/lib/utils";

/**
 * A 60×20 trend under a metric: one line, no axes, an end dot. It never carries the number itself;
 * the metric cell above shows the last value and the delta next to it.
 */
export function Sparkline({ values, color = "var(--ops-brand)", width = 60, height = 20, ariaLabel, className }: { values: number[]; color?: string; width?: number; height?: number; ariaLabel: string; className?: string }) {
  const points = values.filter((value) => Number.isFinite(value));
  if (points.length < 2) return null;
  const max = Math.max(...points);
  const min = Math.min(...points);
  const span = max - min || 1;
  const pad = 2;
  const x = (index: number) => pad + ((width - pad * 2) * index) / (points.length - 1);
  const y = (value: number) => pad + (height - pad * 2) * (1 - (value - min) / span);
  const d = points.map((value, index) => `${index ? "L" : "M"}${x(index).toFixed(1)},${y(value).toFixed(1)}`).join(" ");
  return (
    <svg role="img" aria-label={ariaLabel} width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={cn("block overflow-visible", className)}>
      <path d={d} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" pathLength={1} className="chart-line" />
      <circle cx={x(points.length - 1)} cy={y(points[points.length - 1])} r={2.5} fill={color} stroke={POINT_RING} strokeWidth={1.5} className="chart-dot" />
    </svg>
  );
}
