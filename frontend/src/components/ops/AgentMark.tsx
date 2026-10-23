import { cn } from "@/lib/utils";

const logoSrc = `${import.meta.env.BASE_URL}nervecenter-favicon.svg`;

/**
 * What Sonic is doing, shown on its mark: thinking pulses softly, waiting holds a still amber ring,
 * done is a solid mark, idle is plain.
 */
export type AgentMarkState = "idle" | "thinking" | "waiting" | "done";

/** Sonic's mark: the NerveCenter loop on a white disc, so the agent and the app share one face. */
export function AgentMark({ size = 22, state, live = false, className }: { size?: number; state?: AgentMarkState; /** Alias for `state="thinking"`, kept for existing callers. */ live?: boolean; className?: string }) {
  const current: AgentMarkState = state ?? (live ? "thinking" : "idle");
  return (
    <span
      data-state={current}
      className={cn("relative inline-flex shrink-0 items-center justify-center rounded-full border bg-raised", current === "waiting" ? "border-amber-400 ring-2 ring-amber-400/60" : current === "done" ? "border-line-strong" : "border-line", className)}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <img src={logoSrc} width={Math.round(size * 0.7)} height={Math.round(size * 0.7)} alt="" draggable={false} className="relative z-[1] select-none" />
      {current === "thinking" ? <span className="absolute inset-0 animate-ping rounded-full bg-brand/40" style={{ animationDuration: "1.8s" }} /> : null}
    </span>
  );
}
