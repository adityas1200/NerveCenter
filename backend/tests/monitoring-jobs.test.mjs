import test from 'node:test';
import assert from 'node:assert/strict';
import { monitoringJobSource, monitoringJobSources } from '../src/jobs/monitoring-jobs.mjs';
import { MonitoringService } from '../src/monitoring/monitoring-service.mjs';

const clockAt = Date.parse('2026-10-12T00:00:00.000Z');
const projectList = [
  { id: 'pilot', kind: 'normal' },
  { id: 'other', kind: 'normal' },
  { id: 'archived', kind: 'normal', archivedAt: '2026-01-01' },
  { id: 'reserved', kind: 'unrouted' },
];
const opsByProject = {
  pilot: { sync: { pipelines: { every: 1, unit: 'minutes' } }, automation: { enabled: false } },
  other: { sync: { pipelines: { every: 5, unit: 'minutes' }, dataQuality: { every: 2, unit: 'minutes' } }, automation: { enabled: false } },
};
function setupJobs({ active = true, latest = {} } = {}) {
  const calls = [];
  const store = { async latest(projectId, source) { return latest[`${projectId}/${source}`] || null; } };
  const workspaces = { async for(id) { return { async readOperations() { return opsByProject[id] || {}; } }; } };
  const dataQualityService = { ledgerProjectId: 'pilot' };
  const monitoring = { async fetchScheduledSource(...args) { calls.push(args); return { fetched: true }; } };
  const sources = monitoringJobSources({ store, monitoring, dataQualityService, projects: { list: async () => projectList }, workspaces, isAppActive: () => active, clock: () => clockAt, log: { error() {} } });
  return { sources, calls };
}

test('SPEC-platform-14 FR-4: pipeline and shared DQ jobs have independent due slots and ledger ownership', async () => {
  const { sources } = setupJobs();
  const pipeline = await sources['monitoring:pipelines'].dueJobs({ at: new Date(clockAt) });
  const dq = await sources['monitoring:dataQuality'].dueJobs({ at: new Date(clockAt) });
  assert.deepEqual(pipeline.map(job => job.projectId), ['pilot', 'other']);
  assert.deepEqual(dq.map(job => job.projectId), ['pilot']);
  assert.deepEqual(pipeline.map(job => job.slot), ['1', '1']);
  assert.deepEqual(dq.map(job => job.slot), ['1']);
});

test('SPEC-platform-14 FR-4: persisted completion times gate each source on its own cadence', async () => {
  const latest = {
    'pilot/monitoring:pipelines': { state: 'succeeded', slot: '4', dueAt: new Date(clockAt - 30_000).toISOString(), finishedAt: new Date(clockAt - 10_000).toISOString() },
    'other/monitoring:pipelines': { state: 'succeeded', slot: '2', dueAt: new Date(clockAt - 400_000).toISOString(), finishedAt: null },
  };
  const { sources } = setupJobs({ latest });
  const due = await sources['monitoring:pipelines'].dueJobs({ at: new Date(clockAt) });
  assert.deepEqual(due, [{ projectId: 'other', slot: '3', dueAt: new Date(clockAt).toISOString() }]);
});

test('SPEC-platform-14 FR-4, FR-6: automatic jobs obey sync, active-project, presence, and automation gates', async () => {
  const { sources } = setupJobs({ active: false });
  const noAutomation = await sources['monitoring:pipelines'].dueJobs({ at: new Date(clockAt) });
  assert.deepEqual(noAutomation, []);
  opsByProject.pilot.automation = { enabled: true, pipelineFailed: { action: 'task' } };
  try {
    const watched = await sources['monitoring:pipelines'].dueJobs({ at: new Date(clockAt) });
    assert.deepEqual(watched.map(job => job.projectId), ['pilot']);
  } finally { delete opsByProject.pilot.automation; }
});

test('SPEC-platform-14 FR-5: retryable source execution only fetches and propagates failures', async () => {
  const { sources, calls } = setupJobs();
  const result = await sources['monitoring:pipelines'].execute({ projectId: 'pilot', payload: {} });
  assert.deepEqual(result, { fetched: true });
  assert.deepEqual(calls, [['pilot', 'pipelines', { force: false }]]);
  await sources['monitoring:dataQuality'].execute({ projectId: 'pilot', payload: { source: 'dataQuality', force: true } });
  assert.deepEqual(calls[1], ['pilot', 'dataQuality', { force: true }]);

  const failing = new MonitoringService({
    store: { getState: async () => null, setState: async () => {}, listRuns: async () => ({ items: [] }) },
    operationsService: { fetchPlatformSnapshot: async () => { throw new Error('provider unavailable'); } },
    workspaces: { for: async () => ({ readOperations: async () => ({}) }) },
    alerts: { drain: async () => { throw new Error('detector must not run'); } },
    checkSeconds: 0,
  });
  await assert.rejects(failing.fetchScheduledSource('pilot', 'pipelines'), /provider unavailable/);
});
