import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { FileMonitorStore, STATE } from '../src/monitoring/monitor-store.mjs';
import { tempDir } from './helpers.mjs';

// ADR-0002: the per-project ledger of runs, check results, alerts and monitor state (file store).

const tmp = await tempDir('nc-monitor-store-');
const store = new FileMonitorStore(path.join(tmp, 'monitoring'));
await store.init();
const run = (runId, startTime, extra = {}) => ({ runId, pipelineId: 'job-1', platform: 'databricks', status: 'healthy', startTime, ...extra });

test('ADR-0002: runs upsert by platform, pipeline and run id, list newest first with totals and pages, and stay per project', async () => {
  const runs = Array.from({ length: 130 }, (_, i) => run(`r${i}`, new Date(Date.UTC(2026, 9, 1) + i * 60_000).toISOString()));
  await store.upsertRuns('alpha', runs);
  await store.upsertRuns('alpha', [run('r5', runs[5].startTime, { status: 'failed' })]);
  const first = await store.listRuns('alpha', { pipelineId: 'job-1', limit: 25 });
  assert.deepEqual([first.total, first.items.length, first.items[0].runId], [130, 25, 'r129']);
  const last = await store.listRuns('alpha', { pipelineId: 'job-1', limit: 25, offset: 125 });
  assert.deepEqual(last.items.map(item => item.runId), ['r4', 'r3', 'r2', 'r1', 'r0']);
  assert.equal((await store.listRuns('alpha', { limit: 200 })).items.find(item => item.runId === 'r5').status, 'failed');
  assert.equal((await store.listRuns('beta')).total, 0);
  const windowed = await store.listRuns('alpha', { fromMs: Date.parse(runs[120].startTime) });
  assert.equal(windowed.total, 10);
  assert.equal(await store.pruneRuns('alpha', Date.parse(runs[100].startTime)), 100);
  assert.equal((await store.listRuns('alpha')).total, 30);
});

test('ADR-0002: check results filter and page, while the summary counts the whole window', async () => {
  const items = ['passed', 'failed', 'warning', 'failed', 'passed'].map((status, i) => ({ key: `k${i}`, checkId: `c${i}`, name: `not null ${i}`, status, severity: i === 1 ? 'critical' : 'high', tableId: i < 3 ? 'dq-1' : 'dq-2', executedAt: `2026-10-06T0${i}:00:00Z` }));
  await store.upsertDqResults('pilot', items);
  const failed = await store.listDqResults('pilot', { status: 'failed' });
  assert.deepEqual([failed.total, failed.items.map(item => item.key)], [2, ['k3', 'k1']]);
  assert.deepEqual(failed.summary, { total: 5, passed: 2, failed: 2, warning: 1, unreported: 0 });
  assert.equal((await store.listDqResults('pilot', { severity: 'critical' })).total, 1);
  assert.equal((await store.listDqResults('pilot', { tableIds: ['dq-2'] })).summary.total, 5);
  assert.equal((await store.listDqResults('pilot', { tableIds: ['dq-2'] })).total, 2);
  assert.equal((await store.listDqResults('pilot', { q: 'NULL 4' })).items[0].key, 'k4');
  assert.deepEqual((await store.listDqResults('pilot', { limit: 2, offset: 1 })).items.map(item => item.key), ['k3', 'k2']);
  assert.equal(await store.pruneDq('pilot', Date.parse('2026-10-06T02:00:00Z')), 2);
});

test('ADR-0002: state is per project and key; an occurrence is claimed once until released or pruned', async () => {
  await store.setState('alpha', STATE.fetchPipelines, { cursor: 1 });
  assert.deepEqual(await store.getState('alpha', STATE.fetchPipelines), { cursor: 1 });
  assert.equal(await store.getState('beta', STATE.fetchPipelines), null);
  assert.equal(await store.claimOccurrence('alpha', 'failed:1', '2026-10-01T00:00:00Z'), true);
  assert.equal(await store.claimOccurrence('alpha', 'failed:1'), false);
  assert.equal(await store.claimOccurrence('beta', 'failed:1'), true);
  await store.releaseOccurrence('alpha', 'failed:1');
  assert.equal(await store.claimOccurrence('alpha', 'failed:1', '2026-10-01T00:00:00Z'), true);
  assert.equal(await store.pruneOccurrences('alpha', Date.parse('2026-10-02T00:00:00Z')), 1);
  const claims = await Promise.all(Array.from({ length: 5 }, () => store.claimOccurrence('alpha', 'race')));
  assert.equal(claims.filter(Boolean).length, 1);
});

test('ADR-0002: one open alert per key; reopening never collides; lists filter and count investigations', async () => {
  const first = await store.createAlert({ projectId: 'alpha', key: 'pipeline:databricks:1:failed', trigger: 'pipelineFailed', subject: { type: 'pipeline', id: '1' }, investigation: { starts: ['2026-10-06T01:00:00Z'], taskId: 'T-1' } });
  const same = await store.createAlert({ projectId: 'alpha', key: 'pipeline:databricks:1:failed', trigger: 'pipelineFailed', subject: { type: 'pipeline', id: '1' } });
  assert.deepEqual([first.created, same.created, same.alert.id], [true, false, first.alert.id]);
  await store.updateAlert('alpha', first.alert.id, { status: 'resolved', resolvedAt: '2026-10-06T02:00:00Z' });
  const second = await store.createAlert({ projectId: 'alpha', key: 'pipeline:databricks:1:failed', trigger: 'pipelineFailed', subject: { type: 'pipeline', id: '1' }, investigation: { starts: ['2026-10-06T03:00:00Z', '2026-10-05T03:00:00Z'] } });
  assert.equal(second.created, true);
  assert.equal(await store.updateAlert('alpha', first.alert.id, { status: 'open' }), null);
  assert.equal((await store.getLatestAlert('alpha', 'pipeline:databricks:1:failed')).id, second.alert.id);
  assert.equal((await store.getOpenAlert('alpha', 'pipeline:databricks:1:failed')).id, second.alert.id);
  assert.equal((await store.listAlerts(['alpha'], { status: 'open' })).total, 1);
  assert.equal((await store.listAlerts(['alpha'], { taskId: 'T-1' })).items[0].id, first.alert.id);
  assert.equal((await store.listAlerts(null, { subjectId: '1' })).total, 2);
  assert.equal(await store.countStartedSince('alpha', '2026-10-06T00:00:00Z'), 2);
  await assert.rejects(store.updateAlert('alpha', 'AL-NONE', {}), /Alert not found/);
});
