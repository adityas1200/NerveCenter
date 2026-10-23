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
import { createAppTools } from '../src/tasks/nervecenter-tools.mjs';
import { appStatus, resolvedWithAgent } from '../src/app/ticket-view.mjs';
import { fakeMcpSdk, makeRuntime, sdkInit, sdkResult, tempDir, wait, pilot } from './helpers.mjs';

const tmp = await tempDir('nc-agent-tools-');
const user = { id: 'mitesh.shinde', name: 'Mitesh Shinde' };
const JOB_RUN = { job_id: 731 };

// An SDK stand-in whose agent wants to run job 731 (a production change) and then reports.
function jobSdk() {
  const calls = [];
  return {
    calls,
    query({ prompt, options }) {
      calls.push({ prompt, options });
      return (async function* () {
        yield sdkInit('sess-9');
        const decision = await options.canUseTool('mcp__databricks__run_job_now', JOB_RUN, { signal: options.abortController.signal });
        yield sdkResult('sess-9', decision.behavior === 'allow' ? 'Job 731 rerun started.' : 'Not run.', { total_cost_usd: 0.01, duration_ms: 10 });
      })();
    },
  };
}

test('ADR 0013: a detached approval needs an explicit continuation before the step runs', async () => {
  const workspace = await createWorkspace({ dir: path.join(tmp, 'ws-restart') });
  const store = new FileTaskStore(path.join(tmp, 'store-restart')); await store.init();
  const before = new TaskRuntime({ store, workspace, sdkLoader: async () => jobSdk() });
  const task = await before.startTask({ scope: pilot, prompt: 'Rerun 731', user, notify: false });
  await wait(async () => (await store.getTask(task.id)).status === 'waiting', 10000, 'approval pending');
  const [approval] = await store.listInbox(pilot, { status: 'pending', kind: 'approval' });
  assert.equal(approval.category, 'production_changes'); assert.equal(approval.categoryLabel, 'Production change');

  // NerveCenter restarts: the old process is gone, the approval stays open.
  const sdk = jobSdk(); const after = new TaskRuntime({ store, workspace, sdkLoader: async () => sdk });
  const recovered = await after.recoverAfterRestart();
  assert.deepEqual(recovered.waiting, [task.id]);
  assert.equal((await store.getInboxItem(approval.id)).status, 'pending');

  await after.decideApproval(approval.id, 'approved', user);
  assert.equal((await store.getTask(task.id)).status, 'failed');
  assert.equal(sdk.calls.length, 0, 'deciding an interrupted approval must not replay the write');
  await after.sendMessage(task.id, user, 'I reviewed the task. Continue with the approved job rerun.');
  await wait(async () => (await store.getTask(task.id)).status === 'done', 10000, 'explicit continuation done');
  const done = await after.getTask(task.id, { includeEvents: true });
  assert.equal(done.summary, 'Job 731 rerun started.'); assert.deepEqual(done.grants, []); assert.equal(done.changes, 1);
  assert.ok(done.events.some(event => /^Approved earlier: databricks · run job now 731/.test(event.title)));
  assert.equal((await store.listInbox(pilot, { kind: 'approval' })).length, 1, 'no second approval was asked for');
});

test('the workspace policy lets routine changes run without an approval', async () => {
  const { workspace, store, runtime } = await makeRuntime(tmp, jobSdk(), { name: 'policy' });
  await workspace.setSection('policy', { default_write: 'allow', production_changes: 'allow' });
  const task = await runtime.startTask({ scope: pilot, prompt: 'Rerun 731', user, notify: false });
  assert.equal(task.permission, 'policy');
  await wait(async () => (await store.getTask(task.id)).status === 'done', 10000, 'run done');
  assert.equal((await store.listInbox(pilot, { kind: 'approval' })).length, 0);
  assert.equal((await store.getTask(task.id)).changes, 1);
});

// createSdkMcpServer and tool, reduced to what the tests need: call a tool by name.

