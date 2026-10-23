import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { IntegrationSyncService } from '../src/sync/integration-sync.mjs';

async function fixture(t, { operationsByProject, projectRows, envProvider, runner } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nc-github-job-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const workspaces = new Map();
  for (const [id, operations] of Object.entries(operationsByProject || {})) {
    const dir = path.join(root, id);
    await fs.mkdir(dir, { recursive: true });
    workspaces.set(id, { dir, async readOperations() { return operations; } });
  }
  const sync = new IntegrationSyncService({
    projects: { async list() { return projectRows || [...workspaces.keys()].map(id => ({ id, kind: 'normal' })); } },
    workspaces: { async for(id) { const workspace = workspaces.get(id); if (!workspace) throw new Error(`unexpected project ${id}`); return workspace; } },
    workspace: workspaces.values().next().value,
    knowledge: { async for() { return { async list() { return { items: [] }; }, async sync() {} }; } },
    store: { async findTicketBySourceKey() { return null; }, async nextTicketId() { return 'ticket-1'; }, async createTicket() {}, async updateTicket() {} },
    envProvider: envProvider || (async id => ({ GH_TOKEN: `token-${id}` })),
    runner: runner || (async command => ({ stdout: command === 'gh' ? '[]' : '' })),
  });
  return { sync, workspaces };
}

test('SPEC-platform-12 FR-7: runGithub executes one selected active project immediately and uses its connector', async t => {
  const operations = { source_control: { platform: 'github', repository: 'acme/app' } };
  const tokens = [];
  const { sync } = await fixture(t, {
    operationsByProject: { alpha: operations, beta: operations },
    envProvider: async id => ({ GH_TOKEN: `token-${id}` }),
    runner: async (command, args, options) => {
      if (command === 'gh') tokens.push(options.env.GH_TOKEN);
      return { stdout: command === 'gh' ? '[]' : '' };
    },
  });

  const result = await sync.runGithub('beta');
  assert.equal(result.repository, 'acme/app');
  assert.deepEqual(tokens, ['token-beta']);
  assert.deepEqual(await sync.runGithub('beta'), result, 'the durable adapter does not use process-local due timing');
  assert.deepEqual(tokens, ['token-beta', 'token-beta']);
});

test('SPEC-platform-12 FR-7: inactive or disabled projects do not run scheduled GitHub', async t => {
  let calls = 0;
  const { sync } = await fixture(t, {
    operationsByProject: {
      disabled: { sync: { enabled: false }, source_control: { platform: 'github', repository: 'acme/app' } },
      archived: { source_control: { platform: 'github', repository: 'acme/app' } },
    },
    projectRows: [{ id: 'disabled', kind: 'normal' }, { id: 'archived', kind: 'normal', archivedAt: '2026-10-10' }],
    runner: async () => { calls += 1; return { stdout: '[]' }; },
  });

  assert.deepEqual(await sync.runGithub('archived'), { skipped: 'project inactive' });
  assert.deepEqual(await sync.runGithub('disabled'), { skipped: 'auto sync disabled' });
  assert.equal(calls, 0);
  assert.equal((await sync.runGithub('disabled', { force: true })).repository, 'acme/app');
  sync.isAppActive = () => false;
  assert.deepEqual(await sync.runGithub('disabled'), { skipped: 'app inactive' });
});

test('SPEC-platform-12 FR-7: connector failures reject the job while missing credentials skip', async t => {
  const operations = { source_control: { platform: 'github', repository: 'acme/app' } };
  const { sync } = await fixture(t, {
    operationsByProject: { missing: operations, broken: operations },
    envProvider: async id => {
      if (id === 'broken') throw new Error('connector unavailable');
      return {};
    },
    runner: async () => { throw new Error('runner should not be called without a token'); },
  });

  assert.deepEqual(await sync.runGithub('missing'), { skipped: 'GitHub credential is not configured for this project' });
  await assert.rejects(sync.runGithub('broken'), /connector unavailable/);
});

test('SPEC-platform-12 FR-7: ordinary poll keeps its default knowledge and GitHub behavior', async t => {
  let knowledgeCalls = 0;
  let githubCalls = 0;
  const operations = { source_control: { platform: 'github', repository: 'acme/app' } };
  const { sync } = await fixture(t, {
    operationsByProject: { alpha: operations },
    runner: async command => { if (command === 'gh') githubCalls += 1; return { stdout: command === 'gh' ? '[]' : '' }; },
  });
  sync.knowledge = { async for() { return { async list() { return { items: [{ name: 'runbooks', kind: 'git', pendingChanges: 0 }] }; }, async sync() { knowledgeCalls += 1; } }; } };

  const result = await sync.poll({ force: true });
  assert.equal(result.knowledge.synced, 1);
  assert.equal(result.github.repository, 'acme/app');
  assert.equal(knowledgeCalls, 1);
  assert.equal(githubCalls, 1);
});
