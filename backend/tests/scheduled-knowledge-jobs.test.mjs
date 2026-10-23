import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { knowledgeJobSource } from '../src/jobs/knowledge-jobs.mjs';
import { FileJobStore } from '../src/jobs/job-store.mjs';
import { IntegrationSyncService } from '../src/sync/integration-sync.mjs';

function setup() {
  const operations = {
    fast: { sync: { knowledge: { every: 30, unit: 'seconds' } } },
    slow: { sync: { knowledge: { every: 120, unit: 'seconds' } } },
    disabled: { sync: { enabled: false, knowledge: { every: 5, unit: 'seconds' } } },
  };
  const grants = {
    fast: [{ name: 'shared-runbooks', kind: 'git', shared: true }, { name: 'private-a', kind: 'git' }, { name: 'private-b', kind: 'git' }],
    slow: [{ name: 'shared-runbooks', kind: 'git', shared: true }],
    disabled: [{ name: 'shared-runbooks', kind: 'git', shared: true }],
  };
  const projects = { async list() { return Object.keys(operations).map(id => ({ id, kind: 'normal' })); } };
  const workspaces = { async for(id) { return { async readOperations() { return operations[id]; } }; } };
  const lookups = [];
  const store = { async latest(projectId, source) { lookups.push([projectId, source]); return null; } };
  const integrationSync = {
    knowledgeSeconds: 900,
    knowledge: { async for(id) { return { async list() { return { items: grants[id] }; } }; } },
    async runKnowledge(projectId, name, options) { return { projectId, name, ...options }; },
  };
  return { operations, grants, projects, workspaces, store, integrationSync, lookups };
}

test('ADR-0012: private bases share their project cadence; shared bases use the fastest enabled grant and library queue identity', async () => {
  const ctx = setup();
  const source = knowledgeJobSource({ ...ctx, clock: () => 10_000 });
  const due = await source.dueJobs({ at: 10_000 });
  assert.deepEqual(due.map(job => [job.projectId, job.payload.bases, job.payload.shared]).sort((a, b) => a[0].localeCompare(b[0])), [
    ['fast', ['private-a', 'private-b'], false],
    ['library:shared-runbooks', ['shared-runbooks'], true],
  ].sort((a, b) => a[0].localeCompare(b[0])));
  assert.deepEqual(ctx.lookups.sort((a, b) => a[0].localeCompare(b[0])), [['fast', 'knowledge'], ['library:shared-runbooks', 'knowledge']].sort((a, b) => a[0].localeCompare(b[0])));
  const shared = due.find(job => job.projectId === 'library:shared-runbooks');
  assert.deepEqual(await source.execute({ ...shared, payload: { ...shared.payload, grantProjectId: 'fast' } }), {
    projectId: 'fast', name: 'shared-runbooks', shared: true,
  });
});

test('ADR-0012: an active shared slot suppresses duplicate enqueue; an inactive app schedules nothing', async () => {
  const ctx = setup();
  ctx.store.latest = async projectId => projectId === 'library:shared-runbooks'
    ? { state: 'running', slot: '4', dueAt: new Date(0).toISOString() }
    : null;
  const source = knowledgeJobSource({ ...ctx, clock: () => 10_000 });
  const due = await source.dueJobs({ at: 10_000 });
  assert.equal(due.some(job => job.projectId === 'library:shared-runbooks'), false);
  const inactive = knowledgeJobSource({ ...ctx, isAppActive: () => false });
  assert.deepEqual(await inactive.dueJobs({ at: 10_000 }), []);
});

test('ADR-0012: concurrent schedulers submit the same shared slot and the queue unique key accepts it once', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nc-shared-knowledge-job-'));
  try {
    const ctx = setup();
    const store = new FileJobStore(root);
    await store.init();
    const first = knowledgeJobSource({ ...ctx, store, clock: () => 20_000 });
    const second = knowledgeJobSource({ ...ctx, store, clock: () => 20_000 });
    const [a, b] = await Promise.all([first.dueJobs({ at: 20_000 }), second.dueJobs({ at: 20_000 })]);
    const sharedA = a.find(job => job.projectId === 'library:shared-runbooks');
    const sharedB = b.find(job => job.projectId === 'library:shared-runbooks');
    assert.equal(sharedA.slot, sharedB.slot);
    const [insertA, insertB] = await Promise.all([
      store.enqueue({ ...sharedA, source: 'knowledge' }),
      store.enqueue({ ...sharedB, source: 'knowledge' }),
    ]);
    assert.equal(Number(insertA.created) + Number(insertB.created), 1);
    assert.equal((await store.latest('library:shared-runbooks', 'knowledge')).slot, sharedA.slot);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('ADR-0012: worker rechecks app, grant, auto-sync and pending local changes before syncing', async () => {
  let active = true;
  let enabled = true;
  let syncs = 0;
  const service = new IntegrationSyncService({
    projects: { async list() { return [{ id: 'team', kind: 'normal' }]; } },
    workspaces: { async for() { return { async readOperations() { return { sync: { enabled } }; } }; } },
    workspace: {}, isAppActive: () => active, databricksFailures: false,
    knowledge: { async for() { return {
      async list() { return { items: [{ name: 'shared-runbooks', kind: 'git', shared: true, pendingChanges: 0 }] }; },
      async pendingChanges() { return ['draft.md']; },
      async sync() { syncs += 1; },
    }; } },
  });
  assert.deepEqual(await service.runKnowledge('library:shared-runbooks', 'shared-runbooks', { shared: true }), { skipped: 'pending knowledge changes' });
  assert.equal(syncs, 0);
  enabled = false;
  assert.deepEqual(await service.runKnowledge('library:shared-runbooks', 'shared-runbooks', { shared: true }), { skipped: 'no active project grants this shared base' });
  enabled = true;
  active = false;
  assert.deepEqual(await service.runKnowledge('library:shared-runbooks', 'shared-runbooks', { shared: true }), { skipped: 'app inactive' });
  assert.equal(syncs, 0);
});

test('ADR-0012: kept local commits that are not pushed are recorded as a skip', async () => {
  const service = new IntegrationSyncService({
    projects: { async list() { return [{ id: 'team', kind: 'normal' }]; } },
    workspaces: { async for() { return { async readOperations() { return { sync: { enabled: true } }; } }; } },
    workspace: {}, databricksFailures: false,
    knowledge: { async for() { return {
      async list() { return { items: [{ name: 'private-runbooks', kind: 'git', pendingChanges: 0 }] }; },
      async pendingChanges() { return []; },
      async sync() { throw Object.assign(new Error('Not synced: 1 kept change has not been pushed to the repository yet.'), { statusCode: 409 }); },
    }; } },
  });
  assert.deepEqual(await service.runKnowledge('team', 'private-runbooks'), { skipped: 'pending or kept knowledge changes' });
});

test('ADR-0012: private project job attempts later bases when an earlier base fails', async () => {
  const attempted = [];
  const ctx = setup();
  const source = knowledgeJobSource({ ...ctx, store: { async latest() { return null; } } });
  const job = { projectId: 'fast', payload: { bases: ['private-a', 'private-b'], shared: false } };
  ctx.integrationSync.runKnowledge = async (_projectId, name) => {
    attempted.push(name);
    if (name === 'private-a') throw new Error('upstream unavailable');
    return { synced: true };
  };
  await assert.rejects(source.execute(job), /private-a: upstream unavailable/);
  assert.deepEqual(attempted, ['private-a', 'private-b']);
});
