import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FileOperationsStore } from '../src/app/operations-store.mjs';
import { FileTaskStore } from '../src/tasks/task-store.mjs';
import { BoardService, fillTemplate, normaliseBoard, resolveFilters, resolveRange } from '../src/boards/board-service.mjs';
import { createAppTools } from '../src/tasks/nervecenter-tools.mjs';
import { createBackend } from '../src/bootstrap.mjs';
import { createApiServer } from '../src/api/server.mjs';
import { fakeMcpSdk, tempDir, pilot } from './helpers.mjs';

const tmp = await tempDir('nc-boards-');
const builder = { id: 'priya', name: 'Priya Nair', role: 'developer' };
const admin = { id: 'mitesh', name: 'Mitesh Shinde', role: 'admin' };
const viewer = { id: 'devon', name: 'Devon Blake', role: 'viewer' };
const T = iso => Date.parse(iso);

const clock = () => T('2026-09-25T10:00:00Z');
const run = (pipelineId, name, startTime, status, durationMs = 60_000) => ({ runId: `${pipelineId}-${startTime}`, pipelineId, platform: 'databricks', status, startTime, durationMs });
const fakeOps = {
  async monitor() {
    const items = [
      { pipelineId: '731', name: 'veltrix_sales_daily_load', platform: 'databricks', health: 'failed', lastRunAt: '2026-09-25T04:00:00Z', nextRunAt: '2026-09-26T04:00:00Z', typicalDurationMs: 21 * 60_000, recentRuns: [run('731', 'veltrix', '2026-09-25T04:00:00Z', 'failed', 6 * 60_000)] },
      { pipelineId: '750', name: 'veeva_crm_calls_extract', platform: 'databricks', health: 'healthy', lastRunAt: '2026-09-25T03:00:00Z', nextRunAt: '2026-09-26T03:00:00Z', typicalDurationMs: 19 * 60_000, recentRuns: [run('750', 'veeva', '2026-09-25T03:00:00Z', 'healthy', 41 * 60_000)] },
      { pipelineId: '755', name: 'payer_formulary_load', platform: 'databricks', health: 'running', lastRunAt: '2026-09-25T09:40:00Z', nextRunAt: null, typicalDurationMs: null, recentRuns: [run('755', 'payer', '2026-09-25T09:40:00Z', 'running')] },
      { pipelineId: '760', name: 'field_alignment_publish', platform: 'databricks', health: 'paused', lastRunAt: null, nextRunAt: null, typicalDurationMs: null, recentRuns: [] },
    ];
    const recentRuns = [...items.flatMap(item => item.recentRuns), run('750', 'veeva', '2026-09-24T03:00:00Z', 'healthy'), run('731', 'veltrix', '2026-09-24T04:00:00Z', 'healthy'), run('731', 'veltrix', '2026-09-23T04:00:00Z', 'healthy')];
    return { items, recentRuns };
  },
  async listTickets() {
    return [
      { ticketId: 'OPS-1', title: 'Veltrix daily sales load failed', priority: 'high', status: 'in_progress', appStatus: 'in_progress', createdAt: '2026-09-25T06:00:00Z', updatedAt: '2026-09-25T07:00:00Z', assignee: { name: 'Mitesh Shinde' }, externalReference: { number: 'INC0031300' }, tags: ['pipeline', 'veltrix'] },
      { ticketId: 'OPS-2', title: 'Duplicate HCPs', priority: 'high', status: 'open', appStatus: 'open', createdAt: '2026-09-24T06:00:00Z', updatedAt: '2026-09-24T06:00:00Z', assignee: null, tags: ['dq'] },
      { ticketId: 'OPS-3', title: 'Old failure', priority: 'medium', status: 'resolved', appStatus: 'closed', createdAt: '2026-09-20T06:00:00Z', updatedAt: '2026-09-24T12:00:00Z', closedAt: '2026-09-24T12:00:00Z', resolvedWithAgent: true, kind: 'pipeline', tags: [] },
    ];
  },
};
const fakeDq = { async monitor() { return { items: [
  { checkId: 'DQ-001', name: 'veltrix_sales.trx_null_rate', table: 'gold.veltrix_sales_daily', status: 'failed', severity: 'high', failedRows: 38, executedAt: '2026-09-25T06:40:00Z' },
  { checkId: 'DQ-001', name: 'veltrix_sales.trx_null_rate', table: 'gold.veltrix_sales_daily', status: 'passed', severity: 'high', failedRows: 0, executedAt: '2026-09-24T06:40:00Z' },
  { checkId: 'DQ-002', name: 'corvana_sales.row_count_delta', table: 'gold.corvana_sales_daily', status: 'passed', severity: 'medium', failedRows: 0, executedAt: '2026-09-25T06:40:00Z' },
  { checkId: 'DQ-003', name: 'hcp_master.npi_uniqueness', table: 'gold.dim_hcp', status: 'warning', severity: 'low', failedRows: 3, executedAt: '2026-09-25T06:40:00Z' },
] }; }, async getConfig() { return { warehouseId: 'wh-1', catalog: 'commercial', schema: 'ops_monitoring' }; } };
const fakeTasks = { async listTasks() { return [{ id: 'T-1', status: 'done', finishedAt: '2026-09-25T08:00:00Z', changes: 2 }, { id: 'T-2', status: 'done', finishedAt: '2026-09-24T08:00:00Z', changes: 0 }, { id: 'T-3', status: 'running', changes: 0 }]; } };

