import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { FileOperationsStore } from '../src/app/operations-store.mjs';
import { FileTaskStore } from '../src/tasks/task-store.mjs';
import { OperationsService } from '../src/app/operations-service.mjs';
import { createAppTools } from '../src/tasks/nervecenter-tools.mjs';
import { TOOL_CATEGORIES, toolPermission } from '../src/tasks/nervecenter-tool-categories.mjs';
import { fakeMcpSdk, tempDir } from './helpers.mjs';

// SPEC-tasks-04 FR-12 and FR-13: list_tasks reads a recent window, get_task_log reads one task's conversation for review.
const tmp = await tempDir('nc-task-log-');
const asha = { id: 'asha.rao', name: 'Asha Rao' };
const rbacStore = { overlay: user => ({ ...user, storedRole: 'developer' }) };

let counter = 0;
async function setup() {
  const store = new FileOperationsStore(path.join(tmp, `ops-${counter += 1}`)); await store.init();
  const taskStore = new FileTaskStore(path.join(tmp, `tasks-${counter}`)); await taskStore.init();
  const server = (projectId = 'alpha') => createAppTools({ operationsService: new OperationsService({ store }), taskStore, rbacStore, agentName: 'Sonic' })({ id: 'T-REVIEW', projectId, createdBy: asha }, fakeMcpSdk);
  const task = (id, extra = {}) => taskStore.createTask({ id, projectId: 'alpha', type: 'ticket', status: 'done', title: `Task ${id}`, createdBy: asha, createdAt: '2026-10-10T09:00:00.000Z', updatedAt: '2026-10-10T10:00:00.000Z', cost: { totalUsd: 0.4, turns: 6 }, ...extra });
  const events = async (id, list) => { for (const event of list) await taskStore.appendEvent(id, event); };
  return { taskStore, server, task, events };
}

test('FR-13: get_task_log lists the conversation and counts its signals', async () => {
  const { server, task, events } = await setup();
  await task('T-1', { historyVersion: 1, permission: 'policy', context: { ticket: { ticketId: 'OPS-7' } } });
  await events('T-1', [
    { type: 'user.message', text: 'Why did the orders load fail?', actor: asha },
    { type: 'session.init', model: 'claude-sonnet-5-5' },
    { type: 'assistant.text', text: 'Checking the last runs.' },
    { type: 'tool.use', toolUseId: 'u1', name: 'mcp__nervecenter__query_data', title: 'Query orders', input: { sql: 'SELECT count(*) FROM orders' } },
    { type: 'tool.result', toolUseId: 'u1', isError: false, content: '[[1204]]' },
    { type: 'tool.use', toolUseId: 'u2', name: 'mcp__nervecenter__record_finding', input: { kind: 'root_cause', text: 'Upstream file arrived late', confidence: 'medium' } },
    { type: 'tool.result', toolUseId: 'u2', isError: false, content: '{"shown":true}' },
    { type: 'tool.use', toolUseId: 'u3', name: 'mcp__nervecenter__show_table', input: { columns: ['day', 'rows'], rows: [['10-09', 1204]] } },
    { type: 'tool.result', toolUseId: 'u3', isError: false, content: '{"shown":true}' },
    { type: 'tool.use', toolUseId: 'u4', name: 'Bash', input: { command: 'databricks jobs list' } },
    { type: 'tool.result', toolUseId: 'u4', isError: true, content: 'command not found' },
    { type: 'tool.use', toolUseId: 's1', name: 'Grep', input: {}, parentToolUseId: 'u9' },
    { type: 'approval.requested', inboxId: 'I-1', title: 'Waiting for approval: rerun the job', reason: 'The rerun fixes the load' },
    { type: 'approval.decided', inboxId: 'I-1', decision: 'denied', title: 'Denied: rerun the job', actor: asha },
    { type: 'approval.denied', title: 'Blocked: drop table', detail: 'Not allowed in this task' },
    { type: 'question.asked', inboxId: 'I-2', title: 'Which window?', questions: [{ question: 'Which window?' }] },
    { type: 'question.answered', inboxId: 'I-2', answers: { 'Which window?': 'Yesterday' }, actor: asha },
    { type: 'user.message', text: 'No, that is the wrong table.', actor: asha },
    { type: 'status', status: 'running', title: 'Interrupted', detail: 'Asha Rao sent a new message' },
    { type: 'error', title: 'The agent stopped', detail: 'error_max_turns' },
    { type: 'status', status: 'cancelled', title: 'Cancelled', detail: 'by Asha Rao' },
    { type: 'result', subtype: 'success', isError: false, text: 'Done.', turns: 6, costUsd: 0.4 },
  ]);
  const log = await server().call('get_task_log', { taskId: 'T-1' });
  assert.equal(log.task.taskId, 'T-1'); assert.equal(log.task.ticketId, 'OPS-7'); assert.equal(log.task.turns, 6); assert.equal(log.nextAfterSeq, null);
  assert.deepEqual(log.entries.map(entry => entry.kind), ['person', 'run_start', 'agent', 'tool', 'tool_result', 'finding', 'tool', 'tool', 'tool_error', 'approval_asked', 'approval_decided', 'blocked', 'question', 'answer', 'person', 'status', 'error', 'status', 'run_end'], 'display echoes and subagent steps are left out');
  assert.equal(log.entries[3].tool, 'query_data', 'nervecenter tools are named without the MCP prefix');
  assert.equal(log.entries[4].tool, 'query_data'); assert.equal(log.entries[4].text, '[[1204]]');
  assert.deepEqual([log.entries[5].finding, log.entries[5].confidence], ['root_cause', 'medium']);
  assert.match(log.entries[6].input, /10-09/, 'what a display tool showed stays readable');
  assert.equal(log.entries[10].by, 'Asha Rao');
  assert.deepEqual(log.signals, { personMessages: 2, agentReplies: 1, toolCalls: 3, toolErrors: 1, findings: 1, approvalsAsked: 1, approved: 0, rejected: 1, blocked: 1, questionsAsked: 1, questionsAnswered: 1, interruptions: 1, cancelled: 1, errors: 1, subagentSteps: 1, edits: 1 });
});

