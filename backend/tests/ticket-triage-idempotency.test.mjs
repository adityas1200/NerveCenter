import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { FileOperationsStore } from '../src/app/operations-store.mjs';
import { FileTaskStore, PostgresTaskStore } from '../src/tasks/task-store.mjs';
import { TicketTaskService } from '../src/tasks/ticket-tasks.mjs';
import { applyControlMigrations } from '../src/storage/migrations.mjs';
import { systemScope } from '../src/projects/project-access.mjs';
import { tempDir, makeRuntime, fakeSdk, wait } from './helpers.mjs';

const keyFor = (projectId, ticketId) => `auto-triage:${projectId}:${ticketId}`;
const keyedTask = (id, projectId, ticketId, status = 'queued') => ({
  id, projectId, type: 'ticket', title: `Ticket ${ticketId}`, status, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  context: { ticket: { ticketId, autoTriageKey: keyFor(projectId, ticketId) } },
  ...(status === 'queued' ? { pendingStart: { prompt: 'Triage', user: null } } : {}),
});

test('ADR-0017: file Task store atomically arbitrates one automatic triage key per project and ticket', async () => {
  const root = await tempDir('nc-ticket-triage-file-');
  const store = new FileTaskStore(root); await store.init();
  const [first, second] = await Promise.all([
    store.createTicketTriageTask(keyedTask('T-AUTO-1', 'alpha', 'INC-1'), keyFor('alpha', 'INC-1')),
    store.createTicketTriageTask(keyedTask('T-AUTO-2', 'alpha', 'INC-1'), keyFor('alpha', 'INC-1')),
  ]);
  assert.equal([first, second].filter(result => result.created).length, 1);
  assert.equal(first.task.id, second.task.id);
  assert.equal((await store.findTicketTriageTask('alpha', keyFor('alpha', 'INC-1'))).id, first.task.id);
  assert.equal(await store.findTicketTriageTask('beta', keyFor('alpha', 'INC-1')), null);
});

const databaseUrl = process.env.NC_TEST_DATABASE_URL;
test('ADR-0017: Postgres unique index arbitrates concurrent automatic triage creation', { skip: !databaseUrl && 'NC_TEST_DATABASE_URL is not set' }, async () => {
  const schema = `nc_ticket_triage_${randomBytes(4).toString('hex')}`;
  const { default: pg } = await import('pg');
  const admin = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 4, options: `-c search_path=${schema}` });
  try {
    await applyControlMigrations(pool);
    const store = new PostgresTaskStore(pool); await store.init();
    await pool.query("INSERT INTO ops_projects (id, name, slug) VALUES ('ticket-test', 'Ticket test', 'ticket-test')");
    const results = await Promise.all([
      store.createTicketTriageTask(keyedTask('T-AUTO-PG-1', 'ticket-test', 'INC-1'), keyFor('ticket-test', 'INC-1')),
      store.createTicketTriageTask(keyedTask('T-AUTO-PG-2', 'ticket-test', 'INC-1'), keyFor('ticket-test', 'INC-1')),
    ]);
    assert.equal(results.filter(result => result.created).length, 1);
    assert.equal(results[0].task.id, results[1].task.id);
    assert.equal((await store.findTicketTriageTask('ticket-test', keyFor('ticket-test', 'INC-1'))).id, results[0].task.id);
  } finally {
    await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => {});
    await pool.end();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => {});
    await admin.end();
  }
});

