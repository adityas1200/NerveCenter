import { OutsidePage } from "@/components/layout/OutsideChrome";
import { OutsideLink } from "@/lib/appRouter";

/** SPEC-projects-03 FR-14: a project URL the person cannot open. The same page whether or not the project exists. */
export function NoAccessPage() {
  return (
    <OutsidePage>
      <section className="mx-auto grid w-[min(1240px,calc(100vw-48px))] justify-items-start gap-5 pt-[18vh]">
        <span className="font-mono text-[11px] font-medium uppercase tracking-[0.06em] text-ink-4">No access</span>
        <h1 className="m-0 font-display text-[40px] font-bold leading-[1.1] tracking-[-0.03em] text-ink-1">This project isn&apos;t shared with you.</h1>
        <OutsideLink to="/" className="inline-flex h-9 items-center rounded-lg border border-line-strong bg-raised px-4 text-[13.5px] font-semibold text-ink-1 shadow-card transition-colors hover:bg-surface-hover">All projects</OutsideLink>
      </section>
    </OutsidePage>
  );
}
