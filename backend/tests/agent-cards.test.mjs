import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FileTaskStore } from '../src/tasks/task-store.mjs';
import { TaskRuntime } from '../src/tasks/task-runtime.mjs';
import { createWorkspace } from '../src/workspace/workspace.mjs';
import { FileOperationsStore } from '../src/app/operations-store.mjs';
import { OperationsService } from '../src/app/operations-service.mjs';
import { createAppTools, searchKnowledge } from '../src/tasks/nervecenter-tools.mjs';
import { fakeMcpSdk, sdkInit, sdkResult, tempDir, wait, pilot } from './helpers.mjs';

const tmp = await tempDir('nc-agent-cards-');
const user = { id: 'mitesh.shinde', name: 'Mitesh Shinde' };


test('the agent can show its plan, findings and result cards; each call changes nothing and echoes what was drawn', async () => {
  const ops = new FileOperationsStore(path.join(tmp, 'ops-cards')); await ops.init();
  const operationsService = new OperationsService({ store: ops });
  const server = createAppTools({ operationsService, taskStore: new FileTaskStore(path.join(tmp, 'store-cards')) })({ id: 'T-1', projectId: 'pilot', createdBy: user }, fakeMcpSdk);
  const names = server.tools.map(tool => tool.name);
  for (const name of ['propose_plan', 'update_plan', 'record_finding', 'show_table', 'show_timeline', 'show_comparison', 'show_metrics', 'show_artifact', 'search_knowledge']) assert.ok(names.includes(name), `${name} is offered`);

  const plan = await server.call('propose_plan', { title: 'Fix the Veltrix load', steps: [{ id: 's1', text: 'Read the failed run', kind: 'read' }, { id: 's2', text: 'Repair the run', kind: 'change' }] });
  assert.equal(plan.shown, true); assert.equal(plan.steps.length, 2); assert.equal(plan.steps[0].state, 'pending'); assert.equal(plan.steps[1].kind, 'change');
  assert.deepEqual(await server.call('update_plan', { stepId: 's1', state: 'done', note: 'Column plan_type is new' }), { shown: true, stepId: 's1', state: 'done', note: 'Column plan_type is new' });

  const finding = await server.call('record_finding', { kind: 'hypothesis', id: 'h1', text: 'The IQVIA file gained a column.' });
  assert.deepEqual(finding, { shown: true, findingId: 'h1', kind: 'hypothesis' });
  const evidence = await server.call('record_finding', { kind: 'evidence', hypothesisId: 'h1', text: 'Run 900100826 fails on plan_type.', evidence: [{ label: 'Run 900100826', kind: 'run', ref: '900100826' }] });
  assert.equal(evidence.kind, 'evidence'); assert.match(evidence.findingId, /^f-/);

  assert.deepEqual(await server.call('show_table', { title: 'Runs', columns: ['Run', 'Status'], rows: [['900100826', 'Failed'], ['900100825', 'Healthy']] }), { shown: true, title: 'Runs', rows: 2 });
  assert.deepEqual(await server.call('show_timeline', { title: 'What happened', events: [{ at: '04:00 UTC', text: 'Run started' }, { at: '04:06 UTC', text: 'Run failed', tone: 'bad' }] }), { shown: true, title: 'What happened', events: 2 });
  assert.deepEqual(await server.call('show_comparison', { title: 'Schema', rows: [{ label: 'Columns', before: 41, after: 42, changed: true }] }), { shown: true, title: 'Schema', rows: 1 });
  assert.deepEqual(await server.call('show_metrics', { items: [{ label: 'Rows loaded', value: 0, tone: 'bad' }] }), { shown: true, items: 1 });

  const artifact = await server.call('show_artifact', { path: 'tasks/T-1/report.html', title: 'Veltrix load RCA', summary: 'Cause, impact, fix' });
  assert.deepEqual(artifact, { shown: true, path: 'report.html', title: 'Veltrix load RCA', kind: 'report', summary: 'Cause, impact, fix' });
  assert.equal((await server.call('show_artifact', { path: 'lineage.svg', title: 'Lineage' })).kind, 'image');
  const escaped = await server.tools.find(tool => tool.name === 'show_artifact').handler({ path: '../other/report.html', title: 'x' });
  assert.equal(escaped.isError, true, 'paths outside the task folder are refused');
  const wrongType = await server.tools.find(tool => tool.name === 'show_artifact').handler({ path: 'run.sh', title: 'x' });
  assert.equal(wrongType.isError, true, 'only document, image and HTML files are artifacts');

  const pr = { url: 'https://github.com/acme/data-platform/pull/42', number: 42, title: 'Handle the new plan_type column', branch: 'sonic/ops-1001-plan-type', base: 'main', state: 'draft' };
  assert.deepEqual(await server.call('show_pull_request', pr), { shown: true, url: pr.url, number: 42 });
  const mismatched = await server.tools.find(tool => tool.name === 'show_pull_request').handler({ ...pr, number: 41 });
  assert.equal(mismatched.isError, true, 'the number must match the URL');

  // The cards are reads for the permission gate: no approval, no change count.
  const { classifyTool } = await import('../src/tasks/permission-policy.mjs');
  for (const name of ['propose_plan', 'record_finding', 'show_table', 'show_pull_request', 'search_knowledge']) assert.equal(classifyTool(`mcp__nervecenter__${name}`, {}, { permission: 'read-only' }).verdict, 'allow', `${name} is allowed read-only`);
});

