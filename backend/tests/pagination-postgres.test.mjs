import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

const url = process.env.NC_TEST_DATABASE_URL;
const schema = `nc_page_${randomBytes(4).toString('hex')}`;

test('SPEC-platform-11 FR-5/FR-6: Postgres pages tickets, tasks and inbox after scope and filters', { skip: !url && 'NC_TEST_DATABASE_URL is not set' }, async () => {
  Object.assign(process.env, { OPS_METADATA_STORE: 'postgres', DATABASE_URL: url, NC_DB_SCHEMA: schema, OPS_PG_SSL: 'disable' });
  const { createBackend } = await import('../src/bootstrap.mjs');
  const { getPgPool } = await import('../src/storage/postgres.mjs');
  const { systemScope } = await import('../src/projects/project-access.mjs');
  const pool = await getPgPool();
  try {
    const backend = await createBackend();
    const projectId = 'pagination-test';
    await backend.projectStore.create({ id: projectId, name: 'Pagination test' });
    const scope = systemScope(projectId);
    const at = '2026-10-11T10:00:00.000Z';
    const access = { all: false, userId: 'alice', ownerProjects: [], approverIds: ['alice'], routing: {} };
    for (const [id, visibility, priority, creator] of [
      ['OPS-P1', 'project', 'low', { id: 'other' }],
      ['OPS-P2', 'private', 'critical', { id: 'other' }],
      ['OPS-P3', 'private', 'high', { id: 'alice' }],
    ]) await backend.operationsService.store.createTicket({ ticketId: id, projectId, title: id, status: 'open', visibility, priority, creator, createdAt: at, updatedAt: at });
    const tickets = await backend.operationsService.store.listTicketPage(scope, { access, scope: 'active', sort: 'priority', dir: 'asc', limit: 1, offset: 1 });
    assert.equal(tickets.total, 2);
    assert.deepEqual(tickets.items.map(item => item.ticketId), ['OPS-P1']);
    assert.equal(tickets.meta.open, 2);
    assert.deepEqual(tickets.meta.options.priority, ['high', 'low']);
    const searchedTickets = await backend.operationsService.store.listTicketPage(scope, { access, scope: 'active', sort: 'priority', dir: 'asc', limit: 10, offset: 0, q: 'p3' });
    assert.deepEqual(searchedTickets.items.map(item => item.ticketId), ['OPS-P3']);

    for (const [id, status] of [['T-P1', 'done'], ['T-P2', 'waiting'], ['T-P3', 'running']]) await backend.taskStore.createTask({ id, projectId, type: 'adhoc', status, title: id, createdAt: at, updatedAt: at });
    const tasks = await backend.taskStore.pageTasks(scope, { limit: 1, offset: 1 });
    assert.equal(tasks.total, 3);
    assert.deepEqual(tasks.items.map(item => item.id), ['T-P3']);
    assert.equal(tasks.waiting, 1);
    const searchedTasks = await backend.taskStore.pageTasks(scope, { q: 'P2', limit: 10, offset: 0 });
    assert.deepEqual(searchedTasks.items.map(item => item.id), ['T-P2']);

    await backend.taskStore.createInboxItem({ projectId, taskId: 'T-P1', kind: 'notification', title: 'Older', createdAt: at });
    await backend.taskStore.createInboxItem({ projectId, taskId: 'T-P1', kind: 'notification', title: 'Newer', createdAt: '2026-10-11T10:00:01.000Z' });
    await backend.taskStore.createInboxItem({ projectId, taskId: 'T-P2', kind: 'approval', title: 'Review', createdAt: at });
    const inbox = await backend.taskStore.pageInbox(scope, { view: 'all', limit: 1, offset: 1 });
    assert.equal(inbox.total, 2);
    assert.equal(inbox.items[0].kind, 'approval');
    assert.equal(inbox.pending, 1);
    const action = await backend.taskStore.pageInbox(scope, { view: 'needs_action', limit: 10, offset: 0 });
    assert.equal(action.total, 1);
  } finally {
    await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => {});
    await pool.end();
  }
});
