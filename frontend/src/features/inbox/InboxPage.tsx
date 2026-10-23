import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { Bell, BookOpen, Check, ChevronRight, KeyRound, ListTodo, Mail, MessageCircleQuestion, Rocket, ShieldCheck, Ticket, X, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { inboxApi, inboxKeys, type InboxItem, type InboxKind } from "@/api/inbox";
import { AGENT_NAME, useAgentScreen } from "@/components/ops/agentPanelContext";
import { EmptyState } from "@/components/ops/EmptyState";
import { ListToolbar } from "@/components/ops/ListToolbar";
import { OpsPage } from "@/components/ops/OpsPage";
import { Pager } from "@/components/ops/Pager";
import { RefreshButton } from "@/components/ops/RefreshButton";
import { QueryState } from "@/components/ops/StatePanels";
import { SurfaceCard } from "@/components/ops/SurfaceCard";
import { Button, Card, Tabs, TabsList, TabsTrigger, formatAbsoluteTime, formatRelativeTime, useToast, confirmAction } from "@/components/ui";
import { QuestionPrompt } from "@/features/tasks/QuestionPrompt";
import { FixApprovalSummary } from "@/features/tasks/cards/FixCards";
import { cn } from "@/lib/utils";
import { needsAction } from "./inboxItems";
import { useAction } from "@/lib/useAction";
import { usePager } from "@/lib/usePager";
import { useUrlFilters } from "@/lib/useUrlFilters";
import { useProject } from "@/lib/projectContext";
import { useCan } from "@/auth/rbac";
import { taskKeys } from "@/api/tasks";

/**
 * Inbox: what the agent needs from you, then what it wants you to know. Opens on "Needs action".
 * Approvals say why they need a person (the policy category) and exactly what would change, with
 * the change open so nobody approves blind; they are decided here. Questions with options are
 * answered here too; a legacy question (a reply that ended in "?") opens the task.
 * Updates collapse to the latest one per task.
 */

type Filter = "all" | "needs_action" | "done";
const KIND_LABEL: Record<InboxKind, string> = { approval: "Approval", question: "Question", notification: "Update" };

export function InboxPage() {
  const toast = useToast();
  const url = useUrlFilters();
  const rawView = url.get("view");
  const filter: Filter = rawView === "all" || rawView === "done" ? rawView : "needs_action";
  const { projectId } = useProject();
  const canApprove = useCan("approvals.decide");
  const [selected, setSelected] = useState<Record<string, InboxItem>>({});
  const resetKey = `${projectId || ""}:${filter}`;
  const selectionScope = useRef(resetKey);
  useEffect(() => { if (selectionScope.current !== resetKey) { setSelected({}); selectionScope.current = resetKey; } }, [resetKey]);
  const sizeValue = Number(url.get("size"));
  const size = [10, 25, 50, 100].includes(sizeValue) ? sizeValue : 10;
  const page = Math.max(1, Number(url.get("page")) || 1);
  const offset = (page - 1) * size;
  const query = useQuery({ queryKey: inboxKeys.list({ filter, limit: size, offset }), queryFn: ({ signal }) => inboxApi.list({ view: filter, limit: size, offset }, signal), refetchInterval: false, placeholderData: keepPreviousData });
  const items = query.data?.items ?? [];
  const pager = usePager(query.data?.total ?? 0, { resetKey });
  const pageItems = items;
  const refresh = () => query.refetch({ cancelRefetch: false });
  const decide = useAction({
    mutationFn: ({ id, decision }: { id: string; decision: "approve" | "deny" }) => decision === "approve" ? inboxApi.approve(id) : inboxApi.deny(id),
    invalidate: [inboxKeys.all, taskKeys.all],
    success: (_item, variables) => [variables.decision === "approve" ? "Approved" : "Denied", variables.decision === "approve" ? `${AGENT_NAME} is continuing.` : `${AGENT_NAME} will carry on without this change.`],
    error: "Decision not saved",
  });
  const markRead = useAction({
    mutationFn: (id: string) => inboxApi.read(id),
    invalidate: [inboxKeys.all, taskKeys.all],
    error: "Not marked read",
  });
  const markAllRead = useAction({ mutationFn: () => inboxApi.readAll(), invalidate: [inboxKeys.all, taskKeys.all], error: "Not marked read" });
  const pending = query.data?.pending ?? 0;
  const approvals = pageItems.filter((item) => item.kind === "approval" && item.status === "pending");
  const bulkApprove = useMutation({
    mutationFn: async (chosen: InboxItem[]) => {
      let completed = 0;
      for (const item of chosen) {
        if (item.kind !== "approval" || item.status !== "pending") throw new Error(`Stopped after ${completed} approvals: ${item.title} is no longer pending. ${chosen.length - completed - 1} selected approvals were untouched.`);
        try {
          await inboxApi.approve(item.id);
          completed += 1;
          setSelected((current) => { const next = { ...current }; delete next[item.id]; return next; });
        }
        catch (error) { throw new Error(`Approved ${completed} of ${chosen.length}. ${item.title} failed: ${error instanceof Error ? error.message : "Request failed."} ${chosen.length - completed - 1} selected approvals were untouched.`); }
      }
      return completed;
    },
    onSuccess: async (completed) => { setSelected({}); await refresh(); toast.success(`Approved ${completed}`, `${AGENT_NAME} is continuing.`); },
    onError: async (error) => { await refresh(); toast.error("Approval stopped", error instanceof Error ? error.message : "Try again."); },
  });
  useAgentScreen({ visible: items.slice(0, 50).map((item) => `${item.kind}:${item.title.replace(/^Waiting for approval: /, "").slice(0, 80)} (${item.taskId})`), summary: pending ? `${pending} waiting on the reader` : "nothing waiting" });

  return (
    <OpsPage
      title="Inbox"
      actions={<RefreshButton autoRefresh onClick={() => void query.refetch({ cancelRefetch: false })} busy={query.isFetching} updatedAt={query.dataUpdatedAt} />}
      primary={Object.keys(selected).length > 0 ? <Button variant="primary" size="sm" disabled={!canApprove || bulkApprove.isPending} onClick={() => { const chosen = Object.values(selected); void confirmAction({ title: `Approve ${chosen.length} selected changes?`, description: `${AGENT_NAME} will make the selected changes.`, confirmLabel: `Approve ${chosen.length}` }).then((ok) => { if (ok) bulkApprove.mutate(chosen); }); }}>Approve selected ({Object.keys(selected).length})</Button> : undefined}
    >
      <div className="space-y-4">
        <ListToolbar className="justify-between">
        <Tabs value={filter} onValueChange={(value) => url.update((next) => { if (value === "needs_action") next.delete("view"); else next.set("view", value); next.delete("page"); })}>
          <TabsList aria-label="Inbox filter"><TabsTrigger value="all">All</TabsTrigger><TabsTrigger value="needs_action">Needs action{pending ? <span className="ml-1.5 tabular-nums text-ink-5">{pending}</span> : null}</TabsTrigger><TabsTrigger value="done">Done</TabsTrigger></TabsList>
        </Tabs>
        <Button variant="outline" size="sm" className="border border-line" disabled={!(query.data?.unread ?? 0) || markAllRead.isPending} onClick={() => markAllRead.mutate()}><Check className="h-3.5 w-3.5" />Mark all read</Button>
        </ListToolbar>
        <QueryState query={query} tiles={0}>
          <Card className="overflow-hidden">
            {items.length ? <><div className="flex items-center justify-between border-b border-line px-4 py-2 text-xs text-ink-4"><span>{Object.keys(selected).length} selected across pages</span>{approvals.length ? <button type="button" className="text-brand hover:underline" disabled={!canApprove || bulkApprove.isPending} onClick={() => setSelected((current) => { const next = { ...current }; for (const item of approvals) next[item.id] = item; return next; })}>Select pending approvals on this page</button> : null}</div><ol className="stagger-children divide-y divide-line">{pageItems.map((item) => <InboxRow key={item.id} item={item} canApprove={canApprove} selected={Boolean(selected[item.id])} onToggle={() => setSelected((current) => { const next = { ...current }; if (next[item.id]) delete next[item.id]; else if (item.kind === "approval" && item.status === "pending") next[item.id] = item; return next; })} busy={(decide.isPending && decide.variables?.id === item.id) || bulkApprove.isPending} onDecide={(decision) => decide.mutate({ id: item.id, decision })} onRead={() => markRead.mutate(item.id)} />)}</ol>
              <Pager {...pager.pagerProps} noun="items" /></> : (
              <EmptyState
                illustration="inbox"
                title={filter === "needs_action" ? "Nothing waiting on you" : "Nothing here yet"}
                body={filter === "needs_action" ? `Approvals and questions from ${AGENT_NAME} land here.` : filter === "done" ? "Decided approvals, answered questions and read updates will show here." : `Approvals, questions and updates from ${AGENT_NAME} land here.`}
              />
            )}
          </Card>
        </QueryState>
      </div>
    </OpsPage>
  );
}

/** Every control in the action column shares one size and shape, so the column reads as one line. */
const ACTION = "h-7 min-w-[96px] justify-center rounded-full px-3 text-[12.5px] font-medium transition-all duration-150 active:scale-[0.97]";

/** Colour lives only in the small icons: the chips and pills themselves stay neutral. */
const KIND_ICON: Record<string, { icon: LucideIcon; color: string }> = {
  notification: { icon: Bell, color: "text-indigo-500" },
  question: { icon: MessageCircleQuestion, color: "text-violet-500" },
  production_changes: { icon: Rocket, color: "text-rose-500" },
  email_send: { icon: Mail, color: "text-sky-500" },
  privileged_access: { icon: KeyRound, color: "text-amber-500" },
  ticket_writes: { icon: Ticket, color: "text-teal-500" },
  knowledge_drafts: { icon: BookOpen, color: "text-emerald-500" },
  approval: { icon: ShieldCheck, color: "text-amber-500" },
};
const kindIcon = (item: InboxItem) => (item.kind === "approval" ? KIND_ICON[item.category || ""] : undefined) ?? KIND_ICON[item.kind];

const toolLabel = (name: string) => name.replace(/^mcp__/, "").replace(/__/g, " · ");
/** The short word a settled row shows in its action column; who decided is in the opened row. */
const SETTLED_LABEL: Record<string, string> = { approved: "Approved", denied: "Denied", answered: "Answered", read: "Read", cancelled: "Cancelled" };

function InboxRow({ item, taskTitle, canApprove, busy, selected, onToggle, onDecide, onRead }: { item: InboxItem; taskTitle?: string; canApprove: boolean; busy: boolean; selected: boolean; onToggle: () => void; onDecide: (decision: "approve" | "deny") => void; onRead: () => void }) {
  const action = needsAction(item);
  // A question with options is one the person answers here; a legacy question has none and opens the task.
  const structured = item.kind === "question" && Array.isArray(item.questions) && item.questions.length > 0;
  // Approvals and structured questions open with the change or the options visible; the person decides on what they can see.
  const [open, setOpen] = useState(action && (item.kind === "approval" || structured));
  const unread = item.status === "pending";
  const dot = action ? (item.kind === "approval" ? "bg-amber-500 animate-pulse" : "bg-brand animate-pulse") : unread ? "bg-ink-3" : "bg-line-strong";
  const kind = kindIcon(item);
  const kindLabel = item.kind === "approval" && item.categoryLabel ? item.categoryLabel : KIND_LABEL[item.kind];
  const input = parseInput(item.tool?.input);
  const detail = item.detail || (typeof input?.description === "string" ? input.description : "");
  const decidedBy = item.status === "approved" || item.status === "denied" || item.status === "answered" ? `${item.status === "denied" && structured ? "skipped" : item.status} by ${item.decidedBy?.name || "someone"}` : "";
  const settledQuestion = structured && !action ? (item.status === "answered" ? { status: "answered" as const, answers: item.answers || {}, by: item.decidedBy?.name || null } : item.status === "denied" ? { status: "denied" as const } : null) : null;
  const hasDetails = Boolean(detail || (item.kind === "approval" && input) || structured);
  // Every row is one line; the title opens whatever else there is (details, the change, the answer, who decided).
  const expandable = hasDetails || Boolean(decidedBy);
  const title = item.title.replace(/^Waiting for approval: /, "");
  const taskLink = `/tasks/${encodeURIComponent(item.taskId)}`;
  const linkText = taskTitle || item.taskId;
  return (
    <li className={cn("px-4 py-2", !unread && !open && "opacity-75")}>
      <div className="grid grid-cols-[26px_minmax(0,1fr)] items-center gap-x-4 gap-y-1 md:grid-cols-[34px_132px_minmax(0,1fr)_minmax(0,200px)_96px_176px]">
        <span className="flex items-center gap-2">{item.kind === "approval" && item.status === "pending" ? <input aria-label={`Select approval ${title}`} type="checkbox" checked={selected} disabled={busy || !canApprove} onChange={onToggle} className="accent-brand" /> : null}<span className={cn("h-2 w-2 rounded-full", dot)} aria-hidden="true" /></span>
        <span className="hidden h-7 w-full items-center gap-1.5 whitespace-nowrap rounded-full border border-line bg-raised px-2.5 text-[12px] font-semibold text-ink-2 shadow-[0_1px_2px_rgba(16,24,40,0.04)] md:flex" title={kindLabel}><kind.icon className={cn("h-3.5 w-3.5 shrink-0", kind.color)} aria-hidden="true" /><span className="truncate">{kindLabel}</span></span>
        {expandable ? (
          <button type="button" className="group flex min-w-0 items-center gap-1.5 text-left" aria-expanded={open} onClick={() => setOpen((value) => !value)} title={open ? "Hide details" : "Show details"}>
            <ChevronRight className={cn("h-3.5 w-3.5 shrink-0 text-ink-5 transition-transform group-hover:text-ink-2", open && "rotate-90")} aria-hidden="true" />
            <span className={cn("min-w-0 truncate text-[14px]", unread ? "font-semibold text-ink-1" : "font-medium text-ink-2")}>{title}</span>
          </button>
        ) : <p className={cn("min-w-0 truncate pl-5 text-[14px]", unread ? "font-semibold text-ink-1" : "font-medium text-ink-2")} title={item.title}>{title}</p>}
        <Link to={taskLink} onClick={unread && !action ? onRead : undefined} title={taskTitle ? `${taskTitle} (${item.taskId})` : item.taskId} className="col-start-2 flex w-full min-w-0 items-center gap-1.5 text-[13px] font-medium text-ink-4 transition-colors hover:text-ink-1 md:col-start-4"><ListTodo className="h-3.5 w-3.5 shrink-0 text-ink-5" aria-hidden="true" /><span className="min-w-0 flex-1 truncate">{linkText}</span></Link>
        <time dateTime={item.createdAt} title={formatAbsoluteTime(item.createdAt)} className="col-start-2 whitespace-nowrap text-[13px] tabular-nums text-ink-5 md:col-start-5">{formatRelativeTime(item.createdAt)}</time>
        <div className="col-start-2 flex items-center justify-end gap-1.5 md:col-start-6 md:justify-center">
          {action && item.kind === "approval" ? <><Button size="xs" variant="outline" className={cn(ACTION, "min-w-0 gap-1 border border-line bg-raised text-ink-2 hover:border-emerald-200 hover:bg-emerald-50/60 hover:text-emerald-700")} disabled={busy || !canApprove} onClick={() => onDecide("approve")}><Check className="h-3.5 w-3.5 text-emerald-600" />Approve</Button><Button size="xs" variant="outline" className={cn(ACTION, "min-w-0 gap-1 border border-line bg-raised text-ink-2 hover:border-rose-200 hover:bg-rose-50/60 hover:text-rose-700")} disabled={busy || !canApprove} onClick={() => onDecide("deny")}><X className="h-3.5 w-3.5 text-rose-500" />Deny</Button></> : null}
          {action && item.kind === "question" && !structured ? <Button asChild size="xs" variant="outline" className={cn(ACTION, "gap-1 border border-line bg-raised text-ink-2 hover:border-brand/30 hover:bg-brand-soft/60 hover:text-brand-indigo")}><Link to={taskLink} onClick={onRead}><MessageCircleQuestion className="h-3.5 w-3.5 text-brand" aria-hidden="true" />Answer</Link></Button> : null}
          {unread && !action ? <Button size="xs" variant="outline" className={cn(ACTION, "gap-1 border border-line bg-raised text-ink-2 hover:border-line-strong hover:bg-surface-subtle hover:text-ink-1")} onClick={onRead}><Check className="h-3.5 w-3.5" aria-hidden="true" />Mark read</Button> : null}
          {!action && !unread && SETTLED_LABEL[item.status] ? <SettledLabel label={structured && item.status === "denied" ? "Skipped" : SETTLED_LABEL[item.status]} /> : null}
        </div>
      </div>
      {open ? (
        <div className="mb-1 mt-1.5 space-y-1 pl-6 md:ml-[148px] md:pl-5 md:pr-2">
          {decidedBy ? <p className="text-[12.5px] capitalize text-ink-5">{decidedBy}</p> : null}
          {detail ? <p className="text-[13.5px] leading-5 text-ink-3">{detail}{item.tool ? <span className="text-ink-5"> · {toolLabel(item.tool.name)}</span> : null}</p> : null}
          {item.kind === "approval" && item.fix ? (
            <SurfaceCard tone="warning" label="Tested fix" className="mt-2" bodyClassName="space-y-1.5">
              <FixApprovalSummary fix={item.fix} compact />
              <Link to={taskLink} className="inline-block text-[12.5px] font-medium text-brand hover:text-brand-hover">See the table change and board preview in the task</Link>
            </SurfaceCard>
          ) : item.kind === "approval" && input ? <ApprovalPreview input={input} /> : null}
          {structured && action ? <QuestionPrompt inboxId={item.id} questions={item.questions || []} form={(item.questions || []).some((question) => Boolean(question.field))} className="mt-2" /> : null}
          {settledQuestion ? <ol className="mt-1.5 space-y-1 text-[13px]">{(item.questions || []).map((question) => <li key={question.question} className="flex flex-wrap gap-x-2"><span className="text-ink-4">{question.question}</span><span className="font-medium text-ink-2">{settledQuestion.status === "answered" ? settledQuestion.answers[question.question] || "—" : "Skipped"}</span></li>)}</ol> : null}
        </div>
      ) : null}
    </li>
  );
}

function SettledLabel({ label }: { label: string }) {
  return <span className={cn(ACTION, "inline-flex items-center border border-line/70 bg-surface-subtle/70 text-ink-3")}>{label}</span>;
}

/** What the approver is deciding on: the command, statement or file body, shown in full until collapsed. */
const PREVIEW_KEYS = ["command", "statement", "sql", "jql", "query", "body", "comment", "content", "new_string"] as const;
function ApprovalPreview({ input }: { input: Record<string, unknown> }) {
  const [open, setOpen] = useState(true);
  const previewKey = PREVIEW_KEYS.find((key) => typeof input[key] === "string" && (input[key] as string).trim().length > 0);
  const preview = previewKey ? (input[previewKey] as string) : null;
  const isFileChange = previewKey === "content" || previewKey === "new_string";
  const rows = Object.entries(input).filter(([key]) => key !== previewKey && key !== "old_string" && key !== "description").slice(0, 3);
  const lines = preview ? preview.split("\n").length : 0;
  const long = Boolean(preview && (lines > 2 || preview.length > 160));
  if (!preview && !rows.length) return null;
  return (
    <SurfaceCard tone="warning" label="Proposed change" note={previewKey === "command" ? "Command" : previewKey === "new_string" ? "File edit" : previewKey === "content" ? "File" : previewKey ? capitalise(previewKey) : undefined} className="mt-2" bodyClassName="space-y-1.5">
      {preview && !isFileChange ? (
        <div>
          <pre className={cn("overflow-hidden whitespace-pre-wrap break-words rounded-lg border border-line bg-surface-subtle px-2.5 py-2 font-mono text-[12.5px] leading-relaxed text-ink-2", !open && "max-h-[3.6rem]")}>{preview}</pre>
          {long ? <button type="button" className="mt-1 text-[12.5px] font-medium text-ink-4 hover:text-ink-1" onClick={() => setOpen((current) => !current)}>{open ? "Hide" : `Show ${previewKey === "command" ? "command" : "full text"}`}</button> : null}
        </div>
      ) : null}
      {preview && isFileChange ? (
        <div>
          <button type="button" className="text-[12.5px] font-medium text-ink-4 hover:text-ink-1" onClick={() => setOpen((current) => !current)}>{open ? "Hide" : "Show"} {previewKey === "new_string" ? "the change" : "the file"} · {lines} line{lines === 1 ? "" : "s"}</button>
          {open ? (
            <div className="mt-1.5 space-y-1.5">
              {typeof input.old_string === "string" && input.old_string ? <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-red-200 bg-red-50/60 px-2.5 py-2 font-mono text-[12.5px] leading-relaxed text-ink-2"><span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-red-700">Replaces</span>{input.old_string}</pre> : null}
              <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-line bg-surface-subtle px-2.5 py-2 font-mono text-[12.5px] leading-relaxed text-ink-2">{previewKey === "new_string" ? <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-emerald-700">With</span> : null}{preview}</pre>
            </div>
          ) : null}
        </div>
      ) : null}
      {rows.length && (open || !preview) ? <dl className="grid gap-x-3 gap-y-0.5 text-[12.5px] sm:grid-cols-[auto_1fr]">{rows.map(([key, value]) => <Row key={key} label={key} value={value} />)}</dl> : null}
    </SurfaceCard>
  );
}
const capitalise = (text: string) => text.charAt(0).toUpperCase() + text.slice(1).replace(/_/g, " ");
function Row({ label, value }: { label: string; value: unknown }) { const text = typeof value === "string" ? value : JSON.stringify(value); return <><dt className="font-mono text-ink-5">{label}</dt><dd className="truncate text-ink-2" title={text}>{text.length > 160 ? `${text.slice(0, 160)}…` : text}</dd></>; }
function parseInput(value?: string): Record<string, unknown> | null { if (!value) return null; try { const parsed = JSON.parse(value); return parsed && typeof parsed === "object" ? parsed : null; } catch { return null; } }
