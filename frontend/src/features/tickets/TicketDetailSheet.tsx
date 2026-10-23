import { refreshAfterWrite } from "@/lib/refreshAfterWrite";
import { RefreshButton } from "@/components/ops/RefreshButton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Lock, MessageSquare, PencilLine, RotateCcw, CheckCircle2, Send, UserRound } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { queryKeys } from "@/api/queryKeys";
import { ticketsApi, type TicketActivityItem, type TicketPatch } from "@/api/tickets";
import { listItems, type Ticket, type TicketLink, type UserIdentity } from "@/api/types";
import { useMe } from "@/auth/rbac";
import { AgentMark } from "@/components/ops/AgentMark";
import { AppStatusPill } from "@/components/ops/AgentStatePill";
import { BrandLogo } from "@/components/ops/BrandLogo";
import { Fact } from "@/components/ops/Fact";
import { Pager } from "@/components/ops/Pager";
import { AGENT_NAME, useAskSonic } from "@/components/ops/agentPanelContext";
import { PriorityBadge, priorityText } from "@/components/ops/PriorityBadge";
import { QueryState } from "@/components/ops/StatePanels";
import { Button, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Switch, Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, Textarea, formatRelativeTime, useToast } from "@/components/ui";
import { cn } from "@/lib/utils";
import { assigneeName, humanize, isClosed, sourceKey, SOURCE_LABEL } from "./ticketFields";
import { useAction } from "@/lib/useAction";
import { useProject } from "@/lib/projectContext";
import { usePager } from "@/lib/usePager";

/**
 * One ticket, in the order a person needs it:
 *   1. what Sonic found, with Investigate (its Task) and Ask Sonic (the shared panel, ticket selected),
 *   2. the ticket as the source system has it,
 *   3. what you can do yourself (every change is saved in ServiceNow or Jira too),
 *   4. everything that happened, newest first.
 */

const FILE_IN_SERVICENOW = "File this ticket in ServiceNow as an incident in the Data Platform Support queue and link it back here.";
/** Sent to the ticket's existing task: the agent re-checks rather than starting from scratch. */
const LOOK_AGAIN = "Look at this ticket again. Check what has changed since your last findings, confirm or correct them, and say what should happen next.";

type Panel = "assign" | "resolve" | "comment" | "edit" | null;

const timestamp = (value?: string | null) => value ? new Date(value).toLocaleString() : "—";
/** Platform run IDs are long; "Run 8a1f02c3…" reads, the full id sits in the tooltip. */
const shortRunId = (runId: string) => runId.length > 12 ? `${runId.slice(0, 8)}…` : runId;

