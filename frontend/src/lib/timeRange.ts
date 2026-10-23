export type RangePreset = "today" | "12h" | "24h" | "7d" | "30d" | "custom";

/** `from`/`to` are ISO timestamps and only meaningful for the `custom` preset. */
export interface RangeState {
  preset: RangePreset;
  from?: string;
  to?: string;
}

export interface RangeBounds {
  from: string | null;
  to: string | null;
}

export const RANGE_STORAGE_KEY = "nc-time-range";
export const DEFAULT_RANGE: RangeState = { preset: "24h" };

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export const RANGE_PRESETS: ReadonlyArray<{ preset: RangePreset; label: string }> = [
  { preset: "today", label: "Today" },
  { preset: "12h", label: "Last 12 h" },
  { preset: "24h", label: "Last 24 h" },
  { preset: "7d", label: "Last 7 days" },
  { preset: "custom", label: "Custom" },
];

/** Boards add "Last 30 days" to the app-wide presets. */
export const BOARD_RANGE_PRESETS: ReadonlyArray<{ preset: RangePreset; label: string }> = [
  ...RANGE_PRESETS.slice(0, 4),
  { preset: "30d", label: "Last 30 days" },
  RANGE_PRESETS[4],
];

export const isBoardPreset = (value: unknown): value is RangePreset => BOARD_RANGE_PRESETS.some((item) => item.preset === value);

const WINDOW_MS: Record<Exclude<RangePreset, "today" | "custom">, number> = { "12h": 12 * HOUR_MS, "24h": DAY_MS, "7d": 7 * DAY_MS, "30d": 30 * DAY_MS };

function validIso(value?: string | null): string | null {
  if (!value) return null;
  const at = Date.parse(value);
  return Number.isNaN(at) ? null : new Date(at).toISOString();
}

function startOfToday(now: number): number {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  return start.getTime();
}

export function rangeBounds(range: RangeState, now: number = Date.now()): RangeBounds {
  if (range.preset === "today") return { from: new Date(startOfToday(now)).toISOString(), to: null };
  if (range.preset === "custom") return { from: validIso(range.from), to: validIso(range.to) };
  return { from: new Date(now - WINDOW_MS[range.preset]).toISOString(), to: null };
}

/** The window immediately before the selected one, for "vs previous period" deltas. */
export function previousBounds(range: RangeState, now: number = Date.now()): RangeBounds | null {
  if (range.preset === "custom") return null;
  if (range.preset === "today") {
    const start = startOfToday(now);
    return { from: new Date(start - DAY_MS).toISOString(), to: new Date(start - 1).toISOString() };
  }
  const window = WINDOW_MS[range.preset];
  return { from: new Date(now - 2 * window).toISOString(), to: new Date(now - window - 1).toISOString() };
}

/** Lower-case phrase that completes a sentence: "Tickets raised {periodLabel}". */
export function periodLabel(range: RangeState): string {
  switch (range.preset) {
    case "today": return "today";
    case "12h": return "in the last 12 hours";
    case "24h": return "in the last 24 hours";
    case "7d": return "in the last 7 days";
    default: return "in the selected period";
  }
}

/** Short noun for tile support text: "vs previous 24 h". */
export function periodNoun(range: RangeState): string {
  switch (range.preset) {
    case "today": return "yesterday";
    case "12h": return "previous 12 h";
    case "24h": return "previous 24 h";
    case "7d": return "previous 7 days";
    default: return "previous period";
  }
}

const dayPart = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
const timePart = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
const sameDay = (left: string, right: string) => new Date(left).toDateString() === new Date(right).toDateString();

/** Label shown on the control itself. Custom resolves to its actual window once set, kept short enough for a header. */
export function rangeTitle(range: RangeState): string {
  if (range.preset !== "custom") return BOARD_RANGE_PRESETS.find((item) => item.preset === range.preset)?.label ?? "Custom";
  const from = validIso(range.from);
  const to = validIso(range.to);
  if (!from && !to) return "Custom";
  if (from && to && sameDay(from, to)) return `${dayPart(from)} ${timePart(from)} → ${timePart(to)}`;
  const stamp = (iso: string) => `${dayPart(iso)} ${timePart(iso)}`;
  return `${from ? stamp(from) : "…"} → ${to ? stamp(to) : "now"}`;
}

export function encodeRange(range: RangeState): string {
  if (range.preset !== "custom") return range.preset;
  return `${validIso(range.from) ?? ""}..${validIso(range.to) ?? ""}`;
}

export function decodeRange(value: string | null | undefined): RangeState | null {
  if (!value) return null;
  if (RANGE_PRESETS.some((item) => item.preset === value && value !== "custom")) return { preset: value as RangePreset };
  if (value.includes("..")) {
    const [from, to] = value.split("..");
    const range: RangeState = { preset: "custom", from: validIso(from) ?? undefined, to: validIso(to) ?? undefined };
    return range.from || range.to ? range : null;
  }
  return null;
}

export function readStoredRange(): RangeState {
  try {
    const parsed = decodeRange(window.localStorage.getItem(RANGE_STORAGE_KEY));
    if (parsed) return parsed;
  } catch { /* storage is optional */ }
  return DEFAULT_RANGE;
}

export function storeRange(range: RangeState): void {
  try { window.localStorage.setItem(RANGE_STORAGE_KEY, encodeRange(range)); } catch { /* storage is optional */ }
}

/** Query-string fragment (`from=…&to=…`) for endpoints that take an explicit window. */
export function rangeSearchParams(bounds: RangeBounds, params: URLSearchParams = new URLSearchParams()): URLSearchParams {
  if (bounds.from) params.set("from", bounds.from);
  if (bounds.to) params.set("to", bounds.to);
  return params;
}

/** `datetime-local` input value for an ISO timestamp, in the viewer's zone. */
export function toLocalInputValue(iso?: string | null): string {
  const valid = validIso(iso);
  if (!valid) return "";
  const date = new Date(valid);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function fromLocalInputValue(value: string): string | undefined {
  if (!value) return undefined;
  const at = new Date(value);
  return Number.isNaN(at.valueOf()) ? undefined : at.toISOString();
}

/** Items with no usable timestamp are kept; the window only excludes what it can actually date. */
export function isWithin(bounds: RangeBounds, value?: string | null): boolean {
  if (!bounds.from && !bounds.to) return true;
  const at = Date.parse(String(value ?? ""));
  if (Number.isNaN(at)) return true;
  if (bounds.from && at < Date.parse(bounds.from)) return false;
  if (bounds.to && at > Date.parse(bounds.to)) return false;
  return true;
}
