import { useQuery } from "@tanstack/react-query";
import { CalendarClock, FileText, Ticket, Workflow, type LucideIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { TASK_STATUS_LABEL, tasksApi, type AttachmentUpload, type TaskPermission, taskKeys } from "@/api/tasks";
import { useIsAdmin, useMe } from "@/auth/rbac";
import { AgentMark } from "@/components/ops/AgentMark";
import { AGENT_NAME } from "@/components/ops/agentPanelContext";
import { DIAL_ICON, DIAL_LABEL, PERMISSION_TONE } from "@/components/ops/AutonomyDial";
import { PageHeader } from "@/components/ops/PageHeader";
import { formatRelativeTime } from "@/components/ui";
import { cn } from "@/lib/utils";
import { NewTaskBackdrop } from "./NewTaskBackdrop";
import { PermissionMenu } from "./PermissionMenu";
import { TaskComposer } from "./TaskComposer";
import type { Mention } from "./mentions";
import { TaskStateDot } from "./TasksPage";
import { useAction } from "@/lib/useAction";

/**
 * New task: say what you want done. A wide chat box with the mode chip in its footer (the way
 * Claude Code and ChatGPT pick a mode), four suggestion cards that load a prompt and the mode it
 * suits into the box, and the recent tasks underneath so nobody loses the thread. Sonic's floating
 * pill stays off this page because the box here is the conversation.
 */

interface Suggestion { title: string; prompt: string; permission: TaskPermission; icon: LucideIcon }

/** Four, one per kind of work Sonic does most: investigate, tickets, report, automate. */
/** Placeholder examples, one every few seconds while the box is empty: the range of what Sonic takes on. */
const EXAMPLES = [
  "Why did veltrix_sales_daily_load fail last night?",
  "Which open P1 and P2 tickets have no owner?",
  "Draft this week's data ops summary for the brand leads",
  "Check whether the IQVIA file has the new plan_type column",
  "Set up a weekday 9 AM review of new incidents",
];

const SUGGESTIONS: ReadonlyArray<Suggestion> = [
  { title: "Diagnose the latest pipeline failure", icon: Workflow, permission: "read-only", prompt: "Why did the latest failed pipeline run fail? Find the root cause and the fix. Do not change anything." },
  { title: "Find tickets ready to close", icon: Ticket, permission: "ask", prompt: "Go through my open tickets, tell me which ones can be closed with the evidence, and close them once I approve." },
  { title: "Draft the weekly operations summary", icon: FileText, permission: "policy", prompt: "Prepare this week's operations summary: pipeline health, open incidents and data quality. Draft the email to the brand leads." },
  { title: "Set up a morning ticket review", icon: CalendarClock, permission: "policy", prompt: "Set up a weekday 9 AM routine that reviews new P1 and P2 tickets and tells me which need me." },
];

export function NewTaskPage() {
  const navigate = useNavigate();
  const me = useMe();
  const isAdmin = useIsAdmin();
  const [permission, setPermission] = useState<TaskPermission>("policy");
  // The command palette's "Start a task" hands its words over in the route state.
  const handedOver = (useLocation().state as { prompt?: unknown } | null)?.prompt;
  const [draft, setDraft] = useState<string | null>(typeof handedOver === "string" && handedOver.trim() ? handedOver : null);
  const consumeDraft = useCallback(() => setDraft(null), []);
  const pick = (suggestion: Suggestion) => { setPermission(suggestion.permission); setDraft(suggestion.prompt); };
  const firstName = String(me.data?.user?.name || "").split(/\s+/)[0];
  const [example, setExample] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setExample((index) => (index + 1) % EXAMPLES.length), 3800);
    return () => window.clearInterval(timer);
  }, []);
  const recent = useQuery({ queryKey: taskKeys.list({ recent: true }), queryFn: ({ signal }) => tasksApi.list({ limit: 6 }, signal) });
  const create = useAction({
    mutationFn: ({ prompt, mentions = [], attachments = [] }: { prompt: string; mentions?: Mention[]; attachments?: AttachmentUpload[] }) => tasksApi.create({ type: "adhoc", prompt, permission, ...(attachments.length ? { attachments } : {}), context: { page: { name: "New task", path: "/tasks/new", mentions: mentions.length ? mentions.map(({ kind, id, title }) => ({ kind, id, title })) : undefined } } }),
    invalidate: [taskKeys.all],
    onSuccess: (task) => navigate(`/tasks/${encodeURIComponent(task.id)}`),
    error: "Task not started",
  });
  return (
    <>
      <PageHeader title="New task" compact />
      <div className="relative isolate mx-auto w-full max-w-[860px] space-y-10 pb-10 pt-6">
        <NewTaskBackdrop centerY={58} />
        <section className="space-y-6">
          <div className="stagger-children flex flex-col items-center text-center">
            <span className="rounded-full bg-raised p-2 shadow-[0_0_0_1px_rgb(var(--c-line)),0_10px_30px_-12px_rgb(var(--c-brand)/0.45)]"><AgentMark size={48} state={create.isPending ? "thinking" : "idle"} /></span>
            <h2 className="mt-7 font-display text-[34px] font-semibold leading-[40px] tracking-[-0.025em] text-ink-1">{firstName ? `What should ${AGENT_NAME} do, ${firstName}?` : `What should ${AGENT_NAME} do?`}</h2>
          </div>
          <TaskComposer
            size="lg"
            focusOnMount
            label="Describe the outcome you want"
            placeholder={EXAMPLES[example]}
            className="composer-glow"
            busy={create.isPending}
            mentions
            attachments
            onSend={(text, mentions, attachments) => create.mutateAsync({ prompt: text, mentions, attachments })}
            disabled={create.isPending}
            draft={draft}
            onDraftConsumed={consumeDraft}
            footer={<PermissionMenu value={permission} onChange={setPermission} disabled={create.isPending} allowUnrestricted={isAdmin} />}
          />
          <ul aria-label="Suggestions" className="stagger-children grid gap-3 sm:grid-cols-2">
            {SUGGESTIONS.map((suggestion) => {
              const ModeIcon = DIAL_ICON[suggestion.permission];
              return (
                <li key={suggestion.title}>
                  <button
                    type="button"
                    disabled={create.isPending}
                    onClick={() => pick(suggestion)}
                    className="group flex h-full w-full flex-col rounded-2xl border border-line bg-raised p-4 text-left shadow-card transition duration-200 ease-out hover:-translate-y-px hover:border-line-strong hover:shadow-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/25 disabled:pointer-events-none disabled:opacity-50"
                  >
                    <span className="flex w-full items-center justify-between gap-3">
                      <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-surface-panel text-ink-3 transition-colors group-hover:text-ink-1">
                        <suggestion.icon className="h-4 w-4" aria-hidden="true" />
                      </span>
                      <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11.5px] font-semibold", PERMISSION_TONE[suggestion.permission])}>
                        <ModeIcon className="h-3 w-3" aria-hidden="true" />{DIAL_LABEL[suggestion.permission]}
                      </span>
                    </span>
                    <span className="mt-3 block text-[14.5px] font-semibold leading-5 text-ink-1">{suggestion.title}</span>
                    <span className="mt-1 line-clamp-2 block text-[13px] leading-[19px] text-ink-4">{suggestion.prompt}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        {recent.data?.items.length ? (
          <section aria-label="Recent tasks">
            <div className="flex items-center justify-between px-0.5">
              <h3 className="text-[12px] font-medium text-ink-5">Recent</h3>
              <Link to="/tasks" className="text-[13px] font-medium text-ink-4 hover:text-ink-1">All tasks</Link>
            </div>
            <ul className="mt-2 divide-y divide-line rounded-2xl border border-line bg-raised shadow-card">
              {recent.data.items.map((task) => (
                <li key={task.id}>
                  <Link to={`/tasks/${encodeURIComponent(task.id)}`} className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-surface-subtle">
                    <TaskStateDot status={task.status} />
                    <span className="min-w-0 flex-1 truncate text-[14px] text-ink-1">{task.title}</span>
                    <span className="hidden shrink-0 text-[13px] text-ink-4 sm:block">{TASK_STATUS_LABEL[task.status]}</span>
                    <span className="w-20 shrink-0 text-right text-[13px] text-ink-5">{formatRelativeTime(task.updatedAt)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </>
  );
}
