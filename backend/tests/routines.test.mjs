import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { cronFromSchedule, describeCron, matchesCron, nextRun, parseCron } from '../src/routines/cron.mjs';
import { RoutineScheduler, permissionFromAuthority } from '../src/routines/routine-scheduler.mjs';
import { makeRuntime, sdkInit, sdkResult, tempDir, wait as waitFor } from './helpers.mjs';

const tmp = await tempDir('nc-routines-');
const user = { id: 'mitesh', name: 'Mitesh' };
const wait = (predicate, ms = 4000) => waitFor(predicate, ms);
const quickSdk = { query: () => (async function* () { yield sdkInit('s'); yield sdkResult('s', '7 actionable tickets · 1 SLA risk\n\nStart with DATAOPS-1854.', { total_cost_usd: 0.05, duration_ms: 10 }); })() };

test('cron: parse, match in a timezone, next run, sentences, form to cron', () => {
  const weekdays9 = parseCron('0 9 * * 1-5');
  // 2026-09-25 03:30Z is Friday 09:00 in Kolkata (+5:30)
  assert.equal(matchesCron(weekdays9, new Date('2026-09-25T03:30:00Z'), 'Asia/Kolkata'), true);
  assert.equal(matchesCron(weekdays9, new Date('2026-09-25T09:00:00Z'), 'Asia/Kolkata'), false);
  assert.equal(matchesCron(weekdays9, new Date('2026-09-26T03:30:00Z'), 'Asia/Kolkata'), false, 'Saturday');
  assert.equal(nextRun('0 9 * * 1-5', 'Asia/Kolkata', new Date('2026-09-25T04:00:00Z')).toISOString(), '2026-09-28T03:30:00.000Z', 'skips the weekend');
  assert.equal(describeCron('0 9 * * 1-5', 'Asia/Kolkata'), 'Every weekday at 9:00 AM (Asia/Kolkata)');
  assert.equal(describeCron('0 16 * * 5', 'UTC'), 'Fridays at 4:00 PM');
  assert.equal(describeCron('0 */2 * * *'), 'Every 2 hours');
  assert.equal(describeCron('0 9 1 * *', 'UTC'), 'Day 1 of every month at 9:00 AM');
  assert.equal(cronFromSchedule({ kind: 'weekday', time: '09:00' }), '0 9 * * 1-5');
  assert.equal(cronFromSchedule({ kind: 'weekly', time: '16:00', weekday: 5 }), '0 16 * * 5');
  assert.equal(cronFromSchedule({ kind: 'monthly', time: '08:30', dayOfMonth: 1 }), '30 8 1 * *');
  assert.throws(() => parseCron('0 9 * *'), /five fields/);
  assert.throws(() => parseCron('0 25 * * *'), /out of range/);
  assert.equal(permissionFromAuthority({ writes: 'denied' }), 'read-only');
  assert.equal(permissionFromAuthority({ publish: 'ask', email_send: 'ask' }), 'policy', 'per-category rules without a blanket write rule follow the workspace policy');
});