test('the agent reads and acts on NerveCenter tickets through its own tools', async () => {
  const ops = new FileOperationsStore(path.join(tmp, 'ops-tools')); await ops.init();
  const taskStore = new FileTaskStore(path.join(tmp, 'store-tools')); await taskStore.init();
  // A ServiceNow stand-in: NerveCenter writes ticket changes through to the source.
  const snWrites = []; const serviceNow = { updateIncident: async ({ sysId, fields }) => { snWrites.push({ sysId, fields }); return null; } };
  const operationsService = new OperationsService({ store: ops, serviceNow });
  const base = { status: 'open', priority: 'high', activity: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), visibility: 'operators' };
  await ops.createTicket({ projectId: 'pilot', ...base, ticketId: 'OPS-1', title: 'Duplicate HCPs in the territory report', category: 'Data Platform', tags: ['dq', 'hcp'], source: 'servicenow', sourceKey: 'servicenow:1', externalReference: { system: 'servicenow', sysId: '1', number: 'INC0031204' }, assignee: { type: 'user', id: 'mitesh.shinde@helixa.example', name: 'Mitesh Shinde' }, taskId: 'T-1', taskStatus: 'done', agentSummary: 'gold.dim_hcp is clean.' });
  await ops.createTicket({ projectId: 'pilot', ...base, ticketId: 'OPS-2', title: 'Access request for Karan', category: 'Access', tags: ['access'], source: 'servicenow', sourceKey: 'servicenow:2', externalReference: { system: 'servicenow', sysId: '2', number: 'INC0031203' }, assignee: null, priority: 'medium' });
  await ops.createTicket({ projectId: 'pilot', ...base, ticketId: 'OPS-3', title: 'Old pipeline failure', status: 'resolved', tags: ['pipeline'], source: 'manual', taskId: 'T-2', taskStatus: 'done', taskChanges: 2 });

  const server = createAppTools({ operationsService, taskStore, agentName: 'Dobby' })({ id: 'T-9', projectId: 'pilot', createdBy: user }, fakeMcpSdk);
  assert.equal(server.name, 'nervecenter');

  const dq = await server.call('list_tickets', { text: 'dq' });
  assert.deepEqual(dq.tickets.map(ticket => ticket.ticketId), ['OPS-1']);
  assert.equal(dq.tickets[0].status, 'In progress'); assert.equal(dq.tickets[0].agentFinding, 'gold.dim_hcp is clean.');
  assert.deepEqual((await server.call('list_tickets', { assignee: 'me' })).tickets.map(ticket => ticket.ticketId), ['OPS-1'], 'email user part matches the signed-in id');
  assert.deepEqual((await server.call('list_tickets', { assignee: 'unassigned' })).tickets.map(ticket => ticket.ticketId), ['OPS-2']);
  assert.equal((await server.call('list_tickets', { status: 'closed' })).tickets[0].resolvedWithAgent, true);

  const one = await server.call('get_ticket', { ticketId: 'INC0031203' });
  assert.equal(one.ticketId, 'OPS-2'); assert.equal(one.status, 'Open');

  await server.call('comment_on_ticket', { ticketId: 'OPS-2', text: 'Checked the approval record.' });
  await server.call('assign_ticket', { ticketId: 'OPS-2', assignee: 'me' });
  const assigned = await ops.getTicket('OPS-2');
  assert.equal(assigned.assignee.name, 'Mitesh Shinde'); assert.ok(assigned.activity.some(event => event.type === 'ticket.comment'));
  const refused = await server.tools.find(item => item.name === 'set_ticket_status').handler({ ticketId: 'OPS-2', status: 'resolved' });
  assert.equal(refused.isError, true, 'resolving needs a resolution');
  const resolved = await server.call('set_ticket_status', { ticketId: 'OPS-2', status: 'resolved', resolution: 'Access granted and verified.' });
  assert.equal(resolved.status, 'Closed');
  // Every change went to ServiceNow first: a work note, the assignee, then Resolved with close notes.
  assert.deepEqual(snWrites.map(write => write.sysId), ['2', '2', '2']);
  assert.match(snWrites[0].fields.work_notes, /Checked the approval record\.\n\n\(Dobby for Mitesh Shinde via NerveCenter\)/);
  assert.equal(snWrites[1].fields.assigned_to, 'Mitesh Shinde');
  assert.deepEqual({ state: snWrites[2].fields.state, close_notes: snWrites[2].fields.close_notes }, { state: 'Resolved', close_notes: 'Access granted and verified.' });
  // When the source refuses, nothing changes here and the person is told why.
  serviceNow.updateIncident = async () => { throw new Error('HTTP 403: ACL'); };
  await assert.rejects(operationsService.commentTicket('OPS-1', user, { body: 'x', scope: pilot }), /Not saved\. ServiceNow did not accept the change: HTTP 403/);
  assert.equal((await ops.getTicket('OPS-1')).activity.filter(event => event.type === 'ticket.comment').length, 0);
});

test('a NerveCenter ticket filed in ServiceNow is linked, so the import updates it instead of duplicating it', async () => {
  const ops = new FileOperationsStore(path.join(tmp, 'ops-link')); await ops.init();
  const operationsService = new OperationsService({ store: ops });
  const server = createAppTools({ operationsService, taskStore: new FileTaskStore(path.join(tmp, 'store-link')), agentName: 'Dobby' })({ id: 'T-9', projectId: 'pilot', createdBy: user }, fakeMcpSdk);
  const local = await operationsService.createTicket({ scope: pilot, title: 'Veltrix load failed again', creator: user, visibility: 'operators' });
  const linked = await server.call('link_ticket_to_source', { ticketId: local.ticketId, system: 'servicenow', sysId: 'sn-99', number: 'INC0099' });
  assert.equal(linked.linkedTo, 'INC0099');
  // The poller imports the new incident: same ticket, now carrying the source's fields and its history.
  const imported = await ops.createTicket({ projectId: 'pilot', ticketId: 'OPS-NEW', source: 'servicenow', sourceKey: 'servicenow:sn-99', externalReference: { system: 'servicenow', sysId: 'sn-99', number: 'INC0099' }, title: 'Veltrix load failed again', status: 'open', priority: 'high', assignee: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  assert.equal(imported.ticketId, local.ticketId);
  assert.equal((await ops.listTickets(pilot)).length, 1);
  assert.ok(imported.activity.some(event => event.title === 'Filed in ServiceNow as INC0099'));
  await assert.rejects(operationsService.linkTicketToSource(local.ticketId, { system: 'servicenow', sysId: 'sn-100', number: 'INC0100' }, user, pilot), /already linked/);
});

test('app statuses: four states, whatever the source says', () => {
  assert.equal(appStatus({ status: 'open' }), 'open');
  assert.equal(appStatus({ status: 'open', assignee: { name: 'Rahul' } }), 'in_progress');
  assert.equal(appStatus({ status: 'awaiting_approval' }), 'in_progress');
  assert.equal(appStatus({ status: 'open', taskStatus: 'running' }), 'in_progress');
  assert.equal(appStatus({ status: 'in_progress', taskStatus: 'waiting' }), 'waiting_on_you');
  assert.equal(appStatus({ status: 'resolved', taskStatus: 'waiting' }), 'closed');
  assert.equal(resolvedWithAgent({ status: 'closed', taskId: 'T-1', taskChanges: 1 }), true);
  assert.equal(resolvedWithAgent({ status: 'closed', taskId: 'T-1', taskChanges: 0 }), false);
});