test('FR-13: get_task_log pages a long task and counts signals over all of it', async () => {
  const { server, task, events } = await setup();
  await task('T-2');
  // Long messages hit the page's size bound well before its entry bound, with few events to write.
  await events('T-2', Array.from({ length: 90 }, (_, index) => ({ type: 'user.message', text: `message ${index} ${'x'.repeat(1900)}`, actor: asha })));
  const first = await server().call('get_task_log', { taskId: 'T-2' });
  assert.ok(first.entries.length > 0 && first.entries.length < 90, 'a long task does not come back in one page');
  assert.ok(JSON.stringify(first.entries).length <= 60_000, 'a page is bounded by size');
  assert.equal(first.nextAfterSeq, first.entries.at(-1).seq);
  const seen = [...first.entries];
  for (let page = first; page.nextAfterSeq !== null;) { page = await server().call('get_task_log', { taskId: 'T-2', afterSeq: page.nextAfterSeq }); seen.push(...page.entries); assert.equal(page.signals.personMessages, 90); }
  assert.deepEqual(seen.map(entry => entry.seq), Array.from({ length: 90 }, (_, index) => index + 1), 'pages neither skip nor repeat');
  assert.equal(first.signals.personMessages, 90);
});

test('FR-13: get_task_log reads only the task\'s own project and changes nothing', async () => {
  const { server, task, events, taskStore } = await setup();
  await task('T-3', { projectId: 'beta', title: 'A secret title' });
  await events('T-3', [{ type: 'user.message', text: 'secret question', actor: asha }]);
  const result = await server('alpha').tools.find(item => item.name === 'get_task_log').handler({ taskId: 'T-3' });
  assert.equal(result.isError, true); assert.match(result.content[0].text, /No task T-3 in this project/); assert.ok(!/secret/.test(JSON.stringify(result)));
  assert.equal((await taskStore.listEvents('T-3')).length, 1);
  assert.equal(TOOL_CATEGORIES.get_task_log, 'read'); assert.equal(toolPermission('get_task_log'), null, 'a read needs no extra permission');
});

test('FR-12: list_tasks keeps only tasks updated since a date and says when more may match', async () => {
  const { server, task } = await setup();
  await task('T-old', { updatedAt: '2026-10-01T08:00:00.000Z' });
  await task('T-mid', { updatedAt: '2026-10-12T08:00:00.000Z', finishedAt: '2026-10-12T08:00:00.000Z' });
  await task('T-new', { updatedAt: '2026-10-14T08:00:00.000Z' });
  const recent = await server().call('list_tasks', { since: '2026-10-12' });
  assert.deepEqual(recent.tasks.map(item => item.taskId), ['T-new', 'T-mid']);
  assert.equal(recent.tasks[1].finishedAt, '2026-10-12T08:00:00.000Z'); assert.equal(recent.note, undefined);
  const capped = await server().call('list_tasks', { since: '2026-10-12', limit: 2 });
  assert.deepEqual(capped.tasks.map(item => item.taskId), ['T-new', 'T-mid']); assert.match(capped.note, /more may match/);
  assert.equal((await server().call('list_tasks', {})).tasks.length, 3, 'without since nothing is filtered');
  const bad = await server().tools.find(item => item.name === 'list_tasks').handler({ since: 'last week' });
  assert.equal(bad.isError, true); assert.match(bad.content[0].text, /since must be a date/);
});
