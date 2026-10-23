/** Plain words for the Pipelines table, kept out of the page so they can be tested without rendering. */

const DAY_MS = 86_400_000;

/** What each pipeline-health tile counts; shared by the Overview and Pipelines tiles. */
export const HEALTH_HINT = {
  succeeded: "Pipelines whose latest run finished without errors, or is running right now.",
  failed: "Pipelines whose latest run ended with an error.",
  missed: "Pipelines with a scheduled run that did not start on time. Nothing failed; the run did not happen.",
  paused: "Pipelines whose schedule is switched off in the platform, so no runs are expected.",
} as const;

/** "Today 20:00", "Tomorrow 04:00", "Mon 06:00", then "1 Oct 07:00", in the reader's own clock. */
export function nextRunText(iso: string, now: number = Date.now()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.valueOf())) return "—";
  const time = date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
  const startOfDay = (value: Date) => { const copy = new Date(value); copy.setHours(0, 0, 0, 0); return copy.getTime(); };
  const days = Math.round((startOfDay(date) - startOfDay(new Date(now))) / DAY_MS);
  if (days === 0) return `Today ${time}`;
  if (days === 1) return `Tomorrow ${time}`;
  if (days > 1 && days < 7) return `${date.toLocaleDateString(undefined, { weekday: "short" })} ${time}`;
  return `${date.toLocaleDateString(undefined, { day: "numeric", month: "short" })} ${time}`;
}

/** "45s", "6m", "1h 05m": the size a reader compares at a glance, not the exact figure. */
export function compactDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

/** Well over the usual, not just a little. */
export const slowerThanUsual = (durationMs?: number | null, typicalMs?: number | null) =>
  typeof durationMs === "number" && typeof typicalMs === "number" && typicalMs > 0 && durationMs > typicalMs * 1.5;
