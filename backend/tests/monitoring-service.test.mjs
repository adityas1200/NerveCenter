import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { FileOperationsStore } from '../src/app/operations-store.mjs';
import { OperationsService } from '../src/app/operations-service.mjs';
import { FileMonitorStore, STATE } from '../src/monitoring/monitor-store.mjs';
import { AlertService } from '../src/monitoring/alert-service.mjs';
import { MonitoringService } from '../src/monitoring/monitoring-service.mjs';
import { pilot, tempDir } from './helpers.mjs';

// ADR-0002, SPEC-platform-10 and SPEC-automations-01 end to end: the background fetch fills the ledger, the pages read it with
// no run cap, and the detector opens alerts that start tasks or tickets.

const tmp = await tempDir('nc-monitoring-service-');
const MIN = 60_000;
const HOUR = 60 * MIN;
let dirs = 0;

/** A Databricks with job 42 (every 30 minutes) and job 7 (no schedule); `runs` is mutable so a test can add the next run. */
function fakePlatform(runs) {
  const calls = [];
  const pipelines = [{ pipelineId: '42', name: 'sales_load', platform: 'databricks', schedule: { quartzCronExpression: '0 0/30 * * * ?', timezoneId: 'UTC', pauseStatus: 'UNPAUSED' } }, { pipelineId: '7', name: 'adhoc_export', platform: 'databricks', schedule: null }];
  return {
    calls, pipelines,
    async status() { return { providers: [{ provider: 'databricks', ready: true }] }; },
    async listPipelines() { return { pipelines }; },
    async listRuns({ pipelineId, startTimeFrom, maxRuns }) { calls.push({ pipelineId, startTimeFrom, maxRuns }); return runs.filter(run => (!pipelineId || run.pipelineId === pipelineId) && (!startTimeFrom || Date.parse(run.startTime) >= startTimeFrom)); },
    async getRun({ pipelineId, runId }) { return runs.find(run => run.pipelineId === pipelineId && run.runId === runId); },
    async getPipeline({ pipelineId }) { return pipelines.find(item => item.pipelineId === pipelineId); },
  };
}

class FakeRuntime extends EventEmitter {
  constructor() { super(); this.tasks = new Map(); this.store = { listTasks: async () => [], appendEvent: async () => {} }; }
  async startTask(input) { const task = { id: `T-${this.tasks.size + 1}`, status: 'running', type: input.type, projectId: input.scope.projectId, context: input.context, permission: input.permission }; this.tasks.set(task.id, task); return task; }
  async getTask(id) { return this.tasks.get(id) || null; }
}

/** Every 30 minutes for `hours`, the newest first; `last` overrides the newest run. */
function history(hours, last = {}) {
  const start = Math.floor(Date.now() / (30 * MIN)) * 30 * MIN;
  return Array.from({ length: hours * 2 }, (_, i) => {
    const at = start - i * 30 * MIN + 20_000;
    return { runId: `r${hours * 2 - i}`, pipelineId: '42', platform: 'databricks', status: 'healthy', startTime: new Date(at).toISOString(), endTime: new Date(at + 5 * MIN).toISOString(), durationMs: 5 * MIN, ...(i === 0 ? last : {}) };
  });
}

async function setup({ runs, operations = {}, isAppActive = () => true }) {
  const dir = path.join(tmp, `case-${dirs += 1}`);
  const store = new FileOperationsStore(path.join(dir, 'ops')); await store.init();
  const monitorStore = new FileMonitorStore(path.join(dir, 'monitoring')); await monitorStore.init();
  const platform = fakePlatform(runs);
  const state = { operations };
  const workspace = { readOperations: async () => state.operations };
  const ops = new OperationsService({ store, dataPlatform: platform, monitorStore });
  ops.workspace = workspace;
  const runtime = new FakeRuntime();
  const log = { error() {}, warn() {}, info() {} };
  const alerts = new AlertService({ store: monitorStore, operationsService: ops, ticketTasks: { workspace, sources: async () => [] }, runtime, log });
  const monitoring = new MonitoringService({ store: monitorStore, operationsService: ops, workspaces: { for: async () => workspace }, alerts, isAppActive, log, checkSeconds: 0 });
  return { store, monitorStore, platform, ops, runtime, monitoring, state };
}

