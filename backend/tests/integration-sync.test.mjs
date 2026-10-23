import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FileOperationsStore } from '../src/app/operations-store.mjs';
import { DEFAULT_INTEGRATION_SYNC_SECONDS, IntegrationSyncService, repositoryParts, safeSourcePath } from '../src/sync/integration-sync.mjs';
import { automaticSyncIntervalSeconds } from '../src/sync/sync-settings.mjs';
import { definition } from '../src/connectors/connector-catalog.mjs';
import { tempDir, pilot } from './helpers.mjs';

const tmp = await tempDir('nc-integration-sync-', { maxRetries: 3 });

test('automatic Databricks, GitHub and knowledge sync defaults to 15 seconds', () => {
  const saved = Object.fromEntries(['OPS_INTEGRATION_SYNC_SECONDS', 'OPS_KNOWLEDGE_SYNC_SECONDS', 'OPS_GITHUB_SYNC_SECONDS'].map(key => [key, process.env[key]]));
  for (const key of Object.keys(saved)) delete process.env[key];
  try {
    const service = new IntegrationSyncService();
    assert.equal(DEFAULT_INTEGRATION_SYNC_SECONDS, 15);
    assert.deepEqual([service.intervalSeconds, service.knowledgeSeconds, service.githubSeconds], [15, 15, 15]);
  } finally {
    for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});

test('the workspace sync interval controls scheduled integrations', async () => {
  let time = Date.parse('2026-09-28T09:00:00Z'); let calls = 0;
  const service = new IntegrationSyncService({
    operationsService: { async monitor() { calls += 1; return { recentRuns: [] }; } },
    store: {},
    knowledge: { async list() { return { items: [] }; } },
    workspace: { dir: tmp, async readOperations() { return { sync: { enabled: true, interval_seconds: 30 } }; } },
    clock: () => time,
  });

  await service.poll();
  time += 15_000;
  assert.deepEqual(await service.poll(), { skipped: 'interval not elapsed' });
  time += 15_000;
  await service.poll();
  assert.equal(calls, 2);
});

test('GitHub repository settings are normalized and cannot escape workspace/source', () => {
  assert.deepEqual(repositoryParts('https://github.com/Acme/Widgets.git'), { slug: 'Acme/Widgets', remote: 'https://github.com/Acme/Widgets.git', folder: 'acme-widgets' });
  assert.deepEqual(repositoryParts('acme/widgets').slug, 'acme/widgets');
  const workspace = { dir: path.join(tmp, 'safe-workspace') };
  assert.equal(safeSourcePath(workspace, '', 'acme-widgets'), path.join(workspace.dir, 'source', 'acme-widgets'));
  assert.throws(() => safeSourcePath(workspace, '../outside', 'unused'), /must stay inside/);
});

test('the GitHub connector stores source-control settings and keeps its token in the environment contract', () => {
  const github = definition('github');
  assert.equal(github.kind, 'cli');
  assert.equal(github.cli.command, 'gh');
  assert.deepEqual(github.secrets.map(secret => secret.env), ['GITHUB_TOKEN']);
  assert.deepEqual(github.operations({ repository: 'acme/widgets', defaultBranch: 'develop' }), { source_control: { platform: 'github', connection: 'github', repository: 'acme/widgets', default_branch: 'develop' } });
});

test('one poll syncs failed Databricks runs, clean knowledge, source code and GitHub pull requests idempotently', async () => {
  const dir = path.join(tmp, 'workspace'); await fs.mkdir(dir, { recursive: true });
  const store = new FileOperationsStore(path.join(tmp, 'state.json')); await store.init();
  const createdRuns = [];
  const operationsService = {
    async monitor() { return { recentRuns: [{ platform: 'databricks', pipelineId: '42', runId: '9001', status: 'failed' }, { platform: 'databricks', pipelineId: '42', runId: '9002', status: 'healthy' }] }; },
    async createTicket(input) {
      createdRuns.push(input.runId);
      const ticketId = await store.nextTicketId();
      return store.createTicket({ projectId: 'pilot', ticketId, source: 'databricks', sourceKey: `databricks:${input.pipelineId}:${input.runId}`, pipelineId: input.pipelineId, runId: input.runId, title: 'Failed pipeline', status: 'open', priority: 'high', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), activity: [] });
    },
  };
  const knowledgeSynced = [];
  const knowledge = { async list() { return { items: [{ name: 'runbooks', kind: 'git', pendingChanges: 0 }, { name: 'drafts', kind: 'git', pendingChanges: 2 }] }; }, async sync(name) { knowledgeSynced.push(name); } };
  const workspace = { dir, async readOperations() { return { source_control: { platform: 'github', repository: 'acme/widgets', default_branch: 'main' } }; } };
  let merged = false;
  const pullRequests = [
    { number: 7, title: 'Add retry guard', body: 'Prevents duplicate retries.', state: 'OPEN', isDraft: false, url: 'https://github.com/acme/widgets/pull/7', author: { login: 'alex' }, createdAt: '2026-09-27T08:00:00Z', updatedAt: '2026-09-28T08:00:00Z', headRefName: 'fix/retry', baseRefName: 'main', reviewDecision: 'APPROVED', statusCheckRollup: [{ name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS' }] },
    { number: 8, title: 'Update docs', body: '', state: 'MERGED', isDraft: false, url: 'https://github.com/acme/widgets/pull/8', author: { login: 'sam' }, createdAt: '2026-09-26T08:00:00Z', updatedAt: '2026-09-28T07:00:00Z', mergedAt: '2026-09-28T07:00:00Z', headRefName: 'docs', baseRefName: 'main', statusCheckRollup: [] },
  ];
  const calls = [];
  const runner = async (command, args, options) => {
    calls.push({ command, args, options });
    if (command === 'git' && args[0] === 'clone') { const target = args.at(-1); await fs.mkdir(path.join(target, '.git'), { recursive: true }); return { stdout: '', stderr: '' }; }
    if (command === 'git' && args.includes('status')) return { stdout: '', stderr: '' };
    if (command === 'git' && args.includes('branch')) return { stdout: 'main\n', stderr: '' };
    if (command === 'git' && args.includes('merge')) { merged = true; return { stdout: '', stderr: '' }; }
    if (command === 'gh') return { stdout: JSON.stringify(pullRequests), stderr: '' };
    return { stdout: '', stderr: '' };
  };
  const sync = new IntegrationSyncService({ operationsService, store, workspace, knowledge, runner, envProvider: () => ({ GITHUB_TOKEN: 'test-token' }), clock: () => Date.parse('2026-09-28T09:00:00Z') });

  const first = await sync.poll({ force: true });
  assert.deepEqual(first.databricks, { checked: 1, created: 1 });
  assert.deepEqual(createdRuns, ['9001']);
  assert.deepEqual(knowledgeSynced, ['runbooks']);
  assert.equal(first.github.code.action, 'cloned');
  assert.deepEqual(first.github.pullRequests, { checked: 2, created: 2, updated: 0 });
  assert.equal(calls.find(call => call.command === 'git').options.env.GIT_CONFIG_VALUE_0.includes('test-token'), false, 'the Git auth header is encoded');

  pullRequests[0] = { ...pullRequests[0], state: 'MERGED', mergedAt: '2026-09-28T09:05:00Z', updatedAt: '2026-09-28T09:05:00Z' };
  const second = await sync.poll({ force: true });
  assert.deepEqual(second.databricks, { checked: 1, created: 0 });
  assert.deepEqual(second.github.pullRequests, { checked: 2, created: 0, updated: 2 });
  assert.equal(merged, true, 'a clean default branch is fast-forwarded after fetch');
  const tickets = await store.listTickets(pilot);
  assert.equal(tickets.length, 3);
  assert.equal(tickets.find(ticket => ticket.sourceKey === 'github-pr:acme/widgets:7').status, 'resolved');
  assert.equal(tickets.find(ticket => ticket.sourceKey === 'github-pr:acme/widgets:8').metadata.github.state, 'MERGED');
});

test('a dirty source repository is fetched but never merged', async () => {
  const dir = path.join(tmp, 'dirty-workspace'); const target = path.join(dir, 'source', 'acme-widgets'); await fs.mkdir(path.join(target, '.git'), { recursive: true });
  const calls = [];
  const runner = async (command, args) => {
    calls.push({ command, args });
    if (command === 'git' && args.includes('status')) return { stdout: ' M local-change.js\n', stderr: '' };
    if (command === 'git' && args.includes('branch')) return { stdout: 'main\n', stderr: '' };
    if (command === 'gh') return { stdout: '[]', stderr: '' };
    return { stdout: '', stderr: '' };
  };
  const service = new IntegrationSyncService({ operationsService: { async monitor() { throw new Error('not configured'); } }, store: {}, knowledge: { async list() { return { items: [] }; } }, workspace: { dir, async readOperations() { return { source_control: { platform: 'github', repository: 'acme/widgets' } }; } }, runner });
  const result = await service.poll({ force: true });
  assert.equal(result.github.code.action, 'fetched');
  assert.equal(result.github.code.dirty, true);
  assert.equal(calls.some(call => call.command === 'git' && call.args.includes('merge')), false);
});

test('scheduled integration polling stops while the app is inactive but forced sync still runs', async () => {
  let calls = 0;
  const service = new IntegrationSyncService({
    operationsService: { async monitor() { calls += 1; return { recentRuns: [] }; } },
    store: {},
    knowledge: { async list() { return { items: [] }; } },
    workspace: { dir: tmp, async readOperations() { return {}; } },
    isAppActive: () => false,
  });

  assert.deepEqual(await service.poll(), { skipped: 'app inactive' });
  assert.equal(calls, 0);
  await service.poll({ force: true });
  assert.equal(calls, 1);
});

test('the workspace auto-sync switch stops scheduled integrations but not forced sync', async () => {
  let calls = 0;
  const service = new IntegrationSyncService({
    operationsService: { async monitor() { calls += 1; return { recentRuns: [] }; } },
    store: {},
    knowledge: { async list() { return { items: [] }; } },
    workspace: { dir: tmp, async readOperations() { return { sync: { enabled: false } }; } },
  });

  assert.deepEqual(await service.poll(), { skipped: 'auto sync disabled' });
  assert.equal(calls, 0);
  await service.poll({ force: true });
  assert.equal(calls, 1);
});

test('automaticSyncIntervalSeconds reads the user-chosen number and unit from operations.yaml, not a hardcoded cadence', async () => {
  const seconds = { dir: tmp, async readOperations() { return { sync: { intervalValue: 45, intervalUnit: 'seconds' } }; } };
  const minutes = { dir: tmp, async readOperations() { return { sync: { intervalValue: 5, intervalUnit: 'minutes' } }; } };
  const hours = { dir: tmp, async readOperations() { return { sync: { intervalValue: 2, intervalUnit: 'hours' } }; } };
  const unset = { dir: tmp, async readOperations() { return {}; } };
  const invalid = { dir: tmp, async readOperations() { return { sync: { intervalValue: -3, intervalUnit: 'minutes' } }; } };
  assert.equal(await automaticSyncIntervalSeconds(seconds), 45);
  assert.equal(await automaticSyncIntervalSeconds(minutes), 300);
  assert.equal(await automaticSyncIntervalSeconds(hours), 7200);
  assert.equal(await automaticSyncIntervalSeconds(unset), 15, 'falls back to 15 seconds until the user picks a cadence');
  assert.equal(await automaticSyncIntervalSeconds(unset, 300), 300, 'a caller-supplied fallback (the server default) wins over the hardcoded 60s');
  assert.equal(await automaticSyncIntervalSeconds(invalid), 15, 'an invalid saved value falls back rather than syncing constantly');
});

test('a scheduled poll waits for the user-configured interval to elapse before doing real sync work', async () => {
  let calls = 0; let clockValue = Date.parse('2026-09-28T09:00:00Z');
  const service = new IntegrationSyncService({
    operationsService: { async monitor() { calls += 1; return { recentRuns: [] }; } },
    store: {},
    knowledge: { async list() { return { items: [] }; } },
    workspace: { dir: tmp, async readOperations() { return { sync: { intervalValue: 30, intervalUnit: 'seconds' } }; } },
    clock: () => clockValue,
  });

  // Nothing has synced yet, so the first check always finds "since forever" elapsed and runs immediately.
  await service.poll();
  assert.equal(calls, 1);

  clockValue += 10_000; // only 10s after that first sync: short of the configured 30s
  assert.deepEqual(await service.poll(), { skipped: 'interval not elapsed' });
  assert.equal(calls, 1, 'no new sync work happens before the configured interval elapses');

  clockValue += 25_000; // 35s after the first sync in total: past the configured 30s
  await service.poll();
  assert.equal(calls, 2, 'sync work resumes once the user-configured interval has actually elapsed');
});
