import { Info } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui";
import { cn } from "@/lib/utils";
import { AnimatedFigure } from "./AnimatedNumber";
import { Sparkline } from "./charts/Sparkline";
export type StatTone = "rose" | "amber" | "emerald" | "blue" | "violet" | "slate";

/**
 * A row of flat tiles, one number each. Label on top, the number below with an
 * optional quieter "of 18" beside it. Each tile links to the filtered view behind
 * its number. Colour appears only on a non-zero figure that carries a tone. `hint` is one plain
 * sentence on what the number counts, behind a small info mark next to the label.
 */

const VALUE_TONE: Record<StatTone, string> = {
  rose: "text-rose-700",
  amber: "text-amber-700",
  emerald: "text-emerald-700",
  blue: "text-blue-700",
  violet: "text-violet-700",
  slate: "text-ink-1",
};
/** The trend line takes the figure's hue (status families as RGB so both themes read it). */
const TREND_TONE: Record<StatTone, string> = { rose: "rgb(225 29 72)", amber: "rgb(245 158 11)", emerald: "rgb(5 150 105)", blue: "rgb(37 99 235)", violet: "rgb(124 58 237)", slate: "rgb(var(--c-brand))" };

export interface StatCellProps {
  label: string;
  value: number | string;
  /** Rendered after the value in a quieter weight: "of 18", "89%". */
  suffix?: string;
  /** One short fact, shown as a quiet chip. Leave out unless it changes what the reader does. */
  support?: ReactNode;
  /** A few plain words under the number when they are not a delta: "1 warning, 5 passed". Wraps to two lines. */
  note?: string;
  /** Recent values, oldest first: a small trend line beside the number. */
  trend?: number[];
  /** One sentence on what the number counts, shown in a tooltip on the info mark beside the label. */
  hint?: string;
  tone?: StatTone;
  to?: string;
  active?: boolean;
  className?: string;
}

export function StatCell({ label, value, suffix, support, note, trend, hint, tone = "slate", to, active, className }: StatCellProps) {
  const numeric = typeof value === "number" ? value : Number(String(value).replace(/[^\d.-]/g, ""));
  const emphasised = !Number.isNaN(numeric) && numeric > 0;
  const body = (
    <>
      <span className="flex items-center gap-1.5 text-[13px] font-medium text-ink-4"><span className="truncate" title={label}>{label}</span>{hint ? <HintMark text={hint} /> : null}</span>
      <span className="mt-2 flex items-baseline gap-1.5">
        <span className={cn("font-display text-[32px] font-semibold leading-none tracking-[-0.02em] tabular-nums", emphasised ? VALUE_TONE[tone] : "text-ink-1")}><AnimatedFigure value={value} /></span>
        {suffix ? <span className="truncate text-[14.5px] font-medium tabular-nums text-ink-5">{suffix}</span> : null}
        {trend && trend.length > 1 ? <Sparkline values={trend} color={emphasised ? TREND_TONE[tone] : "rgb(var(--c-ink-5))"} width={72} height={26} ariaLabel={`${label} trend: ${trend.join(", ")}`} className="ml-auto self-end" /> : null}
      </span>
      {support ? <span className="mt-2 inline-block max-w-full truncate rounded-[4px] bg-surface-subtle px-1.5 py-0.5 font-mono text-[11.5px] font-semibold text-ink-3">{support}</span> : null}
      {note ? <span className="mt-2 line-clamp-2 text-[12.5px] leading-[18px] text-ink-4" title={note}>{note}</span> : null}
    </>
  );
  const classes = cn(
    "motion-surface block min-w-0 rounded-2xl border bg-raised px-5 pb-[18px] pt-4 text-left shadow-card",
    active ? "border-brand/70 shadow-[0_0_0_3px_rgb(var(--c-brand)/0.12)]" : "border-line",
    to && "hover:-translate-y-px hover:border-line-strong hover:shadow-card-hover focus-visible:border-line-strong focus-visible:outline-none",
    className,
  );
  const name = `${label}: ${value}${suffix ? ` ${suffix}` : ""}`;
  if (to) return <Link to={to} aria-label={name} className={classes}>{body}</Link>;
  return <div className={classes} aria-label={name}>{body}</div>;
}

/** The info mark. A span, not a button, so it can sit inside the tile's link; the tooltip opens on hover. */
function HintMark({ text }: { text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span role="img" aria-label={text} data-hint className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-ink-5 transition-colors hover:text-ink-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/20">
          <Info className="h-3.5 w-3.5" aria-hidden="true" />
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" align="start" className="max-w-[260px]">{text}</TooltipContent>
    </Tooltip>
  );
}

export function StatStrip({ children, columns = 3, className }: { children: ReactNode; columns?: 2 | 3 | 4; className?: string }) {
  return (
    <div className={cn("stagger-children grid gap-4", columns === 4 ? "grid-cols-2 xl:grid-cols-4" : columns === 3 ? "grid-cols-3" : "grid-cols-2", className)}>
      {children}
    </div>
  );
}