export function TicketDetailSheet({ ticketId, people, onClose }: { ticketId?: string; people: UserIdentity[]; onClose: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const me = useMe();
  const { project } = useProject();
  const askSonic = useAskSonic(onClose);
  const [panel, setPanel] = useState<Panel>(null);
  useEffect(() => setPanel(null), [ticketId]);

  const detail = useQuery({ queryKey: queryKeys.tickets.detail(ticketId || ""), queryFn: ({ signal }) => ticketsApi.detail(ticketId || "", signal), enabled: Boolean(ticketId), refetchInterval: false });
  const activity = useQuery({ queryKey: [...queryKeys.tickets.detail(ticketId || ""), "activity"], queryFn: ({ signal }) => ticketsApi.activity(ticketId || "", signal), enabled: Boolean(ticketId), retry: false });

  const invalidate = async () => {
    await Promise.all([refreshAfterWrite(queryClient, { queryKey: queryKeys.tickets.all }), refreshAfterWrite(queryClient, { queryKey: queryKeys.overview.all })]);
  };
  const where = (ticket?: Ticket | null) => (ticket?.sourceWrite ? ` · saved in ${ticket.sourceWrite.name} ${ticket.sourceWrite.number}` : "");
  const update = useMutation({
    mutationFn: (patch: TicketPatch) => ticketsApi.update(ticketId || "", patch),
    onSuccess: async (updated, patch) => {
      queryClient.setQueryData(queryKeys.tickets.detail(ticketId || ""), updated);
      await Promise.all([invalidate(), activity.refetch({ cancelRefetch: false })]);
      setPanel(null);
      toast.success(patch.status === "resolved" ? "Ticket resolved" : patch.status === "open" ? "Ticket reopened" : patch.assignee !== undefined ? "Assignment saved" : "Ticket updated", `${updated.externalReference?.number || updated.ticketId}${where(updated)}`);
    },
    onError: (error) => toast.error("Not saved", error instanceof Error ? error.message : "Try again."),
  });
  const agent = useAction({
    mutationFn: (body: { prompt?: string }) => ticketsApi.investigate(ticketId || "", { ...body, permission: "policy" }),
    invalidate: [queryKeys.tickets.all, queryKeys.overview.all],
    onSuccess: (result) => { setPanel(null); navigate(`/tasks/${encodeURIComponent(result.task.id)}`); },
    error: `${AGENT_NAME} did not start`,
  });
  const comment = useMutation({
    mutationFn: (body: string) => ticketsApi.comment(ticketId || "", body),
    onSuccess: async (result) => { await activity.refetch({ cancelRefetch: false }); setPanel(null); toast.success("Comment added", result.sourceWrite ? `Saved in ${result.sourceWrite.name} ${result.sourceWrite.number}` : undefined); },
    onError: (error) => toast.error("Comment not saved", error instanceof Error ? error.message : "Try again."),
  });

  const ticket = detail.data;
  const owner = ticket ? assigneeName(ticket) : null;
  const closed = ticket ? isClosed(ticket) : false;
  const events = useMemo<TicketActivityItem[]>(() => listItems(activity.data), [activity.data]);
  const source = ticket ? sourceKey(ticket) : "manual";
  const sourceName = source === "servicenow" || source === "jira" ? SOURCE_LABEL[source] : null;
  const number = ticket?.externalReference?.number || ticket?.ticketId;
  const savedWhere = sourceName ? `Saved in ${sourceName} ${number} too.` : "Saved in NerveCenter.";

  return (
    <Sheet open={Boolean(ticketId)} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-[720px]">
        <SheetHeader>
          <RefreshButton onClick={() => { void detail.refetch({ cancelRefetch: false }); void activity.refetch({ cancelRefetch: false }); }} busy={detail.isFetching || activity.isFetching} updatedAt={detail.dataUpdatedAt} />
          <div className="flex flex-wrap items-center gap-2">
            {ticket ? <PriorityBadge priority={ticket.priority} size="md" /> : null}
            {ticket ? <AppStatusPill status={ticket.appStatus} sourceStatus={ticket.sourceStatus} /> : null}
            {ticket?.visibility === "private" ? <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-line bg-surface-subtle px-2 py-0.5 text-[12px] font-medium text-ink-3"><Lock className="h-3 w-3" aria-hidden="true" />Private</span> : null}
            {ticket?.recurrence ? <Link to={`/tickets/${encodeURIComponent(ticket.recurrence.ofTicketId)}`} className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[12px] font-medium text-amber-900 hover:underline" title="The same failure came back after the earlier ticket was resolved"><RotateCcw className="h-3 w-3" aria-hidden="true" />Recurrence of {ticket.recurrence.ofTicketId}</Link> : null}
          </div>
          <SheetTitle className="mt-2 text-[18px] leading-snug">{ticket?.title || ticket?.failureSummary || ticketId}</SheetTitle>
          <SheetDescription>
            <span className="font-mono">{number}</span>
            {sourceName ? <> · <BrandLogo brand={source} className="-mt-px mr-1 inline h-3.5 w-3.5 align-middle" />{sourceName}</> : ticket?.pipelineName ? ` · Pipeline ${ticket.pipelineName}` : " · NerveCenter"}
            {ticket?.createdAt ? ` · opened ${formatRelativeTime(ticket.createdAt)}` : ""}
            {ticket?.requester?.name ? ` by ${ticket.requester.name}` : ""}
          </SheetDescription>
        </SheetHeader>
        <div className="px-6 pb-8 pt-4">
          <QueryState query={detail}>
            {ticket ? (
              <div className="space-y-6">
                <SonicBlock ticket={ticket} busy={agent.isPending} onInvestigate={(prompt) => agent.mutate(prompt ? { prompt } : {})} onAsk={() => { askSonic({ kind: "ticket", id: ticket.ticketId, title: ticket.title || ticket.ticketId }, `Tell me about this ticket: what it is, what has happened so far, and what I should do next.`); }} />

                <section>
                  <SectionTitle>The ticket{sourceName ? ` in ${sourceName}` : ""}</SectionTitle>
                  <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3.5 sm:grid-cols-3">
                    <Fact label="Assigned to" value={owner || "Nobody"} />
                    <Fact label="Requested by" value={ticket.requester?.name || ticket.metadata?.serviceNow?.requester || "—"} />
                    {ticket.metadata?.serviceNow?.assignmentGroup ? <Fact label="Group" value={ticket.metadata.serviceNow.assignmentGroup} /> : <Fact label="Category" value={humanize(ticket.category) || "—"} />}
                    <Fact label={sourceName ? `${sourceName} state` : "State"} value={ticket.sourceStatus || humanize(ticket.status)} />
                    <Fact label="Priority" value={priorityText(ticket.priority || "medium")} />
                    <Fact label="Last update" value={ticket.updatedAt ? formatRelativeTime(ticket.updatedAt) : "—"} />
                    {ticket.pipelineId ? <Fact label="Pipeline run" value={`${ticket.pipelineName || ticket.pipelineId}${ticket.runId ? ` · Run ${shortRunId(ticket.runId)}` : ""}`} title={`${ticket.pipelineName || ticket.pipelineId}${ticket.runId ? ` · ${ticket.runId}` : ""}`} /> : null}
                    {ticket.resolutionSummary ? <div className="col-span-full"><Fact label="Resolution" value={ticket.resolutionSummary} wrap /></div> : null}
                  </dl>
                  {canChangeVisibility(ticket, me.data, project?.role) ? (
                    <div className="mt-4 flex items-center gap-2 text-[13.5px] text-ink-3">
                      <Switch id="ticket-private" checked={ticket.visibility === "private"} disabled={update.isPending} onCheckedChange={(checked) => update.mutate({ visibility: checked ? "private" : "project" })} aria-label="Private ticket" />
                      <label htmlFor="ticket-private">Private: only the people on it and the project&apos;s owners see it</label>
                    </div>
                  ) : null}
                  {ticket.description ? <p className="mt-4 whitespace-pre-wrap border-t border-line pt-4 text-[14px] leading-6 text-ink-2">{ticket.description}</p> : null}
                  {ticket.externalReference?.url ? <a className="mt-3 inline-flex items-center gap-1 text-[13.5px] font-semibold text-brand hover:underline" href={ticket.externalReference.url} target="_blank" rel="noreferrer"><BrandLogo brand={source} className="mr-0.5 h-3.5 w-3.5" />Open {number} in {sourceName} <ExternalLink className="h-3.5 w-3.5" /></a> : null}
                </section>

                <RelatedTickets links={ticket.links} />

                <section>
                  <div className="flex items-baseline justify-between gap-3"><SectionTitle>Your actions</SectionTitle><span className="text-[12.5px] text-ink-5">{savedWhere}</span></div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {!closed && !owner ? <ActionButton icon={<UserRound className="h-3.5 w-3.5" />} disabled={update.isPending || !me.data?.user?.id} onClick={() => update.mutate({ assignee: { id: me.data?.user?.id || "", name: me.data?.user?.name || "" } })}>Assign to me</ActionButton> : null}
                    {!closed && owner ? <ActionButton icon={<UserRound className="h-3.5 w-3.5" />} pressed={panel === "assign"} onClick={() => setPanel(panel === "assign" ? null : "assign")}>Reassign</ActionButton> : null}
                    {ticket.permissions?.canComment !== false ? <ActionButton icon={<MessageSquare className="h-3.5 w-3.5" />} pressed={panel === "comment"} onClick={() => setPanel(panel === "comment" ? null : "comment")}>Comment</ActionButton> : null}
                    <ActionButton icon={<PencilLine className="h-3.5 w-3.5" />} pressed={panel === "edit"} onClick={() => setPanel(panel === "edit" ? null : "edit")}>Edit</ActionButton>
                    {!closed ? <ActionButton icon={<CheckCircle2 className="h-3.5 w-3.5" />} pressed={panel === "resolve"} onClick={() => setPanel(panel === "resolve" ? null : "resolve")}>Resolve</ActionButton> : null}
                    {closed && ticket.permissions?.canClose !== false ? <ActionButton icon={<RotateCcw className="h-3.5 w-3.5" />} disabled={update.isPending} onClick={() => update.mutate({ status: "open" })}>Reopen</ActionButton> : null}
                    {!sourceName && !closed ? <ActionButton icon={<Send className="h-3.5 w-3.5" />} disabled={agent.isPending} onClick={() => agent.mutate({ prompt: FILE_IN_SERVICENOW })}>File in ServiceNow</ActionButton> : null}
                  </div>
                  {panel === "assign" ? <AssignPanel ticket={ticket} people={people} me={me.data?.user} saving={update.isPending} note={savedWhere} onCancel={() => setPanel(null)} onSave={(assignee) => update.mutate({ assignee })} /> : null}
                  {panel === "resolve" ? <ResolvePanel saving={update.isPending} note={sourceName ? `${number} is set to Resolved in ${sourceName} with this note.` : undefined} onCancel={() => setPanel(null)} onSave={(summary) => update.mutate({ status: "resolved", resolutionSummary: summary || undefined })} /> : null}
                  {panel === "comment" ? <CommentPanel saving={comment.isPending} note={sourceName ? `Saved as a ${source === "servicenow" ? "work note" : "comment"} on ${number} in ${sourceName}. ${AGENT_NAME} sees it too.` : `${AGENT_NAME} sees it on its next step.`} onCancel={() => setPanel(null)} onSave={(body) => comment.mutate(body)} /> : null}
                  {panel === "edit" ? <EditPanel ticket={ticket} saving={update.isPending} note={savedWhere} onCancel={() => setPanel(null)} onSave={(patch) => update.mutate(patch)} /> : null}
                </section>

                <section>
                  <SectionTitle>What happened</SectionTitle>
                  <ActivityList events={events} />
                </section>
              </div>
            ) : null}
          </QueryState>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/* ------------------------------------------------------------ Sonic block */

const TASK_STATE: Record<string, { label: string; className: string }> = {
  none: { label: "Not started", className: "border-line bg-raised text-ink-3" },
  working: { label: "Running", className: "border-blue-200 bg-blue-50 text-blue-800" },
  waiting: { label: "Waiting on you", className: "border-amber-200 bg-amber-50 text-amber-900" },
  done: { label: "Done", className: "border-emerald-200 bg-emerald-50 text-emerald-800" },
  failed: { label: "Stopped", className: "border-rose-200 bg-rose-50 text-rose-800" },
};

function TaskStatePill({ state }: { state: keyof typeof TASK_STATE }) {
  const meta = TASK_STATE[state] || TASK_STATE.none;
  return <span className={cn("inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[12px] font-medium", meta.className)}>{meta.label}</span>;
}

/**
 * What Sonic found on this ticket and where it stands. Without a task: Investigate starts one. With a
 * task: the report (the reply's opening paragraphs), when it finished and how many changes it made,
 * "Open task" for the whole result, and "Look again" to send the task back over the ticket. Ask Sonic
 * opens the shared panel with the ticket selected.
 */
function SonicBlock({ ticket, busy, onInvestigate, onAsk }: { ticket: Ticket; busy: boolean; onInvestigate: (prompt?: string) => void; onAsk: () => void }) {
  const agent = ticket.agent;
  const state = agent?.state || (ticket.taskId ? "done" : "none");
  const taskId = agent?.taskId || ticket.taskId || null;
  const report = agent?.report || ticket.agentReport || agent?.summary || ticket.agentSummary;
  const heading = state === "none" ? `${AGENT_NAME} has not looked at this yet` : state === "working" ? `${AGENT_NAME} is working on it` : state === "waiting" ? `${AGENT_NAME} needs you` : state === "failed" ? `${AGENT_NAME} stopped` : `What ${AGENT_NAME} found`;
  const body = report || (state === "none" ? "It can check the systems this ticket points at, find the cause and tell you what it would change." : state === "working" ? "Reading the ticket and the connected systems." : state === "waiting" ? "It is waiting for an approval or an answer." : "No summary yet.");
  const markState = state === "working" ? "thinking" : state === "waiting" ? "waiting" : state === "done" ? "done" : "idle";
  const changes = agent?.changes ?? ticket.taskChanges ?? 0;
  const finishedAt = agent?.finishedAt || ticket.taskFinishedAt || null;
  const facts = taskId ? [
    finishedAt && (state === "done" || state === "failed") ? `${state === "done" ? "Finished" : "Stopped"} ${formatRelativeTime(finishedAt)}` : null,
    `${changes} ${changes === 1 ? "change" : "changes"} made`,
  ].filter(Boolean).join(" · ") : null;
  const again = state === "failed" ? "Try again" : "Look again";
  return (
    <section className="rounded-xl border border-line bg-raised px-4 py-3.5" aria-label={heading} data-agent-state={state}>
      <div className="flex items-start gap-3">
        <AgentMark size={32} state={markState} className="mt-0.5" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-[14px] font-semibold text-ink-1">{heading}</h3>
            <TaskStatePill state={state} />
          </div>
          <Finding text={body} />
          {facts ? <p className="mt-2 text-[12.5px] text-ink-5" title={finishedAt ? timestamp(finishedAt) : undefined}>{facts}</p> : null}
          <div className="mt-3 flex flex-wrap gap-2">
            {taskId ? (
              <Button asChild size="sm" variant="primary"><Link to={`/tasks/${encodeURIComponent(taskId)}`}>Open task</Link></Button>
            ) : (
              <Button size="sm" variant="primary" disabled={busy} onClick={() => onInvestigate()}>{busy ? "Starting" : "Investigate"}</Button>
            )}
            {taskId && (state === "done" || state === "failed") ? <Button size="sm" variant="outline" className="border border-line bg-raised" disabled={busy} onClick={() => onInvestigate(LOOK_AGAIN)}>{busy ? "Starting" : again}</Button> : null}
            <Button size="sm" variant="outline" className="border border-line bg-raised" onClick={onAsk}>Ask {AGENT_NAME}</Button>
          </div>
        </div>
      </div>
    </section>
  );
}

/** The whole finding, folded at six lines with a Show more toggle only when it is longer than that. */
function Finding({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const paragraph = useRef<HTMLParagraphElement | null>(null);
  useEffect(() => { setExpanded(false); }, [text]);
  useEffect(() => {
    const node = paragraph.current;
    if (!node || expanded) return;
    setOverflows(node.scrollHeight > node.clientHeight + 1);
  }, [text, expanded]);
  return (
    <>
      <p ref={paragraph} className={cn("mt-1 whitespace-pre-wrap text-[14px] leading-6 text-ink-2", !expanded && "line-clamp-6")}>{text}</p>
      {overflows || expanded ? <button type="button" className="mt-1 text-[13px] font-medium text-ink-4 hover:text-ink-1" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}>{expanded ? "Show less" : "Show more"}</button> : null}
    </>
  );
}

/* ------------------------------------------------------------ action panels */

function PanelFrame({ title, note, children, onCancel, onSave, saving, saveLabel, disabled }: { title: string; note?: string; children: ReactNode; onCancel: () => void; onSave: () => void; saving: boolean; saveLabel: string; disabled?: boolean }) {
  return (
    <div className="mt-3 rounded-xl border border-line bg-raised p-3.5 shadow-card">
      <p className="text-[13.5px] font-semibold text-ink-1">{title}</p>
      <div className="mt-2 space-y-2">{children}</div>
      <div className="mt-3 flex items-center justify-between gap-3">
        <span className="text-[12.5px] text-ink-5">{note}</span>
        <div className="flex shrink-0 gap-2">
          <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button size="sm" variant="primary" disabled={saving || disabled} onClick={onSave}>{saving ? "Saving" : saveLabel}</Button>
        </div>
      </div>
    </div>
  );
}

export function AssignPanel({ ticket, people, me, saving, note, onCancel, onSave }: { ticket: Ticket; people: UserIdentity[]; me?: { id: string; name: string }; saving: boolean; note?: string; onCancel: () => void; onSave: (assignee: UserIdentity | null) => void }) {
  const options = useMemo(() => {
    const seen = new Map<string, UserIdentity>();
    if (me) seen.set(me.id, { id: me.id, name: `${me.name} (me)` });
    for (const person of people) if (person?.id && !seen.has(person.id)) seen.set(person.id, person);
    if (ticket.assignee?.id && !seen.has(ticket.assignee.id)) seen.set(ticket.assignee.id, ticket.assignee);
    return [...seen.values()];
  }, [people, me, ticket.assignee]);
  const [value, setValue] = useState(ticket.assignee?.id || "__nobody");
  return (
    <PanelFrame title="Who should own this ticket?" note={note} onCancel={onCancel} saving={saving} saveLabel="Save" onSave={() => { const person = value === "__nobody" ? null : options.find((item) => item.id === value) ?? { id: value, name: value }; onSave(person ? { ...person, name: String(person.name || person.id).replace(/ \(me\)$/, "") } : null); }}>
      <Select value={value} onValueChange={setValue}>
        <SelectTrigger aria-label="Assignee" className="bg-raised"><SelectValue /></SelectTrigger>
        <SelectContent><SelectItem value="__nobody">Nobody</SelectItem>{options.map((person) => <SelectItem key={person.id} value={person.id}>{person.name || person.id}</SelectItem>)}</SelectContent>
      </Select>
    </PanelFrame>
  );
}

export function ResolvePanel({ saving, note, onCancel, onSave }: { saving: boolean; note?: string; onCancel: () => void; onSave: (summary: string) => void }) {
  const [summary, setSummary] = useState("");
  return (
    <PanelFrame title="Resolve the ticket" note={note} onCancel={onCancel} saving={saving} saveLabel="Resolve" disabled={!summary.trim()} onSave={() => onSave(summary.trim())}>
      <Textarea className="bg-raised" value={summary} onChange={(event) => setSummary(event.target.value)} placeholder="What fixed it, in a sentence" aria-label="Resolution note" />
    </PanelFrame>
  );
}

export function CommentPanel({ saving, note, onCancel, onSave }: { saving: boolean; note?: string; onCancel: () => void; onSave: (body: string) => void }) {
  const [body, setBody] = useState("");
  return (
    <PanelFrame title="Add a comment" note={note} onCancel={onCancel} saving={saving} saveLabel="Add comment" disabled={!body.trim()} onSave={() => onSave(body.trim())}>
      <Textarea className="bg-raised" value={body} onChange={(event) => setBody(event.target.value)} placeholder="Your comment" aria-label="Comment" />
    </PanelFrame>
  );
}

function EditPanel({ ticket, saving, note, onCancel, onSave }: { ticket: Ticket; saving: boolean; note?: string; onCancel: () => void; onSave: (patch: TicketPatch) => void }) {
  const [title, setTitle] = useState(ticket.title || "");
  const [description, setDescription] = useState(ticket.description || "");
  const [priority, setPriority] = useState(ticket.priority || "medium");
  return (
    <PanelFrame title="Edit ticket" note={note} onCancel={onCancel} saving={saving} saveLabel="Save changes" disabled={!title.trim()} onSave={() => onSave({ title: title.trim(), description: description.trim(), priority })}>
      <Input className="bg-raised" value={title} onChange={(event) => setTitle(event.target.value)} aria-label="Title" />
      <Textarea className="bg-raised" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Description" aria-label="Description" />
      <Select value={priority} onValueChange={setPriority}>
        <SelectTrigger aria-label="Priority" className="bg-raised"><SelectValue /></SelectTrigger>
        <SelectContent>{["critical", "high", "medium", "low"].map((value) => <SelectItem key={value} value={value}>{priorityText(value)}</SelectItem>)}</SelectContent>
      </Select>
    </PanelFrame>
  );
}

/* ----------------------------------------------------------------- pieces */

function ActionButton({ icon, children, onClick, disabled, pressed }: { icon: ReactNode; children: ReactNode; onClick: () => void; disabled?: boolean; pressed?: boolean }) {
  return <Button size="sm" variant="outline" className={cn("border border-line bg-raised", pressed && "border-ink-1")} aria-pressed={pressed} disabled={disabled} onClick={onClick}>{icon}{children}</Button>;
}

const WHO: Record<string, string> = { comment: "bg-ink-1", agent: "bg-brand", source: "bg-sky-500", other: "bg-line-strong" };
function ActivityList({ events }: { events: TicketActivityItem[] }) {
  // Prefixed: the sheet sits over the ticket list, which owns `page`.
  const pager = usePager(events.length, { prefix: "activity" });
  if (!events.length) return <p className="mt-2 text-[13px] text-ink-5">Nothing yet</p>;
  return (
    <>
    <ol className="mt-3 space-y-0 border-l border-line pl-4">
      {pager.slice(events).map((event) => {
        const kind = event.type === "ticket.comment" ? "comment" : /^task\./.test(event.type) ? "agent" : /synced|created/.test(event.type) ? "source" : "other";
        return (
          <li key={event.id} className="relative pb-4 last:pb-0">
            <span className={cn("absolute -left-[21px] top-1.5 h-2 w-2 rounded-full ring-4 ring-raised", WHO[kind])} aria-hidden="true" />
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-[13.5px] font-medium text-ink-1">{event.title}</p>
              <span className="shrink-0 whitespace-nowrap text-[12.5px] text-ink-5" title={timestamp(event.at)}>{formatRelativeTime(event.at)}</span>
            </div>
            {event.detail ? <p className={cn("mt-0.5 text-[13.5px] leading-5 text-ink-3", kind === "comment" ? "whitespace-pre-wrap rounded-lg bg-surface-subtle px-3 py-2 text-ink-2" : "line-clamp-3")}>{event.detail}</p> : null}
            {event.source ? <p className="mt-1 text-[12.5px] text-ink-5">{event.source}</p> : null}
          </li>
        );
      })}
    </ol>
    <Pager {...pager.pagerProps} noun="events" className="mt-3 px-0" />
    </>
  );
}

const LINK_LABEL: Record<TicketLink["relation"], Record<TicketLink["direction"], string>> = {
  recurrence_of: { out: "Recurrence of", in: "Recurred as" },
  amends_fix_of: { out: "Amends the fix of", in: "Fix amended in" },
  duplicate_of: { out: "Duplicate of", in: "Duplicated by" },
  related_to: { out: "Related to", in: "Related to" },
};

/** Tickets linked to this one (earlier occurrences, amended fixes, duplicates), by relation. Nothing when there are none. */
function RelatedTickets({ links }: { links?: TicketLink[] }) {
  if (!links?.length) return null;
  return (
    <section>
      <SectionTitle>Related tickets</SectionTitle>
      <ul className="mt-2 space-y-1.5">
        {links.map((link) => (
          <li key={`${link.relation}:${link.direction}:${link.ticketId}`} className="flex items-baseline gap-2 text-[13.5px] text-ink-2">
            <span>{LINK_LABEL[link.relation]?.[link.direction] || link.relation}</span>
            <Link to={`/tickets/${encodeURIComponent(link.ticketId)}`} className="font-mono font-semibold text-brand hover:underline">{link.ticketId}</Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <h3 className="text-[12px] font-medium text-ink-5">{children}</h3>;
}

const sameId = (left?: string | null, right?: string | null) => Boolean(left && right && left.toLowerCase() === right.toLowerCase());

/** Who the server lets change visibility (SPEC-projects-02 FR-22, SPEC-projects-03): app admins, the project's owners, the creator and the assignee. */
function canChangeVisibility(ticket: Ticket, me: { user: { id: string }; role: string } | undefined, projectRole?: string) {
  if (!me || me.role === "viewer") return false;
  return me.role === "admin" || projectRole === "admin" || projectRole === "owner" || sameId(ticket.creator?.id, me.user.id) || sameId(ticket.assignee?.id, me.user.id);
}
