import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Every error in three parts: what happened (one sentence), why (one sentence, plain words), and
 * what to do next (a sentence or a button). The raw backend text goes behind a Details disclosure
 * so it is there for whoever needs it without being the headline.
 */
export interface ErrorNoticeProps {
  what: ReactNode;
  why?: ReactNode;
  /** One action: a sentence, or a Button/Link. */
  next?: ReactNode;
  /** Raw message, stack or response for the Details disclosure. */
  detail?: string | null;
  className?: string;
  /** `compact` drops the card padding for use inside a dialog or a table cell. */
  compact?: boolean;
}

export function ErrorNotice({ what, why, next, detail, className, compact = false }: ErrorNoticeProps) {
  const raw = detail ? String(detail).trim() : "";
  return (
    <div role="alert" className={cn("rounded-2xl border border-rose-200/90 bg-rose-50/80 text-[14px]", compact ? "px-3.5 py-3" : "p-5", className)}>
      <p className="font-medium text-ink-1">{what}</p>
      {why ? <p className="mt-1 text-[13.5px] leading-5 text-ink-3">{why}</p> : null}
      {next ? <div className="mt-3 text-[13.5px] text-ink-2">{next}</div> : null}
      {raw ? (
        <details className="mt-3 text-[13px] text-rose-900/80">
          <summary className="cursor-pointer font-medium text-rose-800">Details</summary>
          <pre className="mt-1.5 whitespace-pre-wrap break-words font-mono text-[12.5px] leading-relaxed">{raw}</pre>
        </details>
      ) : null}
    </div>
  );
}
