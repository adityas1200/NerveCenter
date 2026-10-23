import type { MouseEvent } from "react";
import { AgentMark } from "@/components/ops/AgentMark";
import { AGENT_NAME, useAskSonic, type AgentSelection } from "@/components/ops/agentPanelContext";
import { Button, Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui";
import { cn } from "@/lib/utils";
import { useProject } from "@/lib/projectContext";

/**
 * The one "ask Sonic about this row" control, shared by Tickets, Pipelines and Data Quality so it
 * looks and behaves the same everywhere - same size, same tooltip, same hover state - instead of
 * three hand-written copies that quietly drift apart (Tickets used to skip the Tooltip and rely on
 * the browser's native `title` instead, which is why it looked and behaved slightly differently).
 *
 * `icon` (default): a tooltipped icon button, for a table row.
 * `outline`: a labelled "Ask Sonic" button, for a detail sheet or header.
 * `primary`: a filled "Investigate" button, for a failed row's primary action.
 */
export function AskAgentButton({
  onClick,
  label,
  variant = "icon",
  investigateLabel = "Investigate",
  className,
}: {
  onClick: (event: MouseEvent) => void;
  /** Accessible name and tooltip text: "Ask Sonic about <thing>". */
  label: string;
  variant?: "icon" | "outline" | "primary";
  investigateLabel?: string;
  className?: string;
}) {
  // A visitor to an open project reads it but does not ask Sonic there (SPEC-projects-03 FR-13).
  const { visitor } = useProject();
  if (visitor) return null;
  if (variant === "primary") return <Button size="sm" variant="primary" onClick={onClick} className={className}>{investigateLabel}</Button>;
  if (variant === "outline") return <Button size="sm" variant="outline" className={cn("border border-line", className)} onClick={onClick} aria-label={label}><AgentMark size={18} />Ask {AGENT_NAME}</Button>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button size="icon" variant="ghost" className={cn("row-reveal h-7 w-7 shrink-0 rounded-lg", className)} onClick={onClick} aria-label={label}><AgentMark size={20} /></Button>
      </TooltipTrigger>
      <TooltipContent side="left">Ask {AGENT_NAME}</TooltipContent>
    </Tooltip>
  );
}

/**
 * `AskAgentButton` wired to the panel: stops the click so the row does not open, runs `onBeforeAsk`
 * (close the detail sheet this button lives in, see `useAskSonic`) and hands the record to Sonic.
 */
export function AskSonicButton({ selection, prompt, onBeforeAsk, ...button }: { selection: AgentSelection; prompt: string; onBeforeAsk?: () => void } & Omit<Parameters<typeof AskAgentButton>[0], "onClick">) {
  const askSonic = useAskSonic(onBeforeAsk);
  return <AskAgentButton {...button} onClick={(event) => { event.stopPropagation(); askSonic(selection, prompt); }} />;
}
