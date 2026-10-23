import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { githubJobSource } from '../src/jobs/github-jobs.mjs';
import { FileJobStore } from '../src/jobs/job-store.mjs';
import { ScheduledJobDispatcher } from '../src/jobs/scheduler.mjs';

test('SPEC-platform-12 FR-1: GitHub uses persisted sequential slots and independent per-project cadence', async () => {
  let at = Date.parse('2026-10-11T00:00:00Z');
  const latest = new Map();
  const executed = [];
  const projects = { async list() { return ['alpha', 'beta', 'disabled', 'other'].map(id => ({ id, kind: 'normal' })); } };
  const settings = {
    alpha: { sync: { github: { every: 30, unit: 'seconds' } }, source_control: { platform: 'github', repository: 'acme/a' } },
    beta: { sync: { github: { every: 90, unit: 'seconds' } }, source_control: { platform: 'github', repository: 'acme/b' } },
    disabled: { sync: { enabled: false }, source_control: { platform: 'github', repository: 'acme/c' } },
    other: { source_control: { platform: 'snowflake' } },
  };
  const workspaces = { async for(id) { return { async readOperations() { return settings[id]; } }; } };
  const store = { async latest(id) { return latest.get(id) || null; } };
  const source = githubJobSource({ store, projects, workspaces, integrationSync: { githubSeconds: 15, async runGithub(id) { executed.push(id); return { done: id }; } }, clock: () => at });
  assert.deepEqual((await source.dueJobs({ at })).map(job => [job.projectId, job.slot]), [['alpha', '1'], ['beta', '1']]);
  for (const job of await source.dueJobs({ at })) latest.set(job.projectId, { ...job, state: 'completed' });
  at += 31_000;
  assert.deepEqual((await source.dueJobs({ at })).map(job => [job.projectId, job.slot]), [['alpha', '2']]);
  latest.set('alpha', { projectId: 'alpha', slot: '2', dueAt: new Date(at).toISOString(), state: 'queued' });
  at += 60_000;
  assert.deepEqual((await source.dueJobs({ at })).map(job => [job.projectId, job.slot]), [['beta', '2']], 'a queued job blocks another slot for that source');
  assert.deepEqual(await source.execute({ projectId: 'beta' }), { done: 'beta' });
  assert.deepEqual(executed, ['beta']);
});

test('SPEC-platform-12 FR-1: inactive app schedules no GitHub work', async () => {
  const source = githubJobSource({ store: {}, projects: { async list() { throw new Error('should not list projects'); } }, workspaces: {}, integrationSync: {}, isAppActive: () => false });
  assert.deepEqual(await source.dueJobs(), []);
});

test('SPEC-platform-12 FR-7: GitHub job survives dispatcher restart without an early duplicate', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nc-github-schedule-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new FileJobStore(root);
  await store.init();
  let at = Date.parse('2026-10-11T00:00:00Z');
  let calls = 0;
  const parts = {
    store,
    projects: { async list() { return [{ id: 'alpha', kind: 'normal' }]; } },
    workspaces: { async for() { return { async readOperations() { return { sync: { github: { every: 30, unit: 'seconds' } }, source_control: { platform: 'github', repository: 'acme/a' } }; } }; } },
    integrationSync: { githubSeconds: 15, async runGithub() { calls += 1; return { checked: 1 }; } },
  };
  const create = () => new ScheduledJobDispatcher({ store, clock: () => new Date(at) }).registerSource('github', githubJobSource(parts));
  assert.equal((await create().tick()).completed[0].state, 'succeeded');
  assert.equal(calls, 1);
  at += 20_000;
  assert.deepEqual((await create().tick()).completed, []);
  assert.equal(calls, 1);
  at += 11_000;
  assert.equal((await create().tick()).completed[0].state, 'succeeded');
  assert.equal(calls, 2);
  assert.equal((await store.latest('alpha', 'github')).slot, '2');
});

test('SPEC-platform-12 FR-7: recovering an old queued job does not immediately schedule a second sync', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nc-github-recovery-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new FileJobStore(root);
  await store.init();
  await store.enqueue({ projectId: 'alpha', source: 'github', slot: '1', dueAt: '2026-10-10T00:00:00Z' });
  const at = new Date('2026-10-11T00:00:00Z');
  let calls = 0;
  const source = githubJobSource({
    store,
    projects: { async list() { return [{ id: 'alpha', kind: 'normal' }]; } },
    workspaces: { async for() { return { async readOperations() { return { sync: { github: { every: 30, unit: 'seconds' } }, source_control: { platform: 'github', repository: 'acme/a' } }; } }; } },
    integrationSync: { githubSeconds: 15, async runGithub() { calls += 1; return { checked: 1 }; } },
  });
  const dispatcher = new ScheduledJobDispatcher({ store, clock: () => at }).registerSource('github', source);
  await dispatcher.tick();
  assert.equal(calls, 1);
  assert.deepEqual(await source.dueJobs({ at }), [], 'completion time starts the next cadence');
});
