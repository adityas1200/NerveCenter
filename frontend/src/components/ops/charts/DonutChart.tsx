import { useMemo, useState, type CSSProperties } from "react";
import { cn } from "@/lib/utils";
import { EMPTY_INK, HiddenDataTable, formatValue, useWidth } from "./chartShared";
import type { ChartSeries } from "./ColumnChart";

/**
 * A share of one whole: a donut (total in the centre) or a pie. One series, up to eight slices; any
 * more fold into "Other". Each slice is a stroked arc that grows along its angle on mount, staggered
 * 40 ms. The legend names every slice with its value so colour never carries the meaning alone; a
 * slice under hover or a focused legend row lifts and shows label · value · percent.
 */

export interface DonutChartProps {
  labels: string[];
  /** Only the first series is drawn. */
  series: ChartSeries[];
  /** The colour of each slice, one per label; missing entries fall back to the series colour. */
  colors?: string[];
  height?: number;
  ariaLabel: string;
  variant?: "donut" | "pie";
  /** Value on each slice that is at least 8% of the whole. */
  showValues?: boolean;
  /** Where the legend sits; "auto" puts it to the right when the host is wide enough. */
  legend?: "right" | "below" | "auto";
  emptyText?: string;
  /** A click on a bucket picks it (SPEC-tasks-12 FR-2); without it the chart is hover only. */
  onPick?: (index: number) => void;
  /** The picked bucket, drawn as if hovered while nothing else is. */
  picked?: number | null;
  className?: string;
}

export const MAX_SLICES = 8;
const GAP = 2;
const OTHER_COLOR = "#94A3B8";