async function service(extra = {}) {
  const store = new FileOperationsStore(path.join(tmp, `ops-${Math.random().toString(36).slice(2, 8)}`)); await store.init();
  return new BoardService({ store, operationsService: fakeOps, dataQualityService: fakeDq, taskStore: fakeTasks, clock, ...extra });
}

test('a board spec is normalised: a range filter is always present, widgets get ids and sizes, bad SQL and unknown sources are refused', () => {
  const board = normaliseBoard({ title: '  Daily ops ', widgets: [{ type: 'metric', title: 'Pipelines', source: { kind: 'nervecenter', query: 'pipelines.health' } }, { type: 'chart', title: 'Runs', source: { query: 'pipelines.runs_over_time' }, viz: { xColumn: 'Period', seriesColumns: ['Succeeded', 'Failed'] } }, { type: 'text', title: 'Note', markdown: 'Hello' }] });
  assert.equal(board.title, 'Daily ops');
  assert.deepEqual(board.filters.map(filter => filter.type), ['range']);
  assert.deepEqual(board.widgets.map(widget => [widget.id, widget.size]), [['pipelines', 'sm'], ['runs', 'md'], ['note', 'lg']]);
  assert.equal(board.widgets[0].source.kind, 'nervecenter');
  assert.throws(() => normaliseBoard({ title: 'x', widgets: [{ type: 'table', title: 'Bad', source: { kind: 'sql', statement: 'DELETE FROM t' } }] }), /read-only SELECT/);
  assert.throws(() => normaliseBoard({ title: 'x', widgets: [{ type: 'table', title: 'Bad', source: { kind: 'sql', statement: 'SELECT 1; DROP TABLE t' } }] }), /read-only SELECT/);
  assert.throws(() => normaliseBoard({ title: 'x', widgets: [{ type: 'table', title: 'Bad', source: { kind: 'nervecenter', query: 'nope' } }] }), /unknown NerveCenter source/);
  assert.throws(() => normaliseBoard({ widgets: [] }), /needs a title/);
  const two = normaliseBoard({ title: 'x', filters: [{ type: 'select', label: 'Brand', options: ['veltrix', 'corvana'] }, { type: 'range', default: '24h' }], widgets: [] });
  assert.deepEqual(two.filters.map(filter => `${filter.type}:${filter.key}`), ['select:brand', 'range:range']);
  assert.equal(two.filters[1].default, '24h');
});

