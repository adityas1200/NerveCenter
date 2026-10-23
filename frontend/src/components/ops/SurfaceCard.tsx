import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The one card frame for content the agent produced or is asking about: a flat white surface with a
 * hairline border, an optional small uppercase label row (with a note and actions beside it) and the
 * body. `tone="warning"` gives it the amber border an approval prompt uses; `tone="success"` gives it
 * the emerald border a one-line verdict banner uses (same emerald-600 already used for a passed check
 * elsewhere, e.g. RoutineDialog's check list - not a new colour). Stat tiles and tables keep their own
 * frames; this is for the cards in between.
 */
export type SurfaceTone = "default" | "warning" | "success";

export interface SurfaceCardProps {
  /** Small uppercase label in the top row, e.g. "Plan" or "Proposed change". */
  label?: ReactNode;
  /** Quiet text beside the label: a count, a time, a source. */
  note?: ReactNode;
  /** Buttons or links at the right of the label row. */
  actions?: ReactNode;
  tone?: SurfaceTone;
  /** Remove the body padding when the child draws its own edges (a table, a code block). */
  flush?: boolean;
  className?: string;
  bodyClassName?: string;
  children?: ReactNode;
}

export function SurfaceCard({ label, note, actions, tone = "default", flush = false, className, bodyClassName, children }: SurfaceCardProps) {
  const hasHead = Boolean(label || note || actions);
  return (
    <section data-tone={tone} className={cn("rounded-xl border bg-raised", tone === "warning" ? "border-amber-300" : tone === "success" ? "border-emerald-300" : "border-line", className)}>
      {hasHead ? (
        <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 px-4 pt-3", children ? "" : "pb-3")}>
          {label ? <span className={cn("text-[12px] font-medium", tone === "warning" ? "text-amber-700" : tone === "success" ? "text-emerald-700" : "text-ink-5")}>{label}</span> : null}
          {note ? <span className="min-w-0 truncate text-[12.5px] text-ink-4">{note}</span> : null}
          {actions ? <div className="ml-auto flex shrink-0 items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      {children !== undefined && children !== null ? <div className={cn(flush ? "" : hasHead ? "px-4 pb-4 pt-2" : "p-4", bodyClassName)}>{children}</div> : null}
    </section>
  );
}
