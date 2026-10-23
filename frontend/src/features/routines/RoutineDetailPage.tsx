import { useQuery } from "@tanstack/react-query";
import { Bell, CalendarClock, CheckCircle2, ChevronRight, FileText, FlaskConical, History, Pause, Pencil, Play, Plug, RefreshCw, ShieldCheck, Trash2, Wrench, XCircle } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { routineKeys, routinesApi, type Routine, type RoutineCheck, type RoutineNotify, type RoutineRun } from "@/api/routines";
import { PERMISSION_HELP, PERMISSION_LABEL, TASK_STATUS_LABEL, taskKeys } from "@/api/tasks";
import { AutonomyDial } from "@/components/ops/AutonomyDial";
import { useAgentScreen } from "@/components/ops/agentPanelContext";
import { PageHeader } from "@/components/ops/PageHeader";
import { RefreshButton } from "@/components/ops/RefreshButton";
import { QueryState } from "@/components/ops/StatePanels";
import { Button, Card, Switch, formatAbsoluteTime, formatRelativeTime, confirmAction } from "@/components/ui";
import { cn } from "@/lib/utils";
import { RoutineDialog } from "./RoutineDialog";
import { connectionLabel, plainCheckDetail, scheduleWords } from "./routineText";
import { AnimatedFigure } from "@/components/ops/AnimatedNumber";
import { useConnectionNames } from "./useConnectionNames";
import { useAction } from "@/lib/useAction";

/** One routine: what it does, when, with which connections, how the last runs went, and whether its setup checks out. */

