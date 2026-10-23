import test from 'node:test';
import assert from 'node:assert/strict';
import { CATCH_UP_MS, dqAlertKey, dqEvents, dqRecovered, pipelineEvents, pipelineRecovered, slotCoverage, slotSummary } from '../src/monitoring/detector.mjs';
import { parseSchedule, scheduledSlots } from '../src/platform/pipeline-health.mjs';

// SPEC-automations-01: what counts as a failed run, a late or missed slot, a long run and a failed check.

const MIN = 60_000;
const at = text => Date.parse(text);
const every30 = { quartzCronExpression: '0 0/30 * * * ?', timezoneId: 'UTC', pauseStatus: 'UNPAUSED' };
const quarterPast = { quartzCronExpression: '0 15 6 * * ?', timezoneId: 'UTC', pauseStatus: 'UNPAUSED' };
const run = (runId, startIso, status = 'healthy', extra = {}) => ({ runId, pipelineId: 'job-1', platform: 'databricks', status, startTime: startIso, endTime: startIso, ...extra });
const pipeline = (schedule = every30) => ({ pipelineId: 'job-1', platform: 'databricks', name: 'sales_load', schedule });
const late = (over = {}) => ({ action: 'task', graceMinutes: 5, lookbackHours: 24, notStarted: true, missedSlots: true, longRunning: false, longRunningFactor: 2, ...over });
const failedOn = { action: 'task' };
// Switched on when the first run on record started, so every later slot is judged.
const armedAt = text => ({ pipelineFailed: text, pipelineLate: text, dqFailed: text });
const armedLongAgo = { pipelineFailed: '2026-09-01T00:00:00Z', pipelineLate: '2026-09-01T00:00:00Z', dqFailed: '2026-09-01T00:00:00Z' };

test('FR-9: scheduledSlots lists every slot in the window, oldest first, bounded', () => {
  const parsed = parseSchedule(every30).parsed;
  const slots = scheduledSlots(parsed, 'UTC', at('2026-10-06T07:00:00Z'), at('2026-10-06T08:30:00Z'));
  assert.deepEqual(slots.map(value => new Date(value).toISOString()), ['2026-10-06T07:00:00.000Z', '2026-10-06T07:30:00.000Z', '2026-10-06T08:00:00.000Z', '2026-10-06T08:30:00.000Z']);
  assert.equal(scheduledSlots(parsed, 'UTC', at('2026-10-01T00:00:00Z'), at('2026-10-06T00:00:00Z'), 10).length, 10);
});

test('FR-7 S2: no event inside the grace; a not-started event once it has passed', () => {
  const runs = [run('r0', '2026-10-05T06:15:30Z')];
  const inside = pipelineEvents({ pipeline: pipeline(quarterPast), runs, late: late(), now: at('2026-10-06T06:19:00Z'), armed: armedLongAgo });
  assert.deepEqual(inside, []);
  const after = pipelineEvents({ pipeline: pipeline(quarterPast), runs, late: late(), now: at('2026-10-06T06:21:30Z'), armed: armedLongAgo });
  assert.equal(after.length, 1);
  assert.deepEqual({ trigger: after[0].trigger, kind: after[0].kind, slot: after[0].slot, alertKey: after[0].alertKey }, { trigger: 'pipelineLate', kind: 'not_started', slot: '2026-10-06T06:15:00.000Z', alertKey: 'pipeline:databricks:job-1:late' });
});

test('FR-7 S3: a run that starts inside the grace is no event', () => {
  const runs = [run('r1', '2026-10-06T06:18:00Z'), run('r0', '2026-10-05T06:15:30Z')];
  assert.deepEqual(pipelineEvents({ pipeline: pipeline(quarterPast), runs, late: late(), now: at('2026-10-06T06:40:00Z'), armed: armedLongAgo }), []);
});

test('FR-8 S4: a slot with no run is missed even when the next slot ran', () => {
  const runs = [run('r2', '2026-10-06T07:30:10Z'), run('r1', '2026-10-06T06:30:05Z'), run('r0', '2026-10-06T06:00:05Z')];
  const events = pipelineEvents({ pipeline: pipeline(), runs, late: late(), now: at('2026-10-06T07:45:00Z'), armed: armedAt('2026-10-06T06:00:00Z') });
  assert.deepEqual(events.map(event => [event.kind, event.slot]), [['missed', '2026-10-06T07:00:00.000Z']]);
});

