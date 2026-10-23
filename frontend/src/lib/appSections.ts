import { useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { BookOpen, Clock3, Gauge, Inbox, LayoutDashboard, ListChecks, Network, Plug, Settings, ShieldCheck, Ticket, Puzzle, type LucideIcon } from "lucide-react";
import { settingsApi, settingsKeys } from "@/api/settings";
import { useMe } from "@/auth/rbac";
import { useProject } from "@/lib/projectContext";
import { FRESH } from "@/api/queryPolicy";

/**
 * The optional feature sections a workspace can turn off entirely (Settings → Workspace →
 * Sections): hidden from the sidebar and blocked at the route, not just a hidden menu item. Ids
 * match `operations.ui.disabledSections`; every other nav item (Tickets, Tasks, Inbox, Connectors,
 * Settings) is structural and always on.
 */
export interface AppSection { id: string; label: string }

/**
 * Every page of the app, once: the sidebar, the command palette, the G-then-letter shortcuts, the
 * Settings section toggles and the agent panel's page names all derive from this list. Order is the
 * sidebar order. `section` is the id the page can be disabled under, `admin` means app admins only, and
 * `members` hides the page from a visitor to an open project, who may not read it (SPEC-projects-03 FR-13).
 */
export interface AppPage {
  to: string;
  label: string;
  icon: LucideIcon;
  group: "Operations" | "Automation" | "Platform";
  /** The key after G. */
  goKey: string;
  /** Extra words the command palette searches. */
  keywords?: string;
  section?: string;
  admin?: boolean;
  members?: boolean;
}

export const APP_PAGES: readonly AppPage[] = [
  { to: "/", label: "Overview", icon: Gauge, group: "Operations", goKey: "o", keywords: "home dashboard" },
  { to: "/tickets", label: "Tickets", icon: Ticket, group: "Operations", goKey: "t", keywords: "incidents servicenow jira" },
  { to: "/monitor", label: "Pipelines", icon: Network, group: "Operations", goKey: "p", section: "pipelines", keywords: "jobs runs databricks monitor" },
  { to: "/data-quality", label: "Data quality", icon: ShieldCheck, group: "Operations", goKey: "d", section: "data-quality", keywords: "checks dq" },
  { to: "/boards", label: "Boards", icon: LayoutDashboard, group: "Operations", goKey: "b", section: "boards", keywords: "dashboards charts" },
  { to: "/tasks", label: "Tasks", icon: ListChecks, group: "Operations", goKey: "a", keywords: "work history chats", members: true },
  { to: "/inbox", label: "Inbox", icon: Inbox, group: "Operations", goKey: "i", keywords: "approvals questions", members: true },
  { to: "/routines", label: "Routines", icon: Clock3, group: "Automation", goKey: "r", section: "routines", keywords: "schedules automation", members: true },
  { to: "/skills", label: "Skills", icon: Puzzle, group: "Automation", goKey: "s", section: "skills" },
  { to: "/knowledge", label: "Knowledge", icon: BookOpen, group: "Automation", goKey: "k", section: "knowledge", keywords: "docs repositories" },
  { to: "/connectors", label: "Connectors", icon: Plug, group: "Platform", goKey: "c", admin: true, keywords: "connections integrations" },
  { to: "/settings", label: "Settings", icon: Settings, group: "Platform", goKey: ",", members: true, keywords: "policy people sources workspace" },
];

/** Whether this person sees a page here: app-admin pages for app admins, member pages for anyone but a visitor. */
export function usePageAllowed(): (page: AppPage) => boolean {
  const me = useMe().data;
  const { visitor } = useProject();
  const admin = (me?.appRole ?? me?.role) === "admin";
  return useCallback((page: AppPage) => (!page.admin || admin) && (!page.members || !visitor), [admin, visitor]);
}

export const APP_SECTIONS: readonly AppSection[] = APP_PAGES.filter((page) => page.section).map((page) => ({ id: page.section as string, label: page.label }));

/** Disabled sections read from operations.yaml; empty (nothing disabled) until settings load, so a
 * page never flashes disabled while its first request is still in flight. */
export function useDisabledSections(): Set<string> {
  // A visitor to an open project does not read its settings (SPEC-projects-03 FR-13), so nothing reads as disabled.
  const { visitor } = useProject();
  const query = useQuery({ queryKey: settingsKeys.all, queryFn: ({ signal }) => settingsApi.get(signal), staleTime: FRESH.medium, enabled: !visitor });
  return new Set(query.data?.operations?.ui?.disabledSections ?? []);
}

export function useSectionEnabled(id: string): boolean {
  return !useDisabledSections().has(id);
}
