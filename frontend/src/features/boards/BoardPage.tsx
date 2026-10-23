import { refreshAfterWrite } from "@/lib/refreshAfterWrite";
import { keepPreviousData, useMutation, useQuery, useIsFetching, useQueryClient } from "@tanstack/react-query";
import { Check, Eye, EyeOff, LayoutGrid, Pencil, Plus, RotateCcw, SlidersHorizontal, Trash2 } from "lucide-react";
import { useContext, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { boardKeys, boardsApi, type Board, type BoardFilter, type BoardFilterValues, type BoardWidget } from "@/api/boards";
import { tasksApi, type Task, taskKeys } from "@/api/tasks";
import { AGENT_NAME, AgentPanelContext, useAgentScreen, useAskSonic, useCanChat } from "@/components/ops/agentPanelContext";
import { widgetPrompt, widgetSelection, type WidgetPoint } from "./boardSelection";
import { AgentMark } from "@/components/ops/AgentMark";
import { OpsPage } from "@/components/ops/OpsPage";
import type { MenuEntry } from "@/components/ops/OverflowMenu";
import { RefreshButton } from "@/components/ops/RefreshButton";
import { QueryState } from "@/components/ops/StatePanels";
import { AlertDialog, Button, Card, Dialog, RelativeTime, DialogContent, DialogFooter, DialogHeader, DialogTitle, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, useToast } from "@/components/ui";
import { TimeRangePicker } from "@/components/ops/TimeRangePicker";
import { BOARD_RANGE_PRESETS, isBoardPreset, type RangeState as BoardRange } from "@/lib/timeRange";
import { WidgetCard, WidgetSkeleton, nextSize, type WidgetTransition } from "./BoardWidgets";
import { PersonAvatar } from "@/components/ops/PersonAvatar";
import { plural } from "@/lib/utils";
import { useAction } from "@/lib/useAction";
import { useUrlFilters } from "@/lib/useUrlFilters";
import { FRESH } from "@/api/queryPolicy";

/**
 * One board. Header: back to Boards and the title. Under it a summary card in the board's accent
 * (status, description, widget/filter/view counts, owner and last update), then the board's filters (always the period, then one control per select or text filter), all in the URL so
 * a link shares the exact view. The grid draws whatever the backend computed for those filters.
 * Builders improve the board through the Ask Sonic panel; the ••• menu holds publish, layout, rename and delete.
 * While a Sonic task for this board runs, the page polls the spec and data every 4 s and shows a
 * banner; new widgets rise in, changed charts replay, removed widgets fade out.
 */

const ALL = "all";

/** Live-build polling: the spec and data every 4 s while Sonic works; running tasks every 5 s then, else every 30 s. */
const FINISHED_BANNER_MS = 6_000;

interface BoardBuild { active: boolean; task: Task | null }

/** A running task is building this board when its page selection is the board or its title names the board. */
function isBuildingBoard(task: Task, boardId: string, title: string | undefined): boolean {
  const page = task.context?.page;
  if (page?.selection?.id === boardId || page?.open?.id === boardId) return true;
  return Boolean(title) && task.title.toLowerCase().includes(String(title).toLowerCase());
}

/** A question about one widget is an investigation, not a build (SPEC-boards FR-9, SPEC-tasks-12). */
function buildWords(task: Task): string {
  const selection = task.context?.page?.selection;
  const widget = selection?.kind === "board_widget" ? String(selection.detail?.widgetTitle || "") : "";
  return widget ? `${AGENT_NAME} is looking into ${widget}` : `${AGENT_NAME} is building this board`;
}

function useBoardBuild(boardId: string, title: string | undefined): BoardBuild {
  const running = useQuery({
    queryKey: [...taskKeys.all, "running"],
    queryFn: ({ signal }) => tasksApi.list({ status: "running", limit: 20 }, signal),
    staleTime: FRESH.live,
    refetchInterval: false,
  });
  const task = (running.data?.items ?? []).find((item) => isBuildingBoard(item, boardId, title)) ?? null;
  return { active: Boolean(task), task };
}

export function BoardPage() {
  const { boardId = "" } = useParams();
  const query = useQuery({ queryKey: boardKeys.detail(boardId), queryFn: ({ signal }) => boardsApi.get(boardId, signal), retry: false });
  const build = useBoardBuild(boardId, query.data?.title);
  if (query.isPending || query.error || !query.data) {
    return (
      <OpsPage title={query.data?.title ?? "Board"} back={{ to: "/boards", label: "Boards" }}>
        <QueryState query={query} tiles={4}><span /></QueryState>
      </OpsPage>
    );
  }
  return <BoardView board={query.data} build={build} />;
}

/**
 * Which widgets are new since the last spec and which have just gone. New ids animate in for a
 * moment; removed widgets stay a moment while they fade. Every add, change and removal counts toward
 * "n widgets changed" until `reset` is called.
 */
function useWidgetTransitions(widgets: BoardWidget[]) {
  const previous = useRef<BoardWidget[] | null>(null);
  const [fresh, setFresh] = useState<string[]>([]);
  const [leaving, setLeaving] = useState<BoardWidget[]>([]);
  const changed = useRef(new Set<string>());
  useEffect(() => {
    const before = previous.current;
    previous.current = widgets;
    if (!before) return undefined;
    const ids = new Set(widgets.map((widget) => widget.id));
    const beforeById = new Map(before.map((widget) => [widget.id, JSON.stringify(widget)]));
    const added = widgets.filter((widget) => !beforeById.has(widget.id));
    const removed = before.filter((widget) => !ids.has(widget.id));
    const edited = widgets.filter((widget) => beforeById.has(widget.id) && beforeById.get(widget.id) !== JSON.stringify(widget));
    for (const widget of [...added, ...removed, ...edited]) changed.current.add(widget.id);
    if (!added.length && !removed.length) return undefined;
    const timers: number[] = [];
    if (added.length) {
      setFresh((current) => [...current, ...added.map((widget) => widget.id)]);
      timers.push(window.setTimeout(() => setFresh((current) => current.filter((id) => !added.some((widget) => widget.id === id))), 1_000));
    }
    if (removed.length) {
      setLeaving((current) => [...current.filter((widget) => !ids.has(widget.id)), ...removed]);
      timers.push(window.setTimeout(() => setLeaving((current) => current.filter((widget) => !removed.some((gone) => gone.id === widget.id))), 300));
    }
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [widgets]);
  const transitionOf = (widget: BoardWidget): WidgetTransition => (fresh.includes(widget.id) ? "enter" : null);
  return { leaving, transitionOf, changedCount: () => changed.current.size, reset: () => changed.current.clear() };
}

/** The reader's picks from the URL: the range (with from/to for custom) and one value per other filter. */
function readFilters(board: Board, params: URLSearchParams): { range: BoardRange; values: BoardFilterValues } {
  const rangeFilter = board.filters.find((filter) => filter.type === "range");
  const fromUrl = params.get("range");
  const preset = isBoardPreset(fromUrl) ? fromUrl : isBoardPreset(rangeFilter?.default) ? rangeFilter.default : "7d";
  const range: BoardRange = preset === "custom" ? { preset, from: params.get("from") ?? undefined, to: params.get("to") ?? undefined } : { preset };
  const values: BoardFilterValues = { range: preset, ...(preset === "custom" ? { from: range.from, to: range.to } : {}) };
  for (const filter of board.filters) {
    if (filter.type === "range") continue;
    const picked = params.get(filter.key);
    if (filter.type === "select") values[filter.key] = picked && filter.options?.includes(picked) ? picked : ALL;
    else if (picked !== null) values[filter.key] = picked;
    else if (filter.default) values[filter.key] = filter.default;
  }
  return { range, values };
}

function BoardView({ board, build }: { board: Board; build: BoardBuild }) {
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const askSonic = useAskSonic();
  const panel = useContext(AgentPanelContext);
  const urlFilters = useUrlFilters();
  const searchParams = urlFilters.params;
  const [editing, setEditing] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const canEdit = Boolean(board.canEdit);
  const canChat = useCanChat();
  const { range, values } = readFilters(board, searchParams);

  // The first load counts as a view; refetches and filter changes do not.
  const viewed = useRef(false);
  const refreshing = useIsFetching({ queryKey: boardKeys.detail(board.id) }) > 0;
  const data = useQuery({
    queryKey: boardKeys.data(board.id, values),
    queryFn: async ({ signal }) => { const result = await boardsApi.data(board.id, values, { countView: !viewed.current }, signal); viewed.current = true; return result; },
    staleTime: build.active ? 0 : FRESH.medium,
    refetchInterval: false,
    // A filter change keeps the current figures on screen while the new ones load, so numbers run
    // from old to new and charts reshape instead of dropping back to skeletons.
    placeholderData: keepPreviousData,
  });
  // Which filters the figures on screen belong to. A widget lights up when its data changes under
  // the same filters (a refresh, Sonic's build), not when the reader changed a filter themselves.
  const filterKey = JSON.stringify(values);
  const shownKey = useRef(filterKey);
  if (data.data && !data.isPlaceholderData) shownKey.current = filterKey;

  const transitions = useWidgetTransitions(board.widgets);
  // When the build ends, say what changed for a moment.
  const [finished, setFinished] = useState<number | null>(null);
  const wasBuilding = useRef(false);
  useEffect(() => {
    if (build.active) {
      if (!wasBuilding.current) transitions.reset();
      wasBuilding.current = true;
      return undefined;
    }
    if (!wasBuilding.current) return undefined;
    wasBuilding.current = false;
    setFinished(transitions.changedCount());
    transitions.reset();
    const timer = window.setTimeout(() => setFinished(null), FINISHED_BANNER_MS);
    return () => window.clearTimeout(timer);
    // The transitions helpers are stable enough for this: only the build flag should trigger it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [build.active]);

  useEffect(() => { if (!canEdit) setEditing(false); }, [canEdit]);

  useAgentScreen({
    open: { kind: "board", id: board.id, title: board.title },
    visible: board.widgets.map((widget) => widget.id),
    summary: `${board.title}: ${plural(board.widgets.length, "widget")}, ${board.status}`,
  });

  const setParam = urlFilters.set;
  const setRange = (next: BoardRange) => urlFilters.update((params) => {
    params.set("range", next.preset);
    if (next.preset === "custom") { if (next.from) params.set("from", next.from); else params.delete("from"); if (next.to) params.set("to", next.to); else params.delete("to"); }
    else { params.delete("from"); params.delete("to"); }
  });

  const applyBoard = (next: Board) => { queryClient.setQueryData(boardKeys.detail(board.id), next); void refreshAfterWrite(queryClient, { queryKey: boardKeys.list() }); };
  const failed = (title: string) => (error: unknown) => toast.error(title, error instanceof Error ? error.message : "Try again.");

  const publish = useAction({
    mutationFn: (publish: boolean) => (publish ? boardsApi.publish(board.id) : boardsApi.unpublish(board.id)),
    success: (_next, published) => [published ? "Board published" : "Board unpublished", published ? "Everyone can open it now." : "Only you and admins can open it."],
    onSuccess: applyBoard,
    error: "Board not changed",
  });
  const rename = useAction({
    mutationFn: (input: { title: string; description: string }) => boardsApi.update(board.id, input),
    success: "Board renamed",
    onSuccess: (next) => { applyBoard(next); setRenaming(false); },
    error: "Board not renamed",
  });
  const remove = useMutation({
    mutationFn: () => boardsApi.remove(board.id),
    onSuccess: async () => { queryClient.removeQueries({ queryKey: boardKeys.detail(board.id) }); await refreshAfterWrite(queryClient, { queryKey: boardKeys.list() }); toast.success("Board deleted"); navigate("/boards"); },
    onError: failed("Board not deleted"),
  });
  // Layout edits apply at once and roll back if the save fails.
  const layout = useMutation({
    mutationFn: (widgets: BoardWidget[]) => boardsApi.update(board.id, { widgets }),
    onMutate: async (widgets) => {
      await queryClient.cancelQueries({ queryKey: boardKeys.detail(board.id) });
      const previous = queryClient.getQueryData<Board>(boardKeys.detail(board.id));
      queryClient.setQueryData<Board>(boardKeys.detail(board.id), (current) => (current ? { ...current, widgets } : current));
      return { previous };
    },
    onError: (error, _widgets, context) => { if (context?.previous) queryClient.setQueryData(boardKeys.detail(board.id), context.previous); failed("Layout not saved")(error); },
    onSuccess: (next) => applyBoard(next),
  });

  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= board.widgets.length) return;
    const widgets = [...board.widgets];
    [widgets[index], widgets[target]] = [widgets[target], widgets[index]];
    layout.mutate(widgets);
  };
  const resize = (index: number) => layout.mutate(board.widgets.map((widget, position) => (position === index ? { ...widget, size: nextSize(widget.size) } : widget)));
  const removeWidget = (index: number) => layout.mutate(board.widgets.filter((_, position) => position !== index));

  const improve = () => askSonic({ kind: "board", id: board.id, title: board.title }, `Help me improve the board "${board.title}". Ask what I want to change, then update it.`);
  const fix = (widget: BoardWidget, error: string) => askSonic({ kind: "board", id: board.id, title: board.title }, `Widget "${widget.title}" on board "${board.title}" shows an error: ${error.replace(/\.\s*$/, "")}. Fix it.`);
  // The panel sends a prompt the moment it opens, so a half sentence cannot be prefilled: the widget
  // goes in as the selection (the panel's "Sees" line names it) and the person types the change.
  const askChange = (widget: BoardWidget) => {
    if (!panel) return;
    panel.setSelection({ kind: "board", id: board.id, title: `${board.title} · widget "${widget.title}"` });
    panel.setOpen(true);
  };
  // SPEC-tasks-12 FR-1 to FR-3: the widget, the filters on screen and the picked point go to Sonic as a reference.
  const askAbout = canChat ? (widget: BoardWidget, point: WidgetPoint | null) => askSonic(widgetSelection(board, widget, values, point), widgetPrompt(widget, point)) : undefined;

  const published = board.status === "published";
  const menu: MenuEntry[] | undefined = canEdit ? [
    { label: published ? "Unpublish" : "Publish", icon: published ? EyeOff : Eye, onSelect: () => publish.mutate(!published), disabled: publish.isPending || (!published && !board.widgets.length) },
    { label: editing ? "Done editing" : "Edit layout", icon: LayoutGrid, onSelect: () => setEditing((current) => !current), disabled: !board.widgets.length && !editing },
    { label: "Rename", icon: Pencil, onSelect: () => setRenaming(true) },
    { label: "Delete", icon: Trash2, destructive: true, divider: true, onSelect: () => setConfirmDelete(true) },
  ] : undefined;

  // Any pick in the URL (the period or another filter) counts as filtered; Reset goes back to the board's defaults.
  const filterKeys = ["range", "from", "to", ...board.filters.filter((filter) => filter.type !== "range").map((filter) => filter.key)];
  const filtered = filterKeys.some((key) => searchParams.has(key));
  const resetFilters = () => urlFilters.clear(...filterKeys);

  const selects = board.filters.filter((filter) => filter.type === "select");
  const texts = board.filters.filter((filter) => filter.type === "text");

  return (
    <OpsPage
      title={board.title}
      back={{ to: "/boards", label: "Boards" }}
      actions={<RefreshButton autoRefresh paused={editing || renaming} onClick={() => { void queryClient.refetchQueries({ queryKey: boardKeys.detail(board.id), type: "active" }, { cancelRefetch: false }); void queryClient.refetchQueries({ queryKey: [...taskKeys.all, "running"], type: "active" }, { cancelRefetch: false }); }} busy={refreshing} updatedAt={data.dataUpdatedAt || null} />}
      primary={canEdit && editing ? <Button size="sm" variant="primary" onClick={() => setEditing(false)}><Check className="h-3.5 w-3.5" />Done</Button> : undefined}
      menu={menu}
    >
      <BoardHero board={board} published={published} />

      <div className="relative mb-4 flex flex-wrap items-center gap-2 overflow-hidden rounded-2xl border border-line bg-raised px-3 py-2.5 shadow-card">
        {data.isPlaceholderData ? <span aria-hidden="true" data-testid="board-loading" className="board-progress absolute inset-x-0 bottom-0 h-0.5" /> : null}
        <span className="mr-1 inline-flex items-center gap-1.5 text-[12px] font-medium text-ink-5"><SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />Filters</span>
        <TimeRangePicker value={range} onChange={setRange} presets={BOARD_RANGE_PRESETS} label="Period" align="start" quickWindows={false} />
        {selects.map((filter) => {
          const current = values[filter.key] ?? ALL;
          return (
            <Select key={filter.key} value={current} onValueChange={(value) => setParam(filter.key, value)}>
              <SelectTrigger className={`h-8 w-[170px] rounded-lg ${current !== ALL ? "border-ink-1" : ""}`} aria-label={`Filter by ${filter.label}`}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{filter.allLabel || "All"}</SelectItem>
                {(filter.options ?? []).map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}
              </SelectContent>
            </Select>
          );
        })}
        {texts.map((filter) => <TextFilter key={filter.key} filter={filter} value={values[filter.key] ?? ""} onCommit={(value) => setParam(filter.key, value)} />)}
        {filtered ? <Button size="xs" variant="ghost" className="group/reset ml-auto text-ink-4 hover:bg-surface-subtle" onClick={resetFilters}><RotateCcw className="h-3.5 w-3.5 transition-transform duration-300 group-hover/reset:-rotate-180" aria-hidden="true" />Reset filters</Button> : null}
      </div>

      {build.active && build.task ? (
        <div role="status" className="relative mb-4 flex items-center gap-2.5 overflow-hidden rounded-xl border border-line bg-raised px-3.5 py-2.5 text-[13px] leading-5 text-ink-3 shadow-card" data-testid="board-building">
          <span aria-hidden="true" className="board-shimmer absolute inset-x-0 bottom-0 h-0.5" />
          <AgentMark state="thinking" size={18} />
          <span className="min-w-0 truncate"><span className="font-medium text-ink-2">{buildWords(build.task)}</span> · {build.task.title}</span>
          <Link to={`/tasks/${encodeURIComponent(build.task.id)}`} className="ml-auto shrink-0 font-medium text-brand hover:text-brand-hover hover:underline">Open task</Link>
        </div>
      ) : finished !== null ? (
        <div role="status" className="mb-4 flex items-center gap-2.5 rounded-xl border border-line bg-raised px-3.5 py-2.5 text-[13px] leading-5 text-ink-3 shadow-card stagger-in" data-testid="board-finished">
          <AgentMark state="done" size={18} />
          <span><span className="font-medium text-ink-2">{AGENT_NAME} finished</span> · {plural(finished, "widget")} changed</span>
        </div>
      ) : null}

      {!board.widgets.length && !transitions.leaving.length ? (
        <Card className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
          <p className="text-[15px] font-semibold text-ink-1">No widgets yet</p>
          <p className="max-w-sm text-[13.5px] leading-5 text-ink-4">{canEdit ? `Tell ${AGENT_NAME} what to show: metrics, charts, tables or notes.` : "Nothing added yet."}</p>
          {canEdit ? <Button size="sm" variant="primary" className="mt-2" onClick={improve}><Plus className="h-4 w-4" aria-hidden="true" />Add one with {AGENT_NAME}</Button> : null}
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4" role="list" aria-label="Widgets" aria-busy={data.isFetching || undefined}>
          {data.isPending || data.isPlaceholderData
            ? board.widgets.map((widget) => <WidgetSkeleton key={widget.id} widget={widget} />)
            : board.widgets.map((widget, index) => (
              <WidgetCard
                key={widget.id}
                widget={widget}
                index={index}
                transition={transitions.transitionOf(widget)}
                dataKey={shownKey.current}
                result={data.error ? { at: "", error: data.error instanceof Error ? data.error.message : "The board data could not be loaded" } : data.data?.widgets[widget.id]}
                onFix={canEdit ? fix : undefined}
                onAsk={askAbout}
                fix={data.data?.fixes?.[widget.id] ?? null}
                editing={editing ? { onMove: (direction) => move(index, direction), onResize: () => resize(index), onRemove: () => removeWidget(index), onAsk: panel ? () => askChange(widget) : undefined, first: index === 0, last: index === board.widgets.length - 1 } : null}
              />
            ))}
          {transitions.leaving.map((widget) => (
            <WidgetCard key={`leaving-${widget.id}`} widget={widget} transition="leave" result={data.data?.widgets[widget.id] ?? { at: "", columns: [], rows: [] }} />
          ))}
        </div>
      )}

      <RenameDialog key={`${board.updatedAt}:${renaming}`} open={renaming} board={board} pending={rename.isPending} onClose={() => setRenaming(false)} onSave={(input) => rename.mutate(input)} />
      <AlertDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        destructive
        title={`Delete ${board.title}?`}
        description={published ? "Everyone loses this board. This cannot be undone." : "This draft is removed. This cannot be undone."}
        confirmLabel="Delete board"
        confirmDisabled={remove.isPending}
        onConfirm={() => remove.mutateAsync().then(() => undefined, () => undefined)}
      />
    </OpsPage>
  );
}

/**
 * The board at a glance, under its large title: the description as a lead line, then one quiet row
 * with the status, the owner, the last update and the board's size. No card: the title already
 * frames it, and the filters and widgets below carry the weight.
 */
function BoardHero({ board, published }: { board: Board; published: boolean }) {
  const owner = board.owner?.name || board.owner?.id || "";
  const stats: Array<{ label: string; value: number }> = [
    { label: "Widgets", value: board.widgets.length },
    { label: "Filters", value: board.filters.length },
    { label: "Views", value: board.views || 0 },
  ];
  const dot = <span aria-hidden="true" className="text-ink-5">·</span>;
  return (
    <section aria-label="About this board" className="-mt-4 mb-6">
      <p className="max-w-3xl text-[15px] leading-6 text-ink-3">{board.description || <span className="text-ink-5">No description</span>}</p>
      <div className="mt-3 flex flex-wrap items-center gap-x-2.5 gap-y-2 text-[13px] text-ink-4">
        {published
          ? <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11.5px] font-semibold text-emerald-700"><span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-emerald-500" />Live · visible to everyone</span>
          : <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11.5px] font-semibold text-amber-700">Draft · only you and admins</span>}
        <span className="inline-flex items-center gap-2"><PersonAvatar name={owner} size={20} /><span>by <span className="font-medium text-ink-2">{owner}</span></span></span>
        {dot}
        <span>Updated <RelativeTime value={board.updatedAt} className="text-[13px] text-ink-4" /></span>
        {published && board.publishedAt ? <>{dot}<span>Published <RelativeTime value={board.publishedAt} className="text-[13px] text-ink-4" /></span></> : null}
        {dot}
        <ul aria-label="Board counts" className="flex items-center gap-3">
          {stats.map((stat) => (
            <li key={stat.label} className="flex items-baseline gap-1" title={plural(stat.value, stat.label.toLowerCase().replace(/s$/, ""))}>
              <span className="font-semibold tabular-nums text-ink-1">{stat.value.toLocaleString()}</span><span>{stat.value === 1 ? stat.label.replace(/s$/, "") : stat.label}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/** Typing filters after a short pause, so each keystroke does not hit the backend. */
function TextFilter({ filter, value, onCommit }: { filter: BoardFilter; value: string; onCommit: (value: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  useEffect(() => {
    if (draft === value) return undefined;
    const timer = window.setTimeout(() => onCommit(draft), 400);
    return () => window.clearTimeout(timer);
  }, [draft, value, onCommit]);
  return (
    <Input
      aria-label={`Filter by ${filter.label}`}
      placeholder={filter.placeholder || filter.label}
      className="h-8 w-[200px] rounded-lg text-[13px]"
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={(event) => { if (event.key === "Enter") onCommit(draft); }}
    />
  );
}

function RenameDialog({ open, board, pending, onClose, onSave }: { open: boolean; board: Board; pending: boolean; onClose: () => void; onSave: (input: { title: string; description: string }) => void }) {
  const [title, setTitle] = useState(board.title);
  const [description, setDescription] = useState(board.description ?? "");
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Rename board</DialogTitle></DialogHeader>
        <form className="space-y-3 px-5" onSubmit={(event) => { event.preventDefault(); if (title.trim()) onSave({ title: title.trim(), description: description.trim() }); }}>
          <label htmlFor="board-title" className="block text-[12.5px] font-medium text-ink-3">
            Title
            <Input id="board-title" className="mt-1" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={80} required />
          </label>
          <label htmlFor="board-description" className="block text-[12.5px] font-medium text-ink-3">
            Description
            <Input id="board-description" className="mt-1" value={description} onChange={(event) => setDescription(event.target.value)} maxLength={200} placeholder="One line on what the board shows" />
          </label>
          <DialogFooter className="-mx-5">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={pending || !title.trim()}>Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
