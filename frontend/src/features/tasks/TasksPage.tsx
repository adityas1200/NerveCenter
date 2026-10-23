import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Archive, ArchiveRestore, Eye, Plus, Trash2 } from "lucide-react";
import { useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { TASK_STATUS_LABEL, TASK_TYPE_LABEL, startedBy, tasksApi, type Task, type TaskStatus, taskKeys } from "@/api/tasks";
import { AgentMark, type AgentMarkState } from "@/components/ops/AgentMark";
import { AGENT_NAME, useAgentPanel, useAgentScreen } from "@/components/ops/agentPanelContext";
import { EmptyState } from "@/components/ops/EmptyState";
import { ListToolbar } from "@/components/ops/ListToolbar";
import { OpsPage } from "@/components/ops/OpsPage";
import { OpsBody, OpsHead, OpsRow, OpsTable, OpsTd, OpsTh } from "@/components/ops/OpsTable";
import { OverflowMenu } from "@/components/ops/OverflowMenu";
import { Pager } from "@/components/ops/Pager";
import { RefreshButton } from "@/components/ops/RefreshButton";
import { CompactEmptyState, QueryState } from "@/components/ops/StatePanels";
import { Button, Card, Tabs, TabsList, TabsTrigger, TableCell, TableRow, formatRelativeTime, SearchInput, confirmAction } from "@/components/ui";
import { cn } from "@/lib/utils";
import { useAction } from "@/lib/useAction";
import { useUrlFilters } from "@/lib/useUrlFilters";
import { LIST_PAGE_SIZES, usePager } from "@/lib/usePager";

/**
 * Every agent session, newest first, grouped by what matters to the reader: running now, waiting on
 * you, earlier. One table with fixed columns (state, task, type, started by, status, updated) so the
 * groups line up and every row reads the same way.
 * The type filter and search live in the URL (`?type=`, `?q=`), like the Tickets page, so a filtered
 * list can be linked to and survives a refresh.
 */

type TaskFilter = "all" | "ticket" | "routine" | "adhoc" | "alert";
const TASK_FILTERS: TaskFilter[] = ["all", "ticket", "routine", "adhoc", "alert"];
const isTaskFilter = (value: string | null): value is TaskFilter => TASK_FILTERS.includes(value as TaskFilter);
const GROUPS: Array<{ key: string; label: string; match: (task: Task) => boolean }> = [
  { key: "waiting", label: "Waiting on you", match: (task) => task.status === "waiting" },
  { key: "running", label: "Running", match: (task) => task.status === "running" || task.status === "queued" },
  { key: "earlier", label: "Earlier", match: () => true },
];

export function TasksPage() {
  const navigate = useNavigate();
  const panel = useAgentPanel();
  const remove = useAction({
    mutationFn: (id: string) => tasksApi.remove(id),
    invalidate: [taskKeys.all],
    success: "Task deleted",
    error: "Not deleted",
  });
  const archive = useAction({
    mutationFn: ({ id, archived }: { id: string; archived: boolean }) => tasksApi.setArchived(id, archived),
    invalidate: [taskKeys.all],
    success: (_result, { archived }) => [archived ? "Task archived" : "Task restored", archived ? "It's out of the way; find it again from Archived." : "It's back in the list."],
    error: "Not saved",
  });
  const urlFilters = useUrlFilters();
  const searchParams = urlFilters.params;
  const rawType = searchParams.get("type");
  const type: TaskFilter = isTaskFilter(rawType) ? rawType : "all";
  const search = searchParams.get("q") || "";
  const showArchived = searchParams.get("archived") === "1";
  const setParam = (key: "type" | "q", value: string) => urlFilters.set(key, value);
  const selectTab = (value: string) => urlFilters.update((next) => {
    if (value === "archived") { next.set("archived", "1"); next.delete("type"); }
    else { next.delete("archived"); if (value === "all") next.delete("type"); else next.set("type", value); }
  });
  const resetKey = JSON.stringify({ search: search.trim(), type, showArchived });
  const sizeValue = Number(searchParams.get("size"));
  const size = LIST_PAGE_SIZES.includes(sizeValue as typeof LIST_PAGE_SIZES[number]) ? sizeValue : LIST_PAGE_SIZES[0];
  const requestedPage = Math.max(1, Number(searchParams.get("page")) || 1);
  const offset = (requestedPage - 1) * size;
  const query = useQuery({ queryKey: taskKeys.list({ type, archived: showArchived, search: search.trim(), limit: size, offset }), queryFn: ({ signal }) => tasksApi.list({ type, archived: showArchived ? "true" : undefined, q: search.trim(), limit: size, offset }, signal), refetchInterval: false, placeholderData: keepPreviousData });
  const pageItems = useMemo(() => query.data?.items ?? [], [query.data?.items]);
  const total = query.data?.total ?? 0;
  const pagePager = usePager(total, { resetKey });
  useAgentScreen({ visible: pageItems.slice(0, 60).map((task) => `${task.id} ${task.title} (${task.status})`), summary: `${total} tasks listed` });
  const grouped = useMemo(() => {
    const remaining = [...pageItems];
    return GROUPS.map((group) => { const picked = remaining.filter(group.match); for (const task of picked) remaining.splice(remaining.indexOf(task), 1); return { ...group, items: picked }; }).filter((group) => group.items.length);
  }, [pageItems]);
  const active = query.data?.active ?? 0;
  const waiting = query.data?.waiting ?? 0;

  return (
    <OpsPage title={showArchived ? "Tasks · Archived" : "Tasks"} count={[query.data ? `${total}${showArchived ? " archived" : ""} tasks` : "", !showArchived && active ? `${active} running` : "", !showArchived && waiting ? `${waiting} waiting on you` : ""].filter(Boolean).join(" · ") || undefined} actions={<RefreshButton autoRefresh onClick={() => void query.refetch({ cancelRefetch: false })} busy={query.isFetching} />}>
      <div className="space-y-4">
        <ListToolbar>
          <SearchInput className="min-w-[240px] flex-1" label="Search tasks" value={search} onValueChange={(value) => setParam("q", value)} />
          {/* Archived is the last tab rather than its own button: picking it shows every archived task, any type. */}
          <Tabs value={showArchived ? "archived" : type} onValueChange={selectTab}>
            <TabsList aria-label="Task type"><TabsTrigger value="all">All</TabsTrigger><TabsTrigger value="ticket">Tickets</TabsTrigger><TabsTrigger value="routine">Routines</TabsTrigger><TabsTrigger value="alert">Alerts</TabsTrigger><TabsTrigger value="adhoc">{TASK_TYPE_LABEL.adhoc}</TabsTrigger><TabsTrigger value="archived">Archived</TabsTrigger></TabsList>
          </Tabs>
          <div className="flex items-center gap-2">
            <Button asChild variant="primary" size="sm"><Link to="/tasks/new"><Plus className="h-4 w-4" />New task</Link></Button>
          </div>
        </ListToolbar>
        <QueryState query={query}>
          {grouped.length ? (
            <Card className="overflow-hidden">
              <OpsTable minWidth={860}>
                <OpsHead>
                  {/* OpsTd pads 16px each side; a column narrower than its content plus that
                      padding doesn't shrink the content under table-fixed, it just spills the
                      state dot/menu button out past the column's own boundary. */}
                  <OpsTh width="56px"><span className="sr-only">State</span></OpsTh>
                  <OpsTh>Task</OpsTh>
                  <OpsTh width="110px" className="hidden md:table-cell">Type</OpsTh>
                  <OpsTh width="220px" className="hidden lg:table-cell">Started by</OpsTh>
                  <OpsTh width="130px" className="hidden md:table-cell">Status</OpsTh>
                  <OpsTh width="112px" align="right">Updated</OpsTh>
                  <OpsTh width="72px"><span className="sr-only">Actions</span></OpsTh>
                </OpsHead>
                {(() => { let rowIndex = 0; return grouped.map((group) => (
                  <OpsBody key={group.key} aria-label={group.label}>
                    <TableRow className="hover:bg-transparent">
                      <TableCell colSpan={7} className="bg-surface-subtle/70 px-4 py-1.5 text-left text-[12px] font-medium text-ink-5">{group.label} <span className="ml-1 tabular-nums text-ink-5/80">{group.items.length}</span></TableCell>
                    </TableRow>
                    {group.items.map((task) => <TaskRow key={task.id} task={task} index={rowIndex++} onOpen={() => navigate(`/tasks/${encodeURIComponent(task.id)}`)} onDelete={() => { void confirmAction({ title: `Delete "${task.title}"?`, description: "Its conversation and files are removed. This can't be undone.", confirmLabel: "Delete task", destructive: true }).then((ok) => { if (ok) remove.mutate(task.id); }); }} onArchive={() => archive.mutate({ id: task.id, archived: !task.archived })} />)}
                  </OpsBody>
                )); })()}
              </OpsTable>
              <Pager {...pagePager.pagerProps} noun="tasks" />
            </Card>
          ) : total || search.trim() || type !== "all" ? (
            <Card><CompactEmptyState className="justify-center px-4 py-10">{showArchived ? "No archived tasks match" : "No tasks match"}</CompactEmptyState></Card>
          ) : showArchived ? (
            <Card><CompactEmptyState className="justify-center px-4 py-10">No archived tasks</CompactEmptyState></Card>
          ) : (
            <Card>
              <EmptyState illustration="tasks" title="No tasks yet" body={`Ask ${AGENT_NAME} anything on any page, or start a task here.`} action={<Button onClick={() => panel.setOpen(true)}><AgentMark size={20} />Ask {AGENT_NAME}</Button>} />
            </Card>
          )}
        </QueryState>
      </div>
    </OpsPage>
  );
}

/** Sonic's mark state for a task: running and queued think, waiting holds, done is solid, failed and stopped are plain. */
// eslint-disable-next-line react-refresh/only-export-components -- one mapping shared by the list rows and the task header
export function taskMarkState(status: TaskStatus): AgentMarkState {
  if (status === "running" || status === "queued") return "thinking";
  if (status === "waiting") return "waiting";
  if (status === "done") return "done";
  return "idle";
}

/**
 * The task's state, named for screen readers with the status label. Work that is moving or waiting on
 * someone shows Sonic's mark; finished work is a solid dot, so twenty done rows are not twenty logos.
 */
export function TaskStateDot({ status, className }: { status: TaskStatus; className?: string }) {
  const label = TASK_STATUS_LABEL[status];
  const settled = status === "done" || status === "failed" || status === "cancelled";
  return (
    <span className={cn("inline-flex h-4 w-4 shrink-0 items-center justify-center", className)} role="img" aria-label={label} title={label}>
      {settled ? <span className={cn("h-2 w-2 rounded-full", status === "done" ? "bg-emerald-500" : status === "failed" ? "bg-rose-500" : "border border-ink-5")} /> : <AgentMark size={16} state={taskMarkState(status)} />}
    </span>
  );
}

/**
 * One task per row, every column in its own place: state, title (with the failure sentence under
 * it), type, who or what started it, status, when. The whole row opens the task; the title is the
 * focusable control for keyboards; the menu on the right holds the secondary actions.
 *
 * Built on the same OpsTable/OpsRow/OpsTd the rest of the app's lists use (Tickets, Pipelines, Data
 * Quality): a uniform row height and truncation everywhere, and horizontal overflow contained to a
 * scrollbar inside the card instead of pushing the whole page sideways.
 */
function TaskRow({ task, index, onOpen, onDelete, onArchive }: { task: Task; index: number; onOpen: () => void; onDelete: () => void; onArchive: () => void }) {
  // A technical failure (a path, a method, an OS code) reads as one sentence in the list; the raw text stays in the tooltip.
  const rawError = task.status === "failed" ? task.error || "" : "";
  const technical = /\b(GET|POST|PUT|PATCH|DELETE)\s|https?:\/\/|[A-Za-z]:\\|\/\w+\/|\bE[A-Z]{3,}\b|failed \(|\bat\s+\w+\.\w+/.test(rawError);
  const summary = task.status === "failed" ? (technical || !rawError ? "Stopped with an error" : rawError) : "";
  const live = task.status === "running" || task.status === "queued";
  const started = startedBy(task);
  const detail = started.kind === "routine" ? started.label.replace(/^Routine · /, "") : started.label;
  return (
    <OpsRow index={index} onOpen={onOpen}>
      <OpsTd><TaskStateDot status={task.status} /></OpsTd>
      <OpsTd>
        <button type="button" onClick={(event) => { event.stopPropagation(); onOpen(); }} className="block max-w-full truncate text-left text-[14.5px] font-medium text-ink-1 focus-visible:outline-none" title={task.title}>{task.title}</button>
        {summary ? <span className="mt-0.5 block truncate text-[13px] text-rose-700" title={rawError || undefined}>{summary}</span> : null}
      </OpsTd>
      <OpsTd className="hidden md:table-cell" muted>{TASK_TYPE_LABEL[task.type]}</OpsTd>
      <OpsTd className="hidden lg:table-cell" muted><span title={detail}>{detail}</span></OpsTd>
      <OpsTd className={cn("hidden md:table-cell", task.status === "waiting" ? "font-medium text-amber-700" : task.status === "failed" ? "text-rose-700" : "text-ink-4")}>{TASK_STATUS_LABEL[task.status]}</OpsTd>
      <OpsTd align="right" muted className="tabular-nums text-[12.5px]">{formatRelativeTime(task.updatedAt)}</OpsTd>
      <OpsTd align="right">
        <OverflowMenu label={`Actions for ${task.title}`} items={[
          { label: "Open", icon: Eye, onSelect: onOpen },
          { label: task.archived ? "Restore" : (live ? "Stop it first to archive" : "Archive"), icon: task.archived ? ArchiveRestore : Archive, disabled: !task.archived && live, onSelect: onArchive },
          { label: live ? "Stop it first to delete" : "Delete", icon: Trash2, destructive: true, divider: true, disabled: live, onSelect: onDelete },
        ]} />
      </OpsTd>
    </OpsRow>
  );
}
