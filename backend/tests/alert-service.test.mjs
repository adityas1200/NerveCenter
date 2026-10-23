import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { AlertService, autoPriority } from '../src/monitoring/alert-service.mjs';
import { FileMonitorStore } from '../src/monitoring/monitor-store.mjs';
import { effectiveAutomation } from '../src/monitoring/automation-settings.mjs';
import { systemScope } from '../src/projects/project-access.mjs';
import { tempDir, wait } from './helpers.mjs';

// SPEC-automations-01 FR-12..FR-18, FR-27..FR-31 and SPEC-tickets-07: what an alert does with its occurrences.

const tmp = await tempDir('nc-alert-service-');
const HOUR = 3_600_000;
let dirs = 0;

class FakeRuntime extends EventEmitter {
  constructor() {
    super(); this.tasks = new Map(); this.started = []; this.messages = []; this.events = [];
    this.store = {
      listTasks: async (scope, { type, status }) => [...this.tasks.values()].filter(task => task.projectId === scope.projectId && task.type === type && task.status === status),
      appendEvent: async (taskId, event) => { this.events.push({ taskId, ...event }); },
    };
  }
  async startTask(input) { if (this.fail) throw new Error(this.fail); const task = { id: `T-${this.tasks.size + 1}`, status: 'running', type: input.type, projectId: input.scope.projectId, context: input.context, title: input.title, permission: input.permission }; this.tasks.set(task.id, task); this.started.push({ ...input, id: task.id }); return task; }
  async getTask(id) { return this.tasks.get(id) || null; }
  async sendMessage(id, user, text, options) { this.messages.push({ id, text, options }); const task = this.tasks.get(id); task.status = 'running'; return { task }; }
  finish(id, status = 'done') { const task = this.tasks.get(id); Object.assign(task, { status, finishedAt: new Date().toISOString(), summary: 'Root cause: the upstream file was late.' }); this.emit('task', { ...task }); }
}

function fakeOps({ serviceNowReady = false } = {}) {
  const tickets = new Map(); let n = 0;
  const ops = {
    tickets, notes: [], resolved: [], created: [], sourceTickets: [], serviceNowReady,
    async systemNote(ticketId, text) { ops.notes.push({ ticketId, text }); },
    async systemResolve(ticketId, text) { ops.resolved.push({ ticketId, text }); },
    async runTicket() { return null; },
    async createTicket(input) { if (ops.failCreate) throw new Error(ops.failCreate); ops.created.push(input); const ticket = { ticketId: `NC-${++n}`, projectId: input.scope.projectId, pipelineId: input.pipelineId || null, runId: input.runId || null, title: input.title || null }; tickets.set(ticket.ticketId, ticket); return ticket; },
    async createSourceTicket(input) { ops.sourceTickets.push(input); const ticket = { ticketId: `NC-${++n}`, projectId: input.scope.projectId, externalReference: { system: input.system, number: `INC00${n}`, url: `https://sn.example/INC00${n}` } }; tickets.set(ticket.ticketId, ticket); return ticket; },
    async serviceNowStatus() { return { ready: ops.serviceNowReady }; },
    async jiraStatus() { return { ready: false }; },
    store: { async getTicket(id) { return tickets.get(id) || null; }, async updateTicket(id, patch) { const ticket = { ...tickets.get(id), ...patch }; tickets.set(id, ticket); return ticket; } },
  };
  return ops;
}

async function setup({ serviceNowReady = false, clock } = {}) {
  const store = new FileMonitorStore(path.join(tmp, `store-${dirs += 1}`)); await store.init();
  const runtime = new FakeRuntime(); const ops = fakeOps({ serviceNowReady });
  const ticketTasks = { workspace: {}, sources: async () => [], ensureTask: async (ticketId, options) => ({ task: await runtime.startTask({ type: 'ticket', title: options.title, prompt: options.prompt, permission: options.permission, scope: systemScope('pilot'), context: { ticketId, ...options.context } }) }) };
  const log = { error() {}, warn() {}, info() {} };
  const alerts = new AlertService({ store, operationsService: ops, ticketTasks, runtime, log, ...(clock ? { clock } : {}) });
  return { store, runtime, ops, alerts };
}

const config = automation => effectiveAutomation({ automation });
const subject = (id = '42') => ({ type: 'pipeline', id, platform: 'databricks', name: `job ${id}` });
const failure = (runId, { pipelineId = '42', at = new Date().toISOString() } = {}) => ({ trigger: 'pipelineFailed', alertKey: `pipeline:databricks:${pipelineId}:failed`, occurrenceKey: `failed:databricks:${pipelineId}:${runId}`, at, subject: subject(pipelineId), kind: 'failed', runId, summary: 'Task load failed' });
const lateSlot = (slot, pipelineId = '42') => ({ trigger: 'pipelineLate', alertKey: `pipeline:databricks:${pipelineId}:late`, occurrenceKey: `late:databricks:${pipelineId}:${slot}`, at: slot, subject: subject(pipelineId), kind: 'missed', slot });