test('every write tool asks for a reason and the approval carries it', async () => {
  const ops = new FileOperationsStore(path.join(tmp, 'ops-reason')); await ops.init();
  const operationsService = new OperationsService({ store: ops });
  const server = createAppTools({ operationsService, taskStore: new FileTaskStore(path.join(tmp, 'store-reason')) })({ id: 'T-2', projectId: 'pilot', createdBy: user }, fakeMcpSdk);
  for (const name of ['comment_on_ticket', 'assign_ticket', 'set_ticket_status', 'create_ticket', 'link_ticket_to_source']) {
    const shape = server.tools.find(tool => tool.name === name).shape;
    assert.ok(shape.reason, `${name} has a reason field`);
    assert.equal(shape.reason.safeParse('').success, false, `${name} rejects an empty reason`);
  }
  const created = await server.call('create_ticket', { title: 'Veltrix load failed again', reason: 'Nothing tracks the failure yet.' });
  assert.ok(created.ticketId);
  assert.equal((await ops.getTicket(created.ticketId)).reason, undefined, 'the reason is not written into the ticket record');

  // An SDK stand-in whose agent wants to close a ticket with a reason: the Inbox item shows why.
  const workspace = await createWorkspace({ dir: path.join(tmp, 'ws-reason') });
  const store = new FileTaskStore(path.join(tmp, 'store-gate')); await store.init();
  const sdk = { query({ options }) { return (async function* () {
    yield sdkInit('s');
    await options.canUseTool('mcp__nervecenter__set_ticket_status', { ticketId: created.ticketId, status: 'resolved', resolution: 'Loaded.', reason: 'The repair run succeeded and the mart is fresh.' }, { signal: options.abortController.signal });
    yield sdkResult('s', 'Done');
  })(); } };
  const runtime = new TaskRuntime({ store, workspace, sdkLoader: async () => sdk });
  const task = await runtime.startTask({ scope: pilot, prompt: 'Close it', user, notify: false });
  let item;
  await wait(async () => { [item] = await store.listInbox(pilot, { kind: 'approval', taskId: task.id, status: 'pending' }); return Boolean(item); }, 30000, 'approval raised');
  assert.equal(item.reason, 'The repair run succeeded and the mart is fresh.');
  // The Inbox item is written a moment before the task event that mentions it.
  let requested;
  await wait(async () => { requested = (await store.listEvents(task.id)).find(event => event.type === 'approval.requested'); return Boolean(requested); }, 30000, 'approval event recorded');
  assert.equal(requested.reason, item.reason);
  await runtime.cancel(task.id, user);
});

test('search_knowledge ranks pages by matching words, title matches first, and points at the path to read', async () => {
  const dir = path.join(tmp, 'knowledge');
  await fs.mkdir(path.join(dir, 'runbooks'), { recursive: true }); await fs.mkdir(path.join(dir, '.git'), { recursive: true });
  await fs.writeFile(path.join(dir, 'index.md'), '# Knowledge\n\nStart here.');
  await fs.writeFile(path.join(dir, 'runbooks', 'veltrix-load.md'), '# Veltrix sales load runbook\n\nWhen the IQVIA file changes schema, update the contract and repair the run.');
  await fs.writeFile(path.join(dir, 'runbooks', 'nbrx.md'), '---\ntitle: NBRx definition\n---\nNBRx means new-to-brand prescriptions, including switches.');
  await fs.writeFile(path.join(dir, '.git', 'HEAD'), 'ref: refs/heads/main');
  const result = await searchKnowledge(dir, 'veltrix schema', 5);
  assert.equal(result.results[0].path, 'runbooks/veltrix-load.md');
  assert.equal(result.results[0].title, 'Veltrix sales load runbook');
  assert.equal(result.results[0].readPath, 'knowledge/runbooks/veltrix-load.md');
  assert.match(result.results[0].snippet, /schema/);
  assert.equal(result.results.some(item => item.path.startsWith('.git')), false, 'the .git folder is skipped');
  assert.deepEqual((await searchKnowledge(dir, 'nbrx switches')).results.map(item => item.title), ['NBRx definition']);
  assert.deepEqual((await searchKnowledge(dir, 'zzz')).results, []);
  assert.equal((await searchKnowledge(null, 'x')).note, 'No knowledge folder is configured');
});

