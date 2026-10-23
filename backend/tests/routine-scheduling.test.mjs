import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { RoutineScheduler } from '../src/routines/routine-scheduler.mjs';
import { tempDir } from './helpers.mjs';

const minute = value => Math.floor(Date.parse(value) / 60_000);

test('SPEC-routines-03 FR-1/FR-2/FR-6: restart catches up each never-run routine from its updated time', async () => {
  const at = new Date('2026-10-12T03:30:00.000Z');
  const routines = ['alpha', 'beta'].map(name => ({ name, objective: 'Review', app: { enabled: true, updated_at: '2026-10-11T02:30:00.000Z' }, trigger: { type: 'schedule', expression: '0 * * * *', timezone: 'UTC' } }));
  routines.push({ name: 'annual', objective: 'Review', app: { enabled: true, updated_at: '2025-01-01T00:00:00.000Z' }, trigger: { type: 'schedule', expression: '0 0 1 1 *', timezone: 'UTC' } });
  const workspace = { projectId: 'pilot', listRoutines: async () => routines, readOperations: async () => ({}) };
  const scheduler = new RoutineScheduler({ workspace, runtime: {}, stateFile: path.join(await tempDir('nc-routine-state-'), 'state.json'), clock: () => at });
  const candidates = await scheduler.scheduledCandidates({ at, cursorFor: async () => null });
  const latest = candidates.filter(item => !item.skipped);
  assert.equal(latest.length, 2);
  assert.deepEqual(latest.map(item => item.slot), [`alpha:${minute('2026-10-12T03:00:00Z')}`, `beta:${minute('2026-10-12T03:00:00Z')}`]);
  assert.equal(candidates.filter(item => item.skipped).length, 48, 'older due slots are recorded for each routine');
});

test('SPEC-routines-03 FR-3: paused or edited routines skip an already queued slot', async () => {
  const at = new Date('2026-10-12T02:00:00.000Z');
  let routine = { name: 'daily', objective: 'Review', app: { enabled: false, updated_at: at.toISOString() }, trigger: { type: 'schedule', expression: '0 * * * *', timezone: 'UTC' } };
  const workspace = { projectId: 'pilot', getRoutine: async () => routine, readOperations: async () => ({}) };
  const scheduler = new RoutineScheduler({ workspace, runtime: {}, stateFile: path.join(await tempDir('nc-routine-state-'), 'state.json'), clock: () => at });
  assert.equal((await scheduler.executeScheduled({ projectId: 'pilot', slot: `daily:${minute(at)}`, payload: { routine: 'daily' } })).skipped, true);
  routine = { ...routine, app: { enabled: true }, trigger: { ...routine.trigger, expression: '30 * * * *' } };
  const result = await scheduler.executeScheduled({ projectId: 'pilot', slot: `daily:${minute(at)}`, payload: { routine: 'daily' } });
  assert.equal(result.skipped, true);
  assert.match(result.reason, /changed/);
});
