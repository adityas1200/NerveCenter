/* eslint-disable react-refresh/only-export-components */
import * as React from "react";
import { cn } from "@/lib/utils";

export type DateInput = string | number | Date;

export type DurationStyle = "short" | "clock";

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

function toDate(value: DateInput): Date | null {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date;
}

/**
 * Formats an elapsed duration in milliseconds.
 *
 * - `short` (default): `820ms`, `1.2s`, `42s`, `4m 12s`, `2h 05m`, `3d 4h`
 * - `clock`: `0:42`, `4:12`, `1:04:03`
 */
export function formatDuration(ms: number, style: DurationStyle = "short"): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";

  const totalSeconds = Math.floor(ms / SECOND);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);

  if (style === "clock") {
    const paddedSeconds = String(seconds).padStart(2, "0");
    if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${paddedSeconds}`;
    return `${minutes}:${paddedSeconds}`;
  }

  if (ms < SECOND) return `${Math.round(ms)}ms`;
  if (ms < 10 * SECOND) return `${(ms / SECOND).toFixed(1)}s`;
  if (ms < MINUTE) return `${totalSeconds}s`;
  if (ms < HOUR) return `${Math.floor(totalSeconds / 60)}m ${seconds}s`;
  if (ms < DAY) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

/** Formats a timestamp as a compact relative label such as `3m ago` or `2d ago`. */
export function formatRelativeTime(value: DateInput, now: number = Date.now()): string {
  const date = toDate(value);
  if (!date) return "—";

  const delta = now - date.valueOf();
  const distance = Math.abs(delta);
  if (distance < 45 * SECOND) return "just now";

  const suffix = delta >= 0 ? "ago" : "from now";
  if (distance < HOUR) return `${Math.round(distance / MINUTE)}m ${suffix}`;
  if (distance < DAY) return `${Math.round(distance / HOUR)}h ${suffix}`;
  if (distance < WEEK) return `${Math.round(distance / DAY)}d ${suffix}`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/** Formats a timestamp as an absolute, locale-aware label used for the `title` tooltip. */
export function formatAbsoluteTime(value: DateInput): string {
  const date = toDate(value);
  // "Sep 24, 2026, 3:19 PM": the same month-first date the rest of the app shows, no seconds.
  return date ? date.toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) : "Unknown time";
}

export interface RelativeTimeProps
  extends Omit<React.TimeHTMLAttributes<HTMLTimeElement>, "children" | "dateTime" | "title"> {
  value: DateInput;
  /** Refresh cadence in milliseconds. Pass `0` to disable auto-updating. */
  intervalMs?: number;
}

const RelativeTime = React.forwardRef<HTMLTimeElement, RelativeTimeProps>(
  ({ className, value, intervalMs = 30_000, ...props }, ref) => {
    const [now, setNow] = React.useState<number>(() => Date.now());

    React.useEffect(() => {
      if (!Number.isFinite(intervalMs) || intervalMs <= 0) return undefined;
      const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
      return () => window.clearInterval(timer);
    }, [intervalMs]);

    const date = toDate(value);

    return (
      <time
        ref={ref}
        dateTime={date ? date.toISOString() : undefined}
        title={formatAbsoluteTime(value)}
        className={cn("text-[12.5px] tracking-normal text-ink-4", className)}
        {...props}
      >
        {formatRelativeTime(value, now)}
      </time>
    );
  },
);
RelativeTime.displayName = "RelativeTime";

export { RelativeTime };
