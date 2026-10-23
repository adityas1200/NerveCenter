import { refreshAfterWrite } from "@/lib/refreshAfterWrite";
import { RefreshButton } from "@/components/ops/RefreshButton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, BookOpen, CheckCircle2, ClipboardList, Download, ExternalLink, FolderOpen, Gauge, GitCommitHorizontal, PanelRight, PanelRightClose, PanelRightOpen, Puzzle, Repeat, ScrollText, Square, Ticket as TicketIcon, Trash2, UserRoundCheck, type LucideIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { TreeNode } from "@/api/library";
import { TASK_STATUS_LABEL, TASK_TYPE_LABEL, startedBy, tasksApi, type AttachmentUpload, type Task, type TaskEvent, type TaskPermission, taskKeys } from "@/api/tasks";
import { AgentMark } from "@/components/ops/AgentMark";
import { AGENT_NAME } from "@/components/ops/agentPanelContext";
import { ticketsApi } from "@/api/tickets";
import { queryKeys } from "@/api/queryKeys";
import { useIsAdmin, useMe } from "@/auth/rbac";
import { PageHeader } from "@/components/ops/PageHeader";
import { PriorityBadge } from "@/components/ops/PriorityBadge";
import { QueryState } from "@/components/ops/StatePanels";
import { Button, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, Sheet, SheetContent, SheetTitle, Skeleton, formatAbsoluteTime, formatDuration, formatRelativeTime, useToast, confirmAction } from "@/components/ui";
import { cn } from "@/lib/utils";
import { ArtifactCard, type ArtifactRef } from "./ArtifactCard";
import { followUpsFrom } from "./cards/blocks";
import { artifactsFrom as shownArtifactsFrom } from "./cards/cards";
import { ChangesList } from "./ChangesList";
import { FileViewerSheet } from "./FileViewerSheet";
import { InterviewGuidePanel } from "./InterviewGuidePanel";
import { investigationFrom } from "./investigation";
import { outcomeLine } from "./outcome";
import { OutcomeLine } from "./OutcomeLine";
import { QueuedMessages } from "./QueuedMessages";
import { TaskComposer } from "./TaskComposer";
import { TaskThread, currentActivity, currentActivityKind } from "./TaskThread";
import { artifactsFrom } from "./taskEvents";
import { availableSkillsLabel, knowledgeUsage, skillUsage } from "./taskUsage";
import { KnowledgeList, SkillsList } from "./UsageLists";
import { PermissionMenu } from "./PermissionMenu";
import { taskMarkState } from "./TasksPage";
import { useStickToBottom } from "./useStickToBottom";
import { useTaskStream } from "./useTaskStream";
import { useAction } from "@/lib/useAction";
import { resolveChatFileLink } from "@/lib/markdownLinks";

/**
 * One task, as one conversation (SPEC-tasks-10 FR-1). Under the header, the outcome line says where the
 * work stands; below it the thread, where Sonic's components, approvals and questions sit in the turn
 * that made them; then the composer, with Sonic's suggested follow-ups above it. Files, changes, skills,
 * knowledge, context and session facts sit in a side panel beside the thread on wide screens (an icon
 * strip that folds the panel away), and in the Details sheet on a phone.
 */

const PANEL_KEY = "nervecenter.task.panel";
const WIDE = "(min-width: 768px)";

const SOURCE_WORD: Record<string, string> = { servicenow: "ServiceNow", jira: "Jira", nervecenter: "NerveCenter", manual: "Manual", pipeline: "Pipeline", "data-quality": "Data quality", dq: "Data quality" };
const sourceWord = (value: unknown): string => { const key = String(value || "").trim(); if (!key) return "—"; return SOURCE_WORD[key.toLowerCase()] || key.charAt(0).toUpperCase() + key.slice(1); };

