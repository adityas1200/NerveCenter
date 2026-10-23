import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { FileOperationsStore } from '../src/app/operations-store.mjs';
import { FileTaskStore } from '../src/tasks/task-store.mjs';
import { BoardService } from '../src/boards/board-service.mjs';
import { createAppTools } from '../src/tasks/nervecenter-tools.mjs';
import { attachmentLines } from '../src/tasks/attachments.mjs';
import { fakeMcpSdk, makeRuntime, sdkInit, sdkResult, tempDir, wait, pilot } from './helpers.mjs';

// SPEC-tasks-12: what a person points at on a board reaches Sonic as a reference it reads itself.

const tmp = await tempDir('nc-ask-about-');
const builder = { id: 'priya', name: 'Priya Nair', role: 'developer' };
const fakeOps = {
  async monitor() { return { items: [{ pipelineId: '731', name: 'veltrix_sales_daily_load', platform: 'databricks', health: 'failed', recentRuns: [] }, { pipelineId: '750', name: 'veeva_crm_calls_extract', platform: 'databricks', health: 'healthy', recentRuns: [] }], recentRuns: [] }; },
  async listTickets() { return []; },
};

async function boardTools() {
  const store = new FileOperationsStore(path.join(tmp, `ops-${Math.random().toString(36).slice(2, 8)}`)); await store.init();
  const boards = new BoardService({ store, operationsService: fakeOps, taskStore: { listTasks: async () => [] } });
  const board = await boards.create({ title: 'Daily ops', widgets: [{ id: 'health', type: 'chart', title: 'Pipelines by health', source: { kind: 'nervecenter', query: 'pipelines.health' } }] }, builder, pilot);
  await boards.setPublished(board.id, true, builder, pilot);
  const server = createAppTools({ operationsService: fakeOps, taskStore: new FileTaskStore(path.join(tmp, `tasks-${board.id}`)), rbacStore: { overlay: base => ({ ...base, roles: ['viewer'] }), list: () => [] }, boards })({ id: 'T-1', projectId: 'pilot', createdBy: { id: 'devon', name: 'Devon' } }, fakeMcpSdk);
  return { board, server };
}

test('FR-6: get_board_widget_data returns what the widget shows, for anyone who can open the board', async () => {
  const { board, server } = await boardTools();
  // A viewer may read a published board, so the tool works for them too.
  const data = await server.call('get_board_widget_data', { board: board.id, widget: 'health', filters: { range: '24h' } });
  assert.deepEqual(data.board, { id: board.id, title: 'Daily ops', link: `/boards/${board.id}` });
  assert.deepEqual([data.widget.id, data.widget.type, data.widget.source.query], ['health', 'chart', 'pipelines.health']);
  assert.deepEqual(data.columns, ['Health', 'Count']);
  assert.deepEqual(data.rows, [['Succeeded', 1], ['Failed', 1], ['Missed', 0], ['Paused', 0]]);
  assert.equal(data.rowCount, 4);
  assert.equal(data.filters.range.preset, '24h');
  assert.equal(data.fix, null);
  assert.equal((await server.call('get_board_widget_data', { board: 'Daily ops', widget: 'Pipelines by health' })).widget.id, 'health', 'a title works for both');
  const missing = await server.tools.find(item => item.name === 'get_board_widget_data').handler({ board: board.id, widget: 'nope' });
  assert.equal(missing.isError, true);
  assert.equal(missing.content[0].text, 'Error: No widget nope on board Daily ops');
});

test('FR-7: a widget or Overview selection tells Sonic which tool to read it with', async () => {
  const calls = [];
  const sdk = { createSdkMcpServer: () => ({}), query({ prompt, options }) { calls.push({ prompt, options }); return (async function* () { yield sdkInit('sess-a'); yield sdkResult('sess-a', 'Looked.'); })(); } };
  const { store, runtime } = await makeRuntime(tmp, sdk, { name: 'context', appTools: async () => ({}) });
  const page = { name: 'Boards', path: '/boards/B-1', selection: { kind: 'board_widget', id: 'B-1/failed_runs', title: 'Failed runs · 09/24', detail: { boardId: 'B-1', widgetId: 'failed_runs', filters: { range: '7d' }, point: { label: '09/24', values: { Failed: 3 } } } } };
  const task = await runtime.startTask({ scope: pilot, prompt: 'This looks wrong', context: { page }, user: builder, notify: false });
  await wait(async () => (await store.getTask(task.id)).status === 'done', 10000, 'done');
  assert.match(calls[0].prompt, /Selected: \{"kind":"board_widget","id":"B-1\/failed_runs".*"point":\{"label":"09\/24","values":\{"Failed":3\}\}/);
  assert.match(calls[0].prompt, /This message is about widget failed_runs on board B-1, at the point given in Selected\. Call mcp__nervecenter__get_board_widget_data with that board, widget and filters before you answer/);

  await runtime.sendMessage(task.id, builder, 'And this panel?', { context: { page: { name: 'Overview', path: '/', selection: { kind: 'overview_panel', id: 'pipelines', title: 'Pipelines', detail: { range: '24h' } } } } });
  await wait(async () => calls.length === 2 && (await store.getTask(task.id)).status === 'done', 10000, 'second turn');
  assert.match(calls[1].prompt, /This message is about an Overview panel\. Read it with mcp__nervecenter__app_overview/);
  assert.doesNotMatch(calls[1].prompt, /get_board_widget_data/);
});

test('FR-10: an attached image is a pointer to data, not evidence', () => {
  const image = attachmentLines([{ name: 'screenshot.png', path: 'attachments/q-1/screenshot.png', size: 40_000, mime: 'image/png' }], 'tasks/T-1');
  assert.match(image, /Treat an image as a pointer, not as evidence/);
  assert.match(image, /Call any number you could only read from the image unconfirmed/);
  const csv = attachmentLines([{ name: 'rows.csv', path: 'attachments/q-1/rows.csv', size: 900, mime: 'text/csv' }], 'tasks/T-1');
  assert.doesNotMatch(csv, /pointer/);
});