test('FR-8: slots before the first run on record are not judged, unless the app was already watching', () => {
  const runs = [run('r1', '2026-10-06T07:30:10Z')];
  const now = at('2026-10-06T07:45:00Z');
  assert.deepEqual(pipelineEvents({ pipeline: pipeline(), runs, late: late(), now, armed: { pipelineLate: '2026-10-06T07:20:00Z' } }).map(event => event.slot), []);
  const coverage = slotCoverage({ schedule: every30, runs: [], now, fromMs: now - 3 * 60 * MIN, graceMs: 5 * MIN, watchedSince: at('2026-10-06T06:50:00Z') });
  assert.deepEqual(coverage.slots.map(slot => [slot.at, slot.status]), [['2026-10-06T07:00:00.000Z', 'missed'], ['2026-10-06T07:30:00.000Z', 'overdue']]);
});

test('FR-8 S5: many missed slots are many occurrences of one alert key', () => {
  const runs = [run('r0', '2026-10-05T22:00:05Z')];
  const events = pipelineEvents({ pipeline: pipeline(), runs, late: late(), now: at('2026-10-06T02:10:00Z'), armed: armedAt('2026-10-05T22:00:00Z') });
  assert.equal(events.length, 8);
  assert.equal(new Set(events.map(event => event.alertKey)).size, 1);
  assert.equal(new Set(events.map(event => event.occurrenceKey)).size, 8);
});

test('FR-10: a slot whose run failed is a failure, never also late', () => {
  const runs = [run('r1', '2026-10-06T07:00:20Z', 'failed', { endTime: '2026-10-06T07:03:00Z', failureSummary: 'boom' }), run('r0', '2026-10-06T06:30:05Z')];
  const events = pipelineEvents({ pipeline: pipeline(), runs, failed: failedOn, late: late(), now: at('2026-10-06T07:20:00Z'), armed: armedAt('2026-10-06T06:30:00Z') });
  assert.deepEqual(events.map(event => [event.trigger, event.runId || event.slot]), [['pipelineFailed', 'r1']]);
  assert.equal(events[0].occurrenceKey, 'failed:databricks:job-1:r1');
});

test('FR-6: a late start after the grace is its own kind; paused schedules never fire late', () => {
  const runs = [run('r1', '2026-10-06T07:12:00Z'), run('r0', '2026-10-06T06:30:05Z')];
  const events = pipelineEvents({ pipeline: pipeline(), runs, late: late(), now: at('2026-10-06T07:20:00Z'), armed: armedAt('2026-10-06T06:30:00Z') });
  assert.deepEqual(events.map(event => [event.kind, event.runId]), [['late_start', 'r1']]);
  const paused = pipelineEvents({ pipeline: pipeline({ ...every30, pauseStatus: 'PAUSED' }), runs: [run('r0', '2026-10-05T06:30:05Z')], late: late(), now: at('2026-10-06T07:20:00Z'), armed: armedLongAgo });
  assert.deepEqual(paused, []);
});

test('FR-26: a run going much longer than usual is a late event when that check is on', () => {
  const runs = [run('r9', '2026-10-06T07:00:00Z', 'running'), ...[1, 2, 3, 4].map(n => run(`r${n}`, `2026-10-0${n}T07:00:00Z`, 'healthy', { durationMs: 10 * MIN }))];
  const quiet = pipelineEvents({ pipeline: pipeline(), runs, late: late({ notStarted: false, missedSlots: false }), now: at('2026-10-06T07:40:00Z'), armed: armedLongAgo });
  assert.deepEqual(quiet, []);
  const events = pipelineEvents({ pipeline: pipeline(), runs, late: late({ notStarted: false, missedSlots: false, longRunning: true, longRunningFactor: 2 }), now: at('2026-10-06T07:40:00Z'), armed: armedLongAgo });
  assert.deepEqual(events.map(event => [event.kind, event.runId]), [['long_running', 'r9']]);
});

test('FR-11: occurrences before a trigger was switched on (less the catch-up) are history', () => {
  const now = at('2026-10-06T10:00:00Z');
  const runs = [run('old', '2026-10-06T07:00:00Z', 'failed', { endTime: '2026-10-06T07:05:00Z' }), run('recent', '2026-10-06T09:30:00Z', 'failed', { endTime: '2026-10-06T09:35:00Z' })];
  const armed = { pipelineFailed: new Date(now - CATCH_UP_MS / 2).toISOString() };
  assert.deepEqual(pipelineEvents({ pipeline: pipeline(), runs, failed: failedOn, now, armed }).map(event => event.runId), ['recent']);
  assert.deepEqual(pipelineEvents({ pipeline: pipeline(), runs, failed: { action: 'off' }, now, armed }), []);
});

