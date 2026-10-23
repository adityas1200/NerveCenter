import test from 'node:test';
import assert from 'node:assert/strict';
import { createBackend } from '../src/bootstrap.mjs';
import { createApiServer } from '../src/api/server.mjs';
import { approvalStats } from '../src/api/task-routes.mjs';

test('SPEC-platform-11 FR-5/FR-6: tasks and inbox page after filtering and keep full-scope counts', async () => {
  const backend = await createBackend();
  await backend.projectStore.create({ id: 'other', name: 'Other' }, { id: 'test' });
  const at = index => `2026-10-11T10:00:0${index}.000Z`;
  for (const [index, status, title] of [[1, 'done', 'Old report'], [2, 'running', 'Live report'], [3, 'waiting', 'Approval'], [4, 'done', 'New report']]) {
    await backend.taskStore.createTask({ id: `T-page-${index}`, projectId: 'pilot', type: 'adhoc', status, title, summary: '', createdAt: at(index), updatedAt: at(index) });
  }
  await backend.taskStore.createTask({ id: 'T-other', projectId: 'other', type: 'adhoc', status: 'waiting', title: 'Private', createdAt: at(5), updatedAt: at(5) });
  const first = await backend.taskStore.createInboxItem({ projectId: 'pilot', taskId: 'T-page-1', kind: 'notification', title: 'Old update', createdAt: at(1) });
  const latest = await backend.taskStore.createInboxItem({ projectId: 'pilot', taskId: 'T-page-1', kind: 'notification', title: 'New update', createdAt: at(2) });
  await backend.taskStore.createInboxItem({ projectId: 'pilot', taskId: 'T-page-2', kind: 'approval', title: 'Approve change', createdAt: at(3) });
  await backend.taskStore.createInboxItem({ projectId: 'pilot', taskId: 'T-page-3', kind: 'question', title: 'Choose', createdAt: at(4) });
  await backend.taskStore.createInboxItem({ projectId: 'other', taskId: 'T-other', kind: 'approval', title: 'Other approval', createdAt: at(5) });

  const server = createApiServer(backend);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, route) => {
    const response = await fetch(`${base}${route}`, { method, headers: { 'x-nervecenter-project': 'pilot', 'x-user-id': 'mitesh.shinde@zs.com', 'x-user-name': 'Admin' } });
    return { status: response.status, body: await response.json() };
  };
  try {
    const page1 = await call('GET', '/api/tasks?offset=0&limit=2');
    assert.equal(page1.status, 200);
    assert.deepEqual(page1.body.items.map(item => item.id), ['T-page-3', 'T-page-2']);
    assert.equal(page1.body.total, 4);
    assert.equal(page1.body.active, 1);
    assert.equal(page1.body.waiting, 1);
    const page2 = await call('GET', '/api/tasks?offset=2&limit=2');
    assert.deepEqual(page2.body.items.map(item => item.id), ['T-page-4', 'T-page-1']);
    const searched = await call('GET', '/api/tasks?offset=0&limit=2&q=report');
    assert.equal(searched.body.total, 3);
    assert.deepEqual(searched.body.items.map(item => item.id), ['T-page-2', 'T-page-4']);
    assert.equal((await call('GET', '/api/tasks?offset=-1&limit=2')).status, 400);

    const inbox = await call('GET', '/api/inbox?view=all&offset=0&limit=2');
    assert.equal(inbox.status, 200);
    assert.equal(inbox.body.total, 3, 'older notification from the same task is collapsed');
    assert.equal(inbox.body.pending, 2);
    assert.equal(inbox.body.approvals, 1);
    assert.equal(inbox.body.unread, 2);
    assert.equal(inbox.body.items.length, 2);
    const later = await call('GET', '/api/inbox?view=all&offset=2&limit=2');
    assert.deepEqual(later.body.items.map(item => item.id), [latest.id]);
    assert.ok(!later.body.items.some(item => item.id === first.id));
    const action = await call('GET', '/api/inbox?view=needs_action&offset=0&limit=10');
    assert.equal(action.body.total, 2);
    const read = await call('POST', '/api/inbox/read-all');
    assert.deepEqual(read.body, { updated: 2 });
    assert.equal((await call('GET', '/api/inbox?view=all&offset=0&limit=10')).body.unread, 0);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('SPEC-platform-11 FR-6: approval statistics include later inbox pages', async () => {
  const now = new Date().toISOString();
  const items = Array.from({ length: 101 }, (_, index) => ({ id: `I-${index}`, kind: 'approval', status: 'approved', category: 'default_write', createdAt: now, decidedAt: now }));
  const scope = { all: true, projectIds: [] };
  const calls = [];
  const store = { pageInbox: async (_scope, { kind, limit, offset }) => {
    calls.push({ kind, limit, offset });
    return { items: items.slice(offset, offset + limit), total: items.length };
  } };
  const stats = await approvalStats(store, scope);
  assert.equal(stats.totals.approved, 101);
  assert.deepEqual(calls.map(call => call.offset), [0, 100]);
});
