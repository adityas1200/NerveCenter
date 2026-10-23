import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { FileOperationsStore } from '../src/app/operations-store.mjs';
import { OperationsService } from '../src/app/operations-service.mjs';
import { FileMonitorStore } from '../src/monitoring/monitor-store.mjs';
import { AlertService } from '../src/monitoring/alert-service.mjs';
import { MonitoringService } from '../src/monitoring/monitoring-service.mjs';
import { DataQualityService, dqResultKey } from '../src/data-quality/data-quality-service.mjs';
import { up } from '../migrations/011-dq-result-key.mjs';
import { pilot, tempDir } from './helpers.mjs';

// ADR-0006: the DQ ledger is keyed by execution identity (table, check, run time), so a result the source updates in
// place overwrites its row, and migration 011 re-keys the rows written under the old status-bearing key.

const tmp = await tempDir('nc-dq-result-key-');
const MIN = 60_000;
let dirs = 0;

class FakeRuntime extends EventEmitter {
  constructor() { super(); this.tasks = new Map(); this.store = { listTasks: async () => [], appendEvent: async () => {} }; }
  async startTask(input) { const task = { id: `T-${this.tasks.size + 1}`, status: 'running', type: input.type, projectId: input.scope.projectId, context: input.context, permission: input.permission }; this.tasks.set(task.id, task); return task; }
  async getTask(id) { return this.tasks.get(id) || null; }
}

async function setup(rows) {
  const dir = path.join(tmp, `case-${dirs += 1}`);
  const monitorStore = new FileMonitorStore(path.join(dir, 'monitoring')); await monitorStore.init();
  const store = new FileOperationsStore(path.join(dir, 'ops')); await store.init();
  const setting = { provider: 'databricks', catalog: 'ops', schema: 'dq', resultTable: 'results', warehouseId: 'wh', mapping: { checkId: 'check_id', checkName: 'check_name', status: 'status', executedAt: 'executed_at', dataset: 'dataset' }, enabled: true };
  const dq = new DataQualityService({
    store: { getDataQualityConfig: async () => structuredClone(setting), findTicketBySourceRef: async () => null },
    connectionService: { providerStatuses: async () => [{ id: 'databricks', name: 'Databricks', state: 'available', ready: true, source: 'deployment' }], resolve: async () => ({ config: {}, credentials: {} }) },
    databricksFactory: () => ({ queryRows: async () => structuredClone(rows) }),
    ddlMappingAgent: { suggest: async () => ({ used: false }) },
    monitorStore,
  });
  const workspace = { readOperations: async () => ({ automation: { dqFailed: { action: 'task', minSeverity: 'low' } } }) };
  const ops = new OperationsService({ store, monitorStore }); ops.workspace = workspace;
  const log = { error() {}, warn() {}, info() {} };
  const alerts = new AlertService({ store: monitorStore, operationsService: ops, ticketTasks: { workspace, sources: async () => [] }, runtime: new FakeRuntime(), log });
  const monitoring = new MonitoringService({ store: monitorStore, operationsService: ops, dataQualityService: dq, workspaces: { for: async () => workspace }, alerts, log, checkSeconds: 0 });
  return { dq, monitorStore, monitoring };
}

test('ADR-0006: a result the source updates in place (running, then failed) stays one ledger row with the newest status', async () => {
  const executedAt = new Date(Date.now() - 5 * MIN).toISOString();
  const rows = [{ check_id: 'c1', check_name: 'not null', status: 'RUNNING', executed_at: executedAt, dataset: 'sales' }];
  const { dq, monitoring } = await setup(rows);
  await monitoring.runProject('pilot', { force: true });
  rows[0].status = 'FAIL';
  await monitoring.runProject('pilot', { force: true });
  const page = await dq.monitor({ scope: pilot, range: 'Last 24 hours' });
  assert.equal(page.total, 1);
  assert.deepEqual([page.items[0].status, page.items[0].key], ['failed', dqResultKey({ tableId: 'dq-1', checkId: 'c1', executedAt })]);
  assert.deepEqual(page.summary, { total: 1, passed: 0, failed: 1, warning: 0, unreported: 0 });
});

