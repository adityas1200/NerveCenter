import {
  ChevronsLeft,
  ChevronsRight,
  Menu,
  PenLine,
  X,
  type LucideIcon,
} from "lucide-react";
import { NavLink, useMatch } from "react-router-dom";
import { BrandMark } from "@/components/layout/BrandMark";
import { ProjectHeader } from "@/components/layout/ProjectHeader";
import { SidebarProfile } from "@/components/layout/SidebarProfile";
import { Button, Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui";
import { cn } from "@/lib/utils";
import type { Theme } from "@/lib/theme";
import { useMe } from "@/auth/rbac";
import { useInboxPending } from "@/features/inbox/useInboxPending";
import { APP_PAGES, useDisabledSections, usePageAllowed } from "@/lib/appSections";
import { OutsideLink } from "@/lib/appRouter";
import { useProject } from "@/lib/projectContext";

/**
 * Navigation on the app frame. Plain rows; the page you are on is a raised chip, the way a selected
 * tab sits above its strip. `New task` is the one button in the shell, with its shortcut (C) beside it.
 * The keys themselves are handled by the command palette, which lists them all.
 */

// Pages come from APP_PAGES (lib/appSections). `admin` is the required role and `section` the id a
// page can be disabled under (Settings → Workspace → Sections). Tickets, Tasks, Inbox, Connectors and
// Settings are structural and have no section id, so they are never affected by that toggle.
const GROUP_ORDER = ["Operations", "Automation", "Platform"] as const;
const groups = GROUP_ORDER.map((label) => ({ label, items: APP_PAGES.filter((page) => page.group === label) }));

function SidebarNavItem({ to, label, icon: Icon, collapsed, onNavigate, end, badge }: { to: string; label: string; icon: LucideIcon; collapsed: boolean; onNavigate: () => void; end?: boolean; badge?: number }) {
  // A plain string class: the tooltip trigger merges props into the link, and a function className would be lost.
  const isActive = Boolean(useMatch({ path: to, end: Boolean(end) }));
  const link = (
    <NavLink
      to={to}
      end={end}
      onClick={onNavigate}
      aria-label={collapsed ? label : undefined}
      aria-current={isActive ? "page" : undefined}
      className={cn(
        "group/nav flex items-center rounded-lg text-[13.5px] font-medium transition-[background-color,color,box-shadow] duration-150",
        collapsed ? "sidebar-rail-item mx-auto h-9 w-9 justify-center" : "mb-px h-8 gap-2.5 px-2.5",
        isActive ? "bg-raised text-ink-1 shadow-[0_0_0_1px_rgb(var(--c-line)),var(--shadow-card)]" : "text-ink-3 hover:bg-ink-1/[0.045] hover:text-ink-1",
      )}
    >
      <span className="relative flex shrink-0">
        <Icon className={cn("h-4 w-4 shrink-0 transition-colors", isActive ? "text-brand" : "text-ink-4 group-hover/nav:text-ink-2")} strokeWidth={1.9} aria-hidden="true" />
        {badge && collapsed ? <span className="absolute -right-1.5 -top-1.5 h-2 w-2 rounded-full bg-amber-500 ring-2 ring-surface-base" aria-hidden="true" /> : null}
      </span>
      {!collapsed ? <span className="flex-1 truncate">{label}</span> : null}
      {!collapsed && badge ? <span className="min-w-[18px] rounded-full bg-amber-500 px-1.5 py-0.5 text-center text-[11px] font-semibold leading-none tabular-nums text-white" aria-label={`${badge} waiting on you`}>{badge > 9 ? "9+" : badge}</span> : null}
    </NavLink>
  );
  if (!collapsed) return link;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

export function Sidebar({ open, collapsed, onClose, onToggle, theme, onThemeChange }: { open: boolean; collapsed: boolean; onClose: () => void; onToggle: () => void; theme: Theme; onThemeChange: (theme: Theme) => void }) {
  const handleNavigate = () => {
    if (typeof window !== "undefined" && window.innerWidth < 1024) onClose();
  };
  const role = useMe().data?.role;
  const allowed = usePageAllowed();
  const { visitor } = useProject();
  const inboxPending = useInboxPending();
  const disabledSections = useDisabledSections();
  const visibleGroups = groups
    .map((group) => ({
      ...group,
      items: group.items.filter((page) => {
        if (!allowed(page)) return false;
        if (page.section && disabledSections.has(page.section)) return false;
        return true;
      }),
    }))
    .filter((group) => group.items.length > 0);

  return (
    <>
      {!open ? (
        <Button variant="ghost" size="icon" className="fixed left-3 top-2.5 z-50 h-9 w-9 rounded-lg text-ink-3 hover:bg-surface-subtle lg:hidden" onClick={onToggle} aria-label="Open navigation" aria-expanded={false}>
          <Menu className="h-4 w-4" />
        </Button>
      ) : null}

      <div className={cn("fixed inset-0 z-40 bg-slate-950/25 transition-opacity duration-300 lg:hidden", open ? "opacity-100" : "pointer-events-none opacity-0")} onClick={onClose} aria-hidden="true" />

      <aside
        className={cn(
          "shell-sidebar z-50 flex flex-col transition-[width,transform] duration-300 ease-out",
          collapsed ? "lg:w-14" : "lg:w-[232px]",
          "fixed inset-y-0 left-0 w-64",
          open ? "translate-x-0" : "-translate-x-full",
          "lg:static lg:h-full lg:translate-x-0",
        )}
        aria-label="Primary navigation"
        data-collapsed={collapsed ? "true" : "false"}
      >
        <div className={cn("group flex h-14 shrink-0 items-center", collapsed ? "justify-center px-2" : "gap-2 pl-3.5 pr-2")}>
          <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg text-ink-4 hover:bg-surface-subtle hover:text-ink-1 lg:hidden" onClick={onToggle} aria-label="Close navigation">
            <X className="h-4 w-4" />
          </Button>
          {/* The brand goes home: the projects, outside this one (SPEC-projects-03 FR-14). */}
          <OutsideLink to="/" onClick={handleNavigate} className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-1" aria-label="NerveCenter home">
            <BrandMark size={collapsed ? 26 : 26} />
            {!collapsed ? <span className="truncate font-display text-[15.5px] font-semibold leading-none text-ink-1">NerveCenter</span> : null}
          </OutsideLink>
          {!collapsed ? (
            <Button variant="ghost" size="icon" className="hidden h-8 w-8 shrink-0 rounded-lg text-ink-5 opacity-0 transition-opacity hover:bg-surface-subtle hover:text-ink-1 focus-visible:opacity-100 group-hover:opacity-100 lg:inline-flex" onClick={onToggle} aria-label="Collapse navigation" aria-expanded>
              <ChevronsLeft className="h-4 w-4" />
            </Button>
          ) : null}
        </div>
        {collapsed ? (
          <div className="hidden justify-center pb-1 lg:flex">
            <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg text-ink-5 hover:bg-surface-subtle hover:text-ink-1" onClick={onToggle} aria-label="Expand navigation" aria-expanded={false}>
              <ChevronsRight className="h-4 w-4" />
            </Button>
          </div>
        ) : null}

        <div className={cn("shrink-0", collapsed ? "px-2 pb-2" : "px-3 pb-3 pt-1")}>
          <ProjectHeader collapsed={collapsed} onNavigate={handleNavigate} />
        </div>

        {/* Starting work is for the project's developers and owners; viewers and visitors do not get the button. */}
        {role !== "viewer" && !visitor ? <div className={cn("shrink-0 pb-1", collapsed ? "px-2" : "px-3")}>
          {collapsed ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <NavLink to="/tasks/new" onClick={handleNavigate} aria-label="New task" className="mx-auto flex h-9 w-9 items-center justify-center rounded-lg bg-raised text-ink-1 shadow-[0_0_0_1px_rgb(var(--c-line)),var(--shadow-card)] transition-colors hover:text-brand">
                  <PenLine className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
                </NavLink>
              </TooltipTrigger>
              <TooltipContent side="right">New task · C</TooltipContent>
            </Tooltip>
          ) : (
            <NavLink to="/tasks/new" onClick={handleNavigate} className="group/new flex h-9 items-center gap-2.5 rounded-lg bg-raised px-2.5 text-[13.5px] font-semibold text-ink-1 shadow-[0_0_0_1px_rgb(var(--c-line)),var(--shadow-card)] transition-[box-shadow,color] duration-150 hover:shadow-[0_0_0_1px_rgb(var(--c-line-strong)),var(--shadow-card-hover)]">
              <PenLine className="h-4 w-4 shrink-0 text-brand" strokeWidth={2} aria-hidden="true" />
              <span className="flex-1">New task</span>
              <kbd className="!border-line !bg-surface-subtle !px-1.5 !text-[10.5px] !text-ink-4" aria-hidden="true">C</kbd>
            </NavLink>
          )}
        </div> : null}

        <nav className={cn("flex-1 overflow-y-auto overflow-x-hidden py-1", collapsed ? "px-2" : "px-3")}>
          {visibleGroups.map((group, groupIndex) => (
            <div key={group.label}>
              {!collapsed ? (
                <p className={cn("px-2.5 pb-1 text-[12px] font-medium text-ink-5", groupIndex === 0 ? "pt-3" : "pt-5")}>{group.label}</p>
              ) : groupIndex > 0 ? (
                <div className="mx-auto my-2 hidden h-px w-5 bg-line lg:block" aria-hidden="true" />
              ) : null}
              <div className={cn(collapsed && "space-y-0.5")}>
                {group.items.map(({ to, label, icon }) => (
                  <SidebarNavItem key={to} to={to} label={label} icon={icon} collapsed={collapsed} onNavigate={handleNavigate} end={to === "/"} badge={to === "/inbox" ? inboxPending : undefined} />
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div className={cn("shrink-0 py-3", collapsed ? "px-2" : "px-3")}>
          <SidebarProfile collapsed={collapsed} onNavigate={handleNavigate} theme={theme} onThemeChange={onThemeChange} />
        </div>
      </aside>
    </>
  );
}