test('FR-41: the slot summary counts missed and late slots for the page', () => {
  const runs = [run('r3', '2026-10-06T08:12:00Z'), run('r1', '2026-10-06T07:30:10Z'), run('r0', '2026-10-06T06:30:05Z')];
  const coverage = slotCoverage({ schedule: every30, runs, now: at('2026-10-06T08:20:00Z'), fromMs: at('2026-10-06T06:00:00Z'), graceMs: 5 * MIN });
  assert.deepEqual(slotSummary(coverage), { missed: 1, late: 1, slots: coverage.slots.filter(slot => ['missed', 'late', 'overdue'].includes(slot.status)) });
});

test('FR-29: a failure alert recovers on a newer healthy run; a late alert on a newer on-time slot', () => {
  const failedAlert = { trigger: 'pipelineFailed', openedAt: '2026-10-06T07:05:00Z', occurrences: [{ at: '2026-10-06T07:05:00Z', runId: 'r1' }] };
  assert.equal(pipelineRecovered(failedAlert, { runs: [run('r1', '2026-10-06T07:00:00Z', 'failed')] }), null);
  assert.deepEqual(pipelineRecovered(failedAlert, { runs: [run('r2', '2026-10-06T07:30:00Z'), run('r1', '2026-10-06T07:00:00Z', 'failed')] }), { runId: 'r2', at: '2026-10-06T07:30:00Z' });
  const lateAlert = { trigger: 'pipelineLate', openedAt: '2026-10-06T07:06:00Z', occurrences: [{ at: '2026-10-06T07:00:00.000Z', slot: '2026-10-06T07:00:00.000Z', kind: 'missed' }] };
  const coverage = { slots: [{ at: '2026-10-06T07:00:00.000Z', status: 'missed' }, { at: '2026-10-06T07:30:00.000Z', status: 'ran', runId: 'r2' }] };
  assert.deepEqual(pipelineRecovered(lateAlert, { coverage }), { runId: 'r2', at: '2026-10-06T07:30:00.000Z' });
});

const check = (key, status, severity, executedAt, extra = {}) => ({ key, checkId: extra.checkId || key, name: `check ${key}`, status, severity, executedAt, tableId: 'dq-1', table: 'Results', dataset: 'sales', ...extra });

test('FR-24, FR-25: failed checks at or above the minimum severity are events grouped by table and dataset', () => {
  const now = at('2026-10-06T10:00:00Z');
  const items = [check('a', 'failed', 'critical', '2026-10-06T09:00:00Z'), check('b', 'failed', 'low', '2026-10-06T09:00:00Z'), check('c', 'warning', 'high', '2026-10-06T09:00:00Z'), check('d', 'passed', 'high', '2026-10-06T09:00:00Z'), check('e', 'failed', 'high', '2026-10-06T09:00:00Z', { tableId: 'dq-2' })];
  const config = { action: 'task', minSeverity: 'high', includeWarnings: false, tables: [] };
  const events = dqEvents({ items, configFor: () => config, now, armed: armedLongAgo });
  assert.deepEqual(events.map(event => event.resultKey), ['a', 'e']);
  assert.deepEqual(events.map(event => event.alertKey), ['dq:dq-1:sales', 'dq:dq-2:sales']);
  assert.equal(dqAlertKey(items[0]), 'dq:dq-1:sales');
  assert.deepEqual(dqEvents({ items, configFor: () => ({ ...config, includeWarnings: true, tables: ['dq-1'] }), now, armed: armedLongAgo }).map(event => event.resultKey), ['a', 'c']);
  assert.deepEqual(dqEvents({ items, configFor: () => ({ ...config, action: 'off' }), now, armed: armedLongAgo }), []);
});

test('FR-29: a DQ alert recovers only when every failing check passed since', () => {
  const alert = { subject: { tableId: 'dq-1' }, occurrences: [{ checkId: 'a', at: '2026-10-06T08:00:00Z' }, { checkId: 'b', at: '2026-10-06T08:00:00Z' }] };
  const onePassed = [check('a2', 'passed', 'high', '2026-10-06T09:00:00Z', { checkId: 'a' })];
  assert.equal(dqRecovered(alert, onePassed), null);
  const both = [...onePassed, check('b2', 'passed', 'high', '2026-10-06T09:30:00Z', { checkId: 'b' })];
  assert.deepEqual(dqRecovered(alert, both), { at: '2026-10-06T09:30:00Z', checkId: 'b' });
});
