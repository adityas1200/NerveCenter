/* eslint-disable react-refresh/only-export-components */
import { cn } from "@/lib/utils";

/**
 * One vocabulary for ticket priority across the app. The backend stores
 * critical/high/medium/low; operators talk in P1–P4. Every surface that shows a
 * priority goes through here so the label and the colour always agree.
 */

export type PriorityLevel = "P1" | "P2" | "P3" | "P4";

const LEVEL_BY_VALUE: Record<string, PriorityLevel> = {
  critical: "P1",
  p1: "P1",
  high: "P2",
  p2: "P2",
  medium: "P3",
  p3: "P3",
  low: "P4",
  p4: "P4",
};

const WORD_BY_LEVEL: Record<PriorityLevel, string> = { P1: "Critical", P2: "High", P3: "Medium", P4: "Low" };
export const PRIORITY_RANK: Record<PriorityLevel, number> = { P1: 0, P2: 1, P3: 2, P4: 3 };

const TONE: Record<PriorityLevel, string> = {
  P1: "border-rose-200 bg-rose-100 text-rose-800",
  P2: "border-orange-200 bg-orange-50 text-orange-700",
  P3: "border-amber-200 bg-amber-50 text-amber-800",
  P4: "border-slate-200 bg-slate-50 text-slate-600",
};

export function priorityLevel(value?: string | null): PriorityLevel | null {
  return LEVEL_BY_VALUE[String(value || "").toLowerCase()] ?? null;
}

/** Sort rank: P1 first, unknown last. */
export function priorityRank(value?: string | null): number {
  const level = priorityLevel(value);
  return level ? PRIORITY_RANK[level] : 9;
}

/** "P1 · Critical" for places that want the long form. */
export function priorityText(value?: string | null): string {
  const level = priorityLevel(value);
  if (!level) return "No priority";
  return `${level} · ${WORD_BY_LEVEL[level]}`;
}

export function PriorityBadge({ priority, className, size = "sm", variant = "code" }: { priority?: string | null; className?: string; size?: "sm" | "md"; variant?: "code" | "label" }) {
  const level = priorityLevel(priority);
  if (variant === "label") {
    return (
      <span className={cn("inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border py-0.5 pl-1.5 pr-2 text-[11.5px] font-semibold", level ? TONE[level] : "border-slate-200 bg-slate-50 text-slate-400", className)} title={level ? priorityText(priority) : "No priority set"}>
        <span className="font-mono font-bold tabular-nums">{level ?? "—"}</span>
        {level ? <span className="font-medium">{WORD_BY_LEVEL[level]}</span> : null}
      </span>
    );
  }
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-md border font-mono font-bold tabular-nums",
        size === "sm" ? "min-w-[30px] px-1.5 py-0.5 text-[11px]" : "min-w-[38px] px-2 py-1 text-[13px]",
        level ? TONE[level] : "border-slate-200 bg-slate-50 text-slate-400",
        className,
      )}
      title={level ? priorityText(priority) : "No priority set"}
    >
      {level ?? "—"}
    </span>
  );
}
