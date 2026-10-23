import { ArrowDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Tone } from "./cards/blocks";
import type { OutcomeLineData, OutcomeMood } from "./outcome";

const DOT: Record<OutcomeMood, string> = { good: "bg-emerald-500", bad: "bg-rose-500", warning: "bg-amber-500", live: "bg-brand animate-pulse", neutral: "bg-ink-5" };
const WORD: Record<OutcomeMood, string> = { good: "text-emerald-700", bad: "text-rose-700", warning: "text-amber-800", live: "text-brand", neutral: "text-ink-3" };
const VALUE: Record<Tone, string> = { neutral: "text-ink-1", good: "text-emerald-700", bad: "text-rose-700", warning: "text-amber-700" };

/** A fact earns a place in the line only when it reads whole; a cut-off value ("Medi…") is worse than none. */
const fits = (item: { label: string; value: string }) => item.label.length + item.value.length <= 32;

/** Where the task stands, in one line under the title (SPEC-tasks-10 FR-2). While it waits on the reader the line is a button to the prompt. */
export function OutcomeLine({ line, onJump, className }: { line: OutcomeLineData; onJump?: () => void; className?: string }) {
  const body = (
    <>
      <span className="flex shrink-0 items-center gap-2">
        <span className={cn("h-2 w-2 rounded-full", DOT[line.mood])} aria-hidden="true" />
        <span className={cn("text-[13px] font-semibold", WORD[line.mood])}>{line.word}</span>
      </span>
      {/* The headline is the point: it keeps at least two fifths of the line, and the facts give way first. */}
      <span className="min-w-[40%] flex-1 truncate text-[14px] text-ink-1" title={line.headline}>{line.headline}</span>
      {line.items.length ? (
        <dl className="hidden min-w-0 shrink items-center gap-4 overflow-hidden lg:flex">
          {line.items.filter(fits).slice(0, 3).map((item, index) => <div key={`${item.label}-${index}`} className="flex min-w-0 items-baseline gap-1.5 text-[12.5px]" title={`${item.label}: ${item.value}`}><dt className="shrink-0 text-ink-4">{item.label}</dt><dd className={cn("max-w-[180px] truncate font-semibold tabular-nums", VALUE[item.tone])}>{item.value}</dd></div>)}
        </dl>
      ) : null}
      {line.waiting && onJump ? <span className="flex shrink-0 items-center gap-1 text-[12.5px] font-medium text-amber-800">Go to it<ArrowDown className="h-3.5 w-3.5" aria-hidden="true" /></span> : null}
    </>
  );
  const classes = cn("flex min-h-11 w-full items-center gap-3 border-b border-line bg-raised px-6 py-2 text-left", line.waiting && "bg-amber-50/60", className);
  if (line.waiting && onJump) return <button type="button" onClick={onJump} className={cn(classes, "transition-colors hover:bg-amber-50")} aria-label={`${line.headline}. Go to it`}>{body}</button>;
  return <div className={classes} role="status" aria-live="off">{body}</div>;
}
