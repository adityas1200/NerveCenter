import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { IntegrationSyncService } from '../src/sync/integration-sync.mjs';
import { FileOperationsStore } from '../src/app/operations-store.mts';
import { systemScope } from '../src/projects/project-access.mjs';

async function workspace(dir, operations) {
  await fs.mkdir(dir, { recursive: true });
  return { dir, async readOperations() { return operations; } };
}

test('FR-2/FR-3: project sources use independent due times, disabled projects do not block, and force bypasses cadence', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nc-project-sync-'));
  try {
  let time = 1_000_000;
  const operations = {
    alpha: { sync: { knowledge: { every: 30, unit: 'seconds' }, github: { every: 60, unit: 'seconds' } }, source_control: { platform: 'github', repository: 'acme/app' } },
    beta: { sync: { enabled: false }, source_control: { platform: 'github', repository: 'acme/app' } },
    gamma: { sync: { intervalValue: 2, intervalUnit: 'minutes', github: { every: 90, unit: 'seconds' } }, source_control: { platform: 'github', repository: 'acme/app' } },
  };
  const workspaces = new Map();
  for (const id of Object.keys(operations)) workspaces.set(id, await workspace(path.join(root, id), operations[id]));
  const counts = { knowledge: {}, github: {}, credentials: {} };
  const knowledge = { async for(id) { return { async list() { return { items: [{ name: 'private-runbooks', kind: 'git', pendingChanges: 0 }] }; }, async sync() { counts.knowledge[id] = (counts.knowledge[id] || 0) + 1; } }; } };
  const projects = { async list() { return Object.keys(operations).map(id => ({ id, kind: 'normal', archivedAt: null })); } };
  const runner = async (command, args, options) => {
    if (command === 'git' && args[0] === 'clone') { await fs.mkdir(path.join(args.at(-1), '.git'), { recursive: true }); return { stdout: '' }; }
    if (command === 'gh') { counts.github[options.env.GH_TOKEN] = (counts.github[options.env.GH_TOKEN] || 0) + 1; return { stdout: '[]' }; }
    return { stdout: '' };
  };
  const service = new IntegrationSyncService({
    projects, workspaces: { async for(id) { return workspaces.get(id); } }, workspace: workspaces.get('alpha'), knowledge, store: { async findTicketBySourceKey() { return null; } },
    runner, databricksFailures: false, clock: () => time, knowledgeSeconds: 45, githubSeconds: 75,
    envProvider: async id => { const token = `credential-${id}`; counts.credentials[id] = token; return { GH_TOKEN: token }; },
  });

  const first = await service.poll();
  assert.deepEqual(Object.keys(first.projects), ['alpha', 'beta', 'gamma']);
  assert.deepEqual(counts.knowledge, { alpha: 1, gamma: 1 });
  assert.deepEqual(counts.github, { 'credential-alpha': 1, 'credential-gamma': 1 });

  time += 31_000;
  await service.poll();
  assert.equal(counts.knowledge.alpha, 2, 'alpha knowledge is independently due at 30 seconds');
  assert.equal(counts.github['credential-alpha'], 1, 'alpha GitHub is not due at 31 seconds');
  assert.equal(counts.knowledge.gamma, 1, 'gamma knowledge uses shared 120 second cadence');

  time += 31_000;
  await service.poll();
  assert.equal(counts.github['credential-alpha'], 2, 'alpha GitHub becomes due at 62 seconds');
  assert.equal(counts.github['credential-gamma'], 1, 'gamma GitHub uses its own 90 second cadence');
  assert.equal(counts.github['credential-beta'], undefined, 'disabled beta does not use a GitHub credential');

  await service.poll({ force: true });
  assert.equal(counts.knowledge.alpha, 4, 'force runs immediately despite source cadence');
  assert.equal(counts.github['credential-alpha'], 3);
  assert.equal(counts.knowledge.beta, 1, 'force bypasses the disabled-project scheduling guard');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('FR-11: same-repository pull requests use project connection IDs and only adopt same-project legacy tickets', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nc-project-pr-'));
  try {
  const projectIds = ['one', 'two'];
  const ws = new Map();
  for (const id of projectIds) ws.set(id, await workspace(path.join(root, id), { source_control: { platform: 'github', repository: 'acme/shared' } }));
  const store = new FileOperationsStore(path.join(root, 'state.json'));
  await store.init();
  await store.createTicket({ ticketId: 'legacy-one', projectId: 'one', connectionId: '', sourceKey: 'github-pr:acme/shared:9', source: 'github', title: 'Legacy PR ticket', status: 'open', priority: 'medium', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), activity: [] });
  const tokens = [];
  const service = new IntegrationSyncService({
    projects: { async list() { return projectIds.map(id => ({ id, kind: 'normal' })); } }, workspaces: { async for(id) { return ws.get(id); } },
    workspace: ws.get('one'), knowledge: null, store, databricksFailures: false,
    envProvider: async id => ({ GITHUB_TOKEN: `token-${id}` }),
    runner: async (command, args, options) => { if (command === 'gh') tokens.push(options.env.GH_TOKEN); return { stdout: command === 'gh' ? JSON.stringify([{ number: 9, state: 'OPEN', title: 'Improve shared repo', isDraft: false, url: 'https://github.com/acme/shared/pull/9' }]) : '' }; },
  });

  const first = await service.poll({ force: true });
  assert.deepEqual(first.projects.one.github.pullRequests, { checked: 1, created: 0, updated: 1 }, 'the legacy empty-connection ticket is reused in its original project');
  assert.deepEqual(first.projects.two.github.pullRequests, { checked: 1, created: 1, updated: 0 }, 'the other project creates its own ticket');
  assert.deepEqual(tokens, ['token-one', 'token-two']);
  const one = await store.listTickets(systemScope('one'));
  const two = await store.listTickets(systemScope('two'));
  assert.equal(one.length, 1);
  assert.equal(two.length, 1);
  assert.equal(one[0].connectionId, '');
  assert.equal(two[0].connectionId, 'github:two');

  await service.poll({ force: true });
  assert.equal((await store.listTickets(systemScope('one'))).length, 1);
  assert.equal((await store.listTickets(systemScope('two'))).length, 1);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('FR-2: all disabled projects keep the skipped result contract and workspace errors stay project-local', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nc-project-error-'));
  try {
  const disabledWorkspace = await workspace(path.join(root, 'disabled'), { sync: { enabled: false } });
  const failingWorkspace = { dir: path.join(root, 'broken'), async readOperations() { throw new Error('settings unavailable'); } };
  const activeWorkspace = await workspace(path.join(root, 'active'), { source_control: { platform: 'github', repository: 'acme/active' } });
  const ids = ['disabled-one', 'disabled-two'];
  const disabled = new IntegrationSyncService({
    projects: { async list() { return ids.map(id => ({ id, kind: 'normal' })); } },
    workspaces: { async for() { return disabledWorkspace; } }, workspace: disabledWorkspace,
    knowledge: null, store: {}, databricksFailures: false,
  });
  assert.deepEqual(await disabled.poll(), { skipped: 'auto sync disabled' });

  let githubCalls = 0;
  const service = new IntegrationSyncService({
    projects: { async list() { return ['broken', 'credential-error', 'working'].map(id => ({ id, kind: 'normal' })); } },
    workspaces: { async for(id) { return id === 'broken' ? failingWorkspace : activeWorkspace; } }, workspace: activeWorkspace,
    knowledge: null, store: { async findTicketBySourceKey() { return null; } }, databricksFailures: false,
    envProvider: async id => { if (id === 'credential-error') throw new Error('connector unavailable'); return { GH_TOKEN: 'working-project-token' }; },
    runner: async command => { if (command === 'gh') githubCalls += 1; return { stdout: '[]' }; },
  });
  const result = await service.poll();
  assert.deepEqual(result.projects.broken, { error: 'settings unavailable' });
  assert.deepEqual(result.projects['credential-error'].github, { error: 'connector unavailable' });
  assert.deepEqual(result.projects.working.github.pullRequests, { checked: 0, created: 0, updated: 0 });
  assert.equal(githubCalls, 1);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('FR-11: a multi-project sync with no connector credential never uses process-global GitHub tokens', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nc-project-token-'));
  const previous = { GH_TOKEN: process.env.GH_TOKEN, GITHUB_TOKEN: process.env.GITHUB_TOKEN };
  process.env.GH_TOKEN = 'global-fake-token';
  process.env.GITHUB_TOKEN = 'global-fake-fallback';
  try {
    const projectWorkspace = await workspace(path.join(root, 'project'), { source_control: { platform: 'github', repository: 'acme/private' } });
    let commands = 0;
    const service = new IntegrationSyncService({
      projects: { async list() { return [{ id: 'project', kind: 'normal' }]; } },
      workspaces: { async for() { return projectWorkspace; } }, workspace: projectWorkspace,
      knowledge: null, store: {}, databricksFailures: false, envProvider: async () => ({}),
      runner: async () => { commands += 1; return { stdout: '[]' }; },
    });
    const result = await service.poll({ force: true });
    assert.deepEqual(result.github, { skipped: 'GitHub credential is not configured for this project' });
    assert.equal(commands, 0, 'neither git nor gh runs without this project\'s credential');
  } finally {
    for (const key of ['GH_TOKEN', 'GITHUB_TOKEN']) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
    await fs.rm(root, { recursive: true, force: true });
  }
});
