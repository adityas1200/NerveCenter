import { ThinkingOrb, type OrbState } from "thinking-orbs";
import { cn } from "@/lib/utils";

/** What Sonic is doing right now, in NerveCenter's words. `activityOf` in `features/tasks/stepLabels.ts` derives it from a tool name. */
export type Activity = "tool" | "read" | "search" | "web" | "ran" | "system" | "plan" | "writing" | "idle" | "building";

const STATE: Record<Activity, OrbState> = {
  tool: "working",
  read: "working",
  search: "searching",
  web: "searching",
  ran: "solving",
  system: "connecting",
  plan: "weaving",
  writing: "composing",
  idle: "breathing",
  building: "shaping",
};

/**
 * The one live indicator for "Sonic is doing this now": a 20 px monochrome orb whose shape names the
 * activity. It sits in a 12 px box so it lines up with the 12 px ticks and icons around it. Pass `label`
 * when nothing beside it says what is happening; with a text label next to it, leave it decorative.
 * The orb follows `data-theme`, pauses offscreen and draws a still frame under reduced motion on its own.
 */
export function ActivityOrb({ activity = "tool", label, className }: { activity?: Activity; label?: string; className?: string }) {
  return (
    <span className={cn("inline-flex h-3 w-3 shrink-0 items-center justify-center", className)} data-activity={activity}>
      <ThinkingOrb state={STATE[activity]} size={20} theme="auto" aria-label={label} aria-hidden={label ? undefined : "true"} style={{ margin: -4 }} />
    </span>
  );
}