test('ADR-0006: a new run of the same check is its own row, and a failure is alerted once across fetches', async () => {
  const at = minutes => new Date(Date.now() - minutes * MIN).toISOString();
  const rows = [{ check_id: 'c1', check_name: 'not null', status: 'FAIL', executed_at: at(30), dataset: 'sales' }];
  const { dq, monitorStore, monitoring } = await setup(rows);
  await monitoring.runProject('pilot', { force: true });
  rows.unshift({ check_id: 'c1', check_name: 'not null', status: 'PASS', executed_at: at(5), dataset: 'sales' });
  await monitoring.runProject('pilot', { force: true });
  const page = await dq.monitor({ scope: pilot, range: 'Last 24 hours' });
  assert.deepEqual(page.items.map(item => item.status), ['passed', 'failed']);
  const alerts = (await monitorStore.listAlerts(['pilot'], { trigger: 'dqFailed' })).items;
  assert.deepEqual(alerts.map(alert => alert.occurrenceCount), [1]);
});

/** A file-store project as written before ADR-0006: the same execution under two old keys, one claimed and alerted. */
async function legacyRuntime() {
  const runtimeDir = path.join(tmp, `runtime-${dirs += 1}`); const dir = path.join(runtimeDir, 'monitoring', 'pilot');
  await fs.mkdir(dir, { recursive: true });
  const base = { checkId: 'c1', tableId: 'dq-1', executedAt: '2026-10-06T09:00:00Z', name: 'not null' };
  const results = { 'dq-table:old-running': { ...base, key: 'dq-table:old-running', status: 'running', fetchedAt: '2026-10-06T09:05:00Z' }, 'dq-table:old-failed': { ...base, key: 'dq-table:old-failed', status: 'failed', fetchedAt: '2026-10-06T09:20:00Z' }, 'dq-table:other': { ...base, checkId: 'c2', key: 'dq-table:other', status: 'passed', fetchedAt: '2026-10-06T09:20:00Z' } };
  await fs.writeFile(path.join(dir, 'dq.json'), JSON.stringify({ results }));
  await fs.writeFile(path.join(dir, 'occurrences.json'), JSON.stringify({ 'dq:dq-table:old-failed': '2026-10-06T09:21:00Z', 'failed:databricks:42:r1': '2026-10-06T08:00:00Z' }));
  await fs.writeFile(path.join(dir, 'alerts.json'), JSON.stringify({ alerts: { 'AL-1': { id: 'AL-1', trigger: 'dqFailed', key: 'dq:dq-1:sales', status: 'open', occurrences: [{ key: 'dq:dq-table:old-failed', resultKey: 'dq-table:old-failed', checkId: 'c1' }] } } }));
  return { runtimeDir, dir, newKey: dqResultKey(base) };
}
const readJson = async file => JSON.parse(await fs.readFile(file, 'utf8'));

test('ADR-0006: migration 011 collapses one execution to its newest row and carries its claim and alert to the new key', async () => {
  const { runtimeDir, dir, newKey } = await legacyRuntime();
  await up({ runtimeDir });
  const { results } = await readJson(path.join(dir, 'dq.json'));
  assert.equal(Object.keys(results).length, 2);
  assert.deepEqual([results[newKey].status, results[newKey].key], ['failed', newKey]);
  const claimed = await readJson(path.join(dir, 'occurrences.json'));
  assert.equal(claimed[`dq:${newKey}`], '2026-10-06T09:21:00Z');
  assert.equal(claimed['failed:databricks:42:r1'], '2026-10-06T08:00:00Z');
  const { alerts } = await readJson(path.join(dir, 'alerts.json'));
  assert.deepEqual(alerts['AL-1'].occurrences[0], { key: `dq:${newKey}`, resultKey: newKey, checkId: 'c1' });
});

test('ADR-0006: migration 011 is safe to run twice and on a runtime with no monitoring data', async () => {
  const { runtimeDir, dir } = await legacyRuntime();
  await up({ runtimeDir });
  const files = ['dq.json', 'occurrences.json', 'alerts.json'];
  const first = await Promise.all(files.map(name => fs.readFile(path.join(dir, name), 'utf8')));
  await up({ runtimeDir });
  assert.deepEqual(await Promise.all(files.map(name => fs.readFile(path.join(dir, name), 'utf8'))), first);
  await up({ runtimeDir: path.join(tmp, 'empty-runtime') });
});
