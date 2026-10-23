import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { z } from 'zod';
import { FileTaskStore } from '../src/tasks/task-store.mjs';
import { FileOperationsStore } from '../src/app/operations-store.mjs';
import { OperationsService } from '../src/app/operations-service.mjs';
import { createAppTools } from '../src/tasks/nervecenter-tools.mjs';
import { TOOL_CATEGORIES } from '../src/tasks/nervecenter-tool-categories.mjs';
import { classifyTool } from '../src/tasks/permission-policy.mjs';
import { COMPONENTS, COMPONENT_TOOLS, catalogPromptLines } from '../src/tasks/ui-catalog.mjs';
import { fakeMcpSdk, makeRuntime, sdkInit, sdkResult, tempDir, wait, pilot } from './helpers.mjs';

// SPEC-tasks-10: Sonic's component catalog.
const tmp = await tempDir('nc-ui-catalog-');
const user = { id: 'mitesh.shinde', name: 'Mitesh Shinde' };

async function serverWith(name, { tickets = [], runs = null, creator = user, rbacStore = null } = {}) {
  const ops = new FileOperationsStore(path.join(tmp, `ops-${name}`)); await ops.init();
  for (const ticket of tickets) await ops.createTicket(ticket);
  const operationsService = new OperationsService({ store: ops });
  if (runs) operationsService.pipelineRuns = async (pipelineId, { scope }) => (scope.projectId === 'pilot' ? runs[pipelineId] || [] : []);
  const server = createAppTools({ operationsService, taskStore: new FileTaskStore(path.join(tmp, `store-${name}`)), rbacStore })({ id: 'T-1', projectId: 'pilot', createdBy: creator }, fakeMcpSdk);
  const raw = async (tool, args) => server.tools.find(item => item.name === tool).handler(args);
  return { server, raw };
}
const parse = (tool, args) => z.object(COMPONENT_TOOLS[tool].shape).safeParse(args);

test('FR-12, FR-13, FR-15: every catalog component is offered as a read tool that needs no approval, even read-only', async () => {
  const { server } = await serverWith('offered');
  const offered = new Set(server.tools.map(tool => tool.name));
  for (const tool of ['show_chart', 'show_facts', 'show_status_grid', 'show_progress', 'show_flow', 'show_set_diff', 'show_checklist', 'show_records', 'show_email', 'show_document', 'show_notes', 'show_actions', 'set_outcome', 'explain_action', 'request_input', 'show_view', 'show_ticket', 'show_pipeline_runs', 'show_table', 'show_lineage', 'propose_plan']) {
    assert.ok(COMPONENT_TOOLS[tool], `${tool} is in the catalog`);
    assert.ok(offered.has(tool), `${tool} is offered`);
    assert.equal(TOOL_CATEGORIES[tool], 'read', `${tool} is a read`);
    assert.equal(classifyTool(`mcp__nervecenter__${tool}`, {}, { permission: 'read-only' }).verdict, 'allow', `${tool} runs read-only`);
  }
  const kinds = COMPONENTS.map(component => component.kind);
  assert.equal(new Set(kinds).size, kinds.length, 'kinds are unique');
});

