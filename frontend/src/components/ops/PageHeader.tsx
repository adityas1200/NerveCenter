import { ChevronLeft } from "lucide-react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { usePageHeaderOutlet, usePageTitleOutlet } from "@/components/layout/PageHeaderOutlet";
import { OverflowMenu, type MenuEntry } from "@/components/ops/OverflowMenu";

/**
 * The page header, in two parts. The large title opens the page content: the title and one quiet
 * piece of data ("15 open"). The 56px top bar holds the back chevron with its breadcrumb and the
 * controls on compact pages: status, at most one primary button, and a `•••` menu for the rest. Once the large title
 * scrolls under the bar, a compact copy of it fades into the bar. Full-bleed pages (a task, a skill)
 * and pages with their own hero (`compact`) keep the compact title in the bar only.
 * Sentences do not belong here; time-range pickers and filters sit in the page content.
 */
export interface PageHeaderProps {
  title: string;
  /** Quiet data shown after the title: "2 open", "14 skills". Not a sentence. */
  count?: ReactNode;
  /** @deprecated Rendered like `count`. Rewrite callers to pass data, not prose. */
  subtitle?: string;
  back?: { to: string; label: string };
  status?: ReactNode;
  /** Small controls that stay visible, such as the refresh icon. Rendered before the primary button. */
  actions?: ReactNode;
  primary?: ReactNode;
  menu?: MenuEntry[];
  /** Keep the title in the top bar only, for pages that open with their own heading. */
  compact?: boolean;
}

export function PageHeader({ title, count, subtitle, back, status, actions, primary, menu, compact = false }: PageHeaderProps) {
  const outlet = usePageHeaderOutlet();
  const titleOutlet = usePageTitleOutlet();
  const meta = count ?? subtitle;
  const large = Boolean(titleOutlet) && !compact;
  const right = status || actions || primary || menu?.some(Boolean) ? (
    <div className="flex shrink-0 items-center gap-2">
      {status}
      {actions}
      {primary}
      {menu ? <OverflowMenu items={menu} /> : null}
    </div>
  ) : null;

  const crumbs = back ? (
    <>
      <Link to={back.to} aria-label={`Back to ${back.label}`} className="-ml-2 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ink-4 transition-colors hover:bg-surface-subtle hover:text-ink-1">
        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
      </Link>
      <Link to={back.to} className="hidden shrink-0 text-[14px] text-ink-4 transition-colors hover:text-ink-1 md:inline">{back.label}</Link>
      {large ? null : <span className="hidden text-[14px] text-ink-5 md:inline" aria-hidden="true">/</span>}
    </>
  ) : null;

  const barTitle = large
    ? <span data-compact-title aria-hidden="true" className="flex min-w-0 items-baseline gap-2">{back ? <span className="hidden text-[14px] text-ink-5 md:inline">/</span> : null}<span className="truncate font-display text-[15px] font-semibold leading-6 text-ink-1">{title}</span>{meta ? <span className="hidden min-w-0 truncate text-[13.5px] tabular-nums text-ink-4 sm:inline">{meta}</span> : null}</span>
    : <span className="flex min-w-0 items-baseline gap-2"><h1 className="truncate font-display text-[15.5px] font-semibold leading-6 text-ink-1">{title}</h1>{meta ? <span className="hidden min-w-0 truncate text-[13.5px] tabular-nums text-ink-4 sm:inline">{meta}</span> : null}</span>;

  const bar = (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <div className="flex min-w-0 flex-1 items-center gap-2">{crumbs}{barTitle}</div>
      {!large ? right : null}
    </div>
  );

  const largeTitle = (
    <div className="mb-7 flex min-w-0 flex-wrap items-start justify-between gap-x-4 gap-y-2">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="min-w-0 break-words font-display text-[30px] font-semibold leading-[36px] tracking-[-0.025em] text-ink-1">{title}</h1>
        {meta ? <span className="text-[15px] tabular-nums text-ink-4">{meta}</span> : null}
      </div>
      {right}
    </div>
  );

  if (!outlet) return <div className="mb-6 flex min-h-[40px] items-center">{bar}</div>;
  return (
    <>
      {createPortal(bar, outlet)}
      {large && titleOutlet ? createPortal(largeTitle, titleOutlet) : null}
    </>
  );
}
