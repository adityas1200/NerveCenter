import { parseCron } from '../routines/cron.mjs';

/**
 * One rule for what a pipeline's state means to a business user: it is healthy, it failed,
 * or it is overdue (a scheduled run did not happen). Running, paused and never-ran are the
 * three quiet states around that. Also works out the next scheduled start and the usual
 * duration so the page can say "6m, usually 5m" and "Next run: tomorrow 04:00".
 *
 * Schedules arrive as Databricks Quartz cron (6 or 7 fields, `?`, 1-7 weekdays) or plain
 * five-field cron, with an optional timezone. Anything with Quartz `L`, `W` or `#` is
 * treated as unknown: never overdue, no next run.
 */

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const DEFAULT_GRACE_MS = 15 * MINUTE;
const HORIZON_MS = 35 * DAY;
const STEP_BUDGET = 20_000;

export const FAILED = new Set(['failed', 'failure', 'error', 'timedout', 'timed_out', 'canceled', 'cancelled', 'internal_error', 'upstream_failed']);
export const RUNNING = new Set(['running', 'queued', 'pending', 'in_progress', 'blocked', 'waiting_for_retry']);
export const HEALTHY = new Set(['healthy', 'success', 'succeeded', 'successful', 'completed', 'complete']);

const WEEKDAY_INDEX = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
const formatters = new Map();
function formatter(timezone) {
  const key = timezone || 'UTC';
  let cached = formatters.get(key);
  if (!cached) {
    cached = new Intl.DateTimeFormat('en-US', { timeZone: key, hourCycle: 'h23', minute: 'numeric', hour: 'numeric', day: 'numeric', month: 'numeric', year: 'numeric', weekday: 'short' });
    formatters.set(key, cached);
  }
  return cached;
}
/** Wall-clock parts of an instant in a timezone. Formatters are cached; this runs thousands of times per refresh. */
function partsAt(timezone, ms) {
  const parts = Object.fromEntries(formatter(timezone).formatToParts(new Date(ms)).map(part => [part.type, part.value]));
  return { minute: Number(parts.minute), hour: Number(parts.hour) % 24, day: Number(parts.day), month: Number(parts.month), weekday: WEEKDAY_INDEX[String(parts.weekday).toLowerCase().slice(0, 3)] };
}
function validTimezone(timezone) {
  if (!timezone) return 'UTC';
  try { formatter(timezone); return timezone; } catch { return 'UTC'; }
}

/** Quartz weekday numbers are 1-7 starting Sunday; cron's are 0-6. Names pass through. */
function quartzWeekdays(field) {
  return field.split(',').map(part => part.replace(/\d+/g, digits => String(Math.max(0, Number(digits) - 1)))).join(',');
}

