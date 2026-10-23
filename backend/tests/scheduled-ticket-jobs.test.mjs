import test from 'node:test';
import assert from 'node:assert/strict';
import { ticketJobSource } from '../src/jobs/ticket-jobs.mjs';
import { TicketTaskService } from '../src/tasks/ticket-tasks.mjs';

test('SPEC-platform-14 FR-1: ticket jobs use per-project cadence, active normal projects, and persisted sequential slots', async () => {
  let at = Date.parse('2026-10-12T00:00:00Z');
  const latest = new Map();
  const projects = { async list() { return [
    { id: 'alpha', kind: 'normal' }, { id: 'beta', kind: 'normal' },
    { id: 'archived', kind: 'normal', archivedAt: '2026-10-01' }, { id: 'pilot', kind: 'pilot' },
  ]; } };
  const configs = { alpha: { sync: { tickets: { every: 30, unit: 'seconds' } } }, beta: { sync: { tickets: { every: 90, unit: 'seconds' } } } };
  const workspaces = { async for(id) { return { async readOperations() { return configs[id] || {}; } }; } };
  const source = ticketJobSource({ store: { async latest(id, type) { assert.equal(type, 'tickets'); return latest.get(id) || null; } },
    ticketTasks: {}, projects, workspaces, fallbackSeconds: 15, clock: () => at });
  const first = await source.dueJobs({ at });
  assert.deepEqual(first.map(job => [job.projectId, job.slot]), [['alpha', '1'], ['beta', '1']]);
  for (const job of first) latest.set(job.projectId, { ...job, state: 'succeeded', finishedAt: new Date(at).toISOString() });
  at += 31_000;
  assert.deepEqual((await source.dueJobs({ at })).map(job => job.projectId), ['alpha']);
  latest.set('alpha', { projectId: 'alpha', slot: '2', dueAt: new Date(at).toISOString(), state: 'queued' });
  at += 60_000;
  assert.deepEqual((await source.dueJobs({ at })).map(job => job.projectId), ['beta']);
});

test('SPEC-platform-14 FR-2, FR-3: ticket job imports each provider despite a source failure and never invokes Sonic', async () => {
  const calls = [];
  const service = new TicketTaskService({
    workspace: { async readOperations() { return { ticketing: { sources: [
      { platform: 'servicenow' }, { platform: 'jira' },
    ] } }; } },
    operationsService: {
      async syncServiceNow(args) { calls.push(['servicenow', args]); throw new Error('temporary outage token=sentinel-secret'); },
      async syncJira(args) { calls.push(['jira', args]); return { tickets: [{ ticketId: 'J-1' }] }; },
    },
    store: {}, runtime: { on() {}, async startTask() { throw new Error('Sonic must not run in import jobs'); } },
  });
  const source = ticketJobSource({ store: {}, ticketTasks: service,
    projects: { async list() { return [{ id: 'alpha', kind: 'normal' }]; } },
    workspaces: { async for() { return service.workspace; } },
  });
  await assert.rejects(source.execute({ projectId: 'alpha' }), error => /servicenow: temporary outage/.test(error.message) && !error.message.includes('sentinel-secret'));
  assert.deepEqual(calls.map(([platform]) => platform), ['servicenow', 'jira']);
  assert.equal(calls[0][1].startTriage, false);
  assert.equal(calls[0][1].scope.projectId, 'alpha');
});

test('SPEC-platform-14 FR-1: inactive app and disabled auto sync enqueue no ticket imports', async () => {
  let calls = 0;
  const projects = { async list() { calls += 1; return [{ id: 'alpha', kind: 'normal' }]; } };
  const common = { store: {}, ticketTasks: {}, projects,
    workspaces: { async for() { return { async readOperations() { return { sync: { enabled: false } }; } }; } } };
  assert.deepEqual(await ticketJobSource({ ...common, isAppActive: () => false }).dueJobs(), []);
  assert.equal(calls, 0);
  assert.deepEqual(await ticketJobSource(common).dueJobs(), []);
});