export function TaskPage() {
  const { taskId = "" } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const isAdmin = useIsAdmin();
  const me = useMe();
  const stream = useTaskStream(taskId);
  const task = stream.task;
  const events = stream.events;
  const live = task ? task.status === "running" || task.status === "queued" : false;
  const finished = task ? ["done", "failed", "cancelled"].includes(task.status) : false;
  const ticket = task?.context.ticket;
  const viewer = String(me.data?.role || "") === "viewer";

  const [logsOpen, setLogsOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  // Whether the side panel is open, and on which tab, is remembered across tasks.
  const [panelOpen, setPanelOpen] = useState<boolean>(() => { try { return window.localStorage.getItem(PANEL_KEY) !== "0"; } catch { return true; } });
  const [panelTab, setPanelTab] = useState<DetailTabId>("files");
  // A knowledge setup task opens on its interview guide (SPEC-knowledge-03 FR-8), once, so a later choice sticks.
  const setupTask = Boolean(task?.context.knowledgeSetup);
  useEffect(() => { if (setupTask) setPanelTab("guide"); }, [setupTask, taskId]);
  const rememberPanel = useCallback((next: boolean) => { setPanelOpen(next); try { window.localStorage.setItem(PANEL_KEY, next ? "1" : "0"); } catch { /* storage unavailable: the choice lasts this visit */ } }, []);
  // A tab opens the panel on itself; the open tab again folds the panel back to the strip.
  const selectPanelTab = (next: DetailTabId) => { if (panelOpen && next === panelTab) { rememberPanel(false); return; } setPanelTab(next); if (!panelOpen) rememberPanel(true); };
  const openDetails = () => { if (window.matchMedia?.(WIDE).matches) rememberPanel(!panelOpen); else setDetailsOpen(true); };
  const [openFile, setOpenFile] = useState<string | null>(null);
  const [composerDraft, setComposerDraft] = useState<string | null>(null);
  const consumeDraft = useCallback(() => setComposerDraft(null), []);

  const filesKey = useMemo(() => [...taskKeys.detail(taskId), "files"] as const, [taskId]);
  const filesQuery = useQuery({ queryKey: filesKey, queryFn: ({ signal }) => tasksApi.files(taskId, signal), enabled: Boolean(task) && (panelOpen || detailsOpen), refetchInterval: false, retry: false });
  const files = useMemo(() => mergeFiles(filesQuery.data?.items ?? [], artifactsFrom(events)), [filesQuery.data?.items, events]);
  const openableSize = files.find((file) => file.path === openFile)?.size;
  // Chat replies name files the way Sonic saw them from the workspace; match them to this task's files.
  const openTaskFile = useCallback((path: string) => setOpenFile(resolveChatFileLink(path, taskId, files.map((file) => file.path))), [taskId, files]);
  const artifactPaths = useMemo(() => new Set(shownArtifactsFrom(events).map((artifact) => artifact.path)), [events]);

  const stick = useStickToBottom<HTMLDivElement>(events.length + (stream.draft?.text.length || 0));
  const { scrollToBottom, scrollToTop, element: scroller } = stick;
  // A finished task opens at its start, so it reads top to bottom; a live or waiting one stays at its end (FR-4).
  const placed = useRef<string | null>(null);
  useEffect(() => {
    if (!task || !stick.node || placed.current === task.id) return;
    placed.current = task.id;
    if (finished) scrollToTop(); else scrollToBottom("auto");
  }, [task, stick.node, finished, scrollToTop, scrollToBottom]);
  const scrollWithin = useCallback((target: HTMLElement | null | undefined) => {
    const box = scroller.current; if (!box || !target) return;
    // Scroll only the thread: scrollIntoView would also move every scrollable ancestor, the page included.
    box.scrollTo({ top: box.scrollTop + target.getBoundingClientRect().top - box.getBoundingClientRect().top - 16, behavior: "smooth" });
  }, [scroller]);
  const scrollToSeq = useCallback((firstSeq: number) => {
    setDetailsOpen(false);
    window.requestAnimationFrame(() => {
      const anchors = Array.from(scroller.current?.querySelectorAll<HTMLElement>("[data-seq]") ?? []).filter((element) => element.dataset.seq !== "draft");
      scrollWithin([...anchors].reverse().find((element) => Number(element.dataset.seq) <= firstSeq) || anchors[0]);
    });
  }, [scroller, scrollWithin]);
  const jumpToPrompt = useCallback(() => { const prompts = scroller.current?.querySelectorAll<HTMLElement>("[data-prompt]"); scrollWithin(prompts?.[prompts.length - 1]); }, [scroller, scrollWithin]);

  const send = useMutation({
    mutationFn: ({ text, attachments }: { text: string; attachments?: AttachmentUpload[] }) => tasksApi.send(taskId, text, undefined, undefined, attachments),
    onSuccess: async (result) => { await refreshAfterWrite(queryClient, { queryKey: taskKeys.all }); scrollToBottom(); if (result.queued) toast.info("Queued", `${AGENT_NAME} reads it after the current step. Edit it or send it now from the thread.`); },
    onError: (error) => toast.error("Message not sent", error instanceof Error ? error.message : "Try again."),
  });
  const ask = useCallback((text: string) => { send.mutateAsync({ text }).catch(() => { /* the toast says it */ }); }, [send]);
  const permission = useAction({
    mutationFn: (value: TaskPermission) => tasksApi.setPermission(taskId, value),
    invalidate: [taskKeys.all],
    error: "Permission not changed",
  });
  const cancel = useAction({
    mutationFn: () => tasksApi.cancel(taskId),
    invalidate: [taskKeys.all],
    success: `${AGENT_NAME} stopped`,
    error: "Not stopped",
  });
  const remove = useAction({
    mutationFn: () => tasksApi.remove(taskId),
    invalidate: [taskKeys.all],
    success: "Task deleted",
    onSuccess: () => navigate("/tasks", { replace: true }),
    error: "Not deleted",
  });
  const ticketAction = useAction({
    mutationFn: ({ action }: { action: "assign" | "resolve" }) => action === "assign" ? ticketsApi.update(ticket?.ticketId || "", { assignee: { id: me.data?.user?.id || "", name: me.data?.user?.name || "" } }) : ticketsApi.update(ticket?.ticketId || "", { status: "resolved" }),
    invalidate: [queryKeys.tickets.all],
    success: (_ticket, variables) => [variables.action === "assign" ? "Assigned to you" : "Ticket resolved", ticket?.ticketId],
    error: "Ticket not updated",
  });

  const lastUserAt = useMemo(() => [...events].reverse().find((event) => event.type === "user.message")?.at || task?.startedAt || null, [events, task?.startedAt]);
  const elapsed = useElapsed(lastUserAt, live);
  const activity = live ? (stream.draft?.text ? "Writing the reply" : currentActivity(events, stream.startingTool)) : null;
  const status = live ? [activity || "Thinking", elapsed >= 1000 ? formatDuration(elapsed) : null].filter(Boolean).join(" · ") : undefined;
  const activityKind = stream.draft?.text ? "writing" : currentActivityKind(events, stream.startingTool);
  const line = useMemo(() => (task ? outcomeLine(task, events, { activity, elapsedMs: elapsed, pendingApproval: Boolean(stream.pendingApproval), pendingQuestion: Boolean(stream.pendingQuestion) }) : null), [task, events, activity, elapsed, stream.pendingApproval, stream.pendingQuestion]);
  // Actions on components send messages, so they follow the composer's rules (FR-18).
  const askBlocked = !task ? "Loading" : viewer ? "Viewers can't send messages" : task.status === "cancelled" ? "This task was stopped" : live ? `${AGENT_NAME} is working` : task.status === "waiting" || task.pendingApprovalId ? `Answer ${AGENT_NAME} first` : undefined;
  const followUps = useMemo(() => (askBlocked ? [] : followUpsFrom(events)), [events, askBlocked]);

  return (
    <>
      <PageHeader
        title={task?.title || taskId || "Task"}
        back={{ to: "/tasks", label: "Tasks" }}
        count={task ? headerLine(task) : undefined}
        status={task ? <StatusPill status={task.status} /> : null}
        actions={<><RefreshButton autoRefresh onClick={() => { void stream.refetch(); if (panelOpen || detailsOpen) void filesQuery.refetch({ cancelRefetch: false }); }} busy={stream.isFetching || filesQuery.isFetching} updatedAt={task?.updatedAt} />{task ? <Button size="sm" variant="outline" className="border border-line bg-raised" onClick={openDetails}><PanelRight className="h-3.5 w-3.5" />Details</Button> : null}</>}
        primary={ticket && task && task.status !== "done" ? <Button variant="primary" size="sm" disabled={ticketAction.isPending} busy={ticketAction.isPending} onClick={() => { void confirmAction({ title: "Mark this ticket resolved?", description: "The ticket is closed as resolved.", confirmLabel: "Mark resolved" }).then((ok) => { if (ok) ticketAction.mutate({ action: "resolve" }); }); }}><CheckCircle2 className="h-3.5 w-3.5" />Mark resolved</Button> : undefined}
        menu={task ? [
          ticket ? { label: "Assign ticket to me", icon: UserRoundCheck, disabled: ticketAction.isPending, onSelect: () => ticketAction.mutate({ action: "assign" }) } : null,
          live ? { label: `Stop ${AGENT_NAME}`, icon: Square, disabled: cancel.isPending, onSelect: () => cancel.mutate() } : null,
          isAdmin ? { label: "Logs", icon: ScrollText, onSelect: () => setLogsOpen(true) } : null,
          { label: live ? "Stop it first to delete" : "Delete task", icon: Trash2, destructive: true, divider: true, disabled: live || remove.isPending, onSelect: () => { void confirmAction({ title: `Delete "${task.title}"?`, description: "Its conversation and files are removed. This can't be undone.", confirmLabel: "Delete task", destructive: true }).then((ok) => { if (ok) remove.mutate(); }); } },
        ] : undefined}
      />
      <QueryState query={{ isPending: stream.isPending && !task, error: stream.error, data: task, isFetching: stream.isFetching }} skeleton={<TaskSkeleton />}>
        {task && line ? (
          <div className="flex h-[calc(100dvh-var(--shell-chrome))] min-h-0 overflow-hidden bg-raised">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <OutcomeLine line={line} onJump={jumpToPrompt} className="shrink-0" />
            <section className="flex min-h-0 flex-1 flex-col" aria-label="Conversation">
              <div className="relative min-h-0 flex-1">
                <div ref={stick.ref} className="relative h-full overflow-y-auto overscroll-contain px-6 py-8">
                  <div className="mx-auto max-w-[760px]"><TaskThread task={task} events={events} pendingApproval={stream.pendingApproval} pendingQuestion={stream.pendingQuestion} onOpenFile={openTaskFile} draft={stream.draft} startingTool={stream.startingTool} onAdjustPlan={setComposerDraft} editable={!viewer && task.status !== "cancelled"} onStop={() => cancel.mutate()} onAsk={ask} askBlocked={askBlocked} /></div>
                </div>
                {stick.hasNew ? (
                  <button type="button" onClick={() => stick.scrollToBottom()} aria-label="New activity" title="New activity" className="absolute bottom-3 left-1/2 flex h-9 w-9 -translate-x-1/2 items-center justify-center rounded-full border border-line bg-raised text-ink-1 shadow-card transition-colors hover:border-line-strong">
                    <ArrowDown className="h-4 w-4" aria-hidden="true" />
                  </button>
                ) : null}
              </div>
              <div className="shrink-0 bg-raised px-6 pb-4 pt-2">
                <div className="mx-auto max-w-[760px]">
                  {followUps.length ? <FollowUps questions={followUps} onAsk={ask} disabled={send.isPending} /> : null}
                  <TaskComposer attachments above={task.queue?.length ? <QueuedMessages taskId={task.id} queue={task.queue} /> : undefined} onSend={(text, _mentions, attachments) => send.mutateAsync({ text, attachments })} onStop={() => cancel.mutate()} disabled={task.status === "cancelled" || Boolean(task.pendingApprovalId)} busy={live} activity={activityKind} status={status} draft={composerDraft} onDraftConsumed={consumeDraft} footer={<PermissionMenu value={task.permission} onChange={(value) => permission.mutate(value)} disabled={task.status === "cancelled" || permission.isPending} allowUnrestricted={isAdmin} />} hint={task.status === "cancelled" ? "This task was stopped. Start a new task to continue." : stream.pendingQuestion ? `Answer ${AGENT_NAME}'s question above first` : task.pendingApprovalId ? "Decide the approval first." : undefined} />
                </div>
              </div>
            </section>
          </div>
            <aside className="hidden min-h-0 md:block" aria-label="Task details"><TaskDetails task={task} events={events} files={files} artifactPaths={artifactPaths} isAdmin={isAdmin} onOpenFile={openTaskFile} onSelectStep={scrollToSeq} layout="tabs" activeTab={panelTab} open={panelOpen} onTab={selectPanelTab} onToggle={() => rememberPanel(!panelOpen)} /></aside>
          </div>
        ) : null}
      </QueryState>
      <Sheet open={detailsOpen} onOpenChange={setDetailsOpen}>
        <SheetContent side="right" className="w-full overflow-y-auto p-0 sm:max-w-md">
          <SheetTitle className="border-b border-line px-5 py-3.5 text-[15px] font-semibold text-ink-1">Details</SheetTitle>
          {task ? <TaskDetails task={task} events={events} files={files} artifactPaths={artifactPaths} isAdmin={isAdmin} onOpenFile={(path) => { setDetailsOpen(false); openTaskFile(path); }} onSelectStep={scrollToSeq} /> : null}
        </SheetContent>
      </Sheet>
      {task ? <FileViewerSheet taskId={task.id} path={openFile} size={openableSize} onClose={() => setOpenFile(null)} onOpenFile={openTaskFile} /> : null}
      {task ? <LogsDialog task={task} open={logsOpen} onOpenChange={setLogsOpen} /> : null}
    </>
  );
}

/* ------------------------------------------------------------------ pieces */

/** "Started by Mitesh Shinde · Pipelines · 25/09/2026, 09:14". Ticket and routine labels already say the type, so only a chat keeps its type word. */
function headerLine(task: Task): string {
  const started = startedBy(task);
  return [task.type === "adhoc" ? TASK_TYPE_LABEL.adhoc : null, `Started by ${started.label}`, formatAbsoluteTime(task.createdAt)].filter(Boolean).join(" · ");
}

/** Same mark as the list rows: thinking while it runs, holding while it waits, solid when done. */
function StatusPill({ status }: { status: Task["status"] }) {
  return (
    <span className={cn("inline-flex h-7 items-center gap-1.5 rounded-full border py-0.5 pl-1.5 pr-2.5 text-[13px] font-medium", status === "waiting" ? "border-amber-200 bg-amber-50 text-amber-800" : status === "failed" ? "border-rose-200 bg-rose-50 text-rose-800" : "border-line bg-raised text-ink-2")}>
      <AgentMark size={16} state={taskMarkState(status)} />
      {TASK_STATUS_LABEL[status]}
    </span>
  );
}

/** The questions Sonic suggested at the end of its last turn (FR-5); one click sends one. */
function FollowUps({ questions, onAsk, disabled }: { questions: string[]; onAsk: (text: string) => void; disabled: boolean }) {
  return (
    // One row that scrolls sideways: suggestions must not push the thread up by two or three lines.
    <ul className="-mx-1 mb-2 flex gap-1.5 overflow-x-auto px-1 pb-0.5 [mask-image:linear-gradient(to_right,black_90%,transparent)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" aria-label="Suggested questions">
      {questions.map((question) => <li key={question} className="shrink-0"><button type="button" disabled={disabled} onClick={() => onAsk(question)} title={question} className="max-w-[340px] truncate rounded-full border border-line bg-raised px-3 py-1 text-left text-[13px] text-ink-2 transition-colors hover:border-line-strong hover:text-ink-1 disabled:opacity-50">{question}</button></li>)}
    </ul>
  );
}

type DetailTabId = "guide" | "files" | "changes" | "skills" | "knowledge" | "context" | "session";
interface DetailTab { id: DetailTabId; title: string; short: string; icon: LucideIcon; count?: number; badge?: string; content: ReactNode }

/**
 * The task's details (FR-3): its files, the changes it made, the skills and knowledge it used, where it
 * came from (ticket, routine) and the session facts, cost for admins only. In the Details sheet they stack;
 * beside the thread they are tabs on an icon strip, each with a dot while it holds something not yet
 * looked at. An entry that points at a step scrolls the thread to it.
 */
function TaskDetails({ task, events, files, artifactPaths, isAdmin, onOpenFile, onSelectStep, layout = "stack", activeTab = "files", open = true, onTab, onToggle }: { task: Task; events: TaskEvent[]; files: ArtifactRef[]; artifactPaths: Set<string>; isAdmin: boolean; onOpenFile: (path: string) => void; onSelectStep: (firstSeq: number) => void; layout?: "stack" | "tabs"; activeTab?: DetailTabId; open?: boolean; onTab?: (tab: DetailTabId) => void; onToggle?: () => void }) {
  const ticket = task.context.ticket;
  const routine = task.context.routine;
  const systems = useMemo(() => { const names = new Set<string>(); for (const event of events) if (event.type === "tool.use" && event.name?.startsWith("mcp__")) names.add(event.name.split("__")[1]); return [...names]; }, [events]);
  const started = startedBy(task);
  const toolCalls = events.filter((event) => event.type === "tool.use").length;
  const skills = useMemo(() => skillUsage(events), [events]);
  const knowledge = useMemo(() => knowledgeUsage(events, investigationFrom(events)), [events]);
  const startedRow: [string, ReactNode] = ["Started", <span key="started" title={formatAbsoluteTime(task.createdAt)}>{started.label} · {formatRelativeTime(task.createdAt)}</span>];
  const openLink = (to: string, label: string) => <Button asChild size="sm" variant="outline" className="border border-line bg-raised"><Link to={to}>{label}</Link></Button>;
  const changes = task.changes ?? 0;
  // A knowledge setup task's interview guide (SPEC-knowledge-03 FR-8): reloaded each time Sonic updates it.
  const setup = Boolean(task.context.knowledgeSetup);
  const live = task.status === "running" || task.status === "queued";
  const guideVersion = useMemo(() => events.filter((event) => event.type === "tool.use" && /(^|__)update_interview_guide$/.test(event.name || "")).length, [events]);
  const guide = useQuery({ queryKey: [...taskKeys.detail(task.id), "interview-guide", guideVersion], queryFn: ({ signal }) => tasksApi.interviewGuide(task.id, signal), enabled: setup, refetchInterval: live ? 10_000 : false, placeholderData: (previous) => previous });
  const tabs = ([
    setup ? { id: "guide", title: "Interview guide", short: "Guide", icon: ClipboardList, count: guide.data?.questions.length || undefined, content: <InterviewGuidePanel taskId={task.id} base={task.context.knowledgeBase} live={live} version={guideVersion} /> } : null,
    { id: "files", title: "Files", short: "Files", icon: FolderOpen, count: files.length || undefined, content: files.length ? <ul className="space-y-1.5">{files.map((file) => <li key={file.path}><ArtifactCard file={file} onOpen={onOpenFile} compact shown={artifactPaths.has(file.path)} /></li>)}</ul> : <p className="text-[13px] text-ink-5">No files yet</p> },
    { id: "changes", title: "Changes", short: "Changes", icon: GitCommitHorizontal, count: changes || undefined, content: <ChangesList events={events} onSelect={onSelectStep} /> },
    { id: "skills", title: "Skills used", short: "Skills", icon: Puzzle, count: skills.length || undefined, content: <SkillsList skills={skills} onSelect={onSelectStep} /> },
    { id: "knowledge", title: "Knowledge used", short: "Knowledge", icon: BookOpen, count: knowledge.docs.length || undefined, content: <KnowledgeList knowledge={knowledge} onSelect={onSelectStep} /> },
    ticket ? {
      id: "context", title: "Ticket", short: "Ticket", icon: TicketIcon, badge: ticket.source ? sourceWord(ticket.source) : undefined,
      content: <><Facts rows={[["Key", ticket.externalReference?.number || ticket.ticketId], ["Source", sourceWord(ticket.source)], ["Priority", ticket.priority ? <PriorityBadge priority={String(ticket.priority)} variant="label" /> : "—"], ["Status", ticket.status ? String(ticket.status).replace(/[_-]+/g, " ").replace(/^./, (letter) => letter.toUpperCase()) : "—"], startedRow]} /><div className="mt-3 flex flex-wrap gap-2">{openLink(`/tickets/${encodeURIComponent(ticket.ticketId)}`, "Open ticket")}{ticket.externalReference?.url ? <a className="inline-flex h-8 items-center gap-1 rounded-lg px-2.5 text-[13px] font-semibold text-brand hover:bg-surface-subtle" href={ticket.externalReference.url} target="_blank" rel="noreferrer">Open in {sourceWord(ticket.source)} <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" /></a> : null}</div></>,
    } : routine ? {
      id: "context", title: "Routine", short: "Routine", icon: Repeat,
      content: <><Facts rows={[["Name", routine.title || routine.name], startedRow]} />{routine.objective ? <div className="mt-3 rounded-lg border border-line bg-raised px-3 py-2.5"><p className="text-[12px] font-medium text-ink-5">Objective</p><p className="mt-1 line-clamp-6 whitespace-pre-line text-[13px] leading-5 text-ink-2">{String(routine.objective).replace(/^[\s•*-]+/gm, "")}</p></div> : null}<div className="mt-3">{openLink(`/routines/${encodeURIComponent(routine.name)}`, "Open routine")}</div></>,
    } : null,
    {
      id: "session", title: "Session", short: "Session", icon: Gauge, badge: isAdmin ? "admin" : undefined,
      content: (
        <>
          <dl className="grid grid-cols-2 gap-2">
            {[["Tool calls", String(toolCalls)], ["Turns", String(task.cost?.turns ?? 0)], ["Changes", String(changes)], ...(isAdmin ? [["Cost", `$${(task.cost?.totalUsd ?? 0).toFixed(2)}`]] : [])].map(([label, value]) => (
              <div key={label} className="rounded-lg border border-line bg-raised px-3 py-2"><dt className="text-[11px] font-medium text-ink-5">{label}</dt><dd className="mt-0.5 font-display text-[17px] font-semibold tabular-nums text-ink-1">{value}</dd></div>
            ))}
          </dl>
          <ChipList label="Systems" items={systems} />
          {isAdmin && task.sessionId ? <p className="mt-3 truncate font-mono text-[11.5px] text-ink-5" title={task.sessionId}>session {task.sessionId.slice(0, 8)}…</p> : null}
        </>
      ),
    },
  ] as Array<DetailTab | null>).filter((tab): tab is DetailTab => Boolean(tab));

  if (layout === "stack") {
    return <div className="divide-y divide-line">{tabs.map((tab) => <DetailsSection key={tab.id} title={tab.title} badge={tab.badge} count={tab.id === "files" ? tab.count : undefined}>{tab.content}</DetailsSection>)}</div>;
  }
  return <DetailTabs tabs={tabs} current={tabs.find((tab) => tab.id === activeTab) ?? tabs[0]} open={open} onTab={onTab} onToggle={onToggle} />;
}

/** The icon strip and its open panel. Each tab remembers how much it held when last opened, so its dot means "new since you looked". */
function DetailTabs({ tabs, current, open, onTab, onToggle }: { tabs: DetailTab[]; current: DetailTab; open: boolean; onTab?: (tab: DetailTabId) => void; onToggle?: () => void }) {
  const [seen, setSeen] = useState<Partial<Record<DetailTabId, number>>>({});
  useEffect(() => {
    if (!open) return;
    setSeen((previous) => (previous[current.id] === (current.count ?? 0) ? previous : { ...previous, [current.id]: current.count ?? 0 }));
  }, [open, current.id, current.count]);
  return (
    <div className="flex h-full min-h-0">
      {open ? (
        <div id="task-panel" role="tabpanel" aria-label={current.title} className="flex w-[300px] min-h-0 flex-col border-l border-line bg-surface-panel 2xl:w-[340px]">
          <div className="flex shrink-0 items-center gap-2 border-b border-line px-5 py-3">
            <current.icon className="h-4 w-4 text-ink-4" aria-hidden="true" />
            <h2 className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-ink-1">{current.title}</h2>
            {current.badge ? <span className="rounded-md border border-line bg-raised px-1.5 py-0.5 text-[11px] font-medium text-ink-4">{current.badge}</span> : null}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">{current.content}</div>
        </div>
      ) : null}
      <div role="tablist" aria-label="Task details" aria-orientation="vertical" className="flex w-[68px] shrink-0 flex-col gap-1 overflow-y-auto border-l border-line bg-raised px-2 py-3">
        {tabs.map((tab) => {
          const selected = open && tab.id === current.id;
          return (
            <button key={tab.id} type="button" role="tab" aria-selected={selected} aria-controls="task-panel" title={tab.title} onClick={() => onTab?.(tab.id)}
              className={cn("relative flex w-full flex-col items-center gap-1 rounded-lg px-1 py-2 text-[10.5px] font-medium leading-none transition-colors", selected ? "bg-brand-soft text-brand" : "text-ink-4 hover:bg-surface-subtle hover:text-ink-1")}>
              {selected ? <span className="absolute -left-2 top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-r-full bg-brand" aria-hidden="true" /> : null}
              <tab.icon className="h-[18px] w-[18px]" aria-hidden="true" />
              <span>{tab.short}</span>
              {!selected && tab.count && tab.count > (seen[tab.id] ?? 0) ? <span className="absolute right-2.5 top-1.5 h-2 w-2 rounded-full bg-brand ring-2 ring-raised" aria-label="New" /> : null}
            </button>
          );
        })}
        <button type="button" onClick={onToggle} className="mt-auto flex w-full flex-col items-center gap-1 rounded-lg px-1 py-2 text-[10.5px] font-medium leading-none text-ink-4 transition-colors hover:bg-surface-subtle hover:text-ink-1" aria-label={open ? "Hide panel" : "Show panel"} title={open ? "Hide panel" : "Show panel"}>
          {open ? <PanelRightClose className="h-[18px] w-[18px]" aria-hidden="true" /> : <PanelRightOpen className="h-[18px] w-[18px]" aria-hidden="true" />}
          <span>{open ? "Hide" : "Show"}</span>
        </button>
      </div>
    </div>
  );
}

function ChipList({ label, items }: { label: string; items: string[] }) {
  return (
    <div className="mt-3">
      <p className="text-[11px] font-medium text-ink-5">{label}</p>
      {items.length ? <ul className="mt-1 flex flex-wrap gap-1.5">{items.map((item) => <li key={item} className="rounded-full border border-line bg-raised px-2 py-0.5 text-[12px] font-medium text-ink-2">{item}</li>)}</ul> : <p className="mt-0.5 text-[13px] text-ink-5">None</p>}
    </div>
  );
}

function DetailsSection({ title, badge, count, children }: { title: string; badge?: string; count?: number; children: ReactNode }) {
  return (
    <section className="px-5 py-4" aria-label={title}>
      <div className="flex items-center justify-between">
        <h2 className="text-[12.5px] font-semibold text-ink-3">{title}{count ? <span className="ml-1.5 tabular-nums text-ink-5">{count}</span> : null}</h2>
        {badge ? <span className="rounded-md border border-line bg-surface-subtle px-1.5 py-0.5 text-[11px] font-medium text-ink-4">{badge}</span> : null}
      </div>
      <div className="mt-2.5">{children}</div>
    </section>
  );
}
function Facts({ rows }: { rows: Array<[string, ReactNode]> }) {
  return <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13.5px]">{rows.map(([label, value]) => <FactRow key={label} label={label} value={value} />)}</dl>;
}
function FactRow({ label, value }: { label: string; value: ReactNode }) { return <><dt className="text-ink-4">{label}</dt><dd className="min-w-0 truncate text-ink-1" title={typeof value === "string" ? value : undefined}>{value}</dd></>; }

function TaskSkeleton() {
  return (
    <div className="mx-auto max-w-[760px] space-y-4 px-6 py-8" aria-hidden="true">
      <Skeleton className="h-6 w-1/2" />
      <Skeleton className="ml-auto h-12 w-2/3" />
      <Skeleton className="h-4 w-1/3" />
      <Skeleton className="h-28 w-full" />
      <Skeleton className="h-4 w-1/2" />
    </div>
  );
}

function useElapsed(since: string | null, active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  const timer = useRef<number | null>(null);
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    timer.current = window.setInterval(() => setNow(Date.now()), 1000);
    return () => { if (timer.current) window.clearInterval(timer.current); };
  }, [active, since]);
  return since && active ? Math.max(0, now - new Date(since).getTime()) : 0;
}

