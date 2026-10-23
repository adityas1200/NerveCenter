import { useQuery } from "@tanstack/react-query";
import { CalendarClock, Eye, History, Hand, MousePointerClick, Pause, Play, Plus, ShieldCheck, Trash2, Zap, type LucideIcon } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { routineKeys, routinesApi, type Routine } from "@/api/routines";
import { PERMISSION_HELP, PERMISSION_LABEL, TASK_STATUS_LABEL, type TaskPermission } from "@/api/tasks";
import { AGENT_NAME, useAgentScreen } from "@/components/ops/agentPanelContext";
import { ListToolbar } from "@/components/ops/ListToolbar";
import { OpsPage } from "@/components/ops/OpsPage";
import { OverflowMenu } from "@/components/ops/OverflowMenu";
import { Pager } from "@/components/ops/Pager";
import { RefreshButton } from "@/components/ops/RefreshButton";
import { CompactEmptyState, QueryState } from "@/components/ops/StatePanels";
import { Button, Card, Switch, formatRelativeTime, SearchInput, confirmAction } from "@/components/ui";
import { cn } from "@/lib/utils";
import { RoutineDialog } from "./RoutineDialog";
import { scheduleWords } from "./routineText";
import { useAction } from "@/lib/useAction";
import { GRID_PAGE_SIZES, usePager } from "@/lib/usePager";

/**
 * Routines: work Sonic does on a schedule, as a grid of cards: name and schedule, when it runs next,
 * how the last run went, what it may change, an on/off switch and Run now. The card body opens the routine.
 */

export function RoutinesPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const query = useQuery({ queryKey: routineKeys.all, queryFn: ({ signal }) => routinesApi.list(signal), refetchInterval: false });
  const items = useMemo(() => { const term = search.trim().toLowerCase(); return (query.data?.items ?? []).filter((routine) => !term || `${routine.title} ${routine.objective} ${scheduleWords(routine)}`.toLowerCase().includes(term)); }, [query.data?.items, search]);
  useAgentScreen({ visible: items.map((routine) => `${routine.name} (${scheduleWords(routine)}, ${routine.status})`), summary: `${items.length} routines` });
  const pager = usePager(items.length, { sizes: GRID_PAGE_SIZES, resetKey: search.trim() });
  const rows = pager.slice(items);
  const run = useAction({
    mutationFn: (name: string) => routinesApi.run(name),
    invalidate: [routineKeys.all],
    success: ["Routine started", `${AGENT_NAME} is running it now.`],
    onSuccess: (task) => navigate(`/tasks/${encodeURIComponent(task.id)}`),
    error: "Routine not started",
  });
  const toggle = useAction({
    mutationFn: ({ name, enabled }: { name: string; enabled: boolean }) => enabled ? routinesApi.resume(name) : routinesApi.pause(name),
    invalidate: [routineKeys.all],
    success: (routine) => (routine.enabled ? "Routine resumed" : "Routine paused"),
    error: "Not changed",
  });
  const remove = useAction({
    mutationFn: (name: string) => routinesApi.remove(name),
    invalidate: [routineKeys.all],
    success: "Routine deleted",
    error: "Not deleted",
  });
  return (
    <OpsPage
      title="Routines"
      actions={<RefreshButton autoRefresh onClick={() => void query.refetch({ cancelRefetch: false })} busy={query.isFetching} updatedAt={query.dataUpdatedAt} />}
    >
      <div className="space-y-4">
        <ListToolbar className="justify-between gap-3">
          <SearchInput className="w-full max-w-md" label="Search routines" value={search} onValueChange={setSearch} />
          <div className="flex items-center gap-2">
            <Button variant="primary" size="sm" onClick={() => setCreating(true)}><Plus className="h-4 w-4" />New routine</Button>
          </div>
        </ListToolbar>
        <QueryState query={query} tiles={0}>
          {rows.length ? (
            <div className="space-y-4">
                <ol className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
                  {rows.map((routine, index) => <RoutineCard index={index} key={routine.name} routine={routine} running={run.isPending && run.variables === routine.name} onRun={() => run.mutate(routine.name)} onOpen={() => navigate(`/routines/${encodeURIComponent(routine.name)}`)} onOpenLastRun={() => { if (routine.lastRun) navigate(`/tasks/${encodeURIComponent(routine.lastRun.taskId)}`); }} onToggle={() => toggle.mutate({ name: routine.name, enabled: !routine.enabled })} onDelete={() => { void confirmAction({ title: `Delete "${routine.title}"?`, description: "The routine stops running. Its past runs stay in Tasks.", confirmLabel: "Delete routine", destructive: true }).then((ok) => { if (ok) remove.mutate(routine.name); }); }} />)}
                </ol>
                {/* The bar hides itself while everything fits; the frame goes with it. */}
                {items.length > GRID_PAGE_SIZES[0] ? <Card className="overflow-hidden"><Pager {...pager.pagerProps} noun="routines" /></Card> : null}
            </div>
          ) : <Card><CompactEmptyState className="justify-center px-4 py-10">{query.data?.items.length ? "No routines match" : "No routines yet"}</CompactEmptyState></Card>}
        </QueryState>
      </div>
      <RoutineDialog open={creating} onOpenChange={setCreating} />
    </OpsPage>
  );
}

/** What a routine may change, one icon per level. */
const PERMISSION_ICON: Record<TaskPermission, { icon: LucideIcon; color: string }> = {
  "read-only": { icon: Eye, color: "text-slate-500" },
  policy: { icon: ShieldCheck, color: "text-indigo-500" },
  ask: { icon: Hand, color: "text-amber-500" },
  allow: { icon: Zap, color: "text-emerald-500" },
};