test('ADR-0002, SPEC-pipelines-01: the fetch fills the ledger and the page reads every run in the window, not the newest 100', async () => {
  const { monitorStore, monitoring, ops } = await setup({ runs: history(100) });
  const result = await monitoring.runProject('pilot');
  assert.deepEqual(result.pipelines, { runs: 200, jobs: 2 });
  assert.equal((await monitorStore.listRuns('pilot')).total, 200);
  const page = await ops.monitor({ scope: pilot, range: 'All time' });
  assert.equal(page.diagnostics.source, 'ledger');
  assert.equal(page.recentRuns.length, 200);
  assert.deepEqual([page.diagnostics.truncated, page.diagnostics.maxRuns], [false, null]);
  assert.equal(page.fetchedAt, (await monitorStore.getState('pilot', STATE.inventory)).fetchedAt);
  const sales = page.items.find(row => row.pipelineId === '42');
  assert.deepEqual([sales.missedCount, sales.lateCount, sales.alert], [0, 0, null]);
});

test('SPEC-pipelines-01 FR-15: run history pages through the whole ledger with a total', async () => {
  const { monitoring, ops } = await setup({ runs: history(100) });
  await monitoring.runProject('pilot');
  const first = await ops.pipelineRunHistory('42', { scope: pilot, limit: 25 });
  const last = await ops.pipelineRunHistory('42', { scope: pilot, limit: 25, offset: 175 });
  assert.deepEqual([first.total, first.items.length, first.items[0].runId], [200, 25, 'r200']);
  assert.deepEqual([last.items.length, last.items.at(-1).runId], [25, 'r1']);
  assert.ok(first.fetchedAt);
});

test('SPEC-platform-10 FR-4, FR-5: the next fetch reads from the cursor less the overlap, only when due, and Refresh now forces one', async () => {
  const runs = history(4);
  const { monitoring, platform } = await setup({ runs, operations: { sync: { pipelines: { every: 10, unit: 'minutes' } } } });
  await monitoring.runProject('pilot');
  const firstFrom = platform.calls[0].startTimeFrom;
  assert.ok(Date.now() - firstFrom > 59 * 24 * HOUR, 'the first fetch reads the whole retention');
  platform.calls.length = 0;
  assert.equal((await monitoring.runProject('pilot')).pipelines, undefined, 'not due yet');
  assert.equal(platform.calls.length, 0);
  await monitoring.refresh('pilot');
  const newest = Date.parse(runs[0].startTime);
  assert.ok(platform.calls.every(call => call.startTimeFrom >= newest - 2 * HOUR - MIN && call.startTimeFrom <= newest - 2 * HOUR + MIN));
  await assert.rejects(monitoring.refresh('pilot'), error => error.statusCode === 429);
});

test('SPEC-platform-10 FR-4: a failed Databricks job read reports an error and keeps the prior monitoring cursor', async () => {
  const runs = history(2);
  const { monitoring, monitorStore, platform } = await setup({ runs });
  const listPipelines = platform.listPipelines.bind(platform);
  platform.status = async () => ({ providers: [{ provider: 'databricks', ready: true }, { provider: 'snowflake', ready: true }] });
  platform.listPipelines = async ({ provider }) => provider === 'snowflake' ? { pipelines: [{ pipelineId: 'SF-1', name: 'warehouse_load', platform: 'snowflake' }] } : listPipelines();
  await monitoring.runProject('pilot');
  const previous = await monitorStore.getState('pilot', STATE.fetchPipelines);
  const nextRun = { ...runs[0], runId: 'new-run', startTime: new Date(Date.now() + 1000).toISOString() };
  runs.push(nextRun);
  const listRuns = platform.listRuns.bind(platform);
  platform.listRuns = async args => {
    if (args.provider === 'databricks' && args.pipelineId === '7') throw new Error('Job history unavailable');
    if (args.provider === 'snowflake') return [];
    return listRuns(args);
  };

  const failed = await monitoring.refresh('pilot');
  const afterFailure = await monitorStore.getState('pilot', STATE.fetchPipelines);
  assert.match(failed.pipelines.error, /Job history unavailable/);
  assert.equal(afterFailure.cursorMs, previous.cursorMs);
  assert.match(afterFailure.lastError, /Job history unavailable/);
  assert.equal((await monitorStore.listRuns('pilot', { pipelineId: '42' })).items.some(run => run.runId === 'new-run'), false);

  platform.listRuns = listRuns;
  monitoring.lastRefresh.clear();
  const recovered = await monitoring.refresh('pilot');
  assert.equal(recovered.pipelines.error, undefined);
  assert.equal((await monitorStore.listRuns('pilot', { pipelineId: '42' })).items.some(run => run.runId === 'new-run'), true);
});