test('routines: save from the form, list with schedule text, run, test, pause, tick fires once per minute', async () => {
  const { workspace, store, runtime } = await makeRuntime(tmp, quickSdk, { name: 'main' });
  let clockAt = new Date('2026-09-25T03:30:10Z');
  const scheduler = new RoutineScheduler({ workspace, runtime, stateFile: path.join(tmp, 'routines-state.json'), clock: () => clockAt });

  const saved = await scheduler.save({ title: 'Daily ticket review', objective: 'Review my assigned Jira tickets. Group them by type, flag blockers and SLA risk, and tell me which to start next.', schedule: { kind: 'weekday', time: '09:00', timezone: 'Asia/Kolkata' }, permission: 'read-only', notify: 'on_complete', connections: ['Jira'], user });
  assert.equal(saved.name, 'daily-ticket-review'); assert.equal(saved.scheduleText, 'Every weekday at 9:00 AM (Asia/Kolkata)'); assert.equal(saved.permission, 'read-only'); assert.deepEqual(saved.connections, ['jira']); assert.equal(saved.status, 'scheduled');
  assert.equal(saved.nextRunAt, '2026-09-28T03:30:00.000Z', 'clock is already Friday 09:00:10, so next is Monday');
  const file = await fs.readFile(path.join(workspace.workflowsDir, 'daily-ticket-review.yaml'), 'utf8');
  assert.match(file, /trigger:\n  type: schedule\n  timezone: Asia\/Kolkata\n  expression: 0 9 \* \* 1-5/);
  assert.match(file, /authority:\n  writes: denied/);

  const check = await scheduler.check('daily-ticket-review');
  assert.equal(check.ok, false); assert.ok(check.checks.some(item => item.id === 'connection:jira' && !item.ok));
  await workspace.setConnection('jira', { kind: 'mcp', transport: 'http', url: 'https://mcp.atlassian.com/v1/mcp' });
  await workspace.setSection('team', { name: 'Ops', timezone: 'Asia/Kolkata' });
  assert.equal((await scheduler.check('daily-ticket-review')).ok, true);

  const fired = await scheduler.tick();
  assert.equal(fired.length, 1); assert.equal(fired[0].routine, 'daily-ticket-review');
  assert.deepEqual(await scheduler.tick(), [], 'same minute does not fire twice');
  clockAt = new Date('2026-09-25T03:31:10Z');
  assert.deepEqual(await scheduler.tick(), [], 'next minute does not match');
  await wait(async () => (await store.getTask(fired[0].taskId)).status === 'done');
  const view = await scheduler.get('daily-ticket-review');
  assert.equal(view.lastRun.taskId, fired[0].taskId); assert.equal(view.lastRun.summary, '7 actionable tickets · 1 SLA risk'); assert.equal(view.recentRuns.length, 1);
  const runTask = await store.getTask(fired[0].taskId);
  assert.equal(runTask.type, 'routine'); assert.equal(runTask.permission, 'read-only'); assert.equal(runTask.context.routine.fired, 'schedule'); assert.match(runTask.title, /^Daily ticket review$/);

  const testTask = await scheduler.run('daily-ticket-review', { user, test: true });
  assert.match(testTask.title, /test run/); assert.equal(testTask.notify, false); assert.equal(testTask.context.routine.test, true);
  await wait(async () => (await store.getTask(testTask.id)).status === 'done');
  assert.equal((await scheduler.get('daily-ticket-review')).lastTest.taskId, testTask.id);
  assert.equal((await scheduler.get('daily-ticket-review')).recentRuns.length, 1, 'tests are not runs');

  const paused = await scheduler.setEnabled('daily-ticket-review', false);
  assert.equal(paused.status, 'paused'); assert.equal(paused.nextRunAt, null);
  clockAt = new Date('2026-09-28T03:30:10Z');
  assert.deepEqual(await scheduler.tick(), [], 'paused routines do not fire');
  await scheduler.save({ name: 'daily-ticket-review', objective: 'Updated objective', schedule: { cron: '0 */2 * * *', timezone: 'UTC' }, permission: 'ask', notify: 'on_failure', connections: [], user });
  const updated = await scheduler.get('daily-ticket-review');
  assert.equal(updated.scheduleText, 'Every 2 hours'); assert.equal(updated.permission, 'ask'); assert.equal(updated.enabled, false, 'editing keeps the paused state');
  await assert.rejects(scheduler.save({ title: 'Bad', objective: 'x', schedule: { cron: 'nope' } }), /five fields/);
  assert.equal(await scheduler.remove('daily-ticket-review'), true);
  assert.equal((await scheduler.list()).length, 0);
});

test('routines: a schedule without a timezone takes the workspace timezone, else UTC', async () => {
  const { workspace, store, runtime } = await makeRuntime(tmp, quickSdk, { name: 'tz' });
  const scheduler = new RoutineScheduler({ workspace, runtime, stateFile: path.join(tmp, 'routines-state-tz.json'), clock: () => new Date('2026-09-25T04:00:00Z') });

  const utc = await scheduler.save({ title: 'No zone yet', objective: 'Say hello.', schedule: { kind: 'daily', time: '09:00' }, permission: 'read-only', user });
  assert.equal(utc.trigger.timezone, 'UTC', 'an empty team.timezone falls back to UTC');

  await workspace.setSection('team', { name: 'Ops', timezone: 'Asia/Kolkata' });
  const local = await scheduler.save({ title: 'Workspace zone', objective: 'Say hello.', schedule: { kind: 'daily', time: '09:00' }, permission: 'read-only', user });
  assert.equal(local.trigger.timezone, 'Asia/Kolkata');
  assert.equal(local.scheduleText, 'Every day at 9:00 AM (Asia/Kolkata)');
  assert.equal(local.nextRunAt, '2026-09-26T03:30:00.000Z', '09:00 Kolkata is 03:30Z');

  // A file written without a timezone (by hand or by the agent) is read in the workspace timezone too.
  await workspace.saveRoutine('handwritten', { objective: 'Say hello.', trigger: { type: 'schedule', expression: '0 9 * * *' }, authority: { writes: 'denied' }, app: { title: 'Handwritten', enabled: true } });
  const handwritten = await scheduler.get('handwritten');
  assert.equal(handwritten.nextRunAt, '2026-09-26T03:30:00.000Z');
});
