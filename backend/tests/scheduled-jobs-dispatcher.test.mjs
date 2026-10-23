import test from 'node:test';
import assert from 'node:assert/strict';
import { ScheduledJobDispatcher } from '../src/jobs/scheduler.mjs';

function memoryStore() {
  const rows = new Map(); let seq = 0;
  return {
    rows,
    async enqueue(input) {
      const key = `${input.projectId}/${input.source}/${input.slot}`;
      const existing = [...rows.values()].find(row => row.key === key);
      if (existing) return existing;
      const row = { ...input, id: String(++seq), key, state: 'queued', attempts: 0, leaseToken: null, history: [] };
      rows.set(row.id, row); return row;
    },
    async markSkipped(input) {
      const key = `${input.projectId}/${input.source}/${input.slot}`;
      if ([...rows.values()].some(row => row.key === key)) return { created: false };
      const row = { ...input, id: String(++seq), key, state: 'skipped', attempts: 0, leaseToken: null, history: [] };
      rows.set(row.id, row); return { job: row, created: true };
    },
    async claim({ workerId, at }) {
      const row = [...rows.values()].find(item => ['queued', 'retry'].includes(item.state) && new Date(item.dueAt) <= new Date(at));
      if (!row) return null;
      row.state = 'running'; row.attempts++; row.leaseToken = `${workerId}:${row.id}:${row.attempts}`; return { ...row };
    },
    async renew({ id, leaseToken }) { return rows.get(id)?.leaseToken === leaseToken ? rows.get(id) : null; },
    async complete({ id, leaseToken, result }) { const row = rows.get(id); if (row?.leaseToken !== leaseToken) return null; row.state = 'completed'; row.result = result; return row; },
    async fail({ id, leaseToken, error }) { const row = rows.get(id); if (row?.leaseToken !== leaseToken) return null; row.state = 'failed'; row.error = error; return row; },
    async prune({ before, limit }) { const old = [...rows.values()].filter(row => row.state !== 'running' && new Date(row.dueAt) < before).slice(0, limit); old.forEach(row => rows.delete(row.id)); return old.length; },
  };
}

test('dispatcher FR-3a: enqueues idempotently and records older catch-up slots as skipped', async () => {
  const store = memoryStore();
  const dispatcher = new ScheduledJobDispatcher({ store, clock: () => new Date('2026-10-11T12:00:00Z') });
  dispatcher.registerSource('routine', { dueJobs: async () => [
    { projectId: 'p1', slot: 100, dueAt: '2026-10-11T10:00:00Z' },
    { projectId: 'p1', slot: 200, dueAt: '2026-10-11T11:00:00Z' },
    { projectId: 'p2', slot: 150, dueAt: '2026-10-11T10:30:00Z' },
  ], execute: async () => null, catchUpLatestOnly: true });
  await dispatcher.enqueueDue(); await dispatcher.enqueueDue();
  assert.equal([...store.rows.values()].filter(row => row.state === 'queued').length, 2);
  assert.equal([...store.rows.values()].filter(row => row.state === 'skipped').length, 1);
  assert.equal([...store.rows.values()].find(row => row.projectId === 'p1' && row.state === 'queued').slot, 200);
});

test('dispatcher FR-3a: claims, completes, fails through the store and prunes bounded history', async () => {
  const store = memoryStore(); let calls = 0;
  const dispatcher = new ScheduledJobDispatcher({ store, retentionMs: 1000, cleanupLimit: 2, clock: () => new Date('2026-10-11T12:00:00Z'), renewMs: 10_000 });
  dispatcher.registerSource('sync', { dueJobs: async () => [
    { projectId: 'p1', slot: 'ok', dueAt: '2026-10-11T11:00:00Z' },
    { projectId: 'p1', slot: 'bad', dueAt: '2026-10-11T11:01:00Z' },
  ], execute: async job => { calls++; if (job.slot === 'bad') throw new Error('provider unavailable'); return { count: 3 }; } });
  const result = await dispatcher.tick();
  assert.equal(calls, 2);
  assert.deepEqual(result.completed.map(row => row.state).sort(), ['completed', 'failed']);
  assert.equal([...store.rows.values()].find(row => row.slot === 'ok').result.count, 3);
  assert.equal([...store.rows.values()].find(row => row.slot === 'bad').error, 'provider unavailable');
  assert.equal(await dispatcher.cleanup(), 2);
});

test('dispatcher FR-3a: caps same-project execution while allowing separate projects to overlap', async () => {
  const store = memoryStore(); let active = 0; let maxActive = 0;
  const dispatcher = new ScheduledJobDispatcher({ store, concurrencyPerProject: 1, maxConcurrentJobs: 8, clock: () => new Date('2026-10-11T12:00:00Z'), renewMs: 10_000 });
  dispatcher.registerSource('fetch', { dueJobs: async () => [
    ...['a', 'b', 'c'].map((slot, index) => ({ projectId: 'p1', slot, dueAt: new Date(`2026-10-11T11:0${index}:00Z`) })),
    { projectId: 'p2', slot: 'd', dueAt: '2026-10-11T11:04:00Z' },
  ], execute: async () => { active++; maxActive = Math.max(maxActive, active); await new Promise(resolve => setTimeout(resolve, 15)); active--; } });
  await dispatcher.tick();
  assert.equal(maxActive, 2, 'one job per project can run concurrently');
});
