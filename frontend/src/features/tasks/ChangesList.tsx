import { Check, Link2, MessageSquare, Plus, Tag, UserRound, X } from "lucide-react";
import { useMemo, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { TaskEvent } from "@/api/tasks";
import { formatRelativeTime } from "@/components/ui";
import { cn } from "@/lib/utils";
import { becauseOf, writeChanges } from "./describeWork";

const CHANGE_ICON: Record<string, ReactNode> = {
  comment_on_ticket: <MessageSquare className="h-3.5 w-3.5 text-ink-4" aria-hidden="true" />,
  assign_ticket: <UserRound className="h-3.5 w-3.5 text-ink-4" aria-hidden="true" />,
  set_ticket_status: <Tag className="h-3.5 w-3.5 text-ink-4" aria-hidden="true" />,
  update_ticket: <Tag className="h-3.5 w-3.5 text-ink-4" aria-hidden="true" />,
  create_ticket: <Plus className="h-3.5 w-3.5 text-ink-4" aria-hidden="true" />,
  link_ticket_to_source: <Link2 className="h-3.5 w-3.5 text-ink-4" aria-hidden="true" />,
};

/** Every NerveCenter write the agent made, in order, with its reason and time. Each row opens the ticket it touched. */
export function ChangesList({ events, onSelect }: { events: TaskEvent[]; onSelect?: (firstSeq: number) => void }) {
  const rows = useMemo(() => writeChanges(events), [events]);
  if (!rows.length) return <p className="text-[13px] text-ink-5">No actions yet</p>;
  return (
    <ol className="space-y-0.5">
      {rows.map((row) => {
        const body = (
          <>
            <span className="mt-[3px] shrink-0">{row.failed ? <X className="h-3.5 w-3.5 text-rose-600" aria-hidden="true" /> : CHANGE_ICON[row.tool] || <Check className="h-3.5 w-3.5 text-ink-4" aria-hidden="true" />}</span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13.5px] leading-5 text-ink-2">{row.text}{row.reason ? <span className="text-ink-4"> · {becauseOf(row.reason)}</span> : null}</span>
              <span className={cn("block text-[12.5px] leading-4", row.failed ? "text-rose-700" : "text-ink-5")}>{row.failed ? "Did not go through · " : ""}{formatRelativeTime(row.at)}</span>
            </span>
          </>
        );
        const classes = "flex w-full items-start gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-surface-subtle";
        return (
          <li key={row.id}>
            {row.ticketId ? <Link to={`/tickets/${encodeURIComponent(row.ticketId)}`} className={classes}>{body}</Link> : <button type="button" disabled={!onSelect} onClick={() => onSelect?.(row.seq)} className={cn(classes, "enabled:hover:bg-surface-subtle")}>{body}</button>}
          </li>
        );
      })}
    </ol>
  );
}
