import { Check, Minus, Square, X } from "lucide-react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/utils";
import { AgentCard } from "./AgentCard";
import type { Plan, PlanStepState } from "./cards";

/**
 * The agent's plan as a numbered checklist that ticks as steps finish. The active step pulses; a step
 * that changes a system says so in a quiet chip; a note reads under its step. "Adjust plan" hands the
 * page a prefilled follow-up; "Stop" is the task's existing cancel.
 */

export const ADJUST_PLAN_DRAFT = "Change the plan: ";

export function PlanCard({ plan, live, compact = false, onAdjust, onStop, className }: { plan: Plan; live: boolean; compact?: boolean; onAdjust?: (draft: string) => void; onStop?: () => void; className?: string }) {
  const summary = `${plan.done} of ${plan.total} done`;
  return (
    <AgentCard title={plan.title || "Plan"} note={summary} compact={compact} className={className} bodyClassName={compact ? "px-3 py-2" : "px-4 py-2.5"}>
      <ol className={cn("space-y-1.5", compact && "space-y-1")} aria-label="Plan steps">
        {plan.steps.map((step, index) => (
          <li key={step.id} className="flex items-start gap-2.5" data-state={step.state}>
            <StepMark state={step.state} />
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className={cn("tabular-nums text-ink-5", compact ? "text-[12px]" : "text-[12.5px]")}>{index + 1}.</span>
                <span className={cn("leading-5", compact ? "text-[13.5px]" : "text-[14px]", step.state === "done" ? "text-ink-3" : step.state === "skipped" ? "text-ink-5 line-through decoration-line-strong" : step.state === "active" ? "font-medium text-ink-1" : step.state === "blocked" ? "text-ink-2" : "text-ink-2")}>{step.text}</span>
                {step.kind === "change" ? <span className="rounded-md border border-line bg-surface-subtle px-1.5 py-px text-[11px] font-medium text-ink-4">Changes a system</span> : null}
              </span>
              {step.note ? <span className={cn("block leading-4 text-ink-5", compact ? "text-[12px]" : "text-[12.5px]", step.state === "blocked" && "text-rose-700")}>{step.note}</span> : null}
            </span>
          </li>
        ))}
      </ol>
      {(onAdjust || (live && onStop)) && !compact ? (
        <div className="mt-2.5 flex items-center gap-2 border-t border-line pt-2.5">
          {onAdjust ? <Button size="sm" variant="outline" className="border border-line bg-raised" onClick={() => onAdjust(ADJUST_PLAN_DRAFT)}>Adjust plan</Button> : null}
          {live && onStop ? <Button size="sm" variant="outline" className="border border-line bg-raised" onClick={onStop}><Square className="h-3 w-3 fill-current" aria-hidden="true" />Stop</Button> : null}
        </div>
      ) : null}
    </AgentCard>
  );
}

function StepMark({ state }: { state: PlanStepState }) {
  const box = "mt-[3px] flex h-4 w-4 shrink-0 items-center justify-center";
  if (state === "done") return <span className={cn(box, "rounded-full bg-ink-1 text-raised")} aria-label="Done"><Check className="h-2.5 w-2.5 animate-[value-swap_200ms_ease-out_both]" strokeWidth={3} aria-hidden="true" /></span>;
  if (state === "active") return <span className={box} aria-label="In progress"><span className="h-2 w-2 animate-pulse rounded-full bg-brand" /></span>;
  if (state === "skipped") return <span className={cn(box, "text-ink-5")} aria-label="Skipped"><Minus className="h-3 w-3" aria-hidden="true" /></span>;
  if (state === "blocked") return <span className={cn(box, "text-rose-600")} aria-label="Blocked"><X className="h-3 w-3" aria-hidden="true" /></span>;
  return <span className={box} aria-label="Pending"><span className="h-2 w-2 rounded-full border border-line-strong bg-raised" /></span>;
}
