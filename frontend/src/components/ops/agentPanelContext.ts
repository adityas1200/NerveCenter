import { createContext, useCallback, useContext, useEffect } from "react";
import { APP_PAGES } from "@/lib/appSections";

/** The agent's name everywhere in the UI. The backend uses the same name (OPS_AGENT_NAME, default Sonic). */
export const AGENT_NAME = "Sonic";

/**
 * The record a person points Sonic at: a ticket, a pipeline, a data quality check, a board widget or a point on
 * it. `detail` carries what Sonic needs to read it back (SPEC-tasks-12 FR-3), never data it should trust as is.
 */
export type AgentSelection = { kind: string; id: string; title?: string; detail?: Record<string, unknown> };

/**
 * What the person is looking at, told to the agent with every message from the panel:
 * the rows on screen (ids), the record that is open, and a one-line summary of the page state.
 */
export interface AgentScreen {
  visible?: string[];
  open?: AgentSelection | null;
  summary?: string;
}

export interface AgentPanelState {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
  /** Tell the panel what the user has selected on the current page (a ticket, a pipeline, a check). Cleared when the route changes. */
  setSelection: (selection: AgentSelection | null) => void;
  /** Pages publish what is on screen; use `useAgentScreen` rather than calling this directly. */
  setScreen: (screen: AgentScreen | null) => void;
  /** Open the panel with a prompt typed into the box; the user sends it with Enter. */
  ask: (prompt: string) => void;
  /** Whether this reader may talk to Sonic here: not a viewer, not a visitor to an open project. Unset means yes. */
  canChat?: boolean;
}

export const AgentPanelContext = createContext<AgentPanelState | null>(null);

export function useAgentPanel(): AgentPanelState {
  const value = useContext(AgentPanelContext);
  if (!value) throw new Error("useAgentPanel must be used inside AgentPanelProvider");
  return value;
}

/**
 * The one way a row or record talks to Sonic: `askSonic({ kind: "pipeline", id, title }, "Why did it fail?")`
 * selects the record, opens the shared panel and types the prompt into the box for the user to send. Outside the provider (page unit tests)
 * it is a no-op, so pages never need the provider just to render.
 *
 * `before` runs first and closes the detail sheet the caller lives in: a sheet and the Sonic panel are
 * both fixed z-50 overlays, and the sheet's portal mounts later, so it paints on top of the
 * already-mounted panel. Opening the panel behind it looks like nothing happened until the sheet is
 * closed by hand.
 */
export function useAskSonic(before?: () => void): (selection: AgentSelection, prompt: string) => void {
  const panel = useContext(AgentPanelContext);
  return useCallback((selection: AgentSelection, prompt: string) => {
    before?.();
    if (!panel) return;
    panel.setSelection(selection);
    panel.ask(prompt);
  }, [panel, before]);
}

/** Whether "Ask Sonic" actions belong on the page (SPEC-tasks-12): false outside the provider, for viewers and for visitors. */
export function useCanChat(): boolean {
  const panel = useContext(AgentPanelContext);
  return Boolean(panel) && panel?.canChat !== false;
}

/**
 * Publish what this page shows so the agent can see it. Call once per page with stable values
 * (ids joined, the open record); the screen is cleared when the page unmounts.
 */
export function useAgentScreen(screen: AgentScreen | null) {
  const panel = useContext(AgentPanelContext);
  const key = JSON.stringify(screen ?? null);
  useEffect(() => {
    if (!panel) return undefined;
    panel.setScreen(screen);
    return () => panel.setScreen(null);
    // The serialised key is the dependency: pages pass fresh objects on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, panel?.setScreen]);
}

export interface PageDescription { name: string; family: string; prompts: string[] }

// Prompts are things the agent can answer from NerveCenter's own data (its nervecenter tools) or do
// through its skills. Keep each one checked against the demo data when changing them.
const PAGE_PROMPTS: Record<string, string[]> = {
  "/tickets": ["Which of these should I pick up first?", "What is assigned to me and where is each one stuck?", "Which tickets can be closed based on your findings?"],
  "/monitor": ["Why did the failed pipelines fail?", "What breaks downstream if this pipeline stays down?", "Which failures have no ticket yet?", "Which jobs are slower than usual this week?"],
  "/data-quality": ["Explain today's failing checks in plain words", "Show me the rows behind the worst failing check", "Which failing checks have no ticket?", "Which datasets fail most often?"],
  "/tasks": ["What is waiting on me?", "Summarize what you did today", "Which tasks failed and why?"],
  "/inbox": ["What exactly would each approval change?", "Which of these are safe to approve?"],
  "/routines": ["Set up a weekday 9 AM review of new P1 and P2 tickets", "Which routines ran today and what did they find?"],
  "/skills": ["Which skill handles access requests?", "What does the rca skill check before it concludes?"],
  "/knowledge": ["What is missing from our knowledge that you need to work well here?", "Turn the documents I upload into knowledge pages for review", "What does our knowledge say about closing incidents?", "Is anything in the knowledge base out of date?"],
  "/connectors": ["Check that every connection still works", "What can you do with each connection?"],
  "/settings": ["Explain the current approval policy", "Which changes will pause for an approval?"],
  "/boards": ["Build me a board for my daily stand-up", "Add a tile for failed pipelines this week to this board", "Which boards show ticket numbers?"],
  "/": ["What needs my attention right now?", "Plan my day", "What changed since yesterday?"],
};

export function describePage(pathname: string): PageDescription {
  const page = APP_PAGES.find((item) => (item.to === "/" ? pathname === "/" : pathname.startsWith(item.to)));
  return page ? { name: page.label, family: page.label, prompts: PAGE_PROMPTS[page.to] } : { name: pathname, family: pathname, prompts: ["What can you help me with here?"] };
}

// The conversation open per page family. Here rather than in the panel so the pill can read it without loading the panel.
const CONVERSATIONS_KEY = "nc-agent-panel-conversations";
export function readConversations(): Record<string, string> { try { return JSON.parse(window.sessionStorage.getItem(CONVERSATIONS_KEY) || "{}"); } catch { return {}; } }
export function saveConversations(value: Record<string, string>) { window.sessionStorage.setItem(CONVERSATIONS_KEY, JSON.stringify(value)); }
