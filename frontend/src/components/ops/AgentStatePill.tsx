import type { TicketAppStatus } from "@/api/types";
import { APP_STATUS_HELP, APP_STATUS_LABEL } from "@/components/ops/appStatus";

export { APP_STATUS_HELP, APP_STATUS_LABEL };
import { cn } from "@/lib/utils";

/**
 * Ticket status in NerveCenter's four words, the same for every source. The source's own state
 * ("On Hold", "In Review") is kept in the tooltip for anyone who needs it.
 */
const TONE: Record<TicketAppStatus, string> = {
  open: "border-line bg-raised text-ink-2",
  in_progress: "border-blue-200 bg-blue-50 text-blue-800",
  waiting_on_you: "border-amber-200 bg-amber-50 text-amber-900",
  closed: "border-emerald-200 bg-emerald-50 text-emerald-800",
};
const DOT: Record<TicketAppStatus, string> = { open: "bg-ink-4", in_progress: "bg-blue-500", waiting_on_you: "bg-amber-500 animate-pulse", closed: "bg-emerald-500" };

export function AppStatusPill({ status, sourceStatus, className }: { status?: TicketAppStatus | null; sourceStatus?: string | null; className?: string }) {
  const value: TicketAppStatus = status || "open";
  return (
    <span title={sourceStatus ? `${APP_STATUS_HELP[value]} Source: ${sourceStatus}.` : APP_STATUS_HELP[value]} className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-[12.5px] font-medium", TONE[value], className)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", DOT[value])} aria-hidden="true" />
      {APP_STATUS_LABEL[value]}
    </span>
  );
}