/** A pipeline that joins the inventory after the project's first fetch, with a run every 12 hours for `days`. */
function addPipeline(platform, runs, pipelineId, days = 3) {
  platform.pipelines.push({ pipelineId, name: `job_${pipelineId}`, platform: 'databricks', schedule: null });
  for (let i = 0; i < days * 2; i += 1) { const at = Date.now() - (i + 0.5) * 12 * HOUR; runs.push({ runId: `${pipelineId}-r${i}`, pipelineId, platform: 'databricks', status: 'healthy', startTime: new Date(at).toISOString(), endTime: new Date(at + 5 * MIN).toISOString(), durationMs: 5 * MIN }); }
}
const spyBackfill = ops => { const calls = []; const original = ops.fetchPipelineRunHistory.bind(ops); ops.fetchPipelineRunHistory = async args => { calls.push(args); return original(args); }; return calls; };

test('SPEC-platform-10 FR-13: a pipeline new to an already fetched project has its runs read back to the retention window, once', async () => {
  const runs = history(4);
  const { monitoring, monitorStore, platform, ops } = await setup({ runs });
  await monitoring.runProject('pilot');
  assert.equal((await monitorStore.getState('pilot', STATE.fetchPipelines)).known.length, 2);
  const backfills = spyBackfill(ops);
  addPipeline(platform, runs, '99');
  const result = await monitoring.refresh('pilot');
  assert.deepEqual(result.pipelines, { runs: 5, jobs: 3, backfilled: 1 });
  assert.equal((await monitorStore.listRuns('pilot', { pipelineId: '99', platform: 'databricks' })).total, 6);
  assert.equal(backfills.length, 1);
  assert.deepEqual([backfills[0].pipelineId, backfills[0].provider], ['99', 'databricks']);
  assert.ok(Date.now() - backfills[0].startTimeFrom > 59 * 24 * HOUR, 'reads from the start of the retention window');
  assert.deepEqual((await monitorStore.getState('pilot', STATE.fetchPipelines)).known.sort(), ['databricks:42', 'databricks:7', 'databricks:99']);
  // Known now: the next pass does not backfill it again, and the cursor is still the newest normal run.
  monitoring.lastRefresh.clear();
  assert.equal((await monitoring.refresh('pilot')).pipelines.backfilled, undefined);
  assert.equal(backfills.length, 1);
  assert.equal((await monitorStore.getState('pilot', STATE.fetchPipelines)).cursorMs, Date.parse(runs[0].startTime));
});

test('SPEC-platform-10 FR-13: a failed backfill does not fail the fetch and is retried on the next pass', async () => {
  const runs = history(2);
  const { monitoring, monitorStore, platform, ops } = await setup({ runs });
  await monitoring.runProject('pilot');
  addPipeline(platform, runs, '99'); addPipeline(platform, runs, '98');
  const original = ops.fetchPipelineRunHistory.bind(ops); let failing = true;
  ops.fetchPipelineRunHistory = async args => { if (failing && args.pipelineId === '99') throw new Error('platform down'); return original(args); };
  const result = await monitoring.refresh('pilot');
  assert.equal(result.pipelines.error, undefined);
  assert.equal(result.pipelines.backfilled, 1);
  assert.deepEqual((await monitorStore.getState('pilot', STATE.fetchPipelines)).known.sort(), ['databricks:42', 'databricks:7', 'databricks:98']);
  assert.equal((await monitorStore.listRuns('pilot', { pipelineId: '99', platform: 'databricks' })).total, 0);
  failing = false; monitoring.lastRefresh.clear();
  assert.equal((await monitoring.refresh('pilot')).pipelines.backfilled, 1);
  assert.equal((await monitorStore.listRuns('pilot', { pipelineId: '99', platform: 'databricks' })).total, 6);
  assert.equal((await monitorStore.getState('pilot', STATE.fetchPipelines)).known.length, 4);
});