test('filters resolve from defaults and the reader\'s picks, and templates fill from them without touching SQL text', () => {
  const board = normaliseBoard({ title: 'x', filters: [{ type: 'range', default: '7d' }, { type: 'select', key: 'brand', options: ['veltrix'] }], widgets: [] });
  const values = resolveFilters(board, { range: '24h', brand: 'veltrix' });
  assert.equal(values.range.preset, '24h'); assert.equal(values.brand, 'veltrix');
  assert.equal(resolveFilters(board, { brand: 'nope' }).brand, 'all', 'an option that is not offered falls back to all');
  assert.equal(resolveFilters(board, {}).range.preset, '7d');
  const range = resolveRange('7d', {}, clock());
  assert.equal(range.from, '2026-09-18T10:00:00.000Z');
  assert.equal(fillTemplate('{{range.from}}', { range }), '2026-09-18T10:00:00.000Z');
  assert.equal(fillTemplate('{{brand}}', { brand: 'all' }), '', 'all means no filter, so the parameter is empty');
  assert.equal(fillTemplate("' OR 1=1 --{{brand}}", { brand: 'x' }), "' OR 1=1 --x", 'templates only ever produce parameter values');
});

test('NerveCenter sources compute the same numbers the pages show and honour the match filter', async () => {
  const boards = await service();
  const board = await boards.create({ title: 'Ops', filters: [{ type: 'range', default: '7d' }, { type: 'select', key: 'match', label: 'Brand', options: ['veltrix', 'veeva'] }], widgets: [
    { id: 'health', type: 'metric', title: 'Pipelines', source: { kind: 'nervecenter', query: 'pipelines.health' } },
    { id: 'runs', type: 'chart', title: 'Runs', source: { kind: 'nervecenter', query: 'pipelines.runs_over_time' } },
    { id: 'slow', type: 'table', title: 'Slow', source: { kind: 'nervecenter', query: 'pipelines.slow' } },
    { id: 'prio', type: 'chart', title: 'Open by priority', source: { kind: 'nervecenter', query: 'tickets.open_by_priority' } },
    { id: 'tix', type: 'table', title: 'Tickets', source: { kind: 'nervecenter', query: 'tickets.list' } },
    { id: 'fixed', type: 'metric', title: 'Fixed', source: { kind: 'nervecenter', query: 'tickets.fixed_with_agent' } },
    { id: 'dq', type: 'metric', title: 'Checks', source: { kind: 'nervecenter', query: 'dq.checks_by_status' } },
    { id: 'failing', type: 'table', title: 'Failing', source: { kind: 'nervecenter', query: 'dq.failing_checks' } },
    { id: 'agent', type: 'chart', title: 'Sonic', source: { kind: 'nervecenter', query: 'tasks.agent_activity' } },
    { id: 'note', type: 'text', title: 'Note', markdown: 'Read me' },
  ] }, builder, pilot);
  const result = await boards.run(board.id, {}, builder, pilot);
  const w = id => result.widgets[id];
  assert.deepEqual(w('health').rows, [['Succeeded', 2], ['Failed', 1], ['Missed', 0], ['Paused', 1]], 'running counts as succeeded');
  assert.deepEqual(w('runs').columns, ['Period', 'Succeeded', 'Failed']);
  assert.equal(w('runs').rows.length, 8, 'seven days plus today, one row per day');
  assert.deepEqual(w('runs').rows.at(-1), ['09/25', 1, 1]);
  assert.deepEqual(w('slow').rows, [['veeva_crm_calls_extract', 41, 19, 2.2]]);
  assert.deepEqual(w('prio').rows, [['Critical', 0], ['High', 2], ['Medium', 0], ['Low', 0]]);
  assert.equal(w('tix').rows.length, 2); assert.equal(w('tix').rows[0][0], 'INC0031300'); assert.deepEqual(w('tix').links.Ticket, ['/tickets/OPS-1', '/tickets/OPS-2']);
  assert.deepEqual(w('fixed').rows, [['Pipeline', 1]]);
  assert.deepEqual(w('dq').rows, [['Passed', 1], ['Warning', 1], ['Failed', 1]], 'only each check\'s latest run counts');
  assert.deepEqual(w('failing').rows.map(row => [row[0], row[3]]), [['veltrix_sales.trx_null_rate', 'Failed'], ['hcp_master.npi_uniqueness', 'Warning']]);
  assert.deepEqual(w('agent').rows.at(-1), ['09/25', 1, 2]);
  assert.equal(w('note').markdown, 'Read me');
  const filtered = await boards.run(board.id, { match: 'veltrix' }, builder, pilot);
  assert.deepEqual(filtered.widgets.health.rows, [['Succeeded', 0], ['Failed', 1], ['Missed', 0], ['Paused', 0]]);
  assert.equal(filtered.widgets.tix.rows.length, 1);
  assert.equal(filtered.widgets.slow.rows.length, 0);
});