/** "in 18 hours", "Paused", "When started": the next-run line on a card. */
function nextRun(routine: Routine): string {
  if (routine.status === "running") return "Running now";
  if (routine.status === "error") return routine.scheduleError || "Schedule error";
  if (!routine.enabled) return "Paused";
  if (routine.nextRunAt) return formatRelativeTime(routine.nextRunAt);
  return routine.trigger.type === "manual" ? "When started" : "Not scheduled";
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return <div className="flex items-center justify-between gap-3 py-1.5"><dt className="shrink-0 text-[12.5px] text-ink-4">{label}</dt><dd className="min-w-0 truncate text-right text-[13px] font-medium text-ink-2">{children}</dd></div>;
}

/**
 * One routine as a card: the name and schedule open it; a small panel says when it runs next, how the
 * last run went and what it may change; the footer switches it on or off and runs it now.
 */
function RoutineCard({ routine, index, running, onRun, onOpen, onOpenLastRun, onToggle, onDelete }: { routine: Routine; index: number; running: boolean; onRun: () => void; onOpen: () => void; onOpenLastRun: () => void; onToggle: () => void; onDelete: () => void }) {
  const last = routine.lastRun;
  const outcome = last ? TASK_STATUS_LABEL[last.status] : null;
  const schedule = scheduleWords(routine);
  const manual = routine.trigger.type === "manual";
  const permission = PERMISSION_ICON[routine.permission];
  return (
    <li className={cn("group/card motion-surface flex flex-col overflow-hidden rounded-2xl border border-line bg-raised shadow-card hover:-translate-y-0.5 hover:border-line-strong hover:shadow-card-hover", !routine.enabled && "bg-raised/80", index < 12 && "stagger-in")} style={index < 12 ? { animationDelay: `${index * 35}ms` } : undefined}>
      <button type="button" onClick={onOpen} className="flex flex-1 flex-col px-5 pb-4 pt-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand/25">
        <span className="flex items-start gap-3">
          <span aria-hidden="true" className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-xl ring-1 transition-colors", routine.enabled ? "bg-brand-soft text-brand ring-brand/15" : "bg-surface-subtle text-ink-5 ring-line")}>
            {manual ? <MousePointerClick className="h-[18px] w-[18px]" /> : <CalendarClock className="h-[18px] w-[18px]" />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[15px] font-semibold text-ink-1 transition-colors group-hover/card:text-brand-indigo">{routine.title}</span>
            <span className="mt-0.5 block truncate text-[13px] text-ink-4" title={schedule}>{schedule}</span>
          </span>
        </span>
        <span className="mt-2.5 line-clamp-2 min-h-[40px] text-[13px] leading-5 text-ink-3" title={routine.objective}>{routine.objective}</span>
        <dl className="mt-3 divide-y divide-line rounded-xl border border-line bg-surface-tint/60 px-3">
          <Detail label="Next run"><span className={routine.status === "error" ? "text-rose-700" : !routine.enabled ? "text-ink-4" : undefined}>{nextRun(routine)}</span></Detail>
          <Detail label="Last run">
            {last && outcome ? (
              <span className="inline-flex max-w-full items-center gap-1.5">
                <span aria-hidden="true" className={cn("h-1.5 w-1.5 shrink-0 rounded-full", last.status === "failed" ? "bg-rose-500" : last.status === "waiting" ? "bg-amber-500" : last.status === "done" ? "bg-emerald-500" : "bg-ink-5")} />
                <span className="text-ink-4">{formatRelativeTime(last.createdAt)}</span>
                <span className={cn("truncate", last.status === "failed" ? "text-rose-700" : last.status === "waiting" ? "text-amber-800" : "text-ink-2")} title={last.summary || outcome}>{outcome}{last.summary ? ` · ${last.summary}` : ""}</span>
              </span>
            ) : <span className="text-ink-4">Not run yet</span>}
          </Detail>
          <Detail label="Permission"><span className="inline-flex items-center gap-1.5" title={PERMISSION_HELP[routine.permission]}><permission.icon className={cn("h-3.5 w-3.5 shrink-0", permission.color)} aria-hidden="true" />{PERMISSION_LABEL[routine.permission]}</span></Detail>
        </dl>
      </button>
      <div className="flex items-center justify-between gap-2 border-t border-line bg-surface-tint/40 px-5 py-2.5">
        <label className="flex cursor-pointer items-center gap-2 text-[12.5px] font-medium text-ink-3">
          <Switch checked={routine.enabled} onCheckedChange={onToggle} aria-label={routine.enabled ? `Pause ${routine.title}` : `Resume ${routine.title}`} />
          {routine.enabled ? "On" : "Paused"}
        </label>
        <span className="flex items-center gap-1">
          <Button size="xs" variant="outline" className="h-7 gap-1 rounded-full border border-line bg-raised px-3 text-[12.5px] font-medium text-ink-2 transition-all duration-150 hover:border-brand/30 hover:bg-brand-soft hover:text-brand-indigo active:scale-[0.97]" disabled={running || routine.status === "running"} onClick={onRun}><Play className="h-3.5 w-3.5 text-brand" />{running ? "Starting" : "Run now"}</Button>
          <OverflowMenu label={`Actions for ${routine.title}`} items={[
            { label: "Open", icon: Eye, onSelect: onOpen },
            { label: routine.enabled ? "Pause" : "Resume", icon: routine.enabled ? Pause : Play, onSelect: onToggle },
            last ? { label: "Open last run", icon: History, onSelect: onOpenLastRun } : null,
            { label: "Delete", icon: Trash2, destructive: true, divider: true, onSelect: onDelete },
          ]} />
        </span>
      </div>
    </li>
  );
}