test('FR-12, FR-13, FR-17: a failure opens an alert and starts one read-only alert task; the same occurrence never acts twice', async () => {
  const { store, runtime, alerts } = await setup();
  const settings = config({ pipelineFailed: { action: 'task' } });
  const [first] = await alerts.handle('pilot', [failure('r1')], settings);
  assert.equal(first.action, 'task');
  assert.equal(runtime.started.length, 1);
  assert.deepEqual([runtime.started[0].type, runtime.started[0].permission, runtime.started[0].context.alert.alertId], ['alert', 'read-only', first.alertId]);
  assert.match(runtime.started[0].prompt, /r1/);
  const alert = await store.getAlert('pilot', first.alertId);
  assert.deepEqual([alert.status, alert.investigation.status, alert.investigation.taskId, alert.occurrenceCount], ['open', 'started', 'T-1', 1]);
  assert.deepEqual(await alerts.handle('pilot', [failure('r1')], settings), []);
  assert.equal(runtime.started.length, 1);
});

test('FR-17: policy permission is used only when the trigger asks for it', async () => {
  const { runtime, alerts } = await setup();
  await alerts.handle('pilot', [failure('r1')], config({ pipelineFailed: { action: 'task', permission: 'policy' } }));
  assert.equal(runtime.started[0].permission, 'policy');
});

test('FR-28: more occurrences while open are appended and noted on the task, without another turn', async () => {
  const { store, runtime, alerts } = await setup();
  const settings = config({ pipelineFailed: { action: 'task' } });
  const [first] = await alerts.handle('pilot', [failure('r1')], settings);
  const [again] = await alerts.handle('pilot', [failure('r2'), failure('r3')], settings);
  assert.deepEqual([again.alertId, again.appended], [first.alertId, 2]);
  assert.equal(runtime.started.length, 1);
  assert.equal(runtime.messages.length, 0);
  assert.equal((await store.getAlert('pilot', first.alertId)).occurrenceCount, 3);
  assert.equal(runtime.events.filter(event => event.title === 'It happened again').length, 1);
});

test('FR-2: an action of off claims nothing, so switching it on later still sees the occurrence', async () => {
  const { alerts, runtime } = await setup();
  assert.deepEqual(await alerts.handle('pilot', [failure('r1')], config({ pipelineFailed: { action: 'off' } })), []);
  await alerts.handle('pilot', [failure('r1')], config({ pipelineFailed: { action: 'task' } }));
  assert.equal(runtime.started.length, 1);
});

test('D4, FR-32: ticket mode in NerveCenter opens the run ticket and starts no task', async () => {
  const { store, ops, runtime, alerts } = await setup();
  const [result] = await alerts.handle('pilot', [failure('r1')], config({ pipelineFailed: { action: 'ticket', ticket: { platform: 'nervecenter' } } }));
  assert.equal(runtime.started.length, 0);
  assert.deepEqual([ops.created.length, ops.created[0].pipelineId, ops.created[0].runId, ops.created[0].priority], [1, '42', 'r1', 'high']);
  assert.equal((await store.getAlert('pilot', result.alertId)).ticketId, 'NC-1');
});

test('FR-32: a late alert in NerveCenter gets a plain ticket linked to its pipeline', async () => {
  const { ops, alerts } = await setup();
  await alerts.handle('pilot', [lateSlot('2026-10-06T07:00:00.000Z')], config({ pipelineLate: { action: 'ticket', ticket: { platform: 'nervecenter' } } }));
  assert.deepEqual([ops.created[0].source, ops.created[0].type, ops.created[0].priority], ['nervecenter-alert', 'pipeline_late', 'medium']);
  assert.equal(ops.tickets.get('NC-1').pipelineId, '42');
});

test('SPEC-tickets-07 FR-1..FR-4: task and ticket in ServiceNow opens one incident, starts the task on it and reports start and finish', async () => {
  const { store, ops, runtime, alerts } = await setup({ serviceNowReady: true });
  const [result] = await alerts.handle('pilot', [failure('r1')], config({ pipelineFailed: { action: 'task_and_ticket', ticket: { platform: 'servicenow', assignmentGroup: 'Data Ops' } } }));
  assert.equal(ops.sourceTickets.length, 1);
  assert.deepEqual([ops.sourceTickets[0].system, ops.sourceTickets[0].correlationKey, ops.sourceTickets[0].assignmentGroup, ops.sourceTickets[0].priority], ['servicenow', result.alertId, 'Data Ops', 'high']);
  assert.equal(runtime.started[0].type, 'ticket');
  assert.equal(runtime.started[0].context.alert.alertId, result.alertId);
  assert.equal(ops.notes.filter(note => /started/i.test(note.text)).length, 1);
  runtime.finish('T-1');
  await wait(async () => (await store.getAlert('pilot', result.alertId)).lastReportedFinishAt, 2000, 'the finish note');
  runtime.emit('task', { ...runtime.tasks.get('T-1') });
  await new Promise(resolve => setTimeout(resolve, 50));
  const finished = ops.notes.filter(note => note.ticketId === 'NC-1' && /upstream file/.test(note.text));
  assert.equal(finished.length, 1);
  assert.equal((await store.getAlert('pilot', result.alertId)).investigation.status, 'finished');
});

