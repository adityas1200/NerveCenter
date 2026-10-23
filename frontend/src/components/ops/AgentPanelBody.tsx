import { refreshAfterWrite } from "@/lib/refreshAfterWrite";
import { RefreshButton } from "@/components/ops/RefreshButton";
import { Skeleton } from "@/components/ui/skeleton";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Expand, MessageSquare, RotateCcw, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { tasksApi, type AttachmentUpload, type PageContext, taskKeys } from "@/api/tasks";
import { useMe } from "@/auth/rbac";
import { AGENT_NAME, describePage, readConversations, saveConversations, type AgentScreen, type AgentSelection } from "@/components/ops/agentPanelContext";
import { Button, Tooltip, TooltipContent, TooltipTrigger, useToast } from "@/components/ui";
import { QueuedMessages } from "@/features/tasks/QueuedMessages";
import { TaskComposer } from "@/features/tasks/TaskComposer";
import type { Mention } from "@/features/tasks/mentions";
import { TaskThread, currentActivity, currentActivityKind } from "@/features/tasks/TaskThread";
import { useTaskStream } from "@/features/tasks/useTaskStream";
import { cn } from "@/lib/utils";
import { AgentMark } from "@/components/ops/AgentMark";
import { useAction } from "@/lib/useAction";

/** The open Sonic panel: conversation, composer and controls. Loaded the first time the panel opens (AgentPanel.tsx). */

/** Records people know by name (boards, checks, pipelines) read by their title; tickets keep their id. */
const NAMED_KINDS = new Set(["board", "dq_check", "pipeline"]);
function openName(open: AgentSelection | null | undefined): string | null {
  if (!open?.id) return null;
  return NAMED_KINDS.has(open.kind) && open.title ? open.title : open.id;
}

