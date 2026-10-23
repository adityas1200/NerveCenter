import type { TaskEvent } from "@/api/tasks";
import { cardFrom, type Card } from "./cards";
import { ChangeCard } from "./ChangeCard";
import { LineageCard } from "./LineageCard";
import { QueryCard } from "./QueryCard";
import { ComparisonCard } from "./ComparisonCard";
import { MetricsCard } from "./MetricsCard";
import { PullRequestCard } from "./PullRequestCard";
import { TableCard } from "./TableCard";
import { TimelineCard } from "./TimelineCard";

/** One drawn card, whichever kind the agent asked for. Returns nothing for a call the parser could not read. */
export function ResultCard({ card, compact = false, taskId, className }: { card: Card; compact?: boolean; taskId?: string; className?: string }) {
  if (card.kind === "table") return <TableCard card={card} compact={compact} taskId={taskId} className={className} />;
  if (card.kind === "timeline") return <TimelineCard card={card} compact={compact} className={className} />;
  if (card.kind === "comparison") return <ComparisonCard card={card} compact={compact} className={className} />;
  if (card.kind === "pull_request") return <PullRequestCard card={card} compact={compact} className={className} />;
  if (card.kind === "lineage") return <LineageCard card={card} compact={compact} className={className} />;
  if (card.kind === "change") return <ChangeCard card={card} compact={compact} className={className} />;
  if (card.kind === "query") return <QueryCard card={card} compact={compact} className={className} />;
  return <MetricsCard card={card} compact={compact} className={className} />;
}

export function EventCard({ event, compact = false, taskId, className }: { event: TaskEvent; compact?: boolean; taskId?: string; className?: string }) {
  const card = cardFrom(event);
  if (!card) return null;
  return <ResultCard card={card} compact={compact} taskId={taskId} className={className} />;
}
