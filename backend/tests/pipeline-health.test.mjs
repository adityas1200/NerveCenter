import test from 'node:test';
import assert from 'node:assert/strict';
import { nextFire, parseSchedule, pipelineHealth, previousFire, toFiveFieldCron, typicalDuration } from '../src/platform/pipeline-health.mjs';

const T = iso => Date.parse(iso);
const at = (iso, status = 'healthy', durationMs = 5 * 60_000) => ({ runId: iso, status, startTime: iso, durationMs });

test('Quartz cron becomes five-field cron: seconds dropped, ? widened, 1-7 weekdays shifted, L/W/# refused', () => {
  assert.equal(toFiveFieldCron('0 0 4 * * ?'), '0 4 * * *');
  assert.equal(toFiveFieldCron('0 30 6 * * ? 2026'), '30 6 * * *');
  assert.equal(toFiveFieldCron('0 0 6 ? * MON'), '0 6 * * MON');
  assert.equal(toFiveFieldCron('0 0 6 ? * 2-6'), '0 6 * * 1-5');
  assert.equal(toFiveFieldCron('15 9 * * 1-5'), '15 9 * * 1-5');
  assert.equal(toFiveFieldCron('0 0 7 L * ?'), null);
  assert.equal(toFiveFieldCron('0 0 7 ? * 6#3'), null);
  assert.equal(toFiveFieldCron(''), null);
});

test('schedules are read from the Databricks object, "cron · zone" text, or bare cron', () => {
  const structured = parseSchedule({ quartzCronExpression: '0 0 4 * * ?', timezoneId: 'Asia/Kolkata', pauseStatus: 'PAUSED' });
  assert.equal(structured.timezone, 'Asia/Kolkata'); assert.equal(structured.paused, true); assert.ok(structured.parsed);
  const text = parseSchedule('0 0 4 * * ? · Europe/London');
  assert.equal(text.timezone, 'Europe/London'); assert.equal(text.paused, false);
  assert.equal(parseSchedule('30 6 * * *').timezone, 'UTC');
  assert.equal(parseSchedule({ quartzCronExpression: null }), null);
  assert.equal(parseSchedule(null), null);
  assert.equal(parseSchedule({ quartzCronExpression: '0 0 4 * * ?', timezoneId: 'Mars/Olympus' }).timezone, 'UTC', 'an unknown zone falls back to UTC instead of throwing');
});

test('previous and next fire respect the timezone and skip days the cron does not name', () => {
  const daily = parseSchedule({ quartzCronExpression: '0 0 4 * * ?', timezoneId: 'UTC' });
  assert.equal(previousFire(daily.parsed, 'UTC', T('2026-09-24T10:00:00Z')), T('2026-09-24T04:00:00Z'));
  assert.equal(previousFire(daily.parsed, 'UTC', T('2026-09-24T03:59:00Z')), T('2026-09-23T04:00:00Z'));
  assert.equal(nextFire(daily.parsed, 'UTC', T('2026-09-24T10:00:00Z')), T('2026-09-25T04:00:00Z'));
  assert.equal(nextFire(daily.parsed, 'UTC', T('2026-09-24T04:00:00Z')), T('2026-09-25T04:00:00Z'), 'next is strictly after');

  const kolkata = parseSchedule({ quartzCronExpression: '0 0 9 * * ?', timezoneId: 'Asia/Kolkata' });
  assert.equal(previousFire(kolkata.parsed, 'Asia/Kolkata', T('2026-09-24T10:00:00Z')), T('2026-09-24T03:30:00Z'));
  assert.equal(nextFire(kolkata.parsed, 'Asia/Kolkata', T('2026-09-24T10:00:00Z')), T('2026-09-25T03:30:00Z'));

  const monday = parseSchedule({ quartzCronExpression: '0 0 6 ? * MON', timezoneId: 'UTC' });
  // 2026-09-24 is a Thursday.
  assert.equal(previousFire(monday.parsed, 'UTC', T('2026-09-24T10:00:00Z')), T('2026-09-21T06:00:00Z'));
  assert.equal(nextFire(monday.parsed, 'UTC', T('2026-09-24T10:00:00Z')), T('2026-09-28T06:00:00Z'));

  const monthly = parseSchedule({ quartzCronExpression: '0 0 7 1 * ?', timezoneId: 'UTC' });
  assert.equal(previousFire(monthly.parsed, 'UTC', T('2026-09-24T10:00:00Z')), T('2026-09-01T07:00:00Z'));
  assert.equal(nextFire(monthly.parsed, 'UTC', T('2026-09-24T10:00:00Z')), T('2026-10-01T07:00:00Z'));

  const quarterHourly = parseSchedule('*/15 * * * *');
  assert.equal(previousFire(quarterHourly.parsed, 'UTC', T('2026-09-24T10:07:00Z')), T('2026-09-24T10:00:00Z'));
  assert.equal(nextFire(quarterHourly.parsed, 'UTC', T('2026-09-24T10:07:00Z')), T('2026-09-24T10:15:00Z'));

  const yearly = parseSchedule('0 7 1 1 *');
  assert.equal(previousFire(yearly.parsed, 'UTC', T('2026-09-24T10:00:00Z')), null, 'beyond the horizon is unknown, not a guess');
});

