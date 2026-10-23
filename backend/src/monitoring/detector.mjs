import { FAILED, HEALTHY, RUNNING, parseSchedule, scheduledSlots, typicalDuration } from '../platform/pipeline-health.mjs';

// What counts as an event (SPEC-automations-01 FR-6..FR-11, FR-24..FR-26). Pure: runs, schedules and check results in,
// events and slot coverage out, so every edge case is a unit test.

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
/** On first switching a trigger on, occurrences this far before that moment are still acted on; older ones are history. */
export const CATCH_UP_MS = 60 * MINUTE;
const FAILED_LOOKBACK_MS = 24 * HOUR;
const DQ_LOOKBACK_MS = 24 * HOUR;
const SEVERITY_RANK = { critical: 0, high: 1, medium: 2, warning: 2, low: 3, info: 4 };

const statusOf = run => String(run?.status || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
const ms = value => { const at = Date.parse(String(value || '')); return Number.isFinite(at) ? at : null; };
const iso = value => new Date(value).toISOString();
export const pipelineKey = pipeline => `${pipeline.platform || 'unknown'}:${pipeline.pipelineId}`;

/**
 * Every scheduled slot from `fromMs` to `now` with what happened to it:
 * `ran` (a run started within the grace), `late` (a run started after the grace, before the next slot), `overdue` (the newest
 * slot, past the grace, nothing started yet), `missed` (an older slot that never got a run) or `pending` (still inside the
 * grace). Slots before the first run on record cannot be judged and are left out, unless `watchedSince` says the app was
 * already watching then (FR-8). Paused and unparseable schedules have no slots.
 */
export function slotCoverage({ schedule, runs = [], now, fromMs, graceMs, watchedSince = null, maxSlots = 500 }) {
  const parsed = parseSchedule(schedule);
  if (!parsed?.parsed || parsed.paused) return { slots: [], paused: Boolean(parsed?.paused), schedulable: Boolean(parsed?.parsed) };
  const starts = runs.map(run => ({ run, at: ms(run.startTime) })).filter(item => item.at !== null).sort((a, b) => a.at - b.at);
  const firstRun = starts.length ? starts[0].at : null;
  const judgeable = [firstRun, watchedSince].filter(value => value !== null && value !== undefined);
  if (!judgeable.length) return { slots: [], paused: false, schedulable: true };
  const from = Math.max(fromMs, Math.min(...judgeable) - MINUTE);
  const times = scheduledSlots(parsed.parsed, parsed.timezone, from, now, maxSlots);
  const used = new Set(); const slots = [];
  times.forEach((at, index) => {
    const next = times[index + 1] ?? null;
    const onTime = starts.find(item => !used.has(item.run) && item.at >= at - MINUTE && item.at <= at + graceMs + MINUTE);
    if (onTime) { used.add(onTime.run); slots.push({ at: iso(at), status: 'ran', runId: String(onTime.run.runId), runStatus: statusOf(onTime.run) }); return; }
    const late = starts.find(item => !used.has(item.run) && item.at > at + graceMs + MINUTE && (next === null || item.at < next - MINUTE));
    if (late) { used.add(late.run); slots.push({ at: iso(at), status: 'late', runId: String(late.run.runId), runStatus: statusOf(late.run), startedAt: late.run.startTime }); return; }
    if (at + graceMs + MINUTE > now) { slots.push({ at: iso(at), status: 'pending' }); return; }
    slots.push({ at: iso(at), status: next === null || next > now ? 'overdue' : 'missed' });
  });
  return { slots, paused: false, schedulable: true };
}

/** Counts for the Pipelines page: slots in the coverage that went wrong. */
export function slotSummary(coverage) {
  const wrong = coverage.slots.filter(slot => ['missed', 'overdue', 'late'].includes(slot.status));
  return { missed: wrong.filter(slot => slot.status !== 'late').length, late: wrong.filter(slot => slot.status === 'late').length, slots: wrong.slice(-50) };
}

const since = (now, lookbackMs, armedAt) => Math.max(now - lookbackMs, (ms(armedAt) ?? now) - CATCH_UP_MS);

/**
 * Events for one pipeline. `failed` and `late` are its two triggers' settings (action off means no events of that kind);
 * `armed` holds when each trigger was switched on. A slot whose run failed is a failure, never also a late slot (FR-10).
 */
export function pipelineEvents({ pipeline, runs = [], failed, late, now, armed = {} }) {
  const events = []; const key = pipelineKey(pipeline);
  const subject = { type: 'pipeline', id: String(pipeline.pipelineId), platform: pipeline.platform || 'unknown', name: pipeline.name || String(pipeline.pipelineId) };
  if (failed && failed.action !== 'off') {
    const from = since(now, FAILED_LOOKBACK_MS, armed.pipelineFailed);
    for (const run of runs) {
      if (!FAILED.has(statusOf(run))) continue;
      const at = ms(run.endTime) ?? ms(run.startTime); if (at === null || at < from) continue;
      events.push({ trigger: 'pipelineFailed', alertKey: `pipeline:${key}:failed`, occurrenceKey: `failed:${key}:${run.runId}`, at: iso(at), subject, kind: 'failed', runId: String(run.runId), summary: run.failureSummary || null, failingTask: run.failingTask || null, rawState: run.rawState || null });
    }
  }
  if (late && late.action !== 'off') {
    const from = since(now, late.lookbackHours * HOUR, armed.pipelineLate);
    const coverage = slotCoverage({ schedule: pipeline.schedule, runs, now, fromMs: from, graceMs: late.graceMinutes * MINUTE, watchedSince: ms(armed.pipelineLate) });
    for (const slot of coverage.slots) {
      const wanted = (slot.status === 'missed' && late.missedSlots) || (['overdue', 'late'].includes(slot.status) && late.notStarted);
      if (!wanted) continue;
      events.push({ trigger: 'pipelineLate', alertKey: `pipeline:${key}:late`, occurrenceKey: `late:${key}:${slot.at}`, at: slot.at, subject, kind: slot.status === 'missed' ? 'missed' : slot.status === 'late' ? 'late_start' : 'not_started', slot: slot.at, runId: slot.runId || null, startedAt: slot.startedAt || null });
    }
    if (late.longRunning) {
      const latest = runs[0]; const started = ms(latest?.startTime); const usual = typicalDuration(runs.filter(run => run !== latest));
      if (latest && RUNNING.has(statusOf(latest)) && started !== null && usual && now - started > usual * late.longRunningFactor && started >= from) {
        events.push({ trigger: 'pipelineLate', alertKey: `pipeline:${key}:late`, occurrenceKey: `long:${key}:${latest.runId}`, at: iso(now), subject, kind: 'long_running', runId: String(latest.runId), runningMs: now - started, typicalDurationMs: usual });
      }
    }
  }
  return events;
}

/** Whether an open pipeline alert's subject has recovered: a healthy run (or an on-time slot) newer than its last occurrence (FR-29). */
export function pipelineRecovered(alert, { runs = [], coverage = null } = {}) {
  if (alert.trigger === 'pipelineFailed') {
    const failedAt = Math.max(...(alert.occurrences || []).map(item => ms(item.at) ?? 0));
    const healthy = runs.find(run => HEALTHY.has(statusOf(run)) && (ms(run.startTime) ?? 0) > failedAt - 1);
    return healthy ? { runId: String(healthy.runId), at: healthy.endTime || healthy.startTime } : null;
  }
  if (alert.trigger === 'pipelineLate') {
    const latestSlot = Math.max(...(alert.occurrences || []).map(item => ms(item.slot || item.at) ?? 0));
    const ran = (coverage?.slots || []).filter(slot => slot.status === 'ran' && (ms(slot.at) ?? 0) > latestSlot).pop();
    if (ran) return { runId: ran.runId, at: ran.at };
    const longOnly = (alert.occurrences || []).every(item => item.kind === 'long_running');
    if (longOnly) { const ids = new Set(alert.occurrences.map(item => item.runId)); const done = runs.find(run => ids.has(String(run.runId)) && !RUNNING.has(statusOf(run))); if (done) return { runId: String(done.runId), at: done.endTime || done.startTime }; }
    return null;
  }
  return null;
}

const severityMeets = (severity, minimum) => (SEVERITY_RANK[String(severity || '').toLowerCase()] ?? 1) <= (SEVERITY_RANK[minimum] ?? 1);
export const dqAlertKey = item => `dq:${item.tableId || 'table'}:${item.dataset || item.table || 'checks'}`;

/** Events for failed (and, when asked, warning) checks at or above the minimum severity, grouped later by table and dataset. */
export function dqEvents({ items = [], configFor, now, armed = {} }) {
  const events = [];
  const from = since(now, DQ_LOOKBACK_MS, armed.dqFailed);
  for (const item of items) {
    const config = configFor(item); if (!config || config.action === 'off') continue;
    if (!(item.status === 'failed' || (config.includeWarnings && item.status === 'warning'))) continue;
    if (Array.isArray(config.tables) && config.tables.length && !config.tables.includes(item.tableId)) continue;
    if (!severityMeets(item.severity, config.minSeverity)) continue;
    const at = ms(item.executedAt); if (at === null || at < from) continue;
    events.push({ trigger: 'dqFailed', alertKey: dqAlertKey(item), occurrenceKey: `dq:${item.key}`, at: iso(at), subject: { type: 'dq', id: `${item.tableId}:${item.dataset || item.table || 'checks'}`, tableId: item.tableId, table: item.table, dataset: item.dataset || null, name: item.dataset || item.table || 'Data quality checks' }, kind: item.status, resultKey: item.key, checkId: item.checkId, checkName: item.name, severity: item.severity, failedRows: item.failedRows ?? null, field: item.field || null, rule: item.rule || null, summary: item.message || null });
  }
  return events;
}

/** Whether every check in an open DQ alert has passed since it failed (FR-29). */
export function dqRecovered(alert, items = []) {
  const failedAt = new Map();
  for (const occurrence of alert.occurrences || []) { const at = ms(occurrence.at) ?? 0; if (at > (failedAt.get(occurrence.checkId) ?? -1)) failedAt.set(occurrence.checkId, at); }
  if (!failedAt.size) return null;
  let latest = null;
  for (const [checkId, at] of failedAt) {
    const passed = items.filter(item => item.checkId === checkId && item.tableId === alert.subject?.tableId && item.status === 'passed' && (ms(item.executedAt) ?? 0) > at).sort((a, b) => (ms(b.executedAt) ?? 0) - (ms(a.executedAt) ?? 0))[0];
    if (!passed) return null;
    if (!latest || (ms(passed.executedAt) ?? 0) > (ms(latest.executedAt) ?? 0)) latest = passed;
  }
  return { at: latest.executedAt, checkId: latest.checkId };
}
