import test from 'node:test';
import assert from 'node:assert/strict';
import { OperationsService } from '../src/app/operations-service.mjs';
import { systemScope } from '../src/projects/project-access.mjs';
import { attentionTicketRows, overviewTicketRows } from '../src/app/ticket-page.mjs';
import { overviewQuery, overviewTickets, overviewPipelines, overviewAgent, overviewDataQuality, overviewWork } from '../src/app/overview-summary.mjs';

const scope = systemScope('pilot');
const from = '2026-10-01T00:00:00Z', to = '2026-10-02T00:00:00Z';
const query = { from, to, buckets: [[Date.parse(from), Date.parse(to)]] };
const ticket = { ticketId: 'T-1', projectId: 'pilot', title: 'Quality', status: 'open', priority: 'high', kind: 'data_quality', category: 'data_quality', createdAt: from, updatedAt: from };

test('FR-2 ticket aggregates read tickets once and never wait for unrelated monitoring', async () => {
  let reads = 0;
  const service = new OperationsService({ store: { ticketOverview: async (_scope, _access, q) => { reads++; return overviewTicketRows([ticket, { ...ticket, ticketId: 'T-2', status: 'closed', closedAt: from, taskId: "task-1", taskChanges: 1 }], q); } } });
  service.monitor = () => { throw Error('ticket summary must not monitor pipelines'); };
  const result = await overviewTickets(service, undefined, scope, query);
  assert.equal(reads, 1);
  assert.equal(result.ticketSummary.open, 1);
  assert.equal(result.dqOpen, 1);
  assert.deepEqual(result.chart, { raised: [2], resolved: [1], dqResolved: [1] });
  assert.equal(result.agentResolved.dataQuality, 1);
  assert.equal('chartTickets' in result, false);
  assert.equal('items' in result.agentResolved, false);
});

test('FR-2 pipeline group is independent and returns health/chart aggregates only', async () => {
  const service = { _monitorInventory: async options => { assert.equal(options.scope, scope); assert.equal(options.maxRuns, 100); return { pipelines: [{ pipelineId: 'one' }, { pipelineId: 'two' }], runs: [{ pipelineId: 'one', status: 'failed', startTime: from }, { pipelineId: 'two', status: 'healthy', startTime: from }] }; } };
  const data = await overviewPipelines(service, scope, query);
  assert.equal(data.counts.failed, 1);
  assert.equal(data.counts.succeeded, 1);
  assert.deepEqual(data.chart.failed, [1]);
  assert.equal('items' in data, false);
});

test('FR-2 agent summaries preserve the bounded task window and exclude inbox notifications', async () => {
  const store = { listTasks: async (s, options) => { assert.equal(s, scope); assert.equal(options.limit, 200); return [{ id: 'A', title: 'Check pipelines', type: 'adhoc', status: 'done', createdAt: from, updatedAt: from, context: {} }]; }, listInbox: async () => [{ kind: 'approval' }, { kind: 'notification' }, { kind: 'question' }] };
  const data = await overviewAgent(store, scope, query);
  assert.equal(data.waiting, 2);
  assert.equal(data.today.finished, 1);
  assert.equal(data.today.last.id, 'A');
  assert.equal('context' in data.today.last, false);
  assert.match(data.lines.pipelines.text, /1 task finished/);
});

test('FR-2 work retains personal selection and needs no DQ or inbox read', async () => {
  const service = new OperationsService({ store: { attentionTickets: async (_scope, _access, q) => attentionTicketRows([ticket], q), visibleOpenPipelineIds: async () => [] } });
  service.monitor = async () => ({ items: [], workspaceTotal: 0, recentRuns: [], diagnostics: {} });
  const data = await overviewWork(service, undefined, scope);
  assert.equal(data.items[0].title, 'Quality');
  assert.equal(data.scope, 'team');
  assert.equal('ticketSummary' in data, false);
});

test('FR-2 missing DQ configuration and query validation are explicit', async () => {
  assert.equal((await overviewDataQuality(null, query)).configured, false);
  assert.throws(() => overviewQuery(new URLSearchParams({ from: 'bad' })), /Invalid reporting/);
  assert.throws(() => overviewQuery(new URLSearchParams({ from: to, to: from })), /precede/);
  assert.throws(() => overviewQuery(new URLSearchParams({ buckets: '[[4,2]]' })), /Invalid chart/);
  assert.deepEqual(overviewQuery(new URLSearchParams({ from, to, buckets: JSON.stringify(query.buckets) })), query);
});