test('partial text streams as live deltas that are pushed but never stored', async () => {
  const workspace = await createWorkspace({ dir: path.join(tmp, 'ws-stream') });
  const store = new FileTaskStore(path.join(tmp, 'store-stream')); await store.init();
  const sdk = { query({ options }) { assert.equal(options.includePartialMessages, true); return (async function* () {
    yield sdkInit('s');
    yield { type: 'stream_event', session_id: 's', parent_tool_use_id: null, event: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } } };
    yield { type: 'stream_event', session_id: 's', parent_tool_use_id: null, event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'The load ' } } };
    yield { type: 'stream_event', session_id: 's', parent_tool_use_id: null, event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'failed.' } } };
    yield { type: 'stream_event', session_id: 's', parent_tool_use_id: null, event: { type: 'content_block_stop', index: 0 } };
    yield { type: 'stream_event', session_id: 's', parent_tool_use_id: null, event: { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'tu1', name: 'mcp__nervecenter__get_pipeline_runs', input: {} } } };
    yield { type: 'assistant', session_id: 's', message: { content: [{ type: 'text', text: 'The load failed.' }] } };
    yield sdkResult('s', 'The load failed.');
  })(); } };
  const runtime = new TaskRuntime({ store, workspace, sdkLoader: async () => sdk });
  const deltas = [];
  const task = await runtime.startTask({ scope: pilot, prompt: 'Why did it fail?', user, notify: false });
  runtime.subscribeDeltas(task.id, delta => deltas.push(delta));
  await wait(async () => (await store.getTask(task.id)).status === 'done', 10000, 'run done');
  assert.deepEqual(deltas.map(delta => `${delta.kind}:${delta.phase}${delta.text ? `:${delta.text}` : ''}${delta.name ? `:${delta.name}` : ''}`), ['text:start', 'text:delta:The load ', 'text:delta:failed.', 'block:stop', 'tool:start:mcp__nervecenter__get_pipeline_runs']);
  const stored = await store.listEvents(task.id);
  assert.equal(stored.some(event => event.type === 'delta' || event.type === 'stream_event'), false, 'deltas are not stored');
  assert.equal(stored.filter(event => event.type === 'assistant.text').length, 1);
});

test('approval stats count decided requests by policy category inside the window', async () => {
  const { approvalStats } = await import('../src/api/task-routes.mjs');
  const store = new FileTaskStore(path.join(tmp, 'store-stats')); await store.init();
  const old = new Date(Date.now() - 40 * 86_400_000).toISOString();
  for (const item of [
    { kind: 'approval', taskId: 'T-1', title: 'a', category: 'ticket_writes', categoryLabel: 'Ticket change', status: 'approved', decidedAt: new Date().toISOString() },
    { kind: 'approval', taskId: 'T-1', title: 'b', category: 'ticket_writes', categoryLabel: 'Ticket change', status: 'approved', decidedAt: new Date().toISOString() },
    { kind: 'approval', taskId: 'T-2', title: 'c', category: 'ticket_writes', categoryLabel: 'Ticket change', status: 'denied', decidedAt: new Date().toISOString() },
    { kind: 'approval', taskId: 'T-3', title: 'd', category: 'email_send', categoryLabel: 'Send email', status: 'pending' },
    { kind: 'approval', taskId: 'T-4', title: 'e', category: 'email_send', categoryLabel: 'Send email', status: 'approved', decidedAt: old, createdAt: old },
    { kind: 'question', taskId: 'T-5', title: 'q', status: 'pending' },
  ]) await store.createInboxItem({ projectId: 'pilot', ...item });
  const stats = await approvalStats(store, pilot, 30);
  assert.deepEqual(stats.totals, { approved: 2, denied: 1, pending: 1 });
  assert.equal(stats.categories[0].category, 'ticket_writes'); assert.equal(stats.categories[0].approved, 2); assert.equal(stats.categories[0].denied, 1);
  assert.equal(stats.categories.find(item => item.category === 'email_send').approved, 0, 'a decision older than the window is left out');
  assert.equal(stats.categories.find(item => item.category === 'email_send').pending, 1);
});
