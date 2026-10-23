import { cn } from "@/lib/utils";
import { AgentCard } from "./AgentCard";
import type { Card, CardTone } from "./cards";

/** Events in time order: a dot on a hairline, the time in mono, the text beside it. Same language as the Result pane's timeline. */

const DOT: Record<CardTone, string> = {
  neutral: "border-line-strong bg-raised",
  good: "border-emerald-500 bg-emerald-500",
  bad: "border-rose-500 bg-rose-500",
  warning: "border-amber-500 bg-amber-500",
};

export function TimelineCard({ card, compact = false, className }: { card: Extract<Card, { kind: "timeline" }>; compact?: boolean; className?: string }) {
  return (
    <AgentCard title={card.title} compact={compact} className={className}>
      <ol className="relative ml-1 border-l border-line pl-5">
        {card.events.map((event, index) => (
          <li key={`${event.at}-${index}`} className={cn("relative pb-3 last:pb-0", compact && "pb-2")}>
            <span className={cn("absolute -left-[25px] top-[7px] h-2 w-2 rounded-full border", DOT[event.tone])} aria-hidden="true" />
            <span className="font-mono text-[12.5px] text-ink-4">{event.at}</span>
            <p className={cn("leading-6 text-ink-2", compact ? "text-[13.5px] leading-5" : "text-[14px]", event.tone === "bad" && "text-rose-800")}>{event.text}</p>
          </li>
        ))}
      </ol>
    </AgentCard>
  );
}