/** The widget on screen that a board_widget selection points at, so a screenshot is cropped to it (SPEC-tasks-12 FR-8). */
function selectedElement(selection: AgentSelection | null): Element | null {
  const widgetId = selection?.kind === "board_widget" ? selection.detail?.widgetId : undefined;
  if (typeof widgetId !== "string" || !widgetId) return null;
  const quoted = typeof CSS !== "undefined" && typeof CSS.escape === "function" ? CSS.escape(widgetId) : widgetId.replace(/["\\]/g, "\\$&");
  return document.querySelector(`[data-widget-id="${quoted}"]`);
}

/** What the next message is about (SPEC-tasks-12 FR-5): the selection a page set, which the person can clear before sending. */
function AboutChip({ selection, onClear }: { selection: AgentSelection; onClear: () => void }) {
  const label = selection.title || selection.id;
  return (
    <div className="mb-1.5 flex min-w-0 px-1" data-testid="agent-about">
      <span className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-full border border-line bg-surface-subtle py-0.5 pl-2.5 pr-0.5 text-[12.5px] leading-5 text-ink-3" title={label}>
        <span className="shrink-0 text-ink-5">About</span>
        <span className="min-w-0 truncate font-medium text-ink-1">{label}</span>
        <button type="button" onClick={onClear} aria-label="Clear what this message is about" className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-ink-5 hover:bg-surface-panel hover:text-ink-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"><X className="h-3 w-3" aria-hidden="true" /></button>
      </span>
    </div>
  );
}

export function AgentPanelBody({ open, onClose, selection, onClearSelection, screen, pendingPrompt, onPromptConsumed }: { open: boolean; onClose: () => void; selection: AgentSelection | null; onClearSelection: () => void; screen: AgentScreen | null; pendingPrompt: string | null; onPromptConsumed: () => void }) {
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const toast = useToast();
  const queryClient = useQueryClient();
  const me = useMe();
  const readOnly = String(me.data?.role || "") === "viewer";
  const firstName = String(me.data?.user?.name || "").split(/\s+/)[0];
  const page = describePage(location.pathname);
  const [conversations, setConversations] = useState<Record<string, string>>(readConversations);
  // While the panel stays open, the conversation in it stays put as the reader moves around the app
  // (each message still carries the page they are on now); reopened elsewhere, it shows that page's.
  const [pinned, setPinned] = useState<string | null>(null);
  useEffect(() => { if (!open) setPinned(null); }, [open]);
  const taskId = (open && pinned) || conversations[page.family];
  useEffect(() => { if (open && !pinned && conversations[page.family]) setPinned(conversations[page.family]); }, [open, pinned, conversations, page.family]);
  const stream = useTaskStream(open ? taskId : undefined);
  const scroller = useRef<HTMLDivElement | null>(null);
  const draftLength = stream.draft?.text.length || 0;
  useEffect(() => { if (open && scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight; }, [stream.events.length, draftLength, open]);
  // The plan card's "Adjust plan" prefills the box; the box clears the draft once it has taken it.
  const [composerDraft, setComposerDraft] = useState<string | null>(null);
  const consumeDraft = useCallback(() => setComposerDraft(null), []);

  const context = (mentions: Mention[] = []): PageContext => {
    const filters: Record<string, string> = {}; searchParams.forEach((value, key) => { filters[key] = value; });
    return { name: page.name, path: location.pathname, filters: Object.keys(filters).length ? filters : undefined, selection: selection || undefined, visible: screen?.visible?.slice(0, 200), open: screen?.open || undefined, summary: screen?.summary, mentions: mentions.length ? mentions.map(({ kind, id, title }) => ({ kind, id, title })) : undefined };
  };
  const create = useMutation({
    mutationFn: ({ prompt, mentions, attachments = [] }: { prompt: string; mentions?: Mention[]; attachments?: AttachmentUpload[] }) => tasksApi.create({ type: "adhoc", prompt, permission: "policy", context: { page: context(mentions) }, ...(attachments.length ? { attachments } : {}) }),
    onSuccess: async (task) => { const next = { ...readConversations(), [page.family]: task.id }; saveConversations(next); setConversations(next); setPinned(task.id); await refreshAfterWrite(queryClient, { queryKey: taskKeys.all }); },
    onError: (error) => toast.error("Message not sent", error instanceof Error ? error.message : "Try again."),
  });
  // Follow-ups carry the current screen too, so "these" means what is on screen now.
  const send = useAction({
    mutationFn: ({ text, mentions, attachments }: { text: string; mentions?: Mention[]; attachments?: AttachmentUpload[] }) => tasksApi.send(taskId || "", text, { page: context(mentions) }, undefined, attachments),
    invalidate: [taskKeys.detail(taskId || "")],
    error: "Message not sent",
  });
  const cancel = useAction({
    mutationFn: () => tasksApi.cancel(taskId || ""),
    invalidate: [taskKeys.all],
    error: "Not stopped",
  });
  const submit = useCallback(async (text: string, mentions: Mention[] = [], attachments: AttachmentUpload[] = []) => { if (taskId && stream.task && stream.task.status !== "cancelled") await send.mutateAsync({ text, mentions, attachments }); else await create.mutateAsync({ prompt: text, mentions, attachments }); }, [taskId, stream.task, send, create]);
  // A page button ("New board", "Ask Sonic to fix it") only types its prompt into the box; nothing is
  // sent until the user presses Enter, so they can read or edit it first.
  useEffect(() => { if (open && pendingPrompt) { setComposerDraft(pendingPrompt); onPromptConsumed(); } }, [open, pendingPrompt, onPromptConsumed]);
  const startFresh = () => { const next = { ...readConversations() }; delete next[page.family]; saveConversations(next); setConversations(next); setPinned(null); };

  const task = stream.task;
  const live = task ? task.status === "running" || task.status === "queued" : false;
  const markState = task?.pendingApprovalId ? "waiting" : live ? "thinking" : task?.status === "done" ? "done" : "idle";
  const status = live ? (stream.draft?.text ? "Writing the reply" : currentActivity(stream.events, stream.startingTool)) || undefined : undefined;
  const activity = stream.draft?.text ? "writing" : currentActivityKind(stream.events, stream.startingTool);
  return (
    <>
      <div className={cn("fixed inset-0 z-40 bg-black/15 transition-opacity duration-300 xl:hidden", open ? "opacity-100" : "pointer-events-none opacity-0")} onClick={onClose} aria-hidden="true" />
      <aside className={cn("fixed inset-y-0 right-0 z-50 flex w-full max-w-[460px] flex-col border-l border-line bg-raised shadow-modal transition-transform duration-300 ease-out xl:shadow-none", open ? "translate-x-0" : "translate-x-full")} aria-label={`${AGENT_NAME} panel`} aria-hidden={!open}>
        <header className="flex h-16 items-center gap-3 border-b border-line px-4">
          <AgentMark size={32} state={markState} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[14.5px] font-semibold leading-5 text-ink-1">{AGENT_NAME}</p>
            <p className="truncate text-[12px] leading-4 text-ink-4">{live ? status || "Thinking" : task?.title || `On ${page.name}`}</p>
          </div>
          {taskId ? <RefreshButton onClick={() => void stream.refetch()} busy={stream.isFetching} updatedAt={task?.updatedAt} /> : null}
          {task && !live ? (
            <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg text-ink-4 hover:bg-surface-subtle hover:text-ink-1" onClick={startFresh} aria-label="New conversation"><RotateCcw className="h-4 w-4" /></Button></TooltipTrigger><TooltipContent>New conversation</TooltipContent></Tooltip>
          ) : null}
          {task ? <Tooltip><TooltipTrigger asChild><Button asChild variant="ghost" size="icon" className="h-8 w-8 rounded-lg text-ink-4 hover:bg-surface-subtle hover:text-ink-1"><Link to={`/tasks/${encodeURIComponent(task.id)}`} onClick={onClose} aria-label="Open as a full task"><Expand className="h-4 w-4" /></Link></Button></TooltipTrigger><TooltipContent>Open as a full task</TooltipContent></Tooltip> : null}
          <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg text-ink-4 hover:bg-surface-subtle hover:text-ink-1" onClick={onClose} aria-label={`Close ${AGENT_NAME}`}><X className="h-4 w-4" /></Button>
        </header>
        {stream.error ? <p role="alert" className="px-4 text-rose-600">Could not load this conversation. Use Refresh to try again.</p> : null}
        <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-4 py-5">
          {taskId && task ? (
            <TaskThread task={task} events={stream.events} pendingApproval={stream.pendingApproval} pendingQuestion={stream.pendingQuestion} compact onOpenTask={onClose} draft={stream.draft} startingTool={stream.startingTool} liveStatus={readOnly} onAdjustPlan={setComposerDraft} editable={!readOnly} onStop={() => cancel.mutate()} onAsk={(text) => { submit(text).catch(() => { /* the send hook reports the failure */ }); }} askBlocked={readOnly ? "Viewers can't send messages" : task.status === "cancelled" ? "This task was stopped" : live ? `${AGENT_NAME} is working` : task.pendingApprovalId ? `Answer ${AGENT_NAME} first` : undefined} />
          ) : taskId && stream.isPending ? <div role="status" aria-label="Loading conversation" className="space-y-4"><Skeleton className="h-20 w-3/4" /><Skeleton className="h-32 w-full" /></div> : (
            <div className="stagger-children flex min-h-full flex-col justify-center gap-6 pb-8 pt-6">
              <div className="px-1">
                <span className="mb-4 inline-flex rounded-full bg-raised p-1.5 shadow-[0_0_0_1px_rgb(var(--c-line)),0_8px_24px_-10px_rgb(var(--c-brand)/0.5)]"><AgentMark size={32} /></span>
                <p className="font-display text-[24px] font-semibold leading-8 tracking-[-0.02em] text-ink-1">{firstName ? `Hi ${firstName}` : "Hi"}</p>
                <p className="mt-1.5 text-[14px] leading-6 text-ink-3">I can see the {page.name} page{screen?.visible?.length ? ` and the ${screen.visible.length} ${screen.visible.length === 1 ? "item" : "items"} on it` : ""}{openName(screen?.open) ? `, with ${openName(screen?.open)} open` : ""}. Type @ to point me at a ticket, pipeline or table.</p>
              </div>
              <div>
                <p className="px-1 pb-2 text-[12px] font-medium text-ink-5">Try</p>
                <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line">
                  {page.prompts.slice(0, 4).map((prompt) => (
                    <li key={prompt}>
                      <button type="button" className="group flex w-full items-center justify-between gap-3 bg-raised px-3.5 py-3 text-left text-[14px] leading-5 text-ink-2 transition-colors hover:bg-surface-panel hover:text-ink-1 disabled:opacity-50" disabled={create.isPending || readOnly} onClick={() => void submit(prompt)}>
                        <span>{prompt}</span><MessageSquare className="h-3.5 w-3.5 shrink-0 text-ink-5 transition-colors group-hover:text-ink-1" aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>
        <div className="px-3 pb-3 pt-1">
          {!readOnly && selection ? <AboutChip selection={selection} onClear={onClearSelection} /> : null}
          {readOnly ? <p className="text-center text-[13px] text-ink-4">Viewers can read {AGENT_NAME}&apos;s work but not chat.</p> : <TaskComposer layout="inline" mentions attachments capture={() => selectedElement(selection)} above={task?.queue?.length ? <QueuedMessages taskId={task.id} queue={task.queue} /> : undefined} onSend={submit} onStop={taskId ? () => cancel.mutate() : undefined} placeholder={task ? "Ask a follow-up…" : `Ask ${AGENT_NAME} about ${page.name.toLowerCase()}…`} disabled={create.isPending || Boolean(task?.pendingApprovalId)} busy={live} activity={activity} status={status} draft={composerDraft} onDraftConsumed={consumeDraft} focusOnMount={open} hint={stream.pendingQuestion ? `Answer ${AGENT_NAME}'s question above first` : task?.pendingApprovalId ? "Decide the approval above first." : undefined} />}
        </div>
      </aside>
    </>
  );
}