test('FR-13: components refuse inputs they cannot draw, with a message Sonic can act on', async () => {
  const { server, raw } = await serverWith('validate');
  assert.deepEqual(await server.call('show_chart', { title: 'Runs per day', type: 'column', labels: ['Mon', 'Tue'], series: [{ name: 'Failed', values: [1, 0] }] }), { shown: true, title: 'Runs per day', series: 1, points: 2 });
  const short = await raw('show_chart', { title: 'Runs', labels: ['Mon', 'Tue'], series: [{ name: 'Failed', values: [1] }] });
  assert.equal(short.isError, true); assert.match(short.content[0].text, /one value per label/);
  const wide = await raw('show_status_grid', { title: 'Runs', columns: ['20 Sep'], rows: [{ label: 'Job 731', cells: [{ state: 'ok' }, { state: 'failed' }] }] });
  assert.match(wide.content[0].text, /2 cells for 1 columns/);
  assert.deepEqual(await server.call('show_set_diff', { title: 'Columns', leftLabel: 'Contract v7', rightLabel: 'File', left: ['sale_date', 'npi'], right: ['sale_date', 'npi', 'plan_type'] }), { shown: true, title: 'Columns', added: 1, missing: 0 });
  assert.match((await raw('show_actions', { items: [{ label: 'Rerun', kind: 'ask' }] })).content[0].text, /needs a prompt/);
  assert.match((await raw('show_actions', { items: [{ label: 'Open', kind: 'open', href: 'javascript:alert(1)' }] })).content[0].text, /needs an href/);
  assert.match((await raw('show_actions', { items: [{ label: 'Open', kind: 'open', href: '//attacker.example/path' }] })).content[0].text, /needs an href/);
  assert.equal((await raw('show_actions', { items: [] })).isError, true, 'an empty action list is refused');
  assert.deepEqual(await server.call('show_actions', { items: [{ label: 'Open the ticket', kind: 'open', href: '/tickets/OPS-1' }], questions: ['Why run-now?'] }), { shown: true, actions: 1, questions: 1 });
  assert.match((await raw('request_input', { title: 'Which tables?', fields: [{ label: 'Tables', type: 'multiselect', options: ['gold.sales'] }] })).content[0].text, /needs 2 to 8 options/);
  assert.match((await raw('request_input', { title: 'Dates', fields: [{ label: 'From', type: 'date' }, { label: 'from', type: 'date' }] })).content[0].text, /different label/);
  assert.equal((await raw('show_document', { title: 'Brief', path: '../T-2/brief.docx' })).isError, true, 'a document outside the task folder is refused');
  assert.deepEqual(await server.call('show_document', { title: 'Brief', path: 'tasks/T-1/brief.docx' }), { shown: true, title: 'Brief', path: 'brief.docx' });
  assert.equal(parse('set_outcome', { state: 'recovered', headline: 'The load is recovered.' }).success, true);
  assert.equal(parse('set_outcome', { state: 'great', headline: 'x' }).success, false, 'states come from the list');
});

test('FR-13: show_view holds blocks of the view kinds only, each checked like its own tool', async () => {
  const { server, raw } = await serverWith('view');
  const blocks = [
    { kind: 'metrics', items: [{ label: 'Failed runs', value: 1, tone: 'bad' }] },
    { kind: 'chart', width: 'half', title: 'Durations', labels: ['20 Sep', '21 Sep'], series: [{ name: 'Minutes', values: [21, 20] }] },
    { kind: 'status_grid', width: 'half', title: 'Last runs', columns: ['20 Sep', '21 Sep'], rows: [{ label: 'Job 731', cells: [{ state: 'ok' }, { state: 'failed' }] }] },
    { kind: 'checklist', title: 'Verification', items: [{ label: 'Newest run', result: 'pass' }, { label: 'DQ checks', result: 'open' }] },
  ];
  assert.equal(parse('show_view', { title: 'Veltrix this morning', blocks }).success, true);
  assert.deepEqual(await server.call('show_view', { title: 'Veltrix this morning', blocks }), { shown: true, title: 'Veltrix this morning', blocks: ['metrics', 'chart', 'status_grid', 'checklist'] });
  assert.equal(parse('show_view', { title: 'x', blocks: [{ kind: 'email', to: ['a@b.c'], subject: 's', body: 'b' }] }).success, false, 'an email is not a view block');
  assert.equal(parse('show_view', { title: 'x', blocks: [{ kind: 'sparkles' }] }).success, false, 'unknown kinds are refused');
  const bad = await raw('show_view', { title: 'x', blocks: [{ kind: 'chart', title: 'c', labels: ['a', 'b'], series: [{ name: 's', values: [1] }] }] });
  assert.match(bad.content[0].text, /Block 1 \(chart\): Series "s" has 1 values/);
});

