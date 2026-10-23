import test from 'node:test';
import assert from 'node:assert/strict';
import { FileJobStore } from '../src/jobs/job-store.mjs';
import { ScheduledJobDispatcher } from '../src/jobs/scheduler.mjs';
import { MonitoringService } from '../src/monitoring/monitoring-service.mjs';
import { tempDir } from './helpers.mjs';

test('SPEC-platform-14 FR-8: an explicit monitoring job waits for its persisted result', async () => {
  const store = new FileJobStore(await tempDir('nc-manual-monitor-')); await store.init();
  const at = new Date('2026-10-12T00:00:00Z');
  const jobs = new ScheduledJobDispatcher({ store, clock: () => at });
  jobs.registerSource('monitoring:manual', { dueJobs: async () => [], maxAttempts: 1,
    execute: async job => ({ source: job.payload.source, fetched: true }) });
  const result = await jobs.runNow({ source: 'monitoring:manual', projectId: 'alpha', payload: { source: 'pipelines' } });
  assert.equal(result.state, 'succeeded');
  assert.deepEqual(result.result, { source: 'pipelines', fetched: true });
  assert.equal(result.attempts, 1);
});

test('SPEC-platform-14 FR-8: a manual job arriving during an active tick is dispatched without a periodic timer', async () => {
  const store = new FileJobStore(await tempDir('nc-manual-monitor-overlap-')); await store.init();
  const jobs = new ScheduledJobDispatcher({ store, maxConcurrentJobs: 1 });
  jobs.registerSource('monitoring:manual', { dueJobs: async () => [], maxAttempts: 1,
    execute: async job => { await new Promise(resolve => setTimeout(resolve, 150)); return { source: job.payload.source }; } });
  const first = jobs.runNow({ source: 'monitoring:manual', projectId: 'alpha', payload: { source: 'pipelines' }, timeoutMs: 4_000 });
  await new Promise(resolve => setTimeout(resolve, 20));
  const second = jobs.runNow({ source: 'monitoring:manual', projectId: 'alpha', payload: { source: 'dataQuality' }, timeoutMs: 4_000 });
  assert.deepEqual((await Promise.all([first, second])).map(job => job.result.source), ['pipelines', 'dataQuality']);
});

test('SPEC-platform-14 FR-8: manual refresh waits for queue-backed fetch and keeps throttle and result shape', async () => {
  let at = Date.parse('2026-10-12T00:00:00Z');
  const monitoring = new MonitoringService({ clock: () => at, workspaces: {}, store: {}, operationsService: {}, alerts: {} });
  const fetched = [];
  monitoring.setManualFetch(async (projectId, source) => { fetched.push([projectId, source]); return { fetched: true }; });
  monitoring.detectProject = async () => ({ detect: { opened: 0 }, queue: { started: 0 } });
  assert.deepEqual(await monitoring.refresh('alpha', { sources: ['pipelines'] }),
    { pipelines: { fetched: true }, detect: { opened: 0 }, queue: { started: 0 } });
  assert.deepEqual(fetched, [['alpha', 'pipelines']]);
  await assert.rejects(monitoring.refresh('alpha', { sources: ['pipelines'] }), error => error.statusCode === 429);
  at += 30_001;
  assert.equal((await monitoring.refresh('alpha', { sources: ['pipelines'] })).pipelines.fetched, true);
});

test('SPEC-platform-14 FR-5: a failed manual fetch does not trigger detection', async () => {
  const monitoring = new MonitoringService({ workspaces: {}, store: {}, operationsService: {}, alerts: {} });
  monitoring.setManualFetch(async () => ({ error: 'Provider unavailable' }));
  let detected = false;
  monitoring.detectProject = async () => { detected = true; return {}; };
  assert.deepEqual(await monitoring.refresh('alpha', { sources: ['pipelines'] }), { pipelines: { error: 'Provider unavailable' } });
  assert.equal(detected, false);
});
