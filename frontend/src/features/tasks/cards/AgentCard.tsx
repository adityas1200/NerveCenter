import type { ReactNode } from "react";
import { SurfaceCard, type SurfaceTone } from "@/components/ops/SurfaceCard";
import { cn } from "@/lib/utils";

/**
 * The frame every drawn card shares, as a thin wrapper over SurfaceCard so the agent's cards, approval
 * prompts and the rest of the app sit in one frame. The title renders as a heading so cards stay
 * addressable by name; `compact` tightens the body for the side panel. Colour lives only in the body,
 * on status, tone and numbers. `tone="success"` is for a one-line verdict banner ("Extraction complete");
 * plain findings/tables stay `"default"`.
 */
export function AgentCard({ title, note, action, tone = "default", compact = false, className, bodyClassName, children }: { title?: string | null; note?: string | null; action?: ReactNode; tone?: SurfaceTone; compact?: boolean; className?: string; bodyClassName?: string; children: ReactNode }) {
  return (
    <SurfaceCard
      label={title ? <h3 className="min-w-0 truncate">{title}</h3> : undefined}
      note={note ? <span title={note}>{note}</span> : undefined}
      actions={action}
      tone={tone}
      className={cn("min-w-0", className)}
      bodyClassName={cn("text-[14px] text-ink-2", compact && "px-3 pb-2.5", bodyClassName)}
    >
      {children}
    </SurfaceCard>
  );
}