test('SPEC-tickets-07 FR-5: a configured platform that is not connected falls back to NerveCenter and says so', async () => {
  const { store, ops, alerts } = await setup({ serviceNowReady: false });
  const [result] = await alerts.handle('pilot', [failure('r1')], config({ pipelineFailed: { action: 'ticket', ticket: { platform: 'servicenow' } } }));
  assert.equal(ops.sourceTickets.length, 0);
  assert.equal(ops.created.length, 1);
  assert.match((await store.getAlert('pilot', result.alertId)).ticketFallback, /ServiceNow is not connected/);
});

test('FR-34: a ticket that fails to open is recorded and retried by the drain', async () => {
  const { store, ops, alerts } = await setup();
  const settings = config({ pipelineFailed: { action: 'ticket', ticket: { platform: 'nervecenter' } } });
  ops.failCreate = 'The ticket store is down.';
  const [result] = await alerts.handle('pilot', [failure('r1')], settings);
  let alert = await store.getAlert('pilot', result.alertId);
  assert.deepEqual([alert.ticketId, alert.ticketError, alert.ticketAttempts], [null, 'The ticket store is down.', 1]);
  ops.failCreate = null;
  assert.equal((await alerts.drain('pilot', settings)).tickets, 1);
  alert = await store.getAlert('pilot', result.alertId);
  assert.deepEqual([alert.ticketId, alert.ticketError], ['NC-1', null]);
});

test('FR-14: over the concurrency limit an alert queues, starts when a slot frees, and drops after six hours', async () => {
  let offset = 0;
  const { store, runtime, alerts } = await setup({ clock: () => Date.now() + offset });
  const settings = config({ pipelineFailed: { action: 'task' }, limits: { maxConcurrent: 1, cooldownMinutes: 0 } });
  await alerts.handle('pilot', [failure('r1', { pipelineId: '1' })], settings);
  const [second] = await alerts.handle('pilot', [failure('r1', { pipelineId: '2' })], settings);
  assert.equal((await store.getAlert('pilot', second.alertId)).investigation.status, 'queued');
  assert.equal((await alerts.drain('pilot', settings)).started, 0);
  runtime.tasks.get('T-1').status = 'done';
  assert.equal((await alerts.drain('pilot', settings)).started, 1);
  assert.equal((await store.getAlert('pilot', second.alertId)).investigation.taskId, 'T-2');
  const [third] = await alerts.handle('pilot', [failure('r1', { pipelineId: '3' })], settings);
  assert.equal((await store.getAlert('pilot', third.alertId)).investigation.status, 'queued');
  offset = 7 * HOUR;
  assert.equal((await alerts.drain('pilot', settings)).dropped, 1);
  assert.match((await store.getAlert('pilot', third.alertId)).investigation.reason, /six hours/);
});

test('FR-15: the daily cap suppresses further investigations and says why', async () => {
  const { store, runtime, alerts } = await setup();
  const settings = config({ pipelineFailed: { action: 'task' }, limits: { maxPerDay: 1, cooldownMinutes: 0 } });
  await alerts.handle('pilot', [failure('r1', { pipelineId: '1' })], settings);
  const [second] = await alerts.handle('pilot', [failure('r1', { pipelineId: '2' })], settings);
  const alert = await store.getAlert('pilot', second.alertId);
  assert.equal(runtime.started.length, 1);
  assert.deepEqual([alert.status, alert.investigation.status], ['open', 'suppressed']);
  assert.match(alert.investigation.reason, /limit of 1 investigations today/);
});

test('FR-16: a second alert on an asset investigated within the cooldown is not investigated', async () => {
  const { store, runtime, alerts } = await setup();
  const settings = config({ pipelineFailed: { action: 'task' }, pipelineLate: { action: 'task' }, limits: { cooldownMinutes: 30 } });
  await alerts.handle('pilot', [failure('r1')], settings);
  const [late] = await alerts.handle('pilot', [lateSlot('2026-10-06T07:00:00.000Z')], settings);
  assert.equal(runtime.started.length, 1);
  assert.match((await store.getAlert('pilot', late.alertId)).investigation.reason, /less than 30 minutes ago/);
});

