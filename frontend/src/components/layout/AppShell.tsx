import { ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { Sidebar } from "@/components/layout/Sidebar";
import { CommandPalette } from "@/components/layout/CommandPalette";
import { PageHeaderOutletContext, PageTitleOutletContext } from "@/components/layout/PageHeaderOutlet";
import { Topbar } from "@/components/layout/Topbar";
import { AgentPanelProvider } from "@/components/ops/AgentPanel";
import { sweepOrphanedMermaidElements } from "@/lib/mermaidCleanup";
import { useProject } from "@/lib/projectContext";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";

const SIDEBAR_COLLAPSED_KEY = "nc-sidebar-collapsed";

/** Pages that own the whole area under the top bar (a task, a skill, a knowledge base) get no padding and no centred max-width. */
const FULL_BLEED = /^\/(tasks\/(?!new$)[^/]+|skills\/[^/]+|knowledge\/[^/]+)/;

function readCollapsedPreference() {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

export function AppShell({ children }: { children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(readCollapsedPreference);
  const [pageHeaderOutlet, setPageHeaderOutlet] = useState<HTMLElement | null>(null);
  const [pageTitleOutlet, setPageTitleOutlet] = useState<HTMLElement | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const openPalette = useCallback(() => setPaletteOpen(true), []);
  const [theme, setTheme] = useTheme();
  const { visitor } = useProject();
  const location = useLocation();
  const fullBleed = FULL_BLEED.test(location.pathname);
  // A new section fades in; moving within one (a ticket opening over the list) does not remount the page.
  const section = location.pathname.split("/")[1] ?? "";
  // The working panel scrolls on its own, so a new page starts at its top.
  const scroller = useRef<HTMLDivElement | null>(null);
  useEffect(() => { scroller.current?.scrollTo?.({ top: 0 }); }, [location.pathname]);
  // How far the panel has scrolled, as two flags for the top bar: past the very top (the bar frosts)
  // and past the large title (its compact copy shows in the bar). React skips renders when neither flips.
  const [scrolled, setScrolled] = useState(false);
  const [pastTitle, setPastTitle] = useState(false);
  useEffect(() => {
    const element = scroller.current;
    if (!element) return undefined;
    const onScroll = () => { setScrolled(element.scrollTop > 2); setPastTitle(element.scrollTop > 52); };
    onScroll();
    element.addEventListener("scroll", onScroll, { passive: true });
    return () => element.removeEventListener("scroll", onScroll);
  }, []);

  // A mermaid diagram that fails to parse can leave a "bomb" error SVG stuck straight on
  // document.body, outside React's tree - which then survives every client-side route change on
  // its own. Sweep for it on every navigation (and once on first mount, for a stale one already
  // sitting there from before this page loaded).
  useEffect(() => { sweepOrphanedMermaidElements(); }, [location.pathname]);

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? "1" : "0");
    } catch {
      /* ignore storage failures */
    }
  }, [collapsed]);

  const toggleSidebar = useCallback(() => {
    if (typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches) {
      setCollapsed((value) => !value);
      setMobileOpen(false);
      return;
    }
    setMobileOpen((value) => !value);
  }, []);

  const closeMobileSidebar = useCallback(() => setMobileOpen(false), []);

  return (
    <AgentPanelProvider>
      <div className="ops-canvas flex h-[100dvh] overflow-hidden">
        <a className="skip-link" href="#main-content">Skip to main content</a>
        <Sidebar open={mobileOpen} collapsed={collapsed} onClose={closeMobileSidebar} onToggle={toggleSidebar} theme={theme} onThemeChange={setTheme} />
        {/* The working area: one panel on the frame, its own scroll container, so the top bar
            stays pinned inside the rounded edge and the sidebar never moves. */}
        <div className="flex min-w-0 flex-1 flex-col lg:py-2 lg:pr-2">
          <div ref={scroller} data-scroll-root="" className="shell-panel relative flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto overflow-x-hidden lg:rounded-xl">
            <PageHeaderOutletContext.Provider value={pageHeaderOutlet}>
              <PageTitleOutletContext.Provider value={fullBleed ? null : pageTitleOutlet}>
                <Topbar onPageHeaderOutlet={setPageHeaderOutlet} onSearch={openPalette} flat={!fullBleed && !scrolled} condensed={fullBleed || pastTitle} roomy={!fullBleed} />
                <main id="main-content" tabIndex={-1} className={cn("relative z-[1] flex w-full min-w-0 flex-1 flex-col", fullBleed ? "" : "mx-auto max-w-[1440px] px-5 pb-24 pt-5 lg:px-8")}>
                  {fullBleed ? null : <div ref={setPageTitleOutlet} />}
                  {/* SPEC-projects-03 FR-12: a visitor to an open project reads it and changes nothing. */}
                  {visitor ? <p role="note" className="mb-4 flex items-center gap-2 rounded-lg border border-line bg-raised px-3 py-2 text-[13px] text-ink-3"><span className="rounded-full bg-ink-1/[0.06] px-2 py-0.5 text-[11.5px] font-semibold text-ink-2">View only</span>Open to everyone. Ask an owner to add you to work in it.</p> : null}
                  <div key={section} className={cn("page-enter flex min-w-0 flex-1 flex-col", fullBleed && "min-h-0")}>{children}</div>
                </main>
              </PageTitleOutletContext.Provider>
            </PageHeaderOutletContext.Provider>
          </div>
        </div>
      </div>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} theme={theme} onThemeChange={setTheme} />
    </AgentPanelProvider>
  );
}
