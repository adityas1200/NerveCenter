import { Search } from "lucide-react";
import { NotificationsTray } from "@/components/layout/NotificationsTray";
import { MOD } from "@/lib/shortcuts";
import { cn } from "@/lib/utils";

/**
 * The 56px bar above every page. Pages render their breadcrumb and controls into it through
 * `PageHeader`; search (Ctrl K) and the bell sit on the right. Over the top of a page with a large
 * title the bar is clear and borderless; once the page scrolls it frosts, and once the large title
 * has gone under it, the compact title fades in.
 */
export function Topbar({ onPageHeaderOutlet, onSearch, flat, condensed, roomy }: { onPageHeaderOutlet: (element: HTMLElement | null) => void; onSearch: () => void; flat: boolean; condensed: boolean; /** Room for the wide search field; full-bleed pages need the bar for their own header. */ roomy: boolean }) {
  return (
    <header className="shell-topbar sticky top-0 z-30 h-14 shrink-0" data-flat={flat ? "true" : undefined} data-condensed={condensed ? "true" : "false"}>
      <div className="flex h-14 items-center pl-16 pr-4 lg:px-6">
        <div ref={onPageHeaderOutlet} className="flex min-w-0 flex-1 items-center" />
        <div className="ml-3 flex shrink-0 items-center gap-1 border-l border-line pl-3">
          <button
            type="button"
            onClick={onSearch}
            aria-label="Search and commands"
            aria-keyshortcuts="Control+K Meta+K"
            className={cn("group/search flex h-8 items-center gap-2 rounded-lg px-2 text-ink-4 transition-colors hover:bg-ink-1/[0.05] hover:text-ink-1", roomy && "xl:w-[200px] xl:border xl:border-line xl:bg-raised xl:px-2.5 xl:shadow-card xl:hover:border-line-strong xl:hover:bg-raised")}
          >
            <Search className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className={cn("hidden flex-1 text-left text-[13px]", roomy && "xl:inline")}>Search</span>
            <kbd className={cn("hidden !text-[10.5px]", roomy && "xl:inline")} aria-hidden="true">{MOD} K</kbd>
          </button>
          <NotificationsTray />
        </div>
      </div>
    </header>
  );
}