test('SQL widgets run one bound SELECT through the connected platform and report a plain error when it fails', async () => {
  const calls = [];
  const boards = await service({ connectionService: { resolve: async provider => (provider === 'databricks' ? { provider, config: { host: 'h' }, credentials: { token: 't' } } : null) }, databricksFactory: () => ({ queryRows: async args => { calls.push(args); if (/missing/.test(args.statement)) throw new Error('[TABLE_OR_VIEW_NOT_FOUND] The table or view `gold.missing` cannot be found.'); return [{ rows_loaded: 500 }]; } }) });
  const board = await boards.create({ title: 'SQL', widgets: [
    { id: 'rows', type: 'metric', title: 'Rows', source: { kind: 'sql', provider: 'databricks', statement: 'SELECT count(*) AS rows_loaded FROM gold.veltrix_sales_daily WHERE loaded_at >= :from_time', params: { from_time: '{{range.from}}' } }, viz: { valueColumn: 'rows_loaded' } },
    { id: 'gone', type: 'table', title: 'Gone', source: { kind: 'sql', provider: 'databricks', statement: 'SELECT * FROM gold.missing' } },
    { id: 'snow', type: 'table', title: 'Snow', source: { kind: 'sql', provider: 'snowflake', statement: 'SELECT 1' } },
  ] }, builder, pilot);
  const result = await boards.run(board.id, { range: '24h' }, builder, pilot);
  assert.deepEqual(result.widgets.rows.columns, ['rows_loaded']); assert.deepEqual(result.widgets.rows.rows, [[500]]);
  assert.equal(calls[0].warehouseId, 'wh-1', 'the warehouse comes from the data quality setup when Connectors has none');
  assert.deepEqual(calls[0].parameters, [{ name: 'from_time', value: '2026-09-24T10:00:00.000Z', type: 'TIMESTAMP' }]);
  assert.match(result.widgets.gone.error, /table this widget reads does not exist: gold\.missing/);
  assert.match(result.widgets.snow.error, /No snowflake connection is configured/);
  // Results are cached briefly per board, widget and filter set; a widget that errored is tried again.
  await boards.run(board.id, { range: '24h' }, builder, pilot);
  assert.equal(calls.length, 3, 'the second run serves the good widget from cache and retries only the failed one');
});