test('SPEC-platform-10 FR-13: a project fetched before known pipelines were recorded is seeded, not backfilled', async () => {
  const runs = history(2);
  const { monitoring, monitorStore, platform, ops } = await setup({ runs });
  await monitoring.runProject('pilot');
  const { known, ...upgraded } = await monitorStore.getState('pilot', STATE.fetchPipelines);
  await monitorStore.setState('pilot', STATE.fetchPipelines, upgraded);
  const backfills = spyBackfill(ops);
  addPipeline(platform, runs, '99');
  const result = await monitoring.refresh('pilot');
  assert.equal(backfills.length, 0);
  assert.equal(result.pipelines.backfilled, undefined);
  assert.deepEqual((await monitorStore.getState('pilot', STATE.fetchPipelines)).known.sort(), ['databricks:42', 'databricks:7', 'databricks:99']);
});

test('SPEC-platform-10 FR-13: a pipeline that leaves the inventory is forgotten and backfilled again when it returns', async () => {
  const runs = history(2);
  const { monitoring, monitorStore, platform, ops } = await setup({ runs });
  await monitoring.runProject('pilot');
  const backfills = spyBackfill(ops);
  addPipeline(platform, runs, '99');
  await monitoring.refresh('pilot');
  const [gone] = platform.pipelines.splice(2, 1);
  monitoring.lastRefresh.clear(); await monitoring.refresh('pilot');
  assert.deepEqual((await monitorStore.getState('pilot', STATE.fetchPipelines)).known.sort(), ['databricks:42', 'databricks:7']);
  platform.pipelines.push(gone);
  monitoring.lastRefresh.clear(); await monitoring.refresh('pilot');
  assert.equal(backfills.length, 2);
});

test('SPEC-platform-10 FR-13: pipelines of a platform that did not answer this pass stay known', async () => {
  const runs = history(2);
  const { monitoring, monitorStore } = await setup({ runs });
  await monitoring.runProject('pilot');
  const state = await monitorStore.getState('pilot', STATE.fetchPipelines);
  await monitorStore.setState('pilot', STATE.fetchPipelines, { ...state, known: [...state.known, 'snowflake:DB.S.LOAD'] });
  monitoring.lastRefresh.clear(); await monitoring.refresh('pilot');
  assert.deepEqual((await monitorStore.getState('pilot', STATE.fetchPipelines)).known.sort(), ['databricks:42', 'databricks:7', 'snowflake:DB.S.LOAD']);
});

test('SPEC-platform-10 FR-13: at most 10 new pipelines are backfilled per pass, the rest on the next', async () => {
  const runs = history(2);
  const { monitoring, monitorStore, platform, ops } = await setup({ runs });
  await monitoring.runProject('pilot');
  const backfills = spyBackfill(ops);
  for (let i = 0; i < 12; i += 1) addPipeline(platform, runs, `p${i}`, 1);
  assert.equal((await monitoring.refresh('pilot')).pipelines.backfilled, 10);
  assert.equal((await monitorStore.getState('pilot', STATE.fetchPipelines)).known.length, 12);
  monitoring.lastRefresh.clear();
  assert.equal((await monitoring.refresh('pilot')).pipelines.backfilled, 2);
  assert.equal(backfills.length, 12);
  assert.equal((await monitorStore.getState('pilot', STATE.fetchPipelines)).known.length, 14);
});

test('D2: with no automation on, nothing is fetched while nobody has the app open; with one on, it is', async () => {
  const idle = await setup({ runs: history(2), operations: { automation: { enabled: false } }, isAppActive: () => false });
  assert.deepEqual(await idle.monitoring.runProject('pilot'), { skipped: 'app inactive' });
  const watched = await setup({ runs: history(2), operations: { automation: { pipelineFailed: { action: 'task' } } }, isAppActive: () => false });
  assert.equal((await watched.monitoring.runProject('pilot')).pipelines.runs, 4);
  const off = await setup({ runs: history(2), operations: { sync: { enabled: false } } });
  assert.deepEqual(await off.monitoring.runProject('pilot'), { skipped: 'auto sync disabled' });
});