/** Five-field cron text from a Quartz or standard expression, or null when it cannot be expressed. */
export function toFiveFieldCron(expression) {
  const tokens = String(expression || '').trim().split(/\s+/).filter(Boolean);
  if (tokens.length < 5 || tokens.length > 7) return null;
  if (tokens.some(token => /[LW#]/i.test(token))) return null;
  const quartz = tokens.length >= 6;
  const fields = quartz ? tokens.slice(1, 6) : tokens;
  const [minute, hour, day, month, weekday] = fields.map(token => token === '?' ? '*' : token);
  return [minute, hour, day, month, quartz ? quartzWeekdays(weekday) : weekday].join(' ');
}

/**
 * Reads the schedule a platform reported: the Databricks object, "<cron> · <timezone>",
 * or a bare cron string. Returns null when there is no usable schedule.
 */
export function parseSchedule(schedule) {
  if (!schedule) return null;
  let expression; let timezone = null; let paused = false;
  if (typeof schedule === 'object') {
    expression = schedule.quartzCronExpression || schedule.quartz_cron_expression || schedule.cron || schedule.expression || null;
    timezone = schedule.timezoneId || schedule.timezone_id || schedule.timezone || null;
    paused = String(schedule.pauseStatus || schedule.pause_status || '').toUpperCase() === 'PAUSED';
  } else {
    const [text, zone] = String(schedule).split(' · ').map(part => part.trim());
    expression = text; timezone = zone || null;
  }
  if (!expression) return null;
  const five = toFiveFieldCron(expression);
  let parsed = null;
  if (five) { try { parsed = parseCron(five); } catch { parsed = null; } }
  return { expression, timezone: validTimezone(timezone), paused, parsed };
}

const sortedValues = set => [...set].sort((a, b) => a - b);

/** Most recent scheduled minute at or before `fromMs`, or null when none falls within the horizon. */
export function previousFire(parsed, timezone, fromMs, horizonMs = HORIZON_MS) {
  const [minutes, hours, days, months, weekdays] = parsed.fields;
  const allowedMinutes = sortedValues(minutes);
  let at = Math.floor(fromMs / MINUTE) * MINUTE;
  for (let step = 0; step < STEP_BUDGET && fromMs - at <= horizonMs; step += 1) {
    const p = partsAt(timezone, at);
    if (!months.has(p.month) || !days.has(p.day) || !weekdays.has(p.weekday)) { at -= (p.hour * 60 + p.minute + 1) * MINUTE; continue; }
    if (!hours.has(p.hour)) { at -= (p.minute + 1) * MINUTE; continue; }
    if (!minutes.has(p.minute)) {
      const earlier = allowedMinutes.filter(value => value < p.minute).pop();
      at -= (earlier === undefined ? p.minute + 1 : p.minute - earlier) * MINUTE;
      continue;
    }
    return at;
  }
  return null;
}

/** First scheduled minute strictly after `fromMs`, or null when none falls within the horizon. */
export function nextFire(parsed, timezone, fromMs, horizonMs = HORIZON_MS) {
  const [minutes, hours, days, months, weekdays] = parsed.fields;
  const allowedMinutes = sortedValues(minutes);
  let at = Math.floor(fromMs / MINUTE) * MINUTE + MINUTE;
  for (let step = 0; step < STEP_BUDGET && at - fromMs <= horizonMs; step += 1) {
    const p = partsAt(timezone, at);
    if (!months.has(p.month) || !days.has(p.day) || !weekdays.has(p.weekday)) { at += (24 * 60 - (p.hour * 60 + p.minute)) * MINUTE; continue; }
    if (!hours.has(p.hour)) { at += (60 - p.minute) * MINUTE; continue; }
    if (!minutes.has(p.minute)) {
      const later = allowedMinutes.find(value => value > p.minute);
      at += (later === undefined ? 60 - p.minute : later - p.minute) * MINUTE;
      continue;
    }
    return at;
  }
  return null;
}

/**
 * Scheduled minutes in [fromMs, toMs], oldest first, at most `max` (SPEC-automations-01 FR-9). Each step is the bounded
 * nextFire search, so a long window costs at most `max` searches.
 */
export function scheduledSlots(parsed, timezone, fromMs, toMs, max = 500) {
  const slots = []; let at = fromMs - MINUTE;
  while (slots.length < max) {
    const next = nextFire(parsed, timezone, at, Math.max(MINUTE, toMs - at + MINUTE));
    if (next === null || next > toMs) break;
    slots.push(next); at = next;
  }
  return slots;
}

const statusOf = run => String(run?.status || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
const startMs = run => { const at = Date.parse(String(run?.startTime || '')); return Number.isFinite(at) ? at : undefined; };
const iso = ms => (typeof ms === 'number' && Number.isFinite(ms) ? new Date(ms).toISOString() : null);

/** Median duration of the earlier successful runs, once there are enough of them to call it usual. */
export function typicalDuration(runs, { minSamples = 3 } = {}) {
  const samples = runs.slice(1).filter(run => HEALTHY.has(statusOf(run)) && Number.isFinite(run.durationMs) && run.durationMs >= 0).map(run => run.durationMs).sort((a, b) => a - b);
  if (samples.length < minSamples) return null;
  const middle = Math.floor(samples.length / 2);
  return samples.length % 2 ? samples[middle] : Math.round((samples[middle - 1] + samples[middle]) / 2);
}

/**
 * @param {object} input
 * @param {unknown} input.schedule            the platform's schedule (object or string)
 * @param {Array}   input.runs                runs newest first, already limited to the reporting window
 * @param {number}  [input.now]               clock, ms
 * @param {number}  [input.windowStart]       start of the reporting window, ms. A missed slot before
 *                                            the window cannot be judged from its runs, so it is not called overdue.
 * @param {number}  [input.graceMs]           how long after the scheduled minute a run may still start
 */
export function pipelineHealth({ schedule, runs = [], now = Date.now(), windowStart, graceMs = DEFAULT_GRACE_MS } = {}) {
  const parsedSchedule = parseSchedule(schedule);
  const latest = runs[0];
  const latestStatus = statusOf(latest);
  const result = { health: 'unknown', nextRunAt: null, dueAt: null, typicalDurationMs: typicalDuration(runs) };

  if (parsedSchedule?.parsed && !parsedSchedule.paused) result.nextRunAt = iso(nextFire(parsedSchedule.parsed, parsedSchedule.timezone, now));

  if (parsedSchedule?.paused) { result.health = 'paused'; return result; }
  if (latest && RUNNING.has(latestStatus)) { result.health = 'running'; return result; }
  if (latest && FAILED.has(latestStatus)) { result.health = 'failed'; return result; }

  if (parsedSchedule?.parsed) {
    const due = previousFire(parsedSchedule.parsed, parsedSchedule.timezone, now - graceMs);
    const inWindow = due !== null && (windowStart === undefined || windowStart === null || due >= windowStart);
    if (inWindow) {
      const lastStart = startMs(latest);
      if (lastStart === undefined || lastStart + MINUTE < due) { result.health = 'overdue'; result.dueAt = iso(due); return result; }
    }
  }

  if (!latest) { result.health = 'no_runs'; return result; }
  result.health = HEALTHY.has(latestStatus) ? 'healthy' : 'unknown';
  return result;
}