test('FR-14: show_ticket and show_pipeline_runs read the data themselves, in the task\'s project only', async () => {
  const at = new Date().toISOString();
  const tickets = [
    { projectId: 'pilot', ticketId: 'OPS-1', title: 'Veltrix daily load failed', status: 'open', priority: 'high', source: 'servicenow', externalReference: { system: 'servicenow', sysId: '1', number: 'INC0031201' }, activity: [], createdAt: at, updatedAt: at, visibility: 'operators' },
    { projectId: 'pilot', ticketId: 'OPS-2', title: 'Private incident title', status: 'open', priority: 'high', source: 'manual', creator: { id: 'another-user', name: 'Another User' }, activity: [], createdAt: at, updatedAt: at, visibility: 'private' },
    { projectId: 'other', ticketId: 'OPS-9', title: 'Another project', status: 'open', priority: 'low', source: 'manual', activity: [], createdAt: at, updatedAt: at, visibility: 'operators' },
  ];
  const runs = { 731: [{ runId: '910000002', status: 'success', startTime: at, endTime: at, durationMs: 25000 }, { runId: '900001222', status: 'failed', startTime: at, endTime: at, durationMs: 19000, failureSummary: 'schema mismatch: unexpected column plan_type' }] };
  const { server, raw } = await serverWith('bound', { tickets, runs, creator: { id: 'task-reader', name: 'Task Reader' }, rbacStore: { overlay: reader => ({ ...reader, storedRole: 'viewer' }) } });
  const shown = await server.call('show_ticket', { ticketId: 'INC0031201', note: 'The incident' });
  assert.equal(shown.ticket.ticketId, 'OPS-1'); assert.equal(shown.ticket.title, 'Veltrix daily load failed'); assert.equal(shown.ticket.link, '/tickets/OPS-1');
  assert.match((await raw('show_ticket', { ticketId: 'OPS-9' })).content[0].text, /No ticket OPS-9 in this project/);
  const privateResult = await raw('show_ticket', { ticketId: 'OPS-2' });
  assert.equal(privateResult.isError, true);
  assert.match(privateResult.content[0].text, /No ticket OPS-2 in this project/);
  assert.doesNotMatch(privateResult.content[0].text, /Private incident title|access to this ticket/);
  const strip = await server.call('show_pipeline_runs', { pipelineId: '731', limit: 5 });
  assert.deepEqual(strip.runs.map(run => [run.runId, run.status]), [['910000002', 'success'], ['900001222', 'failed']]);
  assert.match(strip.runs[1].failure, /plan_type/);
  assert.match((await raw('show_pipeline_runs', { pipelineId: '999' })).content[0].text, /No runs of pipeline 999 in this project/);
});

test('FR-22: the prompt lists every component with a use and tells Sonic when to use the steering ones', async () => {
  const lines = catalogPromptLines();
  for (const component of COMPONENTS.filter(item => item.use)) assert.ok(lines.some(line => line.startsWith(`- ${component.tool}: `)), `${component.tool} is listed`);
  const calls = [];
  const sdk = { createSdkMcpServer: () => ({ name: 'nervecenter' }), tool: fakeMcpSdk.tool, query: ({ options }) => { calls.push(options); return (async function* () { yield sdkInit('s'); yield sdkResult('s', 'Done.'); })(); } };
  const { runtime, store } = await makeRuntime(tmp, sdk, { name: 'prompt', appTools: () => ({ name: 'nervecenter' }) });
  const task = await runtime.startTask({ scope: pilot, prompt: 'hello', user, notify: false });
  await wait(async () => (await store.getTask(task.id)).status === 'done');
  const append = calls[0].systemPrompt.append;
  assert.match(append, /Answer with components, not prose/);
  assert.match(append, /- show_status_grid: /);
  assert.match(append, /call explain_action, then make the call/);
  assert.match(append, /Call set_outcome whenever the task's state changes/);
  assert.match(append, /End a turn that leaves work for the person with show_actions/);
  assert.match(append, /Open every final reply with one plain sentence that is the answer/);
  assert.match(append, /When you drew components, the reply is the headline sentence plus at most two short paragraphs/);
  assert.match(append, /start with one show_view: a metrics block/);
  assert.match(append, /Whatever skill you run, its own or a project's, pick components from the shape of the content/);
});
