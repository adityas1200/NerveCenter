import { Check, LogOut, Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { BrandMark } from "@/components/layout/BrandMark";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui";
import { useIsAdmin, useMe } from "@/auth/rbac";
import { logout as endSession } from "@/auth-session";
import { OutsideLink } from "@/lib/appRouter";
import { getCurrentUser } from "@/lib/user";
import { useTheme, type Theme } from "@/lib/theme";
import { cn } from "@/lib/utils";

/**
 * The frame of the pages outside any project (SPEC-projects-03 FR-16, FR-19, FR-20): Home, New project and the admin
 * console sit on the app frame with a quiet top bar (FR-24). The bar holds the brand (home), the admin console for app admins, and
 * the person's menu: who they are, their app role, appearance and sign-out.
 */
export function OutsidePage({ crumb, children }: { crumb?: string; children: ReactNode }) {
  const [theme, setTheme] = useTheme();
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return (
    <div className="min-h-[100dvh] bg-surface-base text-ink-1">
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <header className={cn("sticky top-0 z-30 flex h-[60px] items-center gap-3 px-5 transition-[background-color,box-shadow] duration-200 lg:px-7", scrolled && "bg-surface-base/80 shadow-[0_1px_0_rgb(var(--c-line))] backdrop-blur-xl backdrop-saturate-150")}>
        <OutsideLink to="/" className="flex items-center gap-2.5 rounded-lg px-1 text-[15.5px] font-semibold tracking-[-0.01em] text-ink-1" aria-label="NerveCenter home">
          <BrandMark size={24} />
          NerveCenter
        </OutsideLink>
        {crumb ? <><span className="text-ink-5" aria-hidden="true">/</span><span className="text-[14px] font-medium text-ink-4">{crumb}</span></> : null}
        <span className="flex-1" />
        <AdminLink />
        <PersonMenu theme={theme} onThemeChange={setTheme} />
      </header>
      <main id="main-content" tabIndex={-1} className="outline-none">{children}</main>
    </div>
  );
}

function AdminLink() {
  const admin = useIsAdmin();
  if (!admin) return null;
  return <OutsideLink to="/admin" className="hidden h-8 items-center rounded-lg px-3 text-[13px] font-medium text-ink-3 transition-colors hover:bg-ink-1/[0.05] hover:text-ink-1 sm:inline-flex">Admin console</OutsideLink>;
}

const APP_ROLE: Record<string, string> = { admin: "Admin", developer: "Developer", viewer: "Viewer" };

/** The person's menu, top right. */
export function PersonMenu({ theme, onThemeChange }: { theme: Theme; onThemeChange: (theme: Theme) => void }) {
  const [open, setOpen] = useState(false);
  const user = getCurrentUser();
  const me = useMe().data;
  const appRole = me?.appRole ?? me?.role;
  const admin = appRole === "admin";
  const item = "flex h-8 w-full items-center gap-2 rounded-lg px-2 text-[13.5px] font-medium text-ink-2 transition-colors hover:bg-surface-subtle hover:text-ink-1";
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" aria-label="Open your menu" className="flex h-8 w-8 items-center justify-center rounded-full bg-ink-1 text-[11.5px] font-semibold text-raised transition-shadow hover:shadow-[0_0_0_3px_rgb(var(--c-ink-1)/0.12)]">{user.initials}</button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="w-64 rounded-xl border border-line bg-raised p-0 shadow-modal">
        <div className="flex items-start gap-2 border-b border-line px-3.5 py-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[14px] font-semibold text-ink-1">{user.name}</p>
            <p className="mt-0.5 truncate text-[12.5px] text-ink-4">{user.email}</p>
          </div>
          {appRole ? <span className={cn("mt-0.5 rounded-full px-2 py-0.5 text-[11px] font-semibold", admin ? "bg-brand/10 text-brand" : "bg-ink-1/[0.06] text-ink-3")}>{APP_ROLE[appRole] ?? appRole}</span> : null}
        </div>
        <div className="p-1.5">
          <p className="px-2 pb-1 pt-1 text-[12px] font-medium text-ink-5">Appearance</p>
          {(["light", "dark", "system"] as const).map((option) => (
            <button key={option} type="button" role="menuitemradio" aria-checked={theme === option} onClick={() => onThemeChange(option)} className={item}>
              {option === "light" ? <Sun className="h-3.5 w-3.5 text-ink-4" aria-hidden="true" /> : option === "dark" ? <Moon className="h-3.5 w-3.5 text-ink-4" aria-hidden="true" /> : <Monitor className="h-3.5 w-3.5 text-ink-4" aria-hidden="true" />}
              <span className="flex-1 text-left">{option === "light" ? "Light" : option === "dark" ? "Dark" : "System"}</span>
              {theme === option ? <Check className="h-3.5 w-3.5 text-ink-1" aria-hidden="true" /> : null}
            </button>
          ))}
          <div className="-mx-1.5 my-1.5 h-px bg-line" />
          <button type="button" onClick={() => { setOpen(false); void endSession(); }} className={item}><LogOut className="h-3.5 w-3.5 text-ink-4" aria-hidden="true" />Sign out</button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
