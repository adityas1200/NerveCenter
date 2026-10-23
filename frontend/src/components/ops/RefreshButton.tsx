import { RefreshCw } from "lucide-react";
import { useId } from "react";
import { Button, Tooltip, TooltipContent, TooltipTrigger, formatRelativeTime } from "@/components/ui";
import { cn } from "@/lib/utils";
import { AUTO_REFRESH_SECONDS } from "@/lib/autoRefresh";
import { usePageAutoRefresh } from "@/lib/usePageAutoRefresh";

interface RefreshButtonProps {
  onClick: () => void;
  busy?: boolean;
  updatedAt?: string | number | Date | null;
  className?: string;
  /** Opt in only for page-level read actions, never per-item or external sync actions. */
  autoRefresh?: boolean;
  paused?: boolean;
}

export function RefreshButton(props: RefreshButtonProps) {
  return props.autoRefresh ? <ScheduledRefreshButton {...props} /> : <RefreshControl {...props} />;
}

function ScheduledRefreshButton(props: RefreshButtonProps) {
  const timer = usePageAutoRefresh({ onRefresh: props.onClick, busy: Boolean(props.busy), paused: props.paused });
  return <RefreshControl {...props} onClick={timer.refresh} countdown={timer.enabled ? timer : undefined} />;
}

/** FR-2: stable accessible name, quiet countdown, progress only for meaningful elapsed time. */
function RefreshControl({ onClick, busy = false, updatedAt, className, countdown }: RefreshButtonProps & { countdown?: { remaining: number; waiting: boolean } }) {
  const descriptionId = useId();
  const time = countdown ? `${Math.floor(countdown.remaining / 60)}:${String(countdown.remaining % 60).padStart(2, "0")}` : "";
  const status = busy ? "Refreshing" : countdown?.waiting ? "Waiting for activity to finish" : countdown ? `Auto refresh in ${time}` : "Refresh";
  const label = `${status}${updatedAt ? ` · Updated ${formatRelativeTime(updatedAt)}` : ""}`;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size={countdown ? "sm" : "icon"} className={cn("relative h-8 overflow-hidden rounded-lg text-ink-4 hover:bg-surface-subtle hover:text-ink-1", countdown ? "gap-2 border border-line px-2.5" : "w-8", className)} onClick={onClick} disabled={busy} aria-label="Refresh" aria-describedby={descriptionId} aria-busy={busy}>
          <RefreshCw className={cn("h-4 w-4", busy && "animate-spin motion-reduce:animate-none")} aria-hidden="true" />
          {countdown ? <>
            <span className="min-w-[3.5ch] text-caption tabular-nums" aria-hidden="true">{busy ? "…" : countdown.waiting ? "Paused" : time}</span>
            <span className="pointer-events-none absolute inset-x-0 bottom-0 h-px origin-left bg-brand/60 transition-transform duration-300 motion-reduce:transition-none" style={{ transform: `scaleX(${1 - countdown.remaining / AUTO_REFRESH_SECONDS})` }} aria-hidden="true" />
          </> : null}
          <span id={descriptionId} className="sr-only">{label}</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
