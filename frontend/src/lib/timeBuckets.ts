import type { RangeBounds } from "@/lib/timeRange";

/**
 * Splits a reporting window into equal buckets a chart can count into.
 * Short windows (up to 36 hours) bucket by hour; longer ones by day; very long
 * ones by week. Labels are what the axis shows, so they are already short.
 */

export interface TimeBucket {
  /** Inclusive start, exclusive end, both epoch ms. */
  start: number;
  end: number;
  /** Axis label, e.g. "04:00" or "10 Sep". */
  label: string;
  /** Longer label for tooltips, e.g. "Tue 23 Sep, 04:00–05:00". */
  title: string;
}

export type BucketUnit = "hour" | "day" | "week";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

const hourLabel = (ms: number) => new Date(ms).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
const dayLabel = (ms: number) => new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short" });
const weekdayLabel = (ms: number) => new Date(ms).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });

function startOfHour(ms: number): number {
  const date = new Date(ms);
  date.setMinutes(0, 0, 0);
  return date.getTime();
}

function startOfDay(ms: number): number {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function step(unit: BucketUnit, from: number): number {
  const date = new Date(from);
  if (unit === "hour") date.setHours(date.getHours() + 1);
  else if (unit === "day") date.setDate(date.getDate() + 1);
  else date.setDate(date.getDate() + 7);
  return date.getTime();
}

export function bucketUnit(spanMs: number): BucketUnit {
  if (spanMs <= 36 * HOUR) return "hour";
  if (spanMs <= 45 * DAY) return "day";
  return "week";
}

/** Buckets covering the window; a missing `from` falls back to the last 7 days. */
export function makeBuckets(bounds: RangeBounds, now: number = Date.now()): TimeBucket[] {
  const end = bounds.to ? Date.parse(bounds.to) : now;
  const from = bounds.from ? Date.parse(bounds.from) : end - WEEK;
  if (!Number.isFinite(from) || !Number.isFinite(end) || end <= from) return [];
  const unit = bucketUnit(end - from);
  let cursor = unit === "hour" ? startOfHour(from) : startOfDay(from);
  const buckets: TimeBucket[] = [];
  while (cursor < end && buckets.length < 60) {
    const next = step(unit, cursor);
    buckets.push({
      start: cursor,
      end: next,
      label: unit === "hour" ? hourLabel(cursor) : dayLabel(cursor),
      title: unit === "hour"
        ? `${weekdayLabel(cursor)}, ${hourLabel(cursor)}–${hourLabel(next)}`
        : unit === "day"
          ? weekdayLabel(cursor)
          : `Week of ${dayLabel(cursor)}`,
    });
    cursor = next;
  }
  return buckets;
}

/** Index of the bucket a timestamp falls in, or -1 when outside the window or undated. */
export function bucketIndex(buckets: TimeBucket[], iso?: string | null): number {
  if (!iso) return -1;
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return -1;
  return buckets.findIndex((bucket) => at >= bucket.start && at < bucket.end);
}

/** Counts items into buckets by a timestamp selector. */
export function countInto<T>(buckets: TimeBucket[], items: T[], at: (item: T) => string | null | undefined): number[] {
  const counts = new Array<number>(buckets.length).fill(0);
  for (const item of items) {
    const index = bucketIndex(buckets, at(item));
    if (index >= 0) counts[index] += 1;
  }
  return counts;
}