test('a pipeline is healthy, failed, running, paused, overdue or never ran, in that order of precedence', () => {
  const now = T('2026-09-24T10:00:00Z');
  const daily = { quartzCronExpression: '0 0 4 * * ?', timezoneId: 'UTC', pauseStatus: 'UNPAUSED' };

  const healthy = pipelineHealth({ schedule: daily, runs: [at('2026-09-24T04:00:00Z')], now });
  assert.equal(healthy.health, 'healthy'); assert.equal(healthy.nextRunAt, '2026-09-25T04:00:00.000Z'); assert.equal(healthy.dueAt, null);

  assert.equal(pipelineHealth({ schedule: daily, runs: [at('2026-09-24T04:00:00Z', 'failed')], now }).health, 'failed');
  assert.equal(pipelineHealth({ schedule: daily, runs: [at('2026-09-24T09:50:00Z', 'running')], now }).health, 'running');
  assert.equal(pipelineHealth({ schedule: daily, runs: [at('2026-09-24T09:50:00Z', 'queued')], now }).health, 'running');
  assert.equal(pipelineHealth({ schedule: { ...daily, pauseStatus: 'PAUSED' }, runs: [at('2026-09-01T04:00:00Z')], now }).health, 'paused');
  assert.equal(pipelineHealth({ schedule: { ...daily, pauseStatus: 'PAUSED' }, runs: [], now }).nextRunAt, null, 'a paused job has no next run');

  const overdue = pipelineHealth({ schedule: daily, runs: [at('2026-09-23T04:00:00Z')], now });
  assert.equal(overdue.health, 'overdue'); assert.equal(overdue.dueAt, '2026-09-24T04:00:00.000Z');
  assert.equal(pipelineHealth({ schedule: daily, runs: [], now }).health, 'overdue', 'no run at all in the window and the slot passed');

  assert.equal(pipelineHealth({ schedule: daily, runs: [at('2026-09-23T04:00:00Z')], now: T('2026-09-24T04:10:00Z') }).health, 'healthy', 'inside the grace period the slot is not missed yet');
  assert.equal(pipelineHealth({ schedule: daily, runs: [at('2026-09-23T04:00:00Z')], now: T('2026-09-24T04:16:00Z') }).health, 'overdue');
  assert.equal(pipelineHealth({ schedule: daily, runs: [at('2026-09-24T04:00:30Z')], now }).health, 'healthy', 'a start a few seconds after the slot counts');

  assert.equal(pipelineHealth({ schedule: daily, runs: [], now, windowStart: T('2026-09-24T06:00:00Z') }).health, 'no_runs', 'a slot before the reporting window cannot be judged');
  assert.equal(pipelineHealth({ schedule: null, runs: [], now }).health, 'no_runs');
  assert.equal(pipelineHealth({ schedule: null, runs: [at('2026-09-24T04:00:00Z')], now }).health, 'healthy');
  assert.equal(pipelineHealth({ schedule: { quartzCronExpression: '0 0 7 L * ?', timezoneId: 'UTC' }, runs: [], now }).health, 'no_runs', 'an unsupported cron is never called overdue');
  assert.equal(pipelineHealth({ schedule: daily, runs: [at('2026-09-24T04:00:00Z', 'status_not_reported')], now }).health, 'unknown');
});

test('the usual duration is the median of earlier successful runs, once there are three of them', () => {
  const runs = [at('2026-09-24T04:00:00Z', 'healthy', 6 * 60_000), at('2026-09-23T04:00:00Z', 'healthy', 5 * 60_000), at('2026-09-22T04:00:00Z', 'failed', 60_000), at('2026-09-21T04:00:00Z', 'healthy', 4 * 60_000), at('2026-09-20T04:00:00Z', 'healthy', 9 * 60_000)];
  assert.equal(typicalDuration(runs), 5 * 60_000);
  assert.equal(typicalDuration(runs.slice(0, 3)), null);
  assert.equal(pipelineHealth({ schedule: null, runs, now: T('2026-09-24T10:00:00Z') }).typicalDurationMs, 5 * 60_000);
});