test('ADR-0017: triage pass relinks a persisted Task after a create-before-ticket-link crash and restart', async () => {
  const root = await tempDir('nc-ticket-triage-relink-');
  const { runtime, store, workspace } = await makeRuntime(root, fakeSdk());
  const tickets = new FileOperationsStore(path.join(root, 'tickets')); await tickets.init();
  const ticket = await tickets.createTicket({ projectId: 'pilot', ticketId: 'INC-1', source: 'servicenow', title: 'Imported incident', status: 'open', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  await workspace.setSection('ticketing', { sources: [{ platform: 'servicenow', auto_create_tasks: true }] });
  const key = keyFor('pilot', ticket.ticketId);
  await store.createTicketTriageTask(keyedTask('T-RELINK', 'pilot', ticket.ticketId), key);
  await runtime.recoverAfterRestart();
  const service = new TicketTaskService({ store: tickets, runtime, workspace, operationsService: {}, pollSeconds: 0 });
  const result = await service.triagePass({ force: true });
  assert.deepEqual(result.linked, [{ ticketId: 'INC-1', taskId: 'T-RELINK' }]);
  assert.equal((await tickets.getTicket('INC-1')).taskId, 'T-RELINK');
  assert.equal((await store.listTasks(systemScope('pilot'), { type: 'ticket', archived: 'all' })).length, 1);
  await wait(async () => (await store.getTask('T-RELINK')).status === 'done');
  await wait(async () => (await tickets.getTicket('INC-1')).taskStatus === 'done');
  assert.deepEqual(await service.triagePass({ force: true }).then(next => next.created), []);
});

test('ADR-0017: cancelled automatic triage is linked but never restarted', async () => {
  const root = await tempDir('nc-ticket-triage-cancelled-');
  const { runtime, store, workspace } = await makeRuntime(root, fakeSdk());
  const tickets = new FileOperationsStore(path.join(root, 'tickets')); await tickets.init();
  const ticket = await tickets.createTicket({ projectId: 'pilot', ticketId: 'INC-2', source: 'jira', title: 'Cancelled incident', status: 'open', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  await workspace.setSection('ticketing', { sources: [{ platform: 'jira', auto_create_tasks: true }] });
  const key = keyFor('pilot', ticket.ticketId);
  await store.createTicketTriageTask(keyedTask('T-CANCELLED', 'pilot', ticket.ticketId, 'cancelled'), key);
  const service = new TicketTaskService({ store: tickets, runtime, workspace, operationsService: {}, pollSeconds: 0 });
  const result = await service.triagePass({ force: true });
  assert.equal(result.created.length, 0);
  assert.equal((await tickets.getTicket('INC-2')).taskId, 'T-CANCELLED');
  assert.equal((await store.listTasks(systemScope('pilot'), { type: 'ticket', archived: 'all' })).length, 1);
  assert.equal((await store.getTask('T-CANCELLED')).status, 'cancelled');
});

test('ADR-0017: paginated triage reaches older unlinked candidates and normalizes provider names', async () => {
  const root = await tempDir('nc-ticket-triage-pages-');
  const { runtime, store, workspace } = await makeRuntime(root, fakeSdk());
  const tickets = new FileOperationsStore(path.join(root, 'tickets')); await tickets.init();
  const recent = new Date().toISOString();
  for (let index = 0; index < 250; index += 1) {
    await tickets.createTicket({ projectId: 'pilot', ticketId: `INC-${String(index).padStart(3, '0')}`, source: 'ServiceNow', title: 'Already assigned', status: 'open', taskId: `T-EXISTING-${index}`, createdAt: recent, updatedAt: recent });
  }
  await tickets.createTicket({ projectId: 'pilot', ticketId: 'INC-OLDER', source: 'ServiceNow', title: 'Older candidate', status: 'open', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' });
  await workspace.setSection('ticketing', { sources: [{ platform: 'servicenow', auto_create_tasks: true, max_concurrent_tasks: 1 }] });
  const service = new TicketTaskService({ store: tickets, runtime, workspace, operationsService: {}, pollSeconds: 0 });
  const result = await service.triagePass({ force: true });
  assert.deepEqual(result.created.map(item => item.ticketId), ['INC-OLDER']);
  assert.ok((await tickets.getTicket('INC-OLDER')).taskId);
  await wait(async () => (await store.getTask((await tickets.getTicket('INC-OLDER')).taskId)).status === 'done');
  await wait(async () => (await tickets.getTicket('INC-OLDER')).taskStatus === 'done');
});

test('ADR-0017: a person can still explicitly investigate without an automatic triage key', async () => {
  const root = await tempDir('nc-ticket-triage-manual-');
  const { runtime, store, workspace } = await makeRuntime(root, fakeSdk());
  const tickets = new FileOperationsStore(path.join(root, 'tickets')); await tickets.init();
  await tickets.createTicket({ projectId: 'pilot', ticketId: 'INC-3', source: 'jira', title: 'Manual incident', status: 'open', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  const service = new TicketTaskService({ store: tickets, runtime, workspace, operationsService: {}, pollSeconds: 0 });
  const result = await service.ensureTask('INC-3', { permission: 'ask' });
  assert.equal(result.created, true);
  assert.equal(result.task.context.ticket.ticketId, 'INC-3');
  assert.equal(result.task.context.ticket.autoTriageKey, undefined);
  assert.equal(await store.findTicketTriageTask('pilot', keyFor('pilot', 'INC-3')), null);
  await wait(async () => (await store.getTask(result.task.id)).status === 'done');
  await wait(async () => (await tickets.getTicket('INC-3')).taskStatus === 'done');
});