test('FR-29, FR-30, FR-31: recovery resolves the alert and notes the ticket; a repeat within the window reopens it and continues the task', async () => {
  const { store, ops, runtime, alerts } = await setup({ serviceNowReady: true });
  const settings = config({ pipelineFailed: { action: 'task_and_ticket', ticket: { platform: 'servicenow', onRecovery: 'resolve' } } });
  const [first] = await alerts.handle('pilot', [failure('r1')], settings);
  const resolved = await alerts.resolve(await store.getAlert('pilot', first.alertId), { runId: 'r2', at: new Date().toISOString() }, { config: settings });
  assert.equal(resolved.status, 'resolved');
  assert.equal(ops.resolved.length, 1);
  assert.ok(ops.notes.some(note => /r2/.test(note.text)));
  assert.ok(runtime.events.some(event => event.title === 'Recovered'));
  const [again] = await alerts.handle('pilot', [failure('r3')], settings);
  assert.equal(again.alertId, first.alertId);
  const reopened = await store.getAlert('pilot', first.alertId);
  assert.deepEqual([reopened.status, reopened.reopenedCount, reopened.occurrenceCount, reopened.ticketId], ['open', 1, 2, 'NC-1']);
  assert.equal(runtime.started.length, 1);
  assert.equal(runtime.messages.length, 1);
  assert.equal(ops.sourceTickets.length, 1);
});

test('FR-31: onRecovery none leaves the ticket alone; a repeat after the window opens a new alert', async () => {
  let offset = 0;
  const { store, ops, alerts } = await setup({ serviceNowReady: true, clock: () => Date.now() + offset });
  const settings = config({ pipelineFailed: { action: 'ticket', ticket: { platform: 'servicenow', onRecovery: 'none' } } });
  const [first] = await alerts.handle('pilot', [failure('r1')], settings);
  await alerts.resolve(await store.getAlert('pilot', first.alertId), { runId: 'r2' }, { config: settings });
  assert.deepEqual([ops.notes.length, ops.resolved.length], [0, 0]);
  offset = 25 * HOUR;
  const [second] = await alerts.handle('pilot', [failure('r3')], settings);
  assert.notEqual(second.alertId, first.alertId);
  assert.equal((await store.getAlert('pilot', second.alertId)).previousAlertId, first.alertId);
});

test('FR-12: a failure while handling releases the claim so the next pass tries again', async () => {
  const { store, runtime, alerts } = await setup();
  const settings = config({ pipelineFailed: { action: 'task' } });
  const createAlert = store.createAlert.bind(store);
  store.createAlert = async () => { throw new Error('disk full'); };
  const [failed] = await alerts.handle('pilot', [failure('r1')], settings);
  assert.equal(failed.error, 'disk full');
  store.createAlert = createAlert;
  await alerts.handle('pilot', [failure('r1')], settings);
  assert.equal(runtime.started.length, 1);
});

test('FR-13: a task that does not start leaves the alert open with the reason', async () => {
  const { store, runtime, alerts } = await setup();
  runtime.fail = 'The agent is not configured.';
  const [result] = await alerts.handle('pilot', [failure('r1')], config({ pipelineFailed: { action: 'task' } }));
  const alert = await store.getAlert('pilot', result.alertId);
  assert.deepEqual([alert.status, alert.investigation.status], ['open', 'failed']);
  assert.match(alert.investigation.reason, /The agent is not configured/);
});

test('FR-39: a person can resolve an open alert once', async () => {
  const { store, alerts } = await setup();
  const [result] = await alerts.handle('pilot', [failure('r1')], config({ pipelineFailed: { action: 'ticket', ticket: { platform: 'nervecenter' } } }));
  const resolved = await alerts.resolveById('pilot', result.alertId, { id: 'dev1', name: 'Dev One' });
  assert.deepEqual([resolved.status, resolved.resolvedBy.id], ['resolved', 'dev1']);
  await assert.rejects(alerts.resolveById('pilot', result.alertId, { id: 'dev1' }), error => error.statusCode === 409);
  await assert.rejects(alerts.resolveById('pilot', 'AL-NOPE', { id: 'dev1' }), error => error.statusCode === 404);
  assert.equal((await store.listAlerts(['pilot'], { status: 'open' })).total, 0);
});

test('FR-33: automatic priority follows the trigger and the worst DQ severity', () => {
  assert.equal(autoPriority({ trigger: 'pipelineFailed' }), 'high');
  assert.equal(autoPriority({ trigger: 'pipelineLate' }), 'medium');
  assert.equal(autoPriority({ trigger: 'dqFailed', occurrences: [{ severity: 'low' }, { severity: 'critical' }] }), 'critical');
  assert.equal(autoPriority({ trigger: 'dqFailed', occurrences: [] }), 'medium');
});