export function DonutChart({ labels, series, colors, height = 170, ariaLabel, variant = "donut", showValues = false, legend = "auto", emptyText = "Nothing to show", onPick, picked = null, className }: DonutChartProps) {
  const [hostRef, width] = useWidth<HTMLDivElement>();
  const [hovered, setActive] = useState<number | null>(null);
  const active = hovered ?? picked;
  const first = series[0];

  const slices = useMemo(() => {
    const values = labels.map((label, index) => ({ label, value: Math.max(0, first?.values[index] ?? 0), color: colors?.[index] || first?.color || OTHER_COLOR }));
    if (values.length <= MAX_SLICES) return values;
    const kept = values.slice(0, MAX_SLICES - 1);
    const rest = values.slice(MAX_SLICES - 1).reduce((sum, item) => sum + item.value, 0);
    return [...kept, { label: "Other", value: rest, color: OTHER_COLOR }];
  }, [labels, first, colors]);

  const total = slices.reduce((sum, item) => sum + item.value, 0);
  // The folded "Other" slice is several labels, so it cannot be picked as one.
  const pickable = (index: number) => Boolean(onPick) && !(labels.length > MAX_SLICES && index === MAX_SLICES - 1);
  const empty = !first || total <= 0;
  const legendRight = legend === "right" || (legend === "auto" && width >= 340);
  const size = legendRight ? Math.min(height, Math.max(96, width - 150)) : Math.min(height, width);
  const cx = size / 2;
  const cy = size / 2;
  const outer = size / 2 - 2;
  const ring = variant === "pie" ? outer : Math.max(10, outer * 0.32);
  const r = outer - ring / 2;
  const circumference = 2 * Math.PI * r;

  let cursor = 0;
  const arcs = slices.map((slice, index) => {
    const fraction = total > 0 ? slice.value / total : 0;
    const start = cursor;
    cursor += fraction;
    const length = fraction * circumference;
    const gap = slices.filter((item) => item.value > 0).length > 1 ? Math.min(GAP, length) : 0;
    const mid = (start + fraction / 2) * 2 * Math.PI - Math.PI / 2;
    return { ...slice, index, fraction, start, length, gap, mid };
  });
  const dataKey = `${variant}:${slices.map((item) => `${item.label}=${item.value}`).join("|")}`;
  const activeArc = active !== null ? arcs[active] : null;
  const labelRadius = variant === "pie" ? outer * 0.62 : r;

  return (
    <div ref={hostRef} className={cn("relative flex w-full min-w-0 gap-4", legendRight ? "flex-row items-center" : "flex-col items-center", className)}>
      <svg key={dataKey} role="img" aria-label={ariaLabel} width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="block shrink-0 overflow-visible">
        {empty ? (
          <>
            <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgb(var(--c-subtle))" strokeWidth={ring} />
            <text x={cx} y={cy + 4} textAnchor="middle" fontSize={12} fill={EMPTY_INK}>{emptyText}</text>
          </>
        ) : (
          <>
            {arcs.map((arc) => arc.value > 0 ? (
              <circle
                key={arc.label + arc.index}
                data-slice={arc.label}
                cx={cx}
                cy={cy}
                r={r}
                fill="none"
                stroke={arc.color}
                strokeWidth={active === arc.index ? ring + (variant === "pie" ? 0 : 4) : ring}
                strokeDasharray={`${Math.max(0, arc.length - arc.gap)} ${circumference - Math.max(0, arc.length - arc.gap)}`}
                strokeDashoffset={-arc.gap / 2}
                transform={`rotate(${arc.start * 360 - 90} ${cx} ${cy})`}
                className="chart-slice"
                style={{ "--chart-circ": `${circumference}`, "--chart-arc": `${Math.max(0, arc.length - arc.gap)}`, "--chart-rest": `${circumference - Math.max(0, arc.length - arc.gap)}`, animationDelay: `${arc.index * 40}ms` } as CSSProperties}
                opacity={active === null || active === arc.index ? 1 : 0.45}
                onMouseEnter={() => setActive(arc.index)}
                onMouseLeave={() => setActive(null)}
                onClick={pickable(arc.index) ? () => onPick?.(arc.index) : undefined}
                cursor={pickable(arc.index) ? "pointer" : undefined}
                data-testid={pickable(arc.index) ? "chart-pick" : undefined}
              />
            ) : null)}
            {showValues ? arcs.filter((arc) => arc.fraction >= 0.08).map((arc) => (
              <text
                key={`v-${arc.index}`}
                x={cx + Math.cos(arc.mid) * labelRadius}
                y={cy + Math.sin(arc.mid) * labelRadius + 3.5}
                textAnchor="middle"
                fontSize={10.5}
                fontWeight={600}
                fill="#fff"
                className="chart-label pointer-events-none"
                style={{ animationDelay: `${560 + arc.index * 40}ms` }}
              >
                {formatValue(arc.value)}
              </text>
            )) : null}
            {variant === "donut" ? (
              <>
                <text x={cx} y={cy + (size >= 120 ? 2 : 4)} textAnchor="middle" fontSize={size >= 140 ? 22 : 16} fontWeight={600} fill="var(--ops-ink-1)" className="font-display tabular-nums">{formatValue(total)}</text>
                {size >= 120 ? <text x={cx} y={cy + 16} textAnchor="middle" fontSize={10.5} fill="var(--ops-ink-5)">{first?.name}</text> : null}
              </>
            ) : null}
          </>
        )}
      </svg>

      {!empty ? (
        <ul className={cn("m-0 flex min-w-0 list-none flex-col gap-1 p-0 text-[12.5px] text-ink-3", legendRight ? "flex-1" : "w-full flex-row flex-wrap items-center justify-center gap-x-4")} aria-label="Legend">
          {arcs.map((arc) => (
            <li key={arc.label + arc.index} className="min-w-0">
              <button
                type="button"
                className={cn("flex w-full min-w-0 items-center gap-1.5 rounded-md px-1 py-0.5 text-left outline-none transition-colors hover:bg-surface-subtle focus-visible:bg-surface-subtle", active !== null && active !== arc.index && "opacity-60")}
                onMouseEnter={() => setActive(arc.index)}
                onMouseLeave={() => setActive(null)}
                onFocus={() => setActive(arc.index)}
                onBlur={() => setActive(null)}
                aria-label={`${arc.label}: ${formatValue(arc.value)}, ${total > 0 ? Math.round(arc.fraction * 100) : 0}%`}
              >
                <i className="inline-block h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: arc.color }} aria-hidden="true" />
                <span className="min-w-0 truncate">{arc.label}</span>
                <span className="ml-auto shrink-0 tabular-nums text-ink-1">{formatValue(arc.value)}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {activeArc && !empty ? (
        <div
          role="tooltip"
          className="pointer-events-none absolute z-10 whitespace-nowrap rounded-lg border border-line bg-raised px-2.5 py-1.5 text-[12.5px] shadow-card-hover"
          style={{ left: Math.min(Math.max(cx + Math.cos(activeArc.mid) * (outer + 8), 0), Math.max(0, width - 160)), top: Math.max(0, cy + Math.sin(activeArc.mid) * (outer + 8) - 14) }}
        >
          <span className="font-medium text-ink-2">{activeArc.label}</span>
          <span className="text-ink-5"> · </span>
          <span className="tabular-nums text-ink-1">{formatValue(activeArc.value)}</span>
          <span className="text-ink-5"> · </span>
          <span className="tabular-nums text-ink-3">{Math.round(activeArc.fraction * 100)}%</span>
        </div>
      ) : null}

      <HiddenDataTable caption={ariaLabel} labels={slices.map((item) => item.label)} series={first ? [{ ...first, values: slices.map((item) => item.value) }] : []} percentOf={total} />
    </div>
  );
}
