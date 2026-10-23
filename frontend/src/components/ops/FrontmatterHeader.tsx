import type { FrontmatterValue } from "@/lib/frontmatter";
import { cn } from "@/lib/utils";

/**
 * A markdown file's frontmatter as a plain properties table: one row per field, label on the
 * left and value on the right, in the order the file has them. `title` is left out because it
 * already shows as the page heading. `version` inside `metadata` is left out because it isn't
 * meant for a reader — everything else shows exactly as written in the file.
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const HIDDEN = new Set(["title"]);
const LABELS: Record<string, string> = { okf_version: "OKF version", stale_after: "Review by", "allowed-tools": "Allowed tools", allowed_tools: "Allowed tools", id: "ID", url: "URL" };
const STATUS_TONE: Array<[RegExp, string]> = [
  [/^(stable|approved|active|current|published|verified)$/i, "border-emerald-200 bg-emerald-50 text-emerald-700"],
  [/^(draft|proposed|review|in[ _-]?review|pending)$/i, "border-amber-200 bg-amber-50 text-amber-800"],
  [/^(deprecated|retired|superseded|archived|obsolete)$/i, "border-line bg-surface-subtle text-ink-4"],
];

export function FrontmatterHeader({ properties }: { properties: Array<[string, FrontmatterValue]> }) {
  const shown = properties.filter(([key, value]) => !HIDDEN.has(key) && !isEmpty(value));
  if (!shown.length) return null;
  return (
    <dl className="mb-5 space-y-1.5 border-b border-line pb-4 text-[13px]" aria-label="Properties">
      {shown.map(([key, value]) => (
        <div key={key} className="flex items-baseline gap-2">
          <dt className="w-24 shrink-0 font-semibold text-ink-5">{label(key)}</dt>
          <dd className="min-w-0 break-words text-ink-2">{key === "status" && typeof value === "string" ? <StatusPill value={value} /> : formatValue(key, value)}</dd>
        </div>
      ))}
    </dl>
  );
}

function StatusPill({ value }: { value: string }) {
  const tone = STATUS_TONE.find(([pattern]) => pattern.test(value.trim()))?.[1] ?? "border-line bg-raised text-ink-3";
  return <span className={cn("inline-flex rounded-md border px-1.5 py-px text-[11.5px] font-semibold", tone)}>{sentence(value)}</span>;
}

function formatValue(key: string, value: FrontmatterValue): string {
  if (typeof value === "string") return formatScalar(value);
  if (!value.length) return "";
  if (typeof value[0] === "string") return (value as string[]).map(formatScalar).join(", ");
  let entries = value as Array<[string, string]>;
  if (key === "verified" || entries.every(([sub]) => sub === "by" || sub === "at")) {
    const by = entries.find(([sub]) => sub === "by")?.[1]; const at = entries.find(([sub]) => sub === "at")?.[1];
    return [by ? by.replace(/^(human|agent):/i, "") : "", at ? formatScalar(at) : ""].filter(Boolean).join(", ");
  }
  if (key === "metadata") entries = entries.filter(([sub]) => sub !== "version");
  return entries.map(([sub, text]) => `${label(sub)} ${formatScalar(text)}`).join(" · ");
}

function formatScalar(value: string): string {
  const text = value.trim();
  if (/^\d{4}-\d{2}-\d{2}(?:[T ][\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?$/.test(text)) {
    const date = new Date(text.length === 10 ? `${text}T00:00:00Z` : text);
    if (!Number.isNaN(date.getTime())) return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
  }
  return text;
}

function label(key: string): string { return LABELS[key] ?? sentence(key.replace(/[_-]+/g, " ")); }
function sentence(text: string): string { const clean = text.trim(); return clean ? clean.charAt(0).toUpperCase() + clean.slice(1) : clean; }
function isEmpty(value: FrontmatterValue): boolean { return typeof value === "string" ? !value.trim() : !value.length; }