test('FR-13, FR-41: a failed run opens an alert that starts a task, and the run and page show it', async () => {
  const runs = history(3, { status: 'failed', failureSummary: 'Task load failed: file not found' });
  const { monitoring, ops, runtime, monitorStore } = await setup({ runs, operations: { automation: { pipelineFailed: { action: 'task' } } } });
  const result = await monitoring.runProject('pilot');
  assert.equal(result.detect.events, 1);
  const [alert] = (await monitorStore.listAlerts(['pilot'], { status: 'open' })).items;
  assert.deepEqual([alert.trigger, alert.subject.id, alert.investigation.taskId], ['pipelineFailed', '42', 'T-1']);
  assert.equal(runtime.tasks.get('T-1').permission, 'read-only');
  const page = await ops.monitor({ scope: pilot, range: 'All time' });
  const sales = page.items.find(row => row.pipelineId === '42');
  assert.deepEqual([sales.alert.id, sales.alert.taskId, sales.automation.pipelineFailed, sales.automation.pipelineLate], [alert.id, 'T-1', 'task', 'off']);
  const history1 = await ops.pipelineRunHistory('42', { scope: pilot, limit: 5 });
  assert.deepEqual([history1.items[0].taskId, history1.items[0].alertId], ['T-1', alert.id]);
  // A healthy run after the failure closes the alert on the next pass.
  runs.unshift({ ...runs[0], runId: 'r-next', status: 'healthy', failureSummary: null, startTime: new Date(Date.parse(runs[0].endTime) + MIN).toISOString(), endTime: new Date(Date.parse(runs[0].endTime) + 6 * MIN).toISOString() });
  await monitoring.refresh('pilot');
  assert.equal((await monitorStore.getAlert('pilot', alert.id)).status, 'resolved');
});

test('D4: a project with no automation section still gets one NerveCenter ticket per failed Databricks run, and no task', async () => {
  const runs = history(3, { status: 'failed', failureSummary: 'boom' });
  const { monitoring, store, runtime } = await setup({ runs });
  await monitoring.runProject('pilot');
  const tickets = await store.listTickets(pilot);
  assert.equal(tickets.length, 1);
  assert.deepEqual([tickets[0].pipelineId, tickets[0].runId, tickets[0].source], ['42', runs[0].runId, 'databricks']);
  assert.equal(runtime.tasks.size, 0);
  await monitoring.refresh('pilot').catch(() => {});
  assert.equal((await store.listTickets(pilot)).length, 1);
});

test('FR-8, FR-41: a missed slot is counted on the page and listed in the run history with its task', async () => {
  // Every half hour for six hours, except the slot two hours ago.
  const runs = history(6).filter((_, i) => i !== 4);
  const { monitoring, ops } = await setup({ runs, operations: { automation: { pipelineLate: { action: 'task', graceMinutes: 5, lookbackHours: 24 } } } });
  // Switched on when the first run on record started, so the gap is inside the watched period.
  await monitoring.runProject('pilot');
  const page = await ops.monitor({ scope: pilot, range: 'All time' });
  const sales = page.items.find(row => row.pipelineId === '42');
  assert.equal(sales.missedCount, 1);
  const runsPage = await ops.pipelineRunHistory('42', { scope: pilot, limit: 25 });
  assert.equal(runsPage.slots.length, 1);
  assert.equal(runsPage.slots[0].status, 'missed');
});

test('SPEC-platform-10 FR-7: status says when each source last ran and runs next', async () => {
  const { monitoring } = await setup({ runs: history(1), operations: { sync: { pipelines: { every: 2, unit: 'minutes' } } } });
  await monitoring.runProject('pilot');
  const status = await monitoring.status('pilot');
  const { pipelines } = status.sources;
  assert.equal(pipelines.everySeconds, 120);
  assert.equal(Date.parse(pipelines.nextFetchAt) - Date.parse(pipelines.lastFetchAt), 120_000);
  assert.deepEqual([status.automation.legacy, status.automation.active, status.openAlerts], [true, true, 0]);
});

