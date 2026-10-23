import { useQuery } from "@tanstack/react-query";
import { lazy, Suspense, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { tasksApi, taskKeys } from "@/api/tasks";
import { useMe } from "@/auth/rbac";
import { AGENT_NAME, AgentPanelContext, describePage, readConversations, useAgentPanel, type AgentScreen, type AgentSelection } from "@/components/ops/agentPanelContext";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui";
import { useInboxPending } from "@/features/inbox/useInboxPending";
import { cn } from "@/lib/utils";
import { useProject } from "@/lib/projectContext";
import { AgentMark } from "@/components/ops/AgentMark";
import { FRESH } from "@/api/queryPolicy";

// The thread, composer and markdown are most of the panel's weight; nobody downloads them until they first open it.
const AgentPanelBody = lazy(() => import("@/components/ops/AgentPanelBody").then(({ AgentPanelBody }) => ({ default: AgentPanelBody })));

/**
 * Sonic on every page: a pill in the bottom-right corner that opens a side panel. Sonic is told
 * which page the person is on, the rows on screen and the record that is open, and reads the rest
 * through its NerveCenter tools. Under the hood a conversation is an ad-hoc Task, so approvals,
 * history and cost work exactly like the Tasks page. One conversation per page family
 * (all of Tickets share one) until the person starts a new one.
 */

/** Task pages and /tasks/new already have their own composer, so the pill stays out of the way there. */
const HIDE_PILL = /^\/tasks\/[^/]+/;

export function AgentPanelProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const [open, setOpen] = useState(false);
  // Mounted on first open and kept, so its conversation and scroll survive closing and reopening.
  const [mounted, setMounted] = useState(false);
  if (open && !mounted) setMounted(true);
  const [selection, setSelection] = useState<AgentSelection | null>(null);
  const [screen, setScreen] = useState<AgentScreen | null>(null);
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);
  const toggle = useCallback(() => setOpen((value) => !value), []);
  const ask = useCallback((prompt: string) => { setPendingPrompt(prompt); setOpen(true); }, []);
  // A selection belongs to the section it was made in. Closing a detail sheet (/tickets/OPS-1 → /tickets)
  // stays in the section, so "Ask Sonic" from the sheet keeps the ticket it was asked about.
  const section = location.pathname.split("/")[1] || "";
  useEffect(() => { setSelection(null); }, [section]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "j") { event.preventDefault(); toggle(); }
      else if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);
  // Viewers and visitors read Sonic's work but do not talk to it, so pages leave out their "Ask Sonic" actions.
  const me = useMe();
  const { visitor } = useProject();
  // Unknown until /api/me answers, so the actions never flash for a viewer.
  const canChat = Boolean(me.data) && String(me.data?.role || "") !== "viewer" && !visitor;
  const value = useMemo(() => ({ open, setOpen, toggle, setSelection, setScreen, ask, canChat }), [open, toggle, ask, canChat]);
  return (
    <AgentPanelContext.Provider value={value}>
      {/* On a wide screen the panel docks beside the page instead of covering it, so the reader
          watches the page change while Sonic works; narrower screens keep the overlay. */}
      <div className={cn("transition-[padding] duration-300 ease-out", open && "xl:pr-[460px]")}>{children}</div>
      <AgentPill />
      {mounted ? (
        <Suspense fallback={<PanelLoading />}>
          <AgentPanelBody open={open} onClose={() => setOpen(false)} selection={selection} onClearSelection={() => setSelection(null)} screen={screen} pendingPrompt={pendingPrompt} onPromptConsumed={() => setPendingPrompt(null)} />
        </Suspense>
      ) : null}
    </AgentPanelContext.Provider>
  );
}

/**
 * What Sonic is up to for this reader: a task of theirs is running, or this page's own conversation is,
 * and how many items wait on them. Someone else's running task does not make the pill say "working".
 */
function useAgentActivity(pathname: string) {
  const me = useMe();
  const running = useQuery({
    queryKey: [...taskKeys.all, "running"],
    queryFn: ({ signal }) => tasksApi.list({ status: "running", limit: 20 }, signal),
    // Only the pill reads it, and the pill is not shown on task pages.
    enabled: !HIDE_PILL.test(pathname),
    refetchInterval: false,
    refetchIntervalInBackground: false,
    staleTime: FRESH.activity,
  });
  const waiting = useInboxPending();
  const myId = me.data?.user?.id;
  const pageTaskId = readConversations()[describePage(pathname).family];
  const working = (running.data?.items ?? []).some((task) => (myId && task.createdBy?.id === myId) || (pageTaskId && task.id === pageTaskId));
  return { working, waiting };
}

/** SPEC-projects-03 FR-13: a visitor to an open project does not talk to Sonic there, so the pill is not offered. */
function AgentPill() {
  const { visitor } = useProject();
  return visitor ? null : <AgentPillButton />;
}

function AgentPillButton() {
  const panel = useAgentPanel();
  const location = useLocation();
  const { working, waiting } = useAgentActivity(location.pathname);
  if (panel.open || HIDE_PILL.test(location.pathname)) return null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={panel.toggle}
          aria-label={`Ask ${AGENT_NAME}`}
          className="fixed bottom-6 right-6 z-30 flex h-11 items-center gap-2.5 rounded-full border border-line bg-raised pl-1.5 pr-4 text-[14px] font-semibold text-ink-1 shadow-card transition-all duration-200 ease-out hover:-translate-y-px hover:border-line-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:ring-offset-2"
        >
          <AgentMark size={30} state={working ? "thinking" : waiting ? "waiting" : "idle"} />
          <span>{working ? `${AGENT_NAME} is working` : `Ask ${AGENT_NAME}`}</span>
          {waiting ? <span className="ml-0.5 rounded-full bg-amber-400 px-1.5 py-px text-[11.5px] font-bold text-amber-950" aria-label={`${waiting} waiting on you`}>{waiting}</span> : null}
        </button>
      </TooltipTrigger>
      <TooltipContent side="left">{waiting ? `${waiting} waiting on you in the Inbox · ` : ""}Ctrl J</TooltipContent>
    </Tooltip>
  );
}

/** Stands in for the panel while its code loads on first open. */
function PanelLoading() {
  return (
    <aside className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[460px] flex-col border-l border-line bg-raised shadow-modal xl:shadow-none" aria-label={`Loading ${AGENT_NAME}`} aria-busy="true">
      <div role="status" className="space-y-4 p-4"><Skeleton className="h-8 w-40" /><Skeleton className="h-20 w-3/4" /><Skeleton className="h-32 w-full" /></div>
    </aside>
  );
}
