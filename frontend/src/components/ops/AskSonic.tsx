import { X } from "lucide-react";
import { AGENT_NAME } from "@/components/ops/agentPanelContext";
import { AgentMark } from "@/components/ops/AgentMark";
import { Button, Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui";
import { cn } from "@/lib/utils";

/**
 * "Ask Sonic about this" on something a person is looking at (SPEC-tasks-12): Sonic's mark as an icon button,
 * and the bar a picked chart point or row shows until it is asked about or cleared. Board widgets and the
 * Overview panels share them, so the gesture reads the same everywhere.
 */

export function AskSonicButton({ about, onClick, className }: { about: string; onClick: () => void; className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button size="icon" variant="ghost" className={cn("h-6 w-6 shrink-0 rounded-md text-ink-4 hover:bg-surface-subtle hover:text-ink-1", className)} onClick={onClick} aria-label={`Ask ${AGENT_NAME} about ${about}`}><AgentMark size={16} /></Button>
      </TooltipTrigger>
      <TooltipContent>Ask {AGENT_NAME} about this</TooltipContent>
    </Tooltip>
  );
}

export function PickedPoint({ label, onAsk, onClear, className }: { label: string; onAsk: () => void; onClear: () => void; className?: string }) {
  return (
    <div role="status" className={cn("flex min-w-0 items-center gap-2 rounded-lg bg-surface-subtle px-2.5 py-1.5 text-[12.5px] leading-5", className)} data-testid="picked-point">
      <span className="min-w-0 flex-1 truncate tabular-nums text-ink-2" title={label}>{label}</span>
      <button type="button" className="shrink-0 font-medium text-brand hover:text-brand-hover hover:underline" onClick={onAsk}>Ask {AGENT_NAME} about this</button>
      <button type="button" className="shrink-0 rounded p-0.5 text-ink-4 hover:bg-surface-raised hover:text-ink-1" onClick={onClear} aria-label="Clear the picked point"><X className="h-3.5 w-3.5" aria-hidden="true" /></button>
    </div>
  );
}