test('board filter input stays in provider bindings, even when it contains SQL syntax', async () => {
  const calls = [];
  const boards = await service({
    connectionService: { resolve: async provider => ({ provider, config: { warehouseId: 'wh-1' }, credentials: {} }) },
    databricksFactory: () => ({ queryRows: async args => { calls.push({ provider: 'databricks', ...args }); return []; } }),
    snowflakeFactory: () => ({ queryRows: async args => { calls.push({ provider: 'snowflake', ...args }); return []; } }),
  });
  const injection = "' OR 1=1; DROP TABLE approved_view --";
  const filters = { filters: [{ key: 'search', label: 'Search', type: 'text', default: '' }] };
  for (const [provider, statement] of [
    ['databricks', 'SELECT * FROM approved_view WHERE owner = :owner'],
    ['snowflake', 'SELECT * FROM approved_view WHERE owner = ?'],
  ]) {
    await boards.preview({ type: 'table', title: 'Bound SQL', source: { kind: 'sql', provider, statement, params: { owner: '{{search}}' } } }, { search: injection }, builder, filters, pilot);
  }
  await assert.rejects(boards.preview({ type: 'table', title: 'Private SQL', source: { kind: 'sql', statement: 'SELECT * FROM approved_view' } }, {}, viewer, filters, pilot), /Viewers can open boards but not build them/);
  assert.equal(calls[0].statement, 'SELECT * FROM approved_view WHERE owner = :owner');
  assert.deepEqual(calls[0].parameters, [{ name: 'owner', value: injection }]);
  assert.equal(calls[1].statement.includes(injection), false);
  assert.match(calls[1].statement, /SELECT \* FROM approved_view WHERE owner = \?/);
  assert.deepEqual(calls[1].bindings, { 1: { type: 'TEXT', value: injection } });
});

test('viewers read published boards only; builders own their drafts; admins may edit anything', async () => {
  const boards = await service();
  await assert.rejects(boards.create({ title: 'Nope', widgets: [] }, viewer, pilot), /Viewers can open boards but not build them/);
  const draft = await boards.create({ title: 'Priya draft', widgets: [{ type: 'text', title: 'n', markdown: 'x' }] }, builder, pilot);
  assert.equal(draft.status, 'draft');
  assert.deepEqual((await boards.list(viewer, pilot)).map(board => board.id), [], 'a viewer sees no drafts');
  assert.deepEqual((await boards.list(admin, pilot)).map(board => board.id), [draft.id], 'an admin sees every draft');
  await assert.rejects(boards.get(draft.id, viewer, pilot), /draft that belongs to someone else/);
  await assert.rejects(boards.update(draft.id, { title: 'Hijack' }, { id: 'other', name: 'Other', role: 'developer' }, pilot), /Only the board owner or an admin/);
  const published = await boards.setPublished(draft.id, true, builder, pilot);
  assert.equal(published.status, 'published'); assert.ok(published.publishedAt);
  const seen = await boards.get(draft.id, viewer, pilot);
  assert.equal(seen.canEdit, false); assert.equal((await boards.get(draft.id, admin, pilot)).canEdit, true);
  await assert.rejects(boards.setPublished(draft.id, true, { id: 'other', name: 'Other', role: 'developer' }, pilot), /Only the board owner or an admin/);
  const empty = await boards.create({ title: 'Empty', widgets: [] }, builder, pilot);
  await assert.rejects(boards.setPublished(empty.id, true, builder, pilot), /at least one widget/);
  await boards.remove(empty.id, admin, pilot);
  assert.equal((await boards.list(admin, pilot)).length, 1);
  assert.equal((await boards.find('priya', viewer, pilot)).id, draft.id, 'find matches a title fragment');
});

test('SPEC-boards-01 FR-13: a fresh backend starts with no boards and creates none', async () => {
  const backend = await createBackend();
  assert.equal(typeof backend.boards.ensureStarter, 'undefined', 'no starter seeding left');
  assert.deepEqual(await backend.boards.list(admin, pilot), [], 'an empty workspace stays empty');
});