export function RoutineDetailPage() {
  const { name = "" } = useParams();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [check, setCheck] = useState<RoutineCheck | null>(null);
  const query = useQuery({ queryKey: routineKeys.detail(name), queryFn: ({ signal }) => routinesApi.get(name, signal), refetchInterval: false, retry: false });
  const names = useConnectionNames();
  const keys = [routineKeys.all, taskKeys.all];
  const run = useAction({ mutationFn: (test: boolean) => test ? routinesApi.test(name) : routinesApi.run(name), invalidate: keys, success: (task, test) => [test ? "Test run started" : "Run started", test ? "Preview mode: no changes will be made." : task.id], onSuccess: (task) => navigate(`/tasks/${encodeURIComponent(task.id)}`), error: "Not started" });
  const toggle = useAction({ mutationFn: (enabled: boolean) => enabled ? routinesApi.resume(name) : routinesApi.pause(name), invalidate: keys, success: (routine) => (routine.enabled ? "Routine resumed" : "Routine paused"), error: "Not changed" });
  const remove = useAction({ mutationFn: () => routinesApi.remove(name), invalidate: keys, success: "Routine deleted", onSuccess: () => navigate("/routines"), error: "Not deleted" });
  const runCheck = useAction({ mutationFn: () => routinesApi.check(name), onSuccess: setCheck, error: "Check failed" });
  const routine = query.data;
  // "Why did this fail?" or "move it to 8 AM" from the panel means this routine.
  useAgentScreen(routine ? { open: { kind: "routine", id: routine.name, title: routine.title }, summary: `${routine.enabled ? "Active" : "Paused"}; ${routine.scheduleText || "runs on demand"}; ${routine.permission}; last run ${routine.lastRun ? `${routine.lastRun.status}${routine.lastRun.taskId ? ` (${routine.lastRun.taskId})` : ""}` : "never"}` } : null);
  return (
    <>
      <PageHeader
        title={routine?.title || name}
        back={{ to: "/routines", label: "Routines" }}
        status={routine ? <span className="inline-flex h-6 items-center gap-1.5 rounded-full border border-line bg-raised px-2.5 text-[12px] font-semibold text-ink-2"><span aria-hidden="true" className={routine.status === "running" ? "h-1.5 w-1.5 animate-pulse rounded-full bg-brand" : routine.status === "error" ? "h-1.5 w-1.5 rounded-full bg-rose-500" : routine.enabled ? "h-1.5 w-1.5 rounded-full bg-emerald-500" : "h-1.5 w-1.5 rounded-full bg-ink-5"} />{routine.enabled ? "Active" : "Paused"}</span> : undefined}
        actions={<RefreshButton autoRefresh onClick={() => void query.refetch({ cancelRefetch: false })} busy={query.isFetching} updatedAt={query.dataUpdatedAt} />}
        primary={routine ? <Button variant="primary" size="sm" disabled={run.isPending || routine.status === "running"} onClick={() => run.mutate(false)}><Play className="h-3.5 w-3.5" />Run now</Button> : undefined}
        menu={routine ? [
          { label: "Test run", icon: FlaskConical, disabled: run.isPending, onSelect: () => run.mutate(true) },
          { label: "Edit", icon: Pencil, onSelect: () => setEditing(true) },
          { label: routine.enabled ? "Pause" : "Resume", icon: routine.enabled ? Pause : Play, disabled: toggle.isPending, onSelect: () => toggle.mutate(!routine.enabled) },
          { label: "Delete", icon: Trash2, destructive: true, divider: true, disabled: remove.isPending, onSelect: () => { void confirmAction({ title: `Delete "${routine.title}"?`, description: "The routine stops running. Its past runs stay in Tasks.", confirmLabel: "Delete routine", destructive: true }).then((ok) => { if (ok) remove.mutate(); }); } },
        ] : undefined}
      />
      <QueryState query={query} tiles={0}>
        {routine ? (
          <div className="space-y-5">
            <RoutineSummary routine={routine} />
            <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
              <div className="space-y-5">
                <Card className="overflow-hidden shadow-card">
                  <SectionHead icon={History} title="Run history" note={routine.recentRuns.length ? `Last ${routine.recentRuns.length}` : undefined} />
                  {routine.recentRuns.length
                    ? <ol className="px-5 py-3">{routine.recentRuns.map((item, index) => <TimelineRun key={item.taskId} run={item} last={index === routine.recentRuns.length - 1} />)}</ol>
                    : <p className="px-5 py-8 text-center text-[13.5px] text-ink-4">No runs yet. Run it now or wait for the next scheduled run.</p>}
                  {routine.lastTest ? (
                    <div className="border-t border-line bg-surface-tint/50 px-5 py-3">
                      <p className="mb-1 flex items-center gap-1.5 text-[12px] font-medium text-ink-5"><FlaskConical className="h-3.5 w-3.5" aria-hidden="true" />Last test run</p>
                      <ol><TimelineRun run={routine.lastTest} last /></ol>
                    </div>
                  ) : null}
                </Card>
                <Card className="overflow-hidden shadow-card">
                  <SectionHead icon={ShieldCheck} title="Permission" />
                  <div className="px-5 py-4">
                    <AutonomyDial label="Permission" value={routine.permission} onChange={() => {}} disabled className="max-w-[560px]" />
                  </div>
                </Card>
              </div>
              <aside className="space-y-5">
                <Card className="overflow-hidden shadow-card">
                  <SectionHead icon={CalendarClock} title="Schedule" />
                  <div className="space-y-3 px-5 py-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[14px] font-medium text-ink-1">{routine.enabled ? "On" : "Paused"}</p>
                        <p className="text-[12.5px] text-ink-4">{routine.enabled ? "Runs on its schedule" : "Resume to schedule the next run"}</p>
                      </div>
                      <Switch checked={routine.enabled} disabled={toggle.isPending} onCheckedChange={(next) => toggle.mutate(next)} aria-label={routine.enabled ? "Pause routine" : "Resume routine"} />
                    </div>
                    <div className="rounded-xl border border-line bg-surface-tint/60 px-3.5 py-3">
                      <p className="text-[14px] text-ink-1">{scheduleWords(routine)}</p>
                      <p className="mt-0.5 text-[12.5px] text-ink-4">{routine.nextRunAt && routine.enabled ? `Next: ${formatAbsoluteTime(routine.nextRunAt)}` : routine.trigger.type === "manual" ? "Runs when started" : "No run scheduled"}</p>
                      {routine.scheduleError ? <p className="mt-1 text-[12.5px] text-rose-700">{routine.scheduleError}</p> : null}
                    </div>
                  </div>
                </Card>
                <Card className="overflow-hidden shadow-card">
                  <SectionHead icon={Plug} title="Connections" />
                  <div className="px-5 py-4">
                    {routine.connections.length
                      ? <ul className="flex flex-wrap gap-1.5">{routine.connections.map((id) => <li key={id} className="rounded-full border border-line bg-raised px-2.5 py-0.5 text-[12.5px] font-medium text-ink-2">{connectionLabel(id, names)}</li>)}</ul>
                      : <p className="text-[13px] text-ink-4">Uses whatever connections are configured</p>}
                  </div>
                </Card>
                <Card className="overflow-hidden shadow-card">
                  <SectionHead icon={Wrench} title="Setup" action={<Button variant="outline" size="xs" className="h-7 gap-1 rounded-full border border-line bg-raised px-3 text-[12.5px] font-medium text-ink-2 hover:border-line-strong hover:text-ink-1" disabled={runCheck.isPending} busy={runCheck.isPending} onClick={() => runCheck.mutate()}><RefreshCw className={runCheck.isPending ? "h-3 w-3 animate-spin" : "h-3 w-3"} />{check ? "Recheck" : "Check setup"}</Button>} />
                  <div className="px-5 py-4">
                    {check ? <ul className="space-y-2.5">{check.checks.map((item) => <li key={item.id} className="flex items-start gap-2 text-[13.5px]">{item.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-label="OK" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" aria-label="Problem" />}<span><span className="text-ink-1">{item.title}</span><span className="block text-[12.5px] leading-[18px] text-ink-4">{plainCheckDetail(item.detail)}</span></span></li>)}</ul> : <p className="text-[13px] leading-5 text-ink-4">Checks that the connections and permissions this routine needs are in place.</p>}
                  </div>
                  <details className="group border-t border-line px-5 py-3">
                    <summary className="flex cursor-pointer list-none items-center gap-1 text-[12px] font-medium text-ink-5 hover:text-ink-3 [&::-webkit-details-marker]:hidden"><ChevronRight className="h-3 w-3 transition-transform group-open:rotate-90" aria-hidden="true" />Advanced</summary>
                    <dl className="mt-2 text-[12.5px]"><dt className="text-ink-5">File</dt><dd className="mt-0.5 truncate font-mono text-[12.5px] text-ink-3" title={`workflows/${routine.file}`}>workflows/{routine.file}</dd></dl>
                  </details>
                </Card>
              </aside>
            </div>
          </div>
        ) : null}
      </QueryState>
      {routine ? <RoutineDialog open={editing} onOpenChange={setEditing} routine={routine} /> : null}
    </>
  );
}

const NOTIFY_LABEL: Record<RoutineNotify, string> = { on_complete: "Notifies when a run completes", on_failure: "Notifies only on failure", never: "No notifications" };
const usd = (value: number) => `$${value.toFixed(2)}`;
const RUN_DOT: Record<string, string> = { done: "bg-emerald-500", failed: "bg-rose-500", waiting: "bg-amber-500", running: "bg-brand animate-pulse", queued: "bg-brand" };

/** The routine at a glance: the instruction as the headline, its schedule and limits as tags, then four figures from its recent runs. */
function RoutineSummary({ routine }: { routine: Routine }) {
  const runs = routine.recentRuns;
  const finished = runs.filter((run) => run.status === "done" || run.status === "failed");
  const succeeded = finished.filter((run) => run.status === "done").length;
  const costs = runs.map((run) => run.costUsd).filter((cost) => cost > 0);
  const last = routine.lastRun;
  const stats = [
    { label: "Next run", value: routine.status === "running" ? "Running now" : !routine.enabled ? "Paused" : routine.nextRunAt ? formatRelativeTime(routine.nextRunAt) : routine.trigger.type === "manual" ? "Manual" : "Not scheduled", hint: routine.nextRunAt && routine.enabled ? formatAbsoluteTime(routine.nextRunAt) : routine.trigger.type === "manual" ? "Runs when started" : "—" },
    { label: "Last run", value: last ? formatRelativeTime(last.createdAt) : "Never", hint: last ? TASK_STATUS_LABEL[last.status] : "Not run yet", dot: last ? RUN_DOT[last.status] : undefined },
    { label: "Success rate", value: finished.length ? `${Math.round((succeeded / finished.length) * 100)}%` : "—", hint: finished.length ? `${succeeded} of ${finished.length} recent runs` : "No finished runs" },
    { label: "Avg cost", value: costs.length ? usd(costs.reduce((sum, cost) => sum + cost, 0) / costs.length) : "—", hint: costs.length ? "per run" : "No cost recorded" },
  ];
  return (
    <section aria-label="Routine summary" className="stagger-in overflow-hidden rounded-2xl border border-line bg-raised shadow-card">
      <div className="relative px-6 py-5">
        <span aria-hidden="true" className="pointer-events-none absolute inset-0 bg-gradient-to-br from-brand-soft/70 via-raised to-raised" />
        <p className="relative flex items-center gap-1.5 text-[12px] font-medium text-ink-5"><FileText className="h-3.5 w-3.5" aria-hidden="true" />Instruction</p>
        <p className="relative mt-2 max-w-4xl whitespace-pre-wrap text-[15px] leading-7 text-ink-1">{routine.objective}</p>
        <ul className="relative mt-4 flex flex-wrap gap-2">
          <Tag icon={CalendarClock}>{scheduleWords(routine)}</Tag>
          <Tag icon={ShieldCheck} title={PERMISSION_HELP[routine.permission]}>{PERMISSION_LABEL[routine.permission]}</Tag>
          <Tag icon={Bell}>{NOTIFY_LABEL[routine.notify]}</Tag>
        </ul>
      </div>
      <dl className="grid grid-cols-2 divide-line border-t border-line md:grid-cols-4 md:divide-x [&>div:nth-child(n+3)]:border-t [&>div:nth-child(n+3)]:border-line md:[&>div:nth-child(n+3)]:border-t-0">
        {stats.map((stat) => (
          <div key={stat.label} className="px-6 py-3.5">
            <dt className="text-[12px] font-medium text-ink-5">{stat.label}</dt>
            <dd className="mt-1 flex items-center gap-2 font-display text-[20px] font-semibold leading-7 tabular-nums text-ink-1">{stat.dot ? <span aria-hidden="true" className={cn("h-2 w-2 rounded-full", stat.dot)} /> : null}<AnimatedFigure value={stat.value} /></dd>
            <dd className="truncate text-[12.5px] text-ink-4">{stat.hint}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function Tag({ icon: Icon, title, children }: { icon: typeof Bell; title?: string; children: ReactNode }) {
  return <li className="inline-flex items-center gap-1.5 rounded-full border border-line bg-raised px-3 py-1 text-[12.5px] font-medium text-ink-2 shadow-[0_1px_2px_rgba(16,24,40,0.04)]" title={title}><Icon className="h-3.5 w-3.5 text-ink-5" aria-hidden="true" />{children}</li>;
}

function SectionHead({ icon: Icon, title, note, action }: { icon: typeof Bell; title: string; note?: string; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
      <h2 className="flex items-center gap-2 text-[13px] font-semibold text-ink-1"><span aria-hidden="true" className="grid h-6 w-6 place-items-center rounded-md bg-surface-subtle text-ink-4 ring-1 ring-line"><Icon className="h-3.5 w-3.5" /></span>{title}{note ? <span className="text-[12px] font-medium text-ink-5">· {note}</span> : null}</h2>
      {action}
    </div>
  );
}

/** One run on the timeline: a dot on a rail, when it ran, what it found, and its cost. */
function TimelineRun({ run, last }: { run: RoutineRun; last?: boolean }) {
  return (
    <li className="relative pl-6">
      {!last ? <span aria-hidden="true" className="absolute left-[5px] top-5 h-[calc(100%-8px)] w-px bg-line" /> : null}
      <span aria-hidden="true" className={cn("absolute left-0 top-[18px] h-[11px] w-[11px] rounded-full ring-[3px] ring-raised", RUN_DOT[run.status] || "bg-ink-5")} />
      <Link to={`/tasks/${encodeURIComponent(run.taskId)}`} className="group -mx-2 flex items-center gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-surface-tint">
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 text-[13.5px]">
            <span className="font-medium text-ink-1">{formatAbsoluteTime(run.createdAt)}</span>
            <span className="text-ink-5">{formatRelativeTime(run.createdAt)}</span>
            <span className={cn("text-[12.5px] font-medium", run.status === "failed" ? "text-rose-700" : run.status === "waiting" ? "text-amber-800" : "text-ink-3")}>{TASK_STATUS_LABEL[run.status]}</span>
            {run.test ? <span className="rounded-full border border-line bg-surface-subtle px-1.5 text-[11px] font-semibold text-ink-4">Test</span> : null}
          </span>
          {run.summary ? <span className="mt-0.5 block truncate text-[13px] text-ink-3" title={run.summary}>{run.summary}</span> : null}
        </span>
        {run.costUsd ? <span className="shrink-0 text-[12.5px] tabular-nums text-ink-5">{usd(run.costUsd)}</span> : null}
        <ChevronRight className="h-4 w-4 shrink-0 text-ink-5 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
      </Link>
    </li>
  );
}
