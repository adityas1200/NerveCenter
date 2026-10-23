import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { FileOperationsStore } from '../src/app/operations-store.mjs';
import { OperationsService } from '../src/app/operations-service.mjs';
import { FileTaskStore } from '../src/tasks/task-store.mjs';
import { createAppTools } from '../src/tasks/nervecenter-tools.mjs';
import { toolPermission } from '../src/tasks/nervecenter-tool-categories.mjs';
import { RoutineScheduler } from '../src/routines/routine-scheduler.mjs';
import { TicketTaskService } from '../src/tasks/ticket-tasks.mjs';
import { ownerHold } from '../src/tasks/agent-access.mjs';
import { fakeMcpSdk, makeRuntime, tempDir, pilot } from './helpers.mjs';

const tmp = await tempDir('nc-viewer-guards-');
const viewer = { id: 'vera', name: 'Vera', role: 'viewer' };
const developer = { id: 'dana', name: 'Dana', role: 'developer' };

test('agent write tools need the same permission as the HTTP route; reads and system work are untouched', async () => {
  const ops = new FileOperationsStore(path.join(tmp, 'ops')); await ops.init();
  const operationsService = new OperationsService({ store: ops });
  const taskStore = new FileTaskStore(path.join(tmp, 'tasks')); await taskStore.init();
  const rbacStore = { overlay: user => (user.id === 'vera' ? { ...user, storedRole: 'viewer' } : user), list: () => [] };
  const tools = createAppTools({ operationsService, taskStore, rbacStore });
  const ticket = await operationsService.createTicket({ scope: pilot, title: 'Load failed', creator: developer, visibility: 'operators' });
  const asViewer = tools({ id: 'T-1', projectId: 'pilot', createdBy: viewer }, fakeMcpSdk);
  const attempt = await asViewer.tools.find(item => item.name === 'comment_on_ticket').handler({ ticketId: ticket.ticketId, text: 'hi' });
  assert.equal(attempt.isError, true); assert.match(attempt.content[0].text, /read-only/);
  assert.equal((await ops.getTicket(ticket.ticketId)).activity.some(event => event.type === 'ticket.comment'), false);
  assert.deepEqual((await asViewer.call('list_people', {})).people, [], 'reads still work for a viewer');
  for (const owner of [{ id: 'system' }, developer]) {
    const server = tools({ id: 'T-2', projectId: 'pilot', createdBy: owner }, fakeMcpSdk);
    assert.equal((await server.call('comment_on_ticket', { ticketId: ticket.ticketId, text: `from ${owner.id}` })).commented, true);
  }
  assert.equal(toolPermission('list_tickets'), null); assert.equal(toolPermission('create_board'), 'boards.manage'); assert.equal(toolPermission('some_new_write_tool'), 'tasks.manage');
});

test('work for a viewer or blocked owner is parked: no task starts and the reason is recorded', async () => {
  assert.equal(await ownerHold(developer), null); assert.equal(await ownerHold({ id: 'system' }), null); assert.match(await ownerHold(viewer), /viewer/);
  const { workspace, store, runtime } = await makeRuntime(tmp, { query: () => (async function* () {})() }, { name: 'hold' });
  const scheduler = new RoutineScheduler({ workspace, runtime, stateFile: path.join(tmp, 'routines-state.json') });
  await scheduler.save({ title: 'Daily review', objective: 'Review tickets and say what to start.', schedule: { kind: 'weekday', time: '09:00', timezone: 'UTC' }, permission: 'read-only' });
  await assert.rejects(scheduler.run('daily-review', { user: viewer }), { statusCode: 403 });
  assert.equal(await scheduler.run('daily-review', { user: viewer, trigger: 'schedule' }), null);
  assert.match((await scheduler.get('daily-review')).skippedReason, /viewer/);
  assert.equal((await store.listTasks(pilot, {})).length, 0, 'no task was started');

  const ops = new FileOperationsStore(path.join(tmp, 'ops-hold')); await ops.init();
  const ticket = await ops.createTicket({ projectId: 'pilot', ticketId: 'OPS-1', title: 'T', status: 'open', source: 'manual', creator: developer });
  const tickets = new TicketTaskService({ store: ops, runtime });
  await assert.rejects(tickets.ensureTask(ticket.ticketId, { user: viewer }), { statusCode: 403 });
  assert.equal((await store.listTasks(pilot, {})).length, 0);
});
