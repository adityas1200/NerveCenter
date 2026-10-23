import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Bell, Bot, LoaderCircle, CircleDot, GitBranch, Plug, RotateCcw, ShieldAlert, ShieldCheck, Ticket, UserRoundCheck, type LucideIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { NotificationRequestQueue, notificationsApi, fetchNotificationUpdates, type NotificationView } from "@/api/notifications";
import { queryKeys } from "@/api/queryKeys";
import type { NotificationItem } from "@/api/types";
import { Button, Popover, PopoverContent, PopoverTrigger, RelativeTime, Skeleton, Tabs, TabsList, TabsTrigger, Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui";
import { AgentMark } from "@/components/ops/AgentMark";
import { AGENT_NAME } from "@/components/ops/agentPanelContext";
import { cn } from "@/lib/utils";
import { isNotification } from "./notificationKinds";

const SEEN_KEY = "nc-notifications-seen-at";

const KIND_ICON: Record<string, LucideIcon> = {
  "ticket.created": Ticket,
  "ticket.status": CircleDot,
  "ticket.assigned": UserRoundCheck,
  "ticket.priority": Ticket,
  "ticket.recurrence": RotateCcw,
  "approval.pending": ShieldAlert,
  "pipeline.failed": GitBranch,
  "dq.failed": ShieldCheck,
  automation: Bot,
  "system.connection": Plug,
};

const TONE_ICON: Record<NotificationItem["tone"], string> = {
  bad: "text-rose-600",
  warning: "text-amber-600",
  success: "text-emerald-600",
  neutral: "text-ink-4",
};

const isSystem = (item: NotificationItem) => Boolean(item.pinned) || String(item.kind).startsWith("system.");
const isAgent = (item: NotificationItem) => String(item.kind).startsWith("agent.");
type View = NotificationView;
const POLL_MS = 15_000;

function readSeenAt(): number {
  try { return Number(window.localStorage.getItem(SEEN_KEY)) || 0; } catch { return 0; }
}

function startOfToday(): number {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/**
 * The bell. System items (a connection that is down, a table not set up) sit on top until they are
 * fixed and never count as unread. Below them: what Sonic did or needs, and what happened to tickets
 * and pipelines, grouped by day, filterable, and cleared with one click.
 */
export function NotificationsTray() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [seenAt, setSeenAt] = useState<number>(readSeenAt);
  const [view, setView] = useState<View>("all");
  const [session, setSession] = useState(0);
  const [newItems, setNewItems] = useState<NotificationItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [systemCount, setSystemCount] = useState(0);
  const [latestSystem, setLatestSystem] = useState<NotificationItem[] | null>(null);
  const seenAtRef = useRef(seenAt);
  const watermark = useRef<string | null>(null);
  const appliedAlert = useRef<unknown>(null);
  const queue = useRef(new NotificationRequestQueue()).current;
  const scrollRef = useRef<HTMLDivElement>(null);
  const loadingOlder = useRef(false);
  const restoreScroll = useRef<number | null>(null);
  seenAtRef.current = seenAt;

  const alert = useQuery({
    queryKey: [...queryKeys.notifications.all, "alert", open],
    queryFn: async ({ signal }) => {
      const seen = new Date(seenAtRef.current || 0).toISOString();
      if (!open || !watermark.current) {
        const summary = await queue.run(() => notificationsApi.summary(seen, signal), signal);
        watermark.current = summary.watermark;
        return { ...summary, items: [] as NotificationItem[], system: null as NotificationItem[] | null };
      }
      const result = await fetchNotificationUpdates(queue, seen, watermark.current, signal);
      watermark.current = result.watermark;
      return result;
    },
    refetchInterval: POLL_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    retry: false,
  });

  const firstPage = useQuery({
    queryKey: [...queryKeys.notifications.all, "page", view, session],
    queryFn: ({ signal }) => queue.run(() => notificationsApi.page(view, null, signal), signal),
    enabled: open,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const older = useInfiniteQuery({
    queryKey: [...queryKeys.notifications.all, "older", view, session],
    initialPageParam: firstPage.data?.nextCursor ?? "",
    queryFn: ({ pageParam, signal }) => queue.run(() => notificationsApi.page(view, pageParam, signal), signal),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: false,
    refetchOnWindowFocus: false,
    retry: false,
  });

  useEffect(() => {
    if (!alert.data || appliedAlert.current === alert.data) return;
    appliedAlert.current = alert.data;
    if (alert.dataUpdatedAt >= seenAtRef.current) setUnread(alert.data.unread);
    setSystemCount(alert.data.systemCount);
    if (alert.data.system) setLatestSystem(alert.data.system);
    if (!open || !alert.data.items.some(item => view === "all" || (view === "agent" ? isAgent(item) : !isAgent(item)))) return;
    const node = scrollRef.current;
    if (node && node.scrollTop > 24) restoreScroll.current = node.scrollHeight;
    setNewItems((previous) => {
      const seen = new Set<string>();
      return [...alert.data.items, ...previous].filter((item) => isNotification(item) && !isSystem(item) && !seen.has(item.id) && Boolean(seen.add(item.id)));
    });
  }, [alert.data, alert.dataUpdatedAt, open, view]);

  const activity = useMemo(() => {
    const rows = [...newItems, ...(firstPage.data?.items ?? []), ...(older.data?.pages.flatMap((page) => page.items) ?? [])];
    const seen = new Set<string>();
    return rows.filter((item) => isNotification(item) && !isSystem(item) && (view === "all" || (view === "agent" ? isAgent(item) : !isAgent(item))) && !seen.has(item.id) && Boolean(seen.add(item.id)));
  }, [newItems, firstPage.data?.items, older.data?.pages, view]);
  const system = latestSystem ?? firstPage.data?.system ?? [];
  const today = startOfToday();
  const groups = useMemo(() => ({
    today: activity.filter((item) => Date.parse(item.at) >= today),
    earlier: activity.filter((item) => Date.parse(item.at) < today),
  }), [activity, today]);

  const markAllRead = () => {
    const at = Date.now();
    setSeenAt(at);
    setUnread(0);
    try { window.localStorage.setItem(SEEN_KEY, String(at)); } catch { /* storage is optional */ }
  };
  const openItem = (item: NotificationItem) => {
    setOpen(false);
    navigate(item.href);
  };
  const empty = !activity.length && (view === "agent" || !system.length);

  const virtualRows = useMemo(() => [
    ...(groups.today.length ? [{ type: "heading" as const, label: "Today" }, ...groups.today.map((item) => ({ type: "item" as const, item }))] : []),
    ...(groups.earlier.length ? [{ type: "heading" as const, label: "Earlier" }, ...groups.earlier.map((item) => ({ type: "item" as const, item }))] : []),
  ], [groups]);
  const virtualizer = useVirtualizer({ count: virtualRows.length, getScrollElement: () => scrollRef.current, getItemKey: (index) => { const row = virtualRows[index]; return row.type === "item" ? row.item.id : row.label; }, estimateSize: (index) => virtualRows[index]?.type === "heading" ? 34 : 68, overscan: 6, measureElement: (element) => element?.getBoundingClientRect().height ?? 68 });
  const nextCursor = older.data?.pages.length ? older.data.pages[older.data.pages.length - 1].nextCursor : firstPage.data?.nextCursor;
  const loadOlder = () => {
    if (!open || !nextCursor || loadingOlder.current || older.isFetchingNextPage) return;
    loadingOlder.current = true;
    void older.fetchNextPage().finally(() => { loadingOlder.current = false; });
  };
  const checkNearEnd = () => {
    const node = scrollRef.current;
    if (node && node.scrollHeight - node.scrollTop - node.clientHeight <= 300) loadOlder();
  };
  useEffect(() => { if (open && firstPage.data && !older.error) checkNearEnd(); }, [open, firstPage.data, virtualRows.length]); // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const node = scrollRef.current;
    if (node && restoreScroll.current !== null) node.scrollTop += node.scrollHeight - restoreScroll.current;
    restoreScroll.current = null;
  }, [virtualRows.length]);

  const changeOpen = (next: boolean) => {
    if (next) { setSession((value) => value + 1); setNewItems([]); setLatestSystem(null); }
    if (!next) void queryClient.cancelQueries({ predicate: query => query.queryKey[0] === "notifications" && ["page", "older"].includes(String(query.queryKey[1])) });
    setOpen(next);
  };
  const changeView = (next: string) => {
    setView(next as View);
    setSession((value) => value + 1);
    setNewItems([]);
    setLatestSystem(null);
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  };

  return (
    <Popover open={open} onOpenChange={changeOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon" className="relative h-9 w-9 rounded-lg text-ink-3 hover:bg-surface-subtle hover:text-ink-1" aria-label={unread ? `Notifications, ${unread} unread` : systemCount ? `Notifications, ${systemCount} system ${systemCount === 1 ? "issue" : "issues"}` : "Notifications"}>
              <Bell className="h-4 w-4" aria-hidden="true" />
              {unread ? (
                <span className="absolute -right-1 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-rose-500 px-1 text-[9.5px] font-bold leading-none text-white shadow-card">
                  {unread > 9 ? "9+" : unread}
                </span>
              ) : systemCount ? (
                <span aria-hidden="true" className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-ink-4 ring-2 ring-raised" />
              ) : null}
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>Notifications</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" sideOffset={10} className="w-[380px] p-0">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="font-display text-[14.5px] font-semibold text-ink-1">Notifications</h2>
          <Button variant="ghost" size="sm" className="-mr-2 h-7 text-[12.5px]" onClick={markAllRead} disabled={!unread}>Mark all read</Button>
        </div>
        <div className="border-b border-line px-3 py-2">
          <Tabs value={view} onValueChange={changeView}>
            <TabsList aria-label="Show"><TabsTrigger value="all">All</TabsTrigger><TabsTrigger value="agent">{AGENT_NAME}</TabsTrigger><TabsTrigger value="operations">Tickets and pipelines</TabsTrigger></TabsList>
          </Tabs>
        </div>
        {view !== "agent" ? <SystemGroup items={system} onOpen={openItem} /> : null}
        <div ref={scrollRef} onScroll={checkNearEnd} className="max-h-[460px] overflow-y-auto" aria-busy={firstPage.isFetching || older.isFetching}>
          {firstPage.isPending ? (
            <div className="space-y-3 p-4" aria-busy="true">
              {[0, 1, 2].map((index) => <div key={index} className="flex gap-3"><Skeleton className="h-4 w-4 rounded" /><div className="flex-1 space-y-1.5"><Skeleton className="h-3 w-3/4" /><Skeleton className="h-2.5 w-1/2" /></div></div>)}
            </div>
          ) : firstPage.error ? (
            <p className="px-4 py-6 text-center text-[13.5px] text-ink-4">Notifications could not be loaded</p>
          ) : empty ? (
            <p className="px-4 py-8 text-center text-[13.5px] text-ink-4">No notifications</p>
          ) : (
            <>
              <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
                {virtualizer.getVirtualItems().map(row => {
                  const value = virtualRows[row.index];
                  return <div key={row.key} ref={virtualizer.measureElement} data-index={row.index} style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${row.start}px)` }}>
                    {value.type === "heading" ? <p className="px-4 pb-1 pt-3 text-[12px] text-ink-5">{value.label}</p> : <NotificationGroup label="" items={[value.item]} seenAt={seenAt} onOpen={openItem} />}
                  </div>;
                })}
              </div>
              {older.isFetching ? <div role="status" className="flex justify-center p-3"><LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" /><span className="sr-only">Loading older notifications</span></div> : null}
              {older.error ? <Button onClick={loadOlder}>Retry older notifications</Button> : null}
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function SystemGroup({ items, onOpen }: { items: NotificationItem[]; onOpen: (item: NotificationItem) => void }) {
  if (!items.length) return null;
  return (
    <section aria-label="System" className="border-b border-line bg-surface-subtle/60">
      <p className="px-4 pb-1 pt-3 text-[12px] font-medium text-ink-5">System</p>
      <ul className="pb-2">
        {items.map((item) => {
          const Icon = KIND_ICON[item.kind] ?? Plug;
          return (
            <li key={item.id}>
              <button type="button" onClick={() => onOpen(item)} className="flex w-full items-start gap-3 px-4 py-2 text-left transition-colors hover:bg-surface-subtle focus-visible:bg-surface-subtle focus-visible:outline-none">
                <Icon className="mt-0.5 h-4 w-4 shrink-0 text-ink-4" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="truncate text-[13.5px] font-medium text-ink-1">{item.title}</span>
                    <span className="shrink-0 text-[11.5px] font-semibold text-brand">Fix</span>
                  </span>
                  {item.detail ? <span className="mt-0.5 line-clamp-2 text-[12.5px] leading-4 text-ink-4" title={item.detail}>{item.detail}</span> : null}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function NotificationGroup({ label, items, seenAt, onOpen }: { label: string; items: NotificationItem[]; seenAt: number; onOpen: (item: NotificationItem) => void }) {
  if (!items.length) return null;
  return (
    <section aria-label={label}>
      {label ? <p className="sticky top-0 bg-raised/95 px-4 pb-1 pt-3 text-[12px] font-medium text-ink-5 backdrop-blur">{label}</p> : null}
      <ul className="pb-1">
        {items.map((item, index) => {
          const Icon = KIND_ICON[item.kind] ?? CircleDot;
          const unread = Date.parse(item.at) > seenAt;
          return (
            <li key={item.id} className="stagger-in" style={{ animationDelay: `${Math.min(index, 8) * 25}ms` }}>
              <button
                type="button"
                onClick={() => onOpen(item)}
                className={cn("flex w-full items-start gap-3 px-4 py-2.5 text-left transition-colors hover:bg-surface-subtle focus-visible:bg-surface-subtle focus-visible:outline-none", unread && "bg-surface-tint")}
              >
                {isAgent(item) ? <AgentMark size={18} className="mt-px" /> : <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", TONE_ICON[item.tone])} aria-hidden="true" />}
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-3">
                    <span className={cn("truncate text-[13.5px] text-ink-1", unread ? "font-semibold" : "font-medium")} title={item.title}>{item.title}</span>
                    <RelativeTime value={item.at} className="shrink-0 text-[11px] text-ink-5" />
                  </span>
                  {item.detail ? <span className="mt-0.5 line-clamp-2 text-[12.5px] leading-4 text-ink-4" title={item.detail}>{item.detail}</span> : null}
                </span>
                {unread ? <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-brand" /> : null}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