test('Sonic builds, previews, updates and publishes boards through its tools as the person who asked', async () => {
  const boards = await service();
  const rbacStore = { overlay: base => ({ ...base, roles: ['developer'] }), list: () => [] };
  const server = createAppTools({ operationsService: fakeOps, taskStore: new FileTaskStore(path.join(tmp, 'store-tools')), rbacStore, boards })({ id: 'T-1', projectId: 'pilot', createdBy: { id: 'priya', name: 'Priya Nair' } }, fakeMcpSdk);
  const sources = await server.call('list_board_sources', {});
  assert.ok(sources.sources.some(item => item.id === 'pipelines.health'));
  const preview = await server.call('preview_board_widget', { widget: { type: 'metric', title: 'Pipelines', source: { kind: 'nervecenter', query: 'pipelines.health' } }, filters: { range: '24h' } });
  assert.deepEqual(preview.columns, ['Health', 'Count']); assert.equal(preview.filters.range.preset, '24h');
  const created = await server.call('create_board', { title: 'Priya board', widgets: [{ type: 'metric', title: 'Pipelines', source: { kind: 'nervecenter', query: 'pipelines.health' } }], reason: 'Priya asked for a daily view.' });
  assert.equal(created.status, 'draft'); assert.equal(created.owner, 'Priya Nair'); assert.match(created.link, /^\/boards\/B-/);
  const updated = await server.call('update_board', { board: 'Priya board', widgets: [...created.widgets, { type: 'text', title: 'Note', markdown: 'hi' }], reason: 'Add a note.' });
  assert.equal(updated.widgets.length, 2);
  const published = await server.call('publish_board', { board: created.id, published: true, reason: 'Priya asked.' });
  assert.equal(published.status, 'published');
  const viewerServer = createAppTools({ operationsService: fakeOps, taskStore: new FileTaskStore(path.join(tmp, 'store-tools-2')), rbacStore: { overlay: base => ({ ...base, roles: ['viewer'] }), list: () => [] }, boards })({ id: 'T-2', projectId: 'pilot', createdBy: { id: 'devon', name: 'Devon' } }, fakeMcpSdk);
  const refused = await viewerServer.tools.find(tool => tool.name === 'create_board').handler({ title: 'x', widgets: [], reason: 'r' });
  assert.equal(refused.isError, true); assert.match(refused.content[0].text, /read-only/);
  assert.equal((await viewerServer.call('list_boards', {})).boards.length, 1, 'the viewer sees the published board');
});

test('the boards API lists, creates, runs and guards boards', async () => {
  const backend = await createBackend();
  for (const member of ['alice', 'bob']) await backend.projectStore.addMember('pilot', member, { id: 'test' });
  const server = createApiServer(backend);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, route, body, user = 'alice') => { const response = await fetch(`${base}${route}`, { method, headers: { 'content-type': 'application/json', 'x-nervecenter-project': 'pilot', 'x-user-id': user, 'x-user-name': user }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: response.status, body: await response.json() }; };
  try {
    const list = await call('GET', '/api/boards');
    assert.equal(list.status, 200); assert.deepEqual(list.body.items, [], 'no starter board');
    const sources = await call('GET', '/api/boards/sources'); assert.equal(sources.status, 200); assert.ok(sources.body.sources.length > 5);
    const created = await call('POST', '/api/boards', { title: 'Alice board', widgets: [{ type: 'text', title: 'Note', markdown: 'x' }] });
    assert.equal(created.status, 201); assert.equal(created.body.status, 'draft');
    const data = await call('POST', `/api/boards/${created.body.id}/data`, { filters: { range: '24h' } });
    assert.equal(data.status, 200); assert.equal(data.body.widgets.note.markdown, 'x'); assert.equal(data.body.filters.range.preset, '24h');
    const badSql = await call('POST', '/api/boards', { title: 'Bad', widgets: [{ type: 'table', title: 'x', source: { kind: 'sql', statement: 'DROP TABLE t' } }] });
    assert.equal(badSql.status, 400); assert.match(badSql.body.error, /read-only SELECT/);
    const hidden = await call('GET', `/api/boards/${created.body.id}`, undefined, 'bob');
    assert.equal(hidden.status, 403);
    const published = await call('POST', `/api/boards/${created.body.id}/publish`);
    assert.equal(published.status, 200);
    assert.equal((await call('GET', `/api/boards/${created.body.id}`, undefined, 'bob')).status, 200);
    assert.equal((await call('DELETE', `/api/boards/${created.body.id}`, undefined, 'bob')).status, 403);
    assert.equal((await call('DELETE', `/api/boards/${created.body.id}`)).status, 200);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
