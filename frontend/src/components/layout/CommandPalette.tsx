import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  BookOpen,
  Clock3,
  CornerDownLeft,
  LayoutDashboard,
  Monitor,
  Moon,
  PenLine,
  Puzzle,
  Search,
  Sun,
  Ticket,
  type LucideIcon,
} from "lucide-react";
import { Fragment, useCallback, useContext, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { boardKeys, boardsApi } from "@/api/boards";
import { knowledgeApi, knowledgeKeys, skillKeys, skillsApi } from "@/api/library";
import { queryKeys } from "@/api/queryKeys";
import { routineKeys, routinesApi } from "@/api/routines";
import { TASK_STATUS_LABEL, tasksApi, taskKeys } from "@/api/tasks";
import { ticketsApi } from "@/api/tickets";
import { listItems, type MonitorResponse } from "@/api/types";
import { useMe } from "@/auth/rbac";
import { AgentMark } from "@/components/ops/AgentMark";
import { AGENT_NAME, AgentPanelContext } from "@/components/ops/agentPanelContext";
import { statusMeta } from "@/components/ops/OperationalStatus";
import { priorityLevel } from "@/components/ops/PriorityBadge";
import { formatRelativeTime } from "@/components/ui";
import { APP_PAGES, useDisabledSections, usePageAllowed } from "@/lib/appSections";
import { GO_KEYS, MOD, isPlainKey } from "@/lib/shortcuts";
import type { Theme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { FRESH } from "@/api/queryPolicy";

/**
 * Ctrl K (⌘K on a Mac): one box that gets anywhere. Empty, it offers the next likely moves (a new
 * task, Sonic, the latest tasks) and every page with its G shortcut. Typed into, it searches pages,
 * actions, tickets, tasks, boards, pipelines, skills, routines and knowledge, best matches first,
 * and always ends with handing the words to Sonic. It also owns the plain-key shortcuts it lists:
 * C for a new task and G then a letter for a page.
 */

interface PaletteItem {
  id: string;
  group: string;
  label: string;
  /** Quieter text after the label: an ID, a status, a time. */
  hint?: ReactNode;
  /** Searched as well as the label, at a lower weight. */
  keywords?: string;
  icon: ReactNode;
  /** Keys shown on the right. */
  keys?: string[];
  /** A word shown on the right instead of keys: a status, where Enter goes. */
  meta?: string;
  run: () => void;
}

const GROUP_LIMIT: Record<string, number> = { Tickets: 6, Tasks: 5, Boards: 4, Pipelines: 4, Skills: 4, Routines: 3, Knowledge: 3, Pages: 5, Actions: 4 };

/** How well `query` matches `text`: whole-text prefix, then a word's start, then anywhere, then the letters in order. -1 for no match. */
function matchScore(query: string, text: string | undefined): number {
  if (!text) return -1;
  const haystack = text.toLowerCase();
  if (haystack.startsWith(query)) return 100 - Math.min(20, haystack.length - query.length) / 2;
  if (new RegExp(`(^|[\\s/_.:·-])${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(haystack)) return 75;
  if (haystack.includes(query)) return 55;
  if (query.length >= 2 && query.length <= 12) {
    let position = 0;
    for (const char of query) { position = haystack.indexOf(char, position); if (position < 0) return -1; position += 1; }
    return 25;
  }
  return -1;
}

const scoreOf = (query: string, item: PaletteItem) => Math.max(matchScore(query, item.label), matchScore(query, item.keywords) * 0.85);

/** The matched run in the label, in full ink; the rest a step quieter. */
function Highlight({ text, query }: { text: string; query: string }) {
  const at = query ? text.toLowerCase().indexOf(query) : -1;
  if (at < 0) return <>{text}</>;
  return <>{text.slice(0, at)}<mark className="bg-transparent font-semibold text-ink-1 underline decoration-brand/50 decoration-2 underline-offset-[3px]">{text.slice(at, at + query.length)}</mark>{text.slice(at + query.length)}</>;
}

const Keys = ({ keys }: { keys: string[] }) => (
  <span className="flex shrink-0 items-center gap-1" aria-hidden="true">
    {keys.map((key) => <kbd key={key} className="!min-w-[20px] !text-center !text-[10.5px]">{key}</kbd>)}
  </span>
);

const iconBox = (icon: LucideIcon) => {
  const Icon = icon;
  return <Icon className="h-4 w-4" strokeWidth={1.9} aria-hidden="true" />;
};

function StatusDot({ status }: { status: unknown }) {
  const tone = statusMeta(status).tone;
  const color = { bad: "bg-rose-500", warning: "bg-amber-500", review: "bg-violet-500", info: "bg-blue-500", success: "bg-emerald-500", neutral: "bg-slate-400" }[tone];
  return <span aria-hidden="true" className={cn("h-2 w-2 rounded-full", color)} />;
}

function PriorityCode({ priority }: { priority?: string | null }) {
  const level = priorityLevel(priority);
  if (!level) return iconBox(Ticket);
  const tone = { P1: "text-rose-600", P2: "text-orange-600", P3: "text-amber-600", P4: "text-ink-4" }[level];
  return <span className={cn("font-mono text-[10.5px] font-bold", tone)} aria-label={level}>{level}</span>;
}

export function CommandPalette({ open, onOpenChange, theme, onThemeChange }: { open: boolean; onOpenChange: (open: boolean) => void; theme: Theme; onThemeChange: (theme: Theme) => void }) {
  const navigate = useNavigate();
  const location = useLocation();
  const panel = useContext(AgentPanelContext);
  const queryClient = useQueryClient();
  const role = useMe().data?.role;
  const pageAllowed = usePageAllowed();
  const disabled = useDisabledSections();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement | null>(null);

  // Ctrl K anywhere, even in a text box; C and G-letter only as plain keys outside fields and dialogs.
  useEffect(() => {
    let goTimer: number | null = null;
    let goArmed = false;
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        onOpenChange(!open);
        return;
      }
      if (open || !isPlainKey(event)) return;
      const key = event.key.toLowerCase();
      if (goArmed) {
        goArmed = false;
        if (goTimer) window.clearTimeout(goTimer);
        const target = Object.entries(GO_KEYS).find(([, letter]) => letter === key)?.[0];
        if (target) { event.preventDefault(); navigate(target); }
        return;
      }
      if (key === "g" && !event.shiftKey) { goArmed = true; goTimer = window.setTimeout(() => { goArmed = false; }, 1200); return; }
      if (key === "c" && !event.shiftKey && location.pathname !== "/tasks/new") { event.preventDefault(); navigate("/tasks/new"); }
    };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); if (goTimer) window.clearTimeout(goTimer); };
  }, [open, onOpenChange, navigate, location.pathname]);

  useEffect(() => { if (!open) setQuery(""); }, [open]);

  const allowed = (section?: string) => !section || !disabled.has(section);
  const tickets = useQuery({ queryKey: queryKeys.tickets.list("all"), queryFn: ({ signal }) => ticketsApi.list("all", signal), enabled: open, staleTime: FRESH.medium });
  const tasks = useQuery({ queryKey: taskKeys.list({ palette: true }), queryFn: ({ signal }) => tasksApi.list({ limit: 100 }, signal), enabled: open, staleTime: FRESH.short });
  const boards = useQuery({ queryKey: boardKeys.list(), queryFn: ({ signal }) => boardsApi.list(signal), enabled: open && allowed("boards"), staleTime: FRESH.long });
  const skills = useQuery({ queryKey: skillKeys.all, queryFn: ({ signal }) => skillsApi.list(signal), enabled: open && allowed("skills"), staleTime: FRESH.session });
  const routines = useQuery({ queryKey: routineKeys.all, queryFn: ({ signal }) => routinesApi.list(signal), enabled: open && allowed("routines"), staleTime: FRESH.long });
  const knowledge = useQuery({ queryKey: knowledgeKeys.all, queryFn: ({ signal }) => knowledgeApi.list(signal), enabled: open && allowed("knowledge"), staleTime: FRESH.session });

  const go = useCallback((to: string, state?: unknown) => { onOpenChange(false); navigate(to, state ? { state } : undefined); }, [navigate, onOpenChange]);
  const term = query.trim().toLowerCase();

  const items = useMemo<PaletteItem[]>(() => {
    const pages: PaletteItem[] = APP_PAGES.filter((page) => allowed(page.section) && pageAllowed(page)).map((page) => ({
      id: `page:${page.to}`, group: "Pages", label: page.label, keywords: page.keywords, icon: iconBox(page.icon),
      keys: GO_KEYS[page.to] ? ["G", GO_KEYS[page.to].toUpperCase()] : undefined, run: () => go(page.to),
    }));
    const themes: PaletteItem[] = ([["light", "Light theme", Sun], ["dark", "Dark theme", Moon], ["system", "Match system theme", Monitor]] as const)
      .filter(([value]) => value !== theme)
      .map(([value, label, icon]) => ({ id: `theme:${value}`, group: "Actions", label: value === "system" ? label : `Switch to ${label.toLowerCase()}`, keywords: "appearance theme mode dark light", icon: iconBox(icon), run: () => { onThemeChange(value); onOpenChange(false); } }));
    const actions: PaletteItem[] = [
      { id: "action:new-task", group: "Actions", label: "New task", keywords: "start create chat", icon: iconBox(PenLine), keys: ["C"], run: () => go("/tasks/new") },
      ...(panel ? [{ id: "action:sonic", group: "Actions", label: `Ask ${AGENT_NAME}`, keywords: "agent chat help", icon: <AgentMark size={16} />, keys: [MOD, "J"], run: () => { onOpenChange(false); panel.setOpen(true); } }] : []),
      ...themes,
    ];

    if (!term) {
      const recent = [...(tasks.data?.items ?? [])].filter((task) => !task.archived).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)).slice(0, 4).map<PaletteItem>((task) => ({
        id: `task:${task.id}`, group: "Recent tasks", label: task.title, icon: <StatusDot status={task.status === "waiting" ? "waiting" : task.status} />,
        hint: `${TASK_STATUS_LABEL[task.status]} · ${formatRelativeTime(task.updatedAt)}`, run: () => go(`/tasks/${encodeURIComponent(task.id)}`),
      }));
      const suggestions = actions.filter((item) => item.id.startsWith("action:")).map((item) => ({ ...item, group: "Suggestions" }));
      return [...suggestions, ...recent, ...pages.map((page) => ({ ...page, group: "Go to" })), ...themes.map((item) => ({ ...item, group: "Appearance" }))];
    }

    const records: PaletteItem[] = [
      ...listItems(tickets.data).map<PaletteItem>((ticket) => {
        const number = ticket.externalReference?.number || ticket.ticketId;
        return {
          id: `ticket:${ticket.ticketId}`, group: "Tickets", label: ticket.title, keywords: `${number} ${ticket.ticketId} ${ticket.pipelineName ?? ""}`,
          icon: <PriorityCode priority={ticket.priority} />, hint: <span className="font-mono text-[11.5px]">{number}</span>, meta: statusMeta(ticket.status).label,
          run: () => go(`/tickets/${encodeURIComponent(ticket.ticketId)}`),
        };
      }),
      ...(tasks.data?.items ?? []).map<PaletteItem>((task) => ({
        id: `task:${task.id}`, group: "Tasks", label: task.title, keywords: `${task.id} ${task.summary ?? ""}`.slice(0, 300), icon: <StatusDot status={task.status} />,
        hint: `${TASK_STATUS_LABEL[task.status]} · ${formatRelativeTime(task.updatedAt)}`, run: () => go(`/tasks/${encodeURIComponent(task.id)}`),
      })),
      ...(allowed("boards") ? boards.data?.items ?? [] : []).map<PaletteItem>((board) => ({
        id: `board:${board.id}`, group: "Boards", label: board.title, keywords: board.description, icon: iconBox(LayoutDashboard),
        hint: board.status === "published" ? "Live" : "Draft", run: () => go(`/boards/${encodeURIComponent(board.id)}`),
      })),
      ...(allowed("pipelines") ? cachedPipelines(queryClient) : []).map<PaletteItem>((pipeline) => ({
        id: `pipeline:${pipeline.pipelineId}`, group: "Pipelines", label: pipeline.name, keywords: `${pipeline.platform ?? ""} ${pipeline.pipelineId}`, icon: <StatusDot status={pipeline.status} />,
        hint: pipeline.platform, run: () => go(`/monitor?q=${encodeURIComponent(pipeline.name)}`),
      })),
      ...(allowed("skills") ? skills.data?.items ?? [] : []).map<PaletteItem>((skill) => ({
        id: `skill:${skill.id}`, group: "Skills", label: skill.heading || skill.name, keywords: `${skill.name} ${skill.description}`.slice(0, 300), icon: iconBox(Puzzle), run: () => go(`/skills/${encodeURIComponent(skill.id)}`),
      })),
      ...(allowed("routines") ? routines.data?.items ?? [] : []).map<PaletteItem>((routine) => ({
        id: `routine:${routine.name}`, group: "Routines", label: routine.title, keywords: `${routine.name} ${routine.objective}`.slice(0, 300), icon: iconBox(Clock3), run: () => go(`/routines/${encodeURIComponent(routine.name)}`),
      })),
      ...(allowed("knowledge") ? knowledge.data?.items ?? [] : []).map<PaletteItem>((base) => ({
        id: `knowledge:${base.name}`, group: "Knowledge", label: base.title, keywords: `${base.name} ${base.description}`.slice(0, 300), icon: iconBox(BookOpen), run: () => go(`/knowledge/${encodeURIComponent(base.name)}`),
      })),
    ];

    // Rank inside each group, cap each group, then order the groups by their best match.
    const groups = new Map<string, Array<{ item: PaletteItem; score: number }>>();
    for (const item of [...pages, ...actions, ...records]) {
      const score = scoreOf(term, item);
      if (score < 0) continue;
      const list = groups.get(item.group) ?? [];
      list.push({ item, score });
      groups.set(item.group, list);
    }
    const ranked = [...groups.entries()]
      .map(([group, list]) => ({ group, list: list.sort((a, b) => b.score - a.score).slice(0, GROUP_LIMIT[group] ?? 4) }))
      .sort((a, b) => b.list[0].score - a.list[0].score);
    const typed = query.trim();
    const sonic: PaletteItem[] = [
      ...(panel ? [{ id: "sonic:ask", group: AGENT_NAME, label: `Ask ${AGENT_NAME} “${typed}”`, icon: <AgentMark size={16} />, meta: "Opens the panel", run: () => { onOpenChange(false); panel.ask(typed); } }] : []),
      { id: "sonic:task", group: AGENT_NAME, label: `Start a task: “${typed}”`, icon: iconBox(PenLine), meta: "New task", run: () => go("/tasks/new", { prompt: typed }) },
    ];
    return [...ranked.flatMap(({ list }) => list.map(({ item }) => item)), ...sonic];
    // `allowed` reads `disabled`, which is listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term, query, theme, role, pageAllowed, disabled, panel, go, onOpenChange, onThemeChange, queryClient, tickets.data, tasks.data, boards.data, skills.data, routines.data, knowledge.data]);

  useEffect(() => setActive(0), [term]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView?.({ block: "nearest" });
  }, [active]);

  const onKeyDown = (event: ReactKeyboardEvent) => {
    if (!items.length) return;
    if (event.key === "ArrowDown" || (event.key === "n" && event.ctrlKey)) { event.preventDefault(); setActive((index) => (index + 1) % items.length); }
    else if (event.key === "ArrowUp" || (event.key === "p" && event.ctrlKey)) { event.preventDefault(); setActive((index) => (index - 1 + items.length) % items.length); }
    else if (event.key === "Home" && event.ctrlKey) { event.preventDefault(); setActive(0); }
    else if (event.key === "End" && event.ctrlKey) { event.preventDefault(); setActive(items.length - 1); }
    else if (event.key === "Enter") { event.preventDefault(); items[active]?.run(); }
  };

  const loading = open && term && (tickets.isPending || tasks.isPending);
  let lastGroup = "";

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="palette-overlay fixed inset-0 z-[60] bg-black/30" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          onKeyDown={onKeyDown}
          className="palette-pop fixed inset-x-0 top-[12vh] z-[60] mx-auto flex max-h-[76vh] w-[min(640px,calc(100%-2rem))] flex-col overflow-hidden rounded-2xl border border-line-strong bg-raised shadow-modal focus:outline-none"
        >
          <DialogPrimitive.Title className="sr-only">Search and commands</DialogPrimitive.Title>
          <div className="flex h-14 shrink-0 items-center gap-3 border-b border-line px-4">
            <Search className="h-[18px] w-[18px] shrink-0 text-ink-4" aria-hidden="true" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search or run a command"
              aria-label="Search or run a command"
              role="combobox"
              aria-expanded="true"
              aria-controls="command-palette-list"
              aria-activedescendant={items[active] ? `palette-${items[active].id}` : undefined}
              aria-autocomplete="list"
              className="h-full min-w-0 flex-1 bg-transparent text-[16px] text-ink-1 outline-none placeholder:text-ink-5 focus-visible:shadow-none"
            />
            {loading ? <span className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-line-strong border-t-brand" aria-label="Searching" /> : null}
            <kbd className="!text-[10.5px]" aria-hidden="true">Esc</kbd>
          </div>

          <div ref={listRef} id="command-palette-list" role="listbox" aria-label="Results" className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-2">
            {items.map((item, index) => {
              const header = item.group !== lastGroup ? item.group : null;
              lastGroup = item.group;
              const selected = index === active;
              return (
                <Fragment key={item.id}>
                  {header ? <div role="presentation" className="px-2.5 pb-1 pt-3 text-[12px] font-medium text-ink-5">{header}</div> : null}
                  <div
                    id={`palette-${item.id}`}
                    role="option"
                    aria-selected={selected}
                    data-index={index}
                    tabIndex={-1}
                    onMouseMove={() => { if (!selected) setActive(index); }}
                    onClick={() => item.run()}
                    onKeyDown={(event) => { if (event.key === "Enter") item.run(); }}
                    className={cn("flex h-10 cursor-pointer items-center gap-3 rounded-lg px-2.5 text-[14px] transition-colors duration-75", selected ? "bg-ink-1/[0.06] text-ink-1" : "text-ink-2")}
                  >
                    <span className={cn("flex h-5 w-5 shrink-0 items-center justify-center", selected ? "text-ink-1" : "text-ink-4")}>{item.icon}</span>
                    <span className="min-w-0 truncate"><Highlight text={item.label} query={item.group === AGENT_NAME ? "" : term} /></span>
                    {item.hint ? <span className="min-w-0 shrink truncate text-[12.5px] text-ink-5">{item.hint}</span> : null}
                    <span className="ml-auto flex shrink-0 items-center gap-2 pl-2">
                      {item.meta ? <span className="text-[12px] text-ink-5">{item.meta}</span> : item.keys ? <Keys keys={item.keys} /> : null}
                      {selected ? <CornerDownLeft className="h-3.5 w-3.5 text-ink-4" aria-hidden="true" /> : null}
                    </span>
                  </div>
                </Fragment>
              );
            })}
          </div>

          <div className="flex h-10 shrink-0 items-center gap-4 border-t border-line bg-surface-panel px-4 text-[12px] text-ink-5">
            <span className="flex items-center gap-1.5"><Keys keys={["↑", "↓"]} />Move</span>
            <span className="flex items-center gap-1.5"><Keys keys={["↵"]} />Open</span>
            <span className="ml-auto flex items-center gap-1.5">Go to a page<Keys keys={["G"]} /><ArrowRight className="h-3 w-3" aria-hidden="true" />letter</span>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** Pipelines the Pipelines page has already loaded; the palette does not trigger the platform reconcile itself. */
function cachedPipelines(queryClient: ReturnType<typeof useQueryClient>) {
  const seen = new Map<string, MonitorResponse["items"][number]>();
  for (const [, data] of queryClient.getQueriesData<MonitorResponse>({ queryKey: queryKeys.monitor.all })) {
    for (const pipeline of data?.items ?? []) if (pipeline?.pipelineId && !seen.has(pipeline.pipelineId)) seen.set(pipeline.pipelineId, pipeline);
  }
  return [...seen.values()];
}
