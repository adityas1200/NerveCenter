import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { FileOperationsStore } from '../src/app/operations-store.mjs';
import { OperationsService } from '../src/app/operations-service.mjs';
import { FileMonitorStore, PostgresMonitorStore } from '../src/monitoring/monitor-store.mjs';
import { AlertService } from '../src/monitoring/alert-service.mjs';
import { MonitoringService } from '../src/monitoring/monitoring-service.mjs';
import { DataQualityService, FETCH_MAX_ROWS, dqResultKey } from '../src/data-quality/data-quality-service.mjs';
import { pilot, tempDir } from './helpers.mjs';

// ADR-0007: each DQ fetch reads the whole retention window and makes each table's stored results equal to what it read,
// so the Data Quality page matches the result table, and the page asks for that fetch itself.

const tmp = await tempDir('nc-dq-mirror-');
const MIN = 60_000;
const at = minutes => new Date(Date.now() - minutes * MIN).toISOString();
const row = (checkId, minutes, status = 'PASS') => ({ check_id: checkId, check_name: checkId, status, executed_at: at(minutes), dataset: 'sales' });
let dirs = 0;

class FakeRuntime extends EventEmitter {
  constructor() { super(); this.tasks = new Map(); this.store = { listTasks: async () => [], appendEvent: async () => {} }; }
  async startTask(input) { const task = { id: `T-${this.tasks.size + 1}`, status: 'running', type: input.type, projectId: input.scope.projectId, context: input.context, permission: input.permission }; this.tasks.set(task.id, task); return task; }
  async getTask(id) { return this.tasks.get(id) || null; }
}

/** `source.rows` is the result table; set `source.error` to make the next read fail. */
async function setup(rows) {
  const source = { rows, error: null, reads: 0 };
  const dir = path.join(tmp, `case-${dirs += 1}`);
  const monitorStore = new FileMonitorStore(path.join(dir, 'monitoring')); await monitorStore.init();
  const store = new FileOperationsStore(path.join(dir, 'ops')); await store.init();
  const setting = { provider: 'databricks', catalog: 'ops', schema: 'dq', resultTable: 'results', warehouseId: 'wh', mapping: { checkId: 'check_id', checkName: 'check_name', status: 'status', executedAt: 'executed_at', dataset: 'dataset' }, enabled: true };
  const dq = new DataQualityService({
    store: { getDataQualityConfig: async () => structuredClone(setting), findTicketBySourceRef: async () => null },
    connectionService: { providerStatuses: async () => [{ id: 'databricks', name: 'Databricks', state: 'available', ready: true, source: 'deployment' }], resolve: async () => ({ config: {}, credentials: {} }) },
    databricksFactory: () => ({ queryRows: async () => { source.reads += 1; if (source.error) throw new Error(source.error); return structuredClone(source.rows); } }),
    ddlMappingAgent: { suggest: async () => ({ used: false }) },
    monitorStore,
  });
  const workspace = { readOperations: async () => ({ automation: { dqFailed: { action: 'task', minSeverity: 'low' } } }) };
  const ops = new OperationsService({ store, monitorStore }); ops.workspace = workspace;
  const log = { error() {}, warn() {}, info() {} };
  const alerts = new AlertService({ store: monitorStore, operationsService: ops, ticketTasks: { workspace, sources: async () => [] }, runtime: new FakeRuntime(), log });
  const monitoring = new MonitoringService({ store: monitorStore, operationsService: ops, dataQualityService: dq, workspaces: { for: async () => workspace }, alerts, log, checkSeconds: 0 });
  const page = () => dq.monitor({ scope: pilot, range: 'Last 7 days', limit: 500 });
  return { source, dq, monitorStore, monitoring, page };
}

test('ADR-0007 FR-14: a source that overwrites its table leaves only its current rows stored', async () => {
  const { source, monitoring, page } = await setup([row('a', 60 * 30), row('b', 60 * 29), row('c', 60 * 28)]);
  await monitoring.runProject('pilot', { force: true });
  assert.equal((await page()).total, 3);
  source.rows = [row('d', 10), row('e', 5)];
  await monitoring.runProject('pilot', { force: true });
  const after = await page();
  assert.deepEqual(after.items.map(item => item.checkId).sort(), ['d', 'e']);
  assert.deepEqual([after.total, after.summary.total], [2, 2]);
});

test('ADR-0007 FR-14: every fetch reads the whole window, so a row deleted long before the last fetch is removed', async () => {
  const { source, monitoring, monitorStore, page } = await setup([row('old', 60 * 24 * 5), row('new', 5)]);
  await monitoring.runProject('pilot', { force: true });
  source.rows = [row('new', 5)];
  await monitoring.runProject('pilot', { force: true });
  assert.deepEqual((await page()).items.map(item => item.checkId), ['new']);
  const state = await monitorStore.getState('pilot', 'fetch:dataQuality');
  assert.ok(Date.parse(state.from) < Date.now() - 59 * 24 * 60 * MIN, 'the fetch reads the 60-day window');
});

test('ADR-0007 FR-14: a table that cannot be read keeps its stored results; a read with no rows clears it', async () => {
  const { source, monitoring, page } = await setup([row('a', 10), row('b', 5)]);
  await monitoring.runProject('pilot', { force: true });
  source.error = 'warehouse stopped';
  await monitoring.runProject('pilot', { force: true });
  assert.equal((await page()).total, 2);
  source.error = null; source.rows = [];
  await monitoring.runProject('pilot', { force: true });
  assert.equal((await page()).total, 0);
});

