import { Check, LayoutGrid, LogOut, Monitor, Moon, Shield, Sun } from "lucide-react";
import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger, Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui";
import { getCurrentUser } from "@/lib/user";
import { logout as endSession } from "@/auth-session";
import { useIsAdmin } from "@/auth/rbac";
import { goTo } from "@/lib/appRouterCore";
import type { Theme } from "@/lib/theme";
import { cn } from "@/lib/utils";

/** The person at the bottom of the sidebar. The menu holds appearance, the way to every project (Home), the admin console for app admins, and sign-out (SPEC-projects-03 FR-20). */
export function SidebarProfile({ collapsed, onNavigate, theme, onThemeChange }: { collapsed: boolean; onNavigate: () => void; theme: Theme; onThemeChange: (theme: Theme) => void }) {
  const [open, setOpen] = useState(false);
  const user = getCurrentUser();
  const admin = useIsAdmin();

  const logout = () => {
    setOpen(false);
    onNavigate();
    void endSession();
  };

  const trigger = (
    <button
      type="button"
      className={cn(
        "flex items-center gap-2.5 rounded-lg text-left transition-colors hover:bg-ink-1/[0.045] focus-visible:bg-ink-1/[0.045] focus-visible:outline-none",
        collapsed ? "mx-auto h-9 w-9 justify-center" : "w-full px-2 py-2",
      )}
      aria-label="Open profile menu"
    >
      <span className={cn("flex shrink-0 items-center justify-center rounded-full bg-ink-1 font-semibold text-raised", collapsed ? "h-7 w-7 text-[11px]" : "h-7 w-7 text-[11.5px]")}>{user.initials}</span>
      {!collapsed ? (
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold leading-5 text-ink-1">{user.name}</span>
          <span className="block truncate text-[12px] leading-4 text-ink-4">{user.email}</span>
        </span>
      ) : null}
    </button>
  );

  const menu = (
    <PopoverContent side={collapsed ? "right" : "top"} align={collapsed ? "end" : "start"} sideOffset={8} className="w-64 rounded-xl border border-line bg-raised p-0 shadow-modal">
      <div className="border-b border-line px-3.5 py-3">
        <p className="truncate text-[14px] font-semibold text-ink-1">{user.name}</p>
        <p className="mt-0.5 truncate text-[12.5px] text-ink-4">{user.email}</p>
      </div>
      <div className="p-1.5">
        <p className="px-2 pb-1 pt-1.5 text-[12px] font-medium text-ink-5">Appearance</p>
        {(["light", "dark", "system"] as const).map((option) => (
          <button key={option} type="button" role="menuitemradio" aria-checked={theme === option} onClick={() => onThemeChange(option)} className="flex h-8 w-full items-center gap-2 rounded-lg px-2 text-[13.5px] font-medium text-ink-2 transition-colors hover:bg-surface-subtle hover:text-ink-1">
            {option === "light" ? <Sun className="h-3.5 w-3.5 text-ink-4" aria-hidden="true" /> : option === "dark" ? <Moon className="h-3.5 w-3.5 text-ink-4" aria-hidden="true" /> : <Monitor className="h-3.5 w-3.5 text-ink-4" aria-hidden="true" />}
            <span className="flex-1 text-left">{option === "light" ? "Light" : option === "dark" ? "Dark" : "System"}</span>
            {theme === option ? <Check className="h-3.5 w-3.5 text-ink-1" aria-hidden="true" /> : null}
          </button>
        ))}
        <div className="-mx-1.5 my-1.5 h-px bg-line" />
        <button type="button" onClick={() => { setOpen(false); onNavigate(); goTo("/"); }} className="flex h-8 w-full items-center gap-2 rounded-lg px-2 text-[13.5px] font-medium text-ink-2 transition-colors hover:bg-surface-subtle hover:text-ink-1">
          <LayoutGrid className="h-3.5 w-3.5 text-ink-4" aria-hidden="true" />
          All projects
        </button>
        {admin ? (
          <button type="button" onClick={() => { setOpen(false); onNavigate(); goTo("/admin"); }} className="flex h-8 w-full items-center gap-2 rounded-lg px-2 text-[13.5px] font-medium text-ink-2 transition-colors hover:bg-surface-subtle hover:text-ink-1">
            <Shield className="h-3.5 w-3.5 text-ink-4" aria-hidden="true" />
            Admin console
          </button>
        ) : null}
        <button type="button" onClick={logout} className="flex h-8 w-full items-center gap-2 rounded-lg px-2 text-[13.5px] font-medium text-ink-2 transition-colors hover:bg-surface-subtle hover:text-ink-1">
          <LogOut className="h-3.5 w-3.5 text-ink-4" aria-hidden="true" />
          Sign out
        </button>
      </div>
    </PopoverContent>
  );

  if (collapsed) {
    return (
      <Popover open={open} onOpenChange={setOpen}>
        <Tooltip>
          <TooltipTrigger asChild><PopoverTrigger asChild>{trigger}</PopoverTrigger></TooltipTrigger>
          <TooltipContent side="right">{user.name}</TooltipContent>
        </Tooltip>
        {menu}
      </Popover>
    );
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      {menu}
    </Popover>
  );
}
