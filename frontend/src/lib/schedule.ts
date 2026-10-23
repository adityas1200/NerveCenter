import cronstrue from "cronstrue";

/** 5-field cron, or the 6/7-field Quartz form Databricks jobs use (seconds first, optional year). */
const CRON_RE = /^(\S+\s+){4,6}\S+$/;

/**
 * Turns a backend schedule string into something a business user can read.
 * The trigger manager emits "<cron> · <timezone>" for cron triggers and already
 * humanises interval and one-off triggers, so only cron needs translating.
 */
export function describeSchedule(raw?: string | null, timezone?: string | null): string {
  const text = String(raw ?? "").trim();
  if (!text) return "Not scheduled";
  const [expression, embeddedZone] = text.split(" · ").map((part) => part.trim());
  const zone = timezone || embeddedZone || "";
  if (!CRON_RE.test(expression)) return text;
  try {
    const description = cronstrue.toString(expression, { use24HourTimeFormat: true, verbose: false });
    return zone ? `${description} (${zone})` : description;
  } catch {
    return text;
  }
}
