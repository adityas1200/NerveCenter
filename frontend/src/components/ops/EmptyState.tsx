import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The page-level "nothing here": one line drawing, a title, an optional sentence and one action.
 * Table rows that come up empty after a filter keep OpsTableEmpty; this is for the page itself.
 * Drawings are single-stroke outlines in the current text colour, no fills, no faces.
 */
export type EmptyIllustration = "tasks" | "inbox" | "checks" | "pipelines" | "knowledge" | "search";

export interface EmptyStateProps {
  title: ReactNode;
  body?: ReactNode;
  action?: ReactNode;
  illustration?: EmptyIllustration;
  className?: string;
}

export function EmptyState({ title, body, action, illustration, className }: EmptyStateProps) {
  return (
    <div data-testid="empty-state" className={cn("flex flex-col items-center justify-center gap-2 px-6 py-12 text-center", className)}>
      {illustration ? <Illustration kind={illustration} /> : null}
      <p className={cn("text-[14.5px] font-semibold text-ink-1", illustration && "mt-2")}>{title}</p>
      {body ? <p className="max-w-sm text-[13.5px] leading-5 text-ink-4">{body}</p> : null}
      {action ? <div className="mt-2 flex items-center gap-2">{action}</div> : null}
    </div>
  );
}

const STROKE = { fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round" } as const;

/** 96px outline drawings: a stack of cards, a tray, a check list, a pipe with a valve, a book, a magnifier. */
function Illustration({ kind }: { kind: EmptyIllustration }) {
  return (
    <svg width="96" height="96" viewBox="0 0 96 96" aria-hidden="true" data-illustration={kind} className="text-ink-5" {...STROKE}>
      {kind === "tasks" ? (
        <>
          <rect x="26" y="40" width="44" height="30" rx="5" />
          <path d="M31 33h34a5 5 0 0 1 5 5" />
          <path d="M36 26h24a5 5 0 0 1 5 5" />
          <path d="M34 50h16M34 58h24" />
        </>
      ) : null}
      {kind === "inbox" ? (
        <>
          <path d="M22 50v14a6 6 0 0 0 6 6h40a6 6 0 0 0 6-6V50" />
          <path d="M22 50l8-18h36l8 18" />
          <path d="M22 50h16l4 8h12l4-8h16" />
        </>
      ) : null}
      {kind === "checks" ? (
        <>
          <rect x="26" y="28" width="10" height="10" rx="2" />
          <path d="M28.5 33l2.5 2.5 4.5-5" />
          <path d="M42 33h28" />
          <rect x="26" y="43" width="10" height="10" rx="2" />
          <path d="M28.5 48l2.5 2.5 4.5-5" />
          <path d="M42 48h28" />
          <rect x="26" y="58" width="10" height="10" rx="2" />
          <path d="M42 63h20" />
        </>
      ) : null}
      {kind === "pipelines" ? (
        <>
          <path d="M18 44h20M58 44h20" />
          <path d="M18 52h20M58 52h20" />
          <path d="M18 40v16M78 40v16" />
          <circle cx="48" cy="48" r="10" />
          <path d="M48 38V28M42 28h12" />
          <path d="M43 48h10" />
        </>
      ) : null}
      {kind === "knowledge" ? (
        <>
          <path d="M48 32c-6-4-14-5-22-4v36c8-1 16 0 22 4 6-4 14-5 22-4V28c-8-1-16 0-22 4z" />
          <path d="M48 32v36" />
          <path d="M32 40c4-1 8-1 11 0M32 48c4-1 8-1 11 0M53 40c4-1 8-1 11 0M53 48c4-1 8-1 11 0" />
        </>
      ) : null}
      {kind === "search" ? (
        <>
          <circle cx="44" cy="44" r="16" />
          <path d="M55.5 55.5L70 70" />
          <path d="M36 42a8 8 0 0 1 6-6" />
        </>
      ) : null}
    </svg>
  );
}
