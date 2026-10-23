import test from 'node:test';
import assert from 'node:assert/strict';
import { routineJobSource } from '../src/jobs/routine-jobs.mjs';
import { ScheduledJobDispatcher } from '../src/jobs/scheduler.mjs';
import { FileJobStore } from '../src/jobs/job-store.mjs';
import { tempDir } from './helpers.mjs';

test('SPEC-routines-03 FR-1/FR-2/FR-6: routine slots are independent and older slots are recorded skipped', async () => {
  const skipped = []; const enqueued = []; const keys = new Set();
  const store = {
    markSkipped: async item => { skipped.push(item); },
    latest: async () => null,
    enqueue: async item => { const key = `${item.projectId}/${item.source}/${item.slot}`; if (!keys.has(key)) { keys.add(key); enqueued.push(item); } return { job: item, created: keys.has(key) }; },
    claim: async () => null,
    prune: async () => 0,
  };
  const routines = { scheduledCandidates: async () => [
    { projectId: 'pilot', routine: 'a', slot: 'a:101', dueAt: '1970-01-01T01:41:00.000Z', skipped: true },
    { projectId: 'pilot', routine: 'a', slot: 'a:102', dueAt: '1970-01-01T01:42:00.000Z' },
    { projectId: 'pilot', routine: 'b', slot: 'b:102', dueAt: '1970-01-01T01:42:00.000Z' },
  ] };
  const source = routineJobSource({ routines, store });
  const dispatcher = new ScheduledJobDispatcher({ store, clock: () => new Date('1970-01-01T02:00:00Z') });
  dispatcher.registerSource('routine', source);
  await dispatcher.enqueueDue({ at: new Date('1970-01-01T02:00:00Z') });
  await dispatcher.enqueueDue({ at: new Date('1970-01-01T02:00:00Z') });
  assert.equal(skipped.length, 1);
  assert.deepEqual(enqueued.map(job => `${job.projectId}/${job.payload.routine}/${job.slot}`), ['pilot/a/a:102', 'pilot/b/b:102']);
  assert.ok(enqueued.every(job => job.maxAttempts === 1));
});

test('SPEC-routines-03 FR-3: scheduled task executor delegates to the current routine state', async () => {
  let observed;
  const source = routineJobSource({
    store: { latest: async () => null, markSkipped: async () => {} },
    routines: { scheduledCandidates: async () => [], executeScheduled: async job => { observed = job; return { taskId: 'T-2' }; } },
  });
  assert.deepEqual(await source.execute({ projectId: 'pilot', slot: '123', payload: { routine: 'daily' } }), { taskId: 'T-2' });
  assert.equal(observed.payload.routine, 'daily');
});

test('SPEC-routines-03 FR-3: an ineligible routine job gets a skipped terminal state', async () => {
  const store = new FileJobStore(await tempDir('nc-routine-jobs-')); await store.init();
  const at = new Date('2026-10-12T00:00:00Z');
  const dispatcher = new ScheduledJobDispatcher({ store, clock: () => at });
  dispatcher.registerSource('routine', {
    dueJobs: async () => [{ projectId: 'pilot', slot: 'routine:1', dueAt: at.toISOString(), payload: { routine: 'routine' }, maxAttempts: 1 }],
    execute: async () => ({ skipped: true, reason: 'Routine was paused' }), maxAttempts: 1,
  });
  await dispatcher.tick({ at });
  assert.equal((await store.latest('pilot', 'routine')).state, 'skipped');
});