function mergeFiles(tree: TreeNode[], fromEvents: ReturnType<typeof artifactsFrom>): ArtifactRef[] {
  const out: ArtifactRef[] = [];
  const walk = (nodes: TreeNode[]) => { for (const node of nodes) { if (node.type === "file") out.push({ name: node.name, path: node.path, size: node.size, openable: true }); else walk(node.children || []); } };
  walk(tree);
  const names = new Set(out.map((file) => file.name.toLowerCase()));
  for (const artifact of fromEvents) if (!names.has(artifact.name.toLowerCase())) out.push({ name: artifact.name, path: artifact.path, openable: false, at: artifact.at });
  return out;
}

function LogsDialog({ task, open, onOpenChange }: { task: Task; open: boolean; onOpenChange: (open: boolean) => void }) {
  const logs = useQuery({ queryKey: taskKeys.logs(task.id), queryFn: ({ signal }) => tasksApi.logs(task.id, signal), enabled: open });
  const download = () => { const blob = new Blob([(logs.data?.events ?? []).map((event) => JSON.stringify(event)).join("\n")], { type: "application/x-ndjson" }); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = `${task.id}-events.jsonl`; link.click(); URL.revokeObjectURL(url); };
  const cost = logs.data?.cost || task.cost;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader><DialogTitle>Logs · {task.id}</DialogTitle><DialogDescription>Raw session stream from the Agent SDK. Admin only.</DialogDescription></DialogHeader>
        <div className="space-y-4 px-5 pb-5">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[["Total cost", `$${(cost?.totalUsd ?? 0).toFixed(2)}`], ["Input tokens", (cost?.inputTokens ?? 0).toLocaleString()], ["Output tokens", (cost?.outputTokens ?? 0).toLocaleString()], ["Duration", formatDuration(cost?.durationMs ?? 0)]].map(([label, value]) => <div key={label} className="rounded-xl border border-line bg-raised px-3 py-2"><p className="text-[11.5px] text-ink-4">{label}</p><p className="mt-0.5 font-display text-[18px] font-semibold tabular-nums text-ink-1">{value}</p></div>)}
          </div>
          <div className="max-h-[50vh] overflow-auto rounded-xl border border-line">
            <table className="w-full text-[13px]">
              <thead className="sticky top-0 bg-surface-subtle text-left text-[11.5px] uppercase tracking-[0.05em] text-ink-5"><tr><th className="px-3 py-2">Time</th><th className="px-3 py-2">Event</th><th className="px-3 py-2">Detail</th></tr></thead>
              <tbody className="divide-y divide-line">
                {(logs.data?.events ?? []).map((event) => <tr key={event.id} className="align-top"><td className="whitespace-nowrap px-3 py-1.5 font-mono text-ink-4">{new Date(event.at).toLocaleTimeString()}</td><td className="whitespace-nowrap px-3 py-1.5 font-mono text-ink-2">{event.type}{event.name ? ` ${event.name}` : ""}</td><td className="max-w-[560px] px-3 py-1.5 font-mono text-ink-3"><span className="line-clamp-3 break-all">{eventDetail(event)}</span></td></tr>)}
                {logs.isPending ? <tr><td colSpan={3} className="px-3 py-4"><Skeleton className="h-3 w-40" /></td></tr> : null}
              </tbody>
            </table>
          </div>
          <div className="flex justify-end gap-2"><Button variant="outline" className="border border-line" onClick={download} disabled={!logs.data}><Download className="h-4 w-4" />Download JSONL</Button><Button variant="primary" onClick={() => onOpenChange(false)}>Close</Button></div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
function eventDetail(event: TaskEvent): string {
  if (event.type === "tool.use") return event.input || "";
  if (event.type === "tool.result") return event.content || "";
  if (event.type === "assistant.text" || event.type === "user.message") return event.text || "";
  if (event.type === "result") return `${event.subtype} · ${event.turns} turns · ${formatDuration(event.durationMs || 0)} · $${(event.costUsd || 0).toFixed(3)}`;
  if (event.type === "session.init") return `model ${event.model || "?"} · ${event.tools ?? 0} tools · ${availableSkillsLabel(event) || "0 skills"} · mcp: ${(event.mcpServers || []).map((server) => `${server.name} (${server.status})`).join(", ") || "none"}`;
  return [event.title, event.detail].filter(Boolean).join(" · ");
}
