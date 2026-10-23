import { Link } from "react-router-dom";
import { PriorityBadge } from "@/components/ops/PriorityBadge";
import { Skeleton, formatAbsoluteTime, formatDuration, formatRelativeTime } from "@/components/ui";
import { cn } from "@/lib/utils";
import { AgentCard } from "./AgentCard";
import type { Block, RunRow } from "./blocks";
import { StateTag } from "./DataBlocks";

/**
 * The data-bound components (SPEC-tasks-10 FR-14): the server read the ticket or the runs, and these draw
 * the tool result, never the model's input. Pending until the result lands; an error reads as one line.
 */

const words = (value: string) => value.replace(/[_-]+/g, " ").replace(/^./, (letter) => letter.toUpperCase());

export function TicketCard({ block, compact = false, className }: { block: Extract<Block, { kind: "ticket" }>; compact?: boolean; className?: string }) {
  if (block.pending) return <AgentCard title="Ticket" compact={compact} className={className}><Skeleton className="h-4 w-2/3" /><Skeleton className="mt-2 h-3 w-1/3" /></AgentCard>;
  const ticket = block.ticket;
  if (!ticket) return <AgentCard title="Ticket" compact={compact} className={className}><p className="text-[13px] text-ink-4">{block.error || "The ticket could not be read"}</p></AgentCard>;
  const resolved = /^(resolved|closed|done)$/i.test(ticket.status || "");
  return (
    <AgentCard title={ticket.number && ticket.number !== ticket.ticketId ? `${ticket.number} · ${ticket.ticketId}` : ticket.ticketId} note={block.note} compact={compact} className={className}
      action={<Link to={ticket.link} className="inline-flex items-center gap-1 text-[12.5px] font-medium text-brand hover:text-brand-hover">Open</Link>}>
      <p className="text-[14.5px] font-medium leading-6 text-ink-1">{ticket.title}</p>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12.5px] text-ink-4">
        {ticket.status ? <StateTag tone={resolved ? "good" : "brand"}>{words(ticket.status)}</StateTag> : null}
        {ticket.priority ? <PriorityBadge priority={ticket.priority} variant="label" /> : null}
        {ticket.source ? <span>{words(ticket.source)}</span> : null}
        <span>{ticket.assignee ? `Assigned to ${ticket.assignee}` : "Unassigned"}</span>
        {ticket.updatedAt ? <span title={formatAbsoluteTime(ticket.updatedAt)}>Updated {formatRelativeTime(ticket.updatedAt)}</span> : null}
      </div>
      {ticket.agentFinding ? <p className="mt-2.5 border-t border-line-soft pt-2.5 text-[13px] leading-5 text-ink-3">{ticket.agentFinding}</p> : null}
    </AgentCard>
  );
}

const RUN_TONE = (status: string): "good" | "bad" | "warning" | "brand" | "neutral" => (/^(success|succeeded|ok|passed|completed)$/.test(status) ? "good" : /fail|error/.test(status) ? "bad" : /running|queued|pending/.test(status) ? "brand" : /cancel|skip|timeout|late/.test(status) ? "warning" : "neutral");
const RUN_CELL: Record<ReturnType<typeof RUN_TONE>, string> = { good: "bg-emerald-500/25", bad: "bg-rose-500", warning: "bg-amber-400", brand: "bg-brand/50", neutral: "bg-surface-subtle ring-1 ring-inset ring-line" };

export function PipelineRunsCard({ block, compact = false, className }: { block: Extract<Block, { kind: "pipeline_runs" }>; compact?: boolean; className?: string }) {
  const title = block.title || `Runs of ${block.pipelineId}`;
  if (block.pending) return <AgentCard title={title} compact={compact} className={className}><div className="flex gap-1.5">{Array.from({ length: 8 }, (_, index) => <Skeleton key={index} className="h-6 flex-1" />)}</div></AgentCard>;
  if (block.error || !block.runs.length) return <AgentCard title={title} compact={compact} className={className}><p className="text-[13px] text-ink-4">{block.error || "No runs yet"}</p></AgentCard>;
  const failed = block.runs.filter((run) => RUN_TONE(run.status) === "bad").length;
  // The strip reads left to right, oldest first, the way a calendar does.
  const ordered = [...block.runs].sort((left, right) => Date.parse(left.startTime || "") - Date.parse(right.startTime || ""));
  return (
    <AgentCard title={title} note={`${block.runs.length} runs${failed ? ` · ${failed} failed` : ""}`} compact={compact} className={className} bodyClassName="px-0 pb-0">
      <div className="flex gap-1 px-4 pb-3" aria-label="Runs, oldest first">{ordered.map((run) => <span key={run.runId} className={cn("h-6 flex-1 rounded", RUN_CELL[RUN_TONE(run.status)])} title={`${run.runId} · ${words(run.status)}${run.startTime ? ` · ${formatAbsoluteTime(run.startTime)}` : ""}`} />)}</div>
      <ul className="divide-y divide-line-soft border-t border-line-soft">
        {block.runs.slice(0, compact ? 5 : 8).map((run) => <RunLine key={run.runId} run={run} compact={compact} />)}
      </ul>
      {block.note ? <p className="border-t border-line-soft px-4 py-2 text-[12.5px] text-ink-4">{block.note}</p> : null}
    </AgentCard>
  );
}

function RunLine({ run, compact }: { run: RunRow; compact: boolean }) {
  return (
    <li className={cn("grid items-start gap-x-3 px-4 py-2 text-[13px]", compact ? "grid-cols-[1fr_auto] px-3" : "grid-cols-[110px_1fr_auto]")}>
      {!compact ? <span className="truncate font-mono text-[12px] text-ink-4" title={run.runId}>{run.runId}</span> : null}
      <div className="min-w-0">
        <span className="text-ink-2" title={run.startTime ? formatAbsoluteTime(run.startTime) : undefined}>{run.startTime ? formatRelativeTime(run.startTime) : "—"}{run.durationMs !== null ? <span className="text-ink-5"> · {formatDuration(run.durationMs)}</span> : null}{run.ticket ? <Link to={`/tickets/${encodeURIComponent(run.ticket)}`} className="ml-2 text-[12px] font-medium text-brand hover:text-brand-hover">{run.ticket}</Link> : null}</span>
        {run.failure ? <p className="mt-0.5 line-clamp-2 text-[12.5px] leading-5 text-rose-700" title={run.failure}>{run.failure}</p> : null}
      </div>
      <StateTag tone={RUN_TONE(run.status)}>{words(run.status)}</StateTag>
    </li>
  );
}
