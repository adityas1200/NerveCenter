import { formatAbsoluteTime } from "@/components/ui";
import type { Routine } from "@/api/routines";
import { describeSchedule } from "@/lib/schedule";

/** The schedule in words. The backend covers the common shapes; anything it left as raw cron goes through cronstrue. */
export function scheduleWords(routine: Pick<Routine, "trigger" | "scheduleText">): string {
  const { trigger, scheduleText } = routine;
  if (trigger.type !== "schedule" || !trigger.expression) return scheduleText || "Manual";
  const raw = trigger.expression.trim();
  if (scheduleText && scheduleText.trim() !== raw) return scheduleText;
  return describeSchedule(raw, trigger.timezone);
}

/** "Jira", "Runbook search": the connector's display name when we know it, otherwise the id in words. */
export function connectionLabel(id: string, names: Record<string, string>): string {
  if (names[id]) return names[id];
  const text = id.replace(/[-_]+/g, " ").trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : id;
}

const ISO_TIME = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})/g;

/** Setup-check lines come from the backend with ISO timestamps; show them the way the rest of the page does. */
export function plainCheckDetail(detail: string): string {
  return String(detail || "").replace(ISO_TIME, (iso) => formatAbsoluteTime(iso));
}