test('SPEC-data-quality-02 FR-13, FR-24, FR-42: check results land in the ledger, pages filter and page them, and a failure opens one alert per table and dataset', async () => {
  const { DataQualityService } = await import('../src/data-quality/data-quality-service.mjs');
  const dir = path.join(tmp, `dq-${dirs += 1}`);
  const monitorStore = new FileMonitorStore(path.join(dir, 'monitoring')); await monitorStore.init();
  const store = new FileOperationsStore(path.join(dir, 'ops')); await store.init();
  const ago = minutes => new Date(Date.now() - minutes * MIN).toISOString();
  // 150 results, more than the old 100-row read; two failures on the same dataset.
  const rows = Array.from({ length: 150 }, (_, i) => ({ check_id: `c${i}`, check_name: `check ${i}`, status: i === 3 || i === 4 ? 'FAIL' : 'PASS', executed_at: ago(i + 1), dataset: 'sales' }));
  const setting = { provider: 'databricks', catalog: 'ops', schema: 'dq', resultTable: 'results', warehouseId: 'wh', mapping: { checkId: 'check_id', checkName: 'check_name', status: 'status', executedAt: 'executed_at', dataset: 'dataset' }, enabled: true };
  const dq = new DataQualityService({
    store: { getDataQualityConfig: async () => structuredClone(setting), findTicketBySourceRef: async () => null },
    connectionService: { providerStatuses: async () => [{ id: 'databricks', name: 'Databricks', state: 'available', ready: true, source: 'deployment' }], resolve: async () => ({ config: {}, credentials: {} }) },
    databricksFactory: () => ({ queryRows: async () => rows }),
    ddlMappingAgent: { suggest: async () => ({ used: false }) },
    monitorStore,
  });
  const workspace = { readOperations: async () => ({ automation: { dqFailed: { action: 'task', minSeverity: 'low' } } }) };
  const ops = new OperationsService({ store, monitorStore }); ops.workspace = workspace;
  const runtime = new FakeRuntime(); const log = { error() {}, warn() {}, info() {} };
  const alerts = new AlertService({ store: monitorStore, operationsService: ops, ticketTasks: { workspace, sources: async () => [] }, runtime, log });
  const monitoring = new MonitoringService({ store: monitorStore, operationsService: ops, dataQualityService: dq, workspaces: { for: async () => workspace }, alerts, log, checkSeconds: 0 });
  const result = await monitoring.runProject('pilot');
  assert.deepEqual(result.dataQuality, { results: 150 });
  const page = await dq.monitor({ scope: pilot, range: 'Last 24 hours', limit: 25, offset: 25 });
  assert.deepEqual([page.total, page.items.length, page.summary.total, page.summary.failed], [150, 25, 150, 2]);
  assert.equal(page.items[0].checkId, 'c25');
  assert.equal((await dq.monitor({ scope: pilot, status: 'failed' })).total, 2);
  assert.equal(result.detectDq.events, 2);
  const open = (await monitorStore.listAlerts(['pilot'], { status: 'open' })).items;
  assert.equal(open.length, 1);
  assert.deepEqual([open[0].key, open[0].occurrenceCount, open[0].investigation.taskId], ['dq:dq-1:sales', 2, 'T-1']);
  const reconciled = await dq.reconcile({ scope: pilot, status: 'failed' });
  assert.deepEqual(reconciled.items.map(item => item.taskId), ['T-1', 'T-1']);
});

test('SPEC-data-quality-02 FR-7: a failed table listing is reported by detection instead of treated as no tables', async () => {
  const { monitoring, monitorStore } = await setup({ runs: [] });
  await monitorStore.setState('pilot', STATE.dqSnapshot, { fetchedAt: new Date().toISOString() });
  monitoring.dataQualityService = { ledgerProjectId: 'pilot', async listTables() { throw new Error('Table configuration unavailable'); } };

  const result = await monitoring.runProject('pilot', { force: true, sources: [] });

  assert.deepEqual(result.detectDq, { error: 'Table configuration unavailable' });
});

test('SPEC-platform-15 FR-5/FR-6: monitor filters all inventory before returning a server page', async () => {
  const { ops } = await setup({ runs: [] });
  const pipelines = Array.from({ length: 1205 }, (_, index) => ({
    pipelineId: `job-${index}`,
    name: index < 3 ? `other-${index}` : `target-${index}`,
    platform: 'databricks',
    schedule: null,
  }));
  ops._monitorInventory = async () => ({ pipelines, runs: [], providers: ['databricks'], sources: [], providerDiagnostics: [], ledger: null });

  const page = await ops.monitor({ scope: pilot, limit: 5000, pageLimit: 10, offset: 1190, status: 'No runs', platform: 'databricks', q: 'target', includeIdle: true });

  assert.equal(page.total, 1202);
  assert.equal(page.items.length, 10);
  assert.equal(page.items[0].pipelineId, 'job-1193');
  assert.ok(page.items.every(item => item.name.startsWith('target-')));
  assert.deepEqual({ idle: page.summary.idle, matchingIdle: page.summary.matchingIdle, platform: page.summary.platforms[0] }, { idle: 1205, matchingIdle: 1202, platform: 'databricks' });
});
