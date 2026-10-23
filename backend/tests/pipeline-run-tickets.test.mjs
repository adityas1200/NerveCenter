import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { FileOperationsStore } from '../src/app/operations-store.mjs';
import { OperationsService } from '../src/app/operations-service.mjs';
import { FileMonitorStore } from '../src/monitoring/monitor-store.mjs';
import { AlertService } from '../src/monitoring/alert-service.mjs';
import { MonitoringService } from '../src/monitoring/monitoring-service.mjs';
import { pilot, tempDir } from './helpers.mjs';

// SPEC-pipelines-01 FR-15: every run an alert covers shows the alert's ticket, under its ServiceNow or Jira number,
// not only the run the ticket was opened on (that run's row showed the NerveCenter id, the newest run borrowed the
// pipeline's ticket under its source number, so one ticket looked like two).

const tmp = await tempDir('nc-pipeline-run-tickets-');
const MIN = 60_000;

class FakeRuntime extends EventEmitter {
  constructor() { super(); this.tasks = new Map(); this.store = { listTasks: async () => [], appendEvent: async () => {} }; }
  async startTask(input) { const task = { id: `T-${this.tasks.size + 1}`, status: 'running', type: input.type, projectId: input.scope.projectId, context: input.context, permission: input.permission }; this.tasks.set(task.id, task); return task; }
  async getTask(id) { return this.tasks.get(id) || null; }
}

test('FR-15: a cancelled run and the failed run after it both show the alert\'s ServiceNow ticket by its number', async () => {
  const at = minutes => new Date(Date.now() - minutes * MIN).toISOString();
  const runs = [
    { runId: 'r-failed', pipelineId: '42', platform: 'databricks', status: 'failed', rawState: 'FAILED', startTime: at(20), endTime: at(15), failureSummary: 'Task load failed' },
    { runId: 'r-cancelled', pipelineId: '42', platform: 'databricks', status: 'failed', rawState: 'CANCELED', startTime: at(50), endTime: at(45), failureSummary: 'Run was cancelled' },
    { runId: 'r-ok', pipelineId: '42', platform: 'databricks', status: 'healthy', startTime: at(90), endTime: at(85) },
  ];
  const pipelines = [{ pipelineId: '42', name: 'sales_load', platform: 'databricks', schedule: null }];
  const platform = {
    async status() { return { providers: [{ provider: 'databricks', ready: true }] }; },
    async listPipelines() { return { pipelines }; },
    async listRuns({ pipelineId }) { return runs.filter(run => !pipelineId || run.pipelineId === pipelineId); },
    async getRun({ runId }) { return runs.find(run => run.runId === runId); },
    async getPipeline() { return pipelines[0]; },
  };
  const dir = path.join(tmp, 'case-1');
  const store = new FileOperationsStore(path.join(dir, 'ops')); await store.init();
  const monitorStore = new FileMonitorStore(path.join(dir, 'monitoring')); await monitorStore.init();
  const workspace = { readOperations: async () => ({ automation: { pipelineFailed: { action: 'task' } } }) };
  const ops = new OperationsService({ store, dataPlatform: platform, monitorStore }); ops.workspace = workspace;
  const log = { error() {}, warn() {}, info() {} };
  const alerts = new AlertService({ store: monitorStore, operationsService: ops, ticketTasks: { workspace, sources: async () => [] }, runtime: new FakeRuntime(), log });
  const monitoring = new MonitoringService({ store: monitorStore, operationsService: ops, workspaces: { for: async () => workspace }, alerts, log, checkSeconds: 0 });
  // Armed before the runs, so both failures are occurrences of one alert, as on dev.
  await monitorStore.setState('pilot', 'armed', { pipelineFailed: at(120) });
  await monitoring.runProject('pilot', { force: true });
  const [alert] = (await monitorStore.listAlerts(['pilot'], { status: 'open' })).items;
  assert.deepEqual(alert.occurrences.map(item => item.runId).sort(), ['r-cancelled', 'r-failed']);
  // The ServiceNow ticket the alert opened records the run it was opened on, as createSourceTicket stamps it.
  await store.createTicket({ ticketId: 'OPS-1038', projectId: 'pilot', visibility: 'project', status: 'open', title: 'sales_load failed', pipelineId: '42', runId: 'r-cancelled', source: 'servicenow', externalReference: { system: 'servicenow', number: 'INC0010020' }, createdAt: at(40), updatedAt: at(40), activity: [] });
  await monitorStore.updateAlert('pilot', alert.id, { ticketId: 'OPS-1038' });

  const history = await ops.pipelineRunHistory('42', { scope: pilot, limit: 10 });
  const byRun = Object.fromEntries(history.items.map(run => [run.runId, run]));
  assert.deepEqual([byRun['r-failed'].ticket?.ticketId, byRun['r-failed'].ticket?.number], ['OPS-1038', 'INC0010020']);
  assert.deepEqual([byRun['r-cancelled'].ticket?.ticketId, byRun['r-cancelled'].ticket?.number], ['OPS-1038', 'INC0010020']);
  assert.equal(byRun['r-failed'].ticketAction, 'view');
  assert.equal(byRun['r-ok'].ticket, null);
});