test('ADR-0007 FR-14: a table at the row cap is replaced only from its oldest returned row', async () => {
  const { monitorStore, monitoring } = await setup([]);
  const stale = { key: dqResultKey({ tableId: 'dq-1', checkId: 'gone', executedAt: at(60 * 24 * 40) }), tableId: 'dq-1', checkId: 'gone', status: 'passed', executedAt: at(60 * 24 * 40) };
  const recentGone = { key: dqResultKey({ tableId: 'dq-1', checkId: 'recent-gone', executedAt: at(1) }), tableId: 'dq-1', checkId: 'recent-gone', status: 'passed', executedAt: at(1) };
  await monitorStore.upsertDqResults('pilot', [stale, recentGone]);
  await monitorStore.setState('pilot', 'dq:snapshot', { fetchedAt: new Date().toISOString() });
  // FETCH_MAX_ROWS rows, newest first, all within the last 7 days.
  const step = (7 * 24 * 60) / FETCH_MAX_ROWS;
  monitoring.dataQualityService.fetchResults = async () => ({ configured: true, sources: [{ tableId: 'dq-1', table: 'results', status: 'ok', count: FETCH_MAX_ROWS, truncated: true }], items: Array.from({ length: FETCH_MAX_ROWS }, (_, i) => { const executedAt = at(2 + i * step); return { key: dqResultKey({ tableId: 'dq-1', checkId: `c${i}`, executedAt }), tableId: 'dq-1', checkId: `c${i}`, status: 'passed', executedAt }; }) });
  await monitoring.runProject('pilot', { force: true, sources: ['dataQuality'] });
  const { items } = await monitorStore.listDqResults('pilot', { limit: 50_000 });
  const ids = new Set(items.map(item => item.checkId));
  assert.equal(ids.has('gone'), true, 'older than the oldest returned row: kept');
  assert.equal(ids.has('recent-gone'), false, 'inside the returned range and not returned: removed');
  assert.equal(items.length, FETCH_MAX_ROWS + 1);
});

test('ADR-0007 FR-14: the service reports a table that hit the row cap, whatever rows it then drops', async () => {
  const rows = Array.from({ length: FETCH_MAX_ROWS }, (_, i) => row(`c${i}`, 1 + i / 100));
  rows[0].executed_at = 'not a time';
  const { dq } = await setup(rows);
  const result = await dq.fetchResults({ from: at(60 * 24 * 60) });
  assert.deepEqual([result.items.length, result.sources[0].truncated], [FETCH_MAX_ROWS - 1, true]);
  const { dq: small } = await setup([row('a', 5)]);
  assert.equal((await small.fetchResults({ from: at(60) })).sources[0].truncated, false);
});

test('ADR-0007 FR-16: a failure removed from the source and written back is not alerted again', async () => {
  const failure = row('c1', 10, 'FAIL');
  const { source, monitorStore, monitoring } = await setup([failure]);
  await monitoring.runProject('pilot', { force: true });
  source.rows = [];
  await monitoring.runProject('pilot', { force: true });
  source.rows = [failure];
  await monitoring.runProject('pilot', { force: true });
  const alerts = (await monitorStore.listAlerts(['pilot'], { trigger: 'dqFailed' })).items;
  assert.deepEqual(alerts.map(alert => [alert.status, alert.occurrenceCount]), [['open', 1]]);
});

test('ADR-0007 FR-15: a data-quality refresh from any project fetches the shared tables, throttled apart from the Pipelines refresh', async () => {
  const { source, monitoring } = await setup([row('a', 5)]);
  monitoring.ops.fetchPipelineRunHistory = undefined;
  const result = await monitoring.refresh('proj-b', { sources: ['dataQuality'] });
  assert.equal(result.dataQuality.results, 1);
  assert.equal(source.reads, 1);
  await assert.rejects(monitoring.refresh('proj-c', { sources: ['dataQuality'] }), error => error.statusCode === 429);
  assert.equal(source.reads, 1);
  // The Pipelines page's refresh of the same project is not blocked by the Data Quality page's.
  await assert.doesNotReject(monitoring.refresh('pilot', { sources: ['pipelines'] }));
});

test('ADR-0007 FR-14: the Postgres store replaces a table in one transaction and rolls back on failure', async () => {
  const calls = []; let failInsert = false; let released = 0;
  const client = { query: async (sql, params) => { calls.push([sql.split(/\s+/).slice(0, 3).join(' '), params]); if (failInsert && sql.startsWith('INSERT')) throw new Error('boom'); return { rowCount: 4, rows: [] }; }, release: () => { released += 1; } };
  const store = new PostgresMonitorStore({ connect: async () => client, query: async () => { throw new Error('writes must use the transaction client'); } });
  const item = { key: 'dq-result:1', tableId: 'dq-1', checkId: 'a', status: 'passed', executedAt: at(5) };
  const fromMs = Date.now() - 60 * MIN;
  assert.deepEqual(await store.replaceDqResults('pilot', 'dq-1', [item], { fromMs }), { upserted: 1, removed: 4 });
  assert.deepEqual(calls.map(([sql]) => sql), ['BEGIN', 'DELETE FROM ops_dq_results', 'INSERT INTO ops_dq_results(project_id,result_key,table_id,status,severity,executed_at,data,updated_at)', 'COMMIT']);
  assert.deepEqual(calls[1][1], ['pilot', 'dq-1', new Date(fromMs).toISOString(), ['dq-result:1']]);
  calls.length = 0; failInsert = true;
  await assert.rejects(store.replaceDqResults('pilot', 'dq-1', [item], { fromMs }), /boom/);
  assert.deepEqual(calls.map(([sql]) => sql).at(-1), 'ROLLBACK');
  assert.equal(released, 2);
});
