import { refreshAfterWrite } from "@/lib/refreshAfterWrite";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronRight, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { inboxApi, inboxKeys } from "@/api/inbox";
import { CATEGORY_LABEL, type TaskEvent, taskKeys } from "@/api/tasks";
import { AGENT_NAME } from "@/components/ops/agentPanelContext";
import { SurfaceCard } from "@/components/ops/SurfaceCard";
import { Button, useToast } from "@/components/ui";
import { cn } from "@/lib/utils";
import { reasonOf } from "../describeWork";
import { safeParse } from "../taskEvents";
import type { Explanation } from "./blocks";
import { FixApprovalSummary } from "./FixCards";
import type { FixProposal } from "./fixes";

/**
 * An approval in the thread (SPEC-tasks-10 FR-7, FR-8; SPEC-tasks-06 FR-12). With an `explain_action` before
 * it, the card leads with Sonic's plain-language summary and keeps the exact command behind "Show command",
 * so the reader decides on both; the category is the server's, not Sonic's. Without one it shows the command
 * or input as before. Once decided it stays as a read-only record of who decided.
 */
export function ApprovalPrompt({ event, explanation = null, proposal = null, decided = null, onDecided, compact = false, className }: {
  event: TaskEvent;
  explanation?: Explanation | null;
  /** For an `apply_fix` approval, the tested proposal from the thread (SPEC-tasks-13 FR-11). */
  proposal?: FixProposal | null;
  compact?: boolean;
  /** The decision, for an approval that is no longer pending. */
  decided?: { decision: "approved" | "denied" | "none"; by: string | null } | null;
  onDecided?: () => void;
  className?: string;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [outcome, setOutcome] = useState<"approve" | "deny" | null>(null);
  const [showCommand, setShowCommand] = useState(false);
  const decide = useMutation({
    mutationFn: (decision: "approve" | "deny") => decision === "approve" ? inboxApi.approve(event.inboxId || "") : inboxApi.deny(event.inboxId || ""),
    onSuccess: async (_item, decision) => { setOutcome(decision); await refreshAfterWrite(queryClient, { queryKey: inboxKeys.all }); await refreshAfterWrite(queryClient, { queryKey: taskKeys.all }); onDecided?.(); },
    onError: (error) => toast.error("Decision not saved", error instanceof Error ? error.message : "Try again."),
  });
  const category = CATEGORY_LABEL[event.category || ""] || "Change";

  if (outcome && !decided) {
    return (
      <div className={cn("flex items-center gap-2 rounded-xl border border-line bg-raised px-3 py-2.5 text-[13.5px]", className)} role="status">
        {outcome === "approve" ? <Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" /> : <X className="h-3.5 w-3.5 text-ink-4" aria-hidden="true" />}
        <span className="text-ink-2">{outcome === "approve" ? `Approved. ${AGENT_NAME} is continuing.` : `Denied. ${AGENT_NAME} will carry on without this change.`}</span>
      </div>
    );
  }

  // An apply_fix approval shows what NerveCenter measured; its own input is only a proposal id.
  const command = event.fix ? <FixApprovalSummary fix={event.fix} proposal={decided ? null : proposal} compact={compact} decided={Boolean(decided)} /> : <CommandDetail event={event} />;
  if (decided) {
    const approved = decided.decision === "approved";
    const word = decided.decision === "none" ? "Not decided" : `${approved ? "Approved" : "Denied"}${decided.by ? ` by ${decided.by}` : ""}`;
    return (
      <SurfaceCard label={category} className={className} actions={<span className={cn("inline-flex items-center gap-1 text-[12.5px] font-medium", approved ? "text-emerald-700" : "text-ink-4")}>{approved ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : decided.decision === "denied" ? <X className="h-3.5 w-3.5" aria-hidden="true" /> : null}{word}</span>} bodyClassName="pt-1">
        {explanation ? <ExplanationBody explanation={explanation} /> : command}
        {explanation && event.fix ? <div className="mt-3 border-t border-line-soft pt-3">{command}</div> : explanation ? <CommandToggle open={showCommand} onToggle={() => setShowCommand((value) => !value)}>{command}</CommandToggle> : null}
      </SurfaceCard>
    );
  }

  return (
    <SurfaceCard tone="warning" label={category} className={className} bodyClassName="pt-1">
      <p className="text-[13.5px] font-semibold text-ink-1">{AGENT_NAME} needs your approval</p>
      {explanation ? (
        <>
          <ExplanationBody explanation={explanation} />
          {event.fix ? <div className="mt-3 border-t border-line-soft pt-3">{command}</div> : <CommandToggle open={showCommand} onToggle={() => setShowCommand((value) => !value)}>{command}</CommandToggle>}
        </>
      ) : command}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="primary" disabled={decide.isPending} busy={decide.isPending} onClick={() => decide.mutate("approve")}><Check className="h-3.5 w-3.5" />{decide.isPending && decide.variables === "approve" ? "Approving" : "Approve"}</Button>
        <Button size="sm" variant="outline" className="border border-line bg-raised" disabled={decide.isPending} busy={decide.isPending} onClick={() => decide.mutate("deny")}><X className="h-3.5 w-3.5" />Deny</Button>
        <Link to="/settings?tab=policy" className="ml-auto text-[12.5px] text-ink-4 hover:text-ink-1">Why am I asked?</Link>
      </div>
    </SurfaceCard>
  );
}

function ExplanationBody({ explanation }: { explanation: Explanation }) {
  const rows = [["Impact", explanation.impact], ["Undo", explanation.rollback], ["If it fails", explanation.ifFails]].filter((row): row is [string, string] => Boolean(row[1]));
  return (
    <div className="mt-1">
      <p className="text-[14px] font-medium leading-6 text-ink-1">{explanation.title}</p>
      {explanation.what ? <p className="mt-0.5 text-[13.5px] leading-5 text-ink-2">{explanation.what}</p> : null}
      {explanation.checks.length ? <ul className="mt-2 space-y-1">{explanation.checks.map((check, index) => <li key={index} className="flex gap-2 text-[13px] leading-5 text-ink-2"><Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden="true" />{check}</li>)}</ul> : null}
      {rows.length ? <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[13px]">{rows.map(([label, value]) => <div key={label} className="contents"><dt className="text-ink-4">{label}</dt><dd className="text-ink-2">{value}</dd></div>)}</dl> : null}
      <p className="mt-2 text-[11.5px] text-ink-5">{AGENT_NAME}&apos;s summary. The command below is what runs.</p>
    </div>
  );
}

function CommandToggle({ open, onToggle, children }: { open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <div className="mt-2">
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex items-center gap-1 text-[12.5px] font-medium text-ink-3 hover:text-ink-1"><ChevronRight className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-90")} aria-hidden="true" />{open ? "Hide command" : "Show command"}</button>
      {open ? children : null}
    </div>
  );
}

/** The exact command, file or input behind the approval, as the server recorded it. */
function CommandDetail({ event }: { event: TaskEvent }) {
  const input = safeParse(event.tool?.input);
  const title = (event.title || "").replace(/^Waiting for approval: /, "");
  const reason = reasonOf(event);
  const command = typeof input?.command === "string" ? input.command : null;
  const filePath = typeof input?.file_path === "string" ? input.file_path : null;
  const content = typeof input?.content === "string" ? input.content : typeof input?.new_string === "string" ? input.new_string : null;
  const fields = input ? Object.entries(input).filter(([key]) => key !== "reason") : [];
  return (
    <>
      <p className="mt-1 text-[13.5px] leading-5 text-ink-2">{command ? "Run this command" : title}</p>
      {reason ? <p className="mt-1 text-[13.5px] leading-5 text-ink-2"><span className="font-medium">Why:</span> {reason}</p> : null}
      {command ? <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-line bg-surface-subtle p-2.5 font-mono text-[12.5px] text-ink-2">{command.length > 1200 ? `${command.slice(0, 1200)}…` : command}</pre> : null}
      {!command && filePath ? <div className="mt-2 rounded-lg border border-line bg-surface-subtle p-2.5"><p className="truncate font-mono text-[12.5px] text-ink-3" title={filePath}>{filePath}</p>{content ? <pre className="mt-1.5 max-h-40 overflow-auto whitespace-pre-wrap font-mono text-[12.5px] text-ink-2">{content.length > 1500 ? `${content.slice(0, 1500)}…` : content}</pre> : null}</div> : null}
      {!command && !filePath && fields.length ? <dl className="mt-2 grid gap-x-3 gap-y-0.5 rounded-lg border border-line bg-surface-subtle p-2.5 text-[12.5px] sm:grid-cols-[auto_1fr]">{fields.slice(0, 8).map(([key, value]) => <ItemRow key={key} label={key} value={value} />)}</dl> : null}
    </>
  );
}

function ItemRow({ label, value }: { label: string; value: unknown }) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return <><dt className="font-mono text-ink-5">{label}</dt><dd className="truncate text-ink-2" title={text}>{text.length > 200 ? `${text.slice(0, 200)}…` : text}</dd></>;
}
