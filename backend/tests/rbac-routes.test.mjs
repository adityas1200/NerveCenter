import test from 'node:test';
import assert from 'node:assert/strict';
import { createBackend } from '../src/bootstrap.mjs';
import { createApiServer } from '../src/api/server.mjs';
import { ANY_USER, authorizeRoute, hasPermission, permissionsFor, projectPermissionsFor, ROLES } from '../src/app/rbac.mjs';
import { dispatch, route } from '../src/lib/router.mjs';

const ADMIN = 'mitesh.shinde@zs.com';
let server; let base; let inboxId;
const call = async (method, path, body, user = 'dev-dana') => {
  const response = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', 'x-nervecenter-project': 'pilot', 'x-user-id': user, 'x-user-name': user }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
};

test.before(async () => {
  const backend = await createBackend();
  // SPEC-projects-03: what someone may do in PILOT comes from their role there, so vera is a viewer in the project.
  await backend.projectStore.addMember('pilot', 'dev-dana', { id: 'test' }, { role: 'developer' });
  await backend.projectStore.addMember('pilot', 'view-vera', { id: 'test' }, { role: 'viewer' });
  inboxId = (await backend.taskStore.createInboxItem({ kind: 'notification', projectId: 'pilot', title: 'Probe' })).id;
  server = createApiServer(backend);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  await call('GET', '/api/me', undefined, 'view-vera');
  assert.equal((await call('POST', '/api/admin/rbac/users/view-vera/role', { role: 'viewer' }, ADMIN)).status, 200);
  assert.equal((await call('GET', '/api/me', undefined, 'view-vera')).body.role, 'viewer');
});
test.after(() => new Promise(resolve => server.close(resolve)));

const viewerWrites = [
  ['POST', '/api/tickets', { title: 'x' }], ['PATCH', '/api/tickets/OPS-1', { status: 'closed' }], ['POST', '/api/tickets/OPS-1/comments', { body: 'x' }], ['POST', '/api/tickets/OPS-1/investigate', {}],
  ['POST', '/api/tasks', { prompt: 'x' }], ['POST', '/api/tasks/T-1/messages', { text: 'x' }], ['PATCH', '/api/tasks/T-1', { permission: 'allow' }], ['POST', '/api/tasks/T-1/cancel'], ['DELETE', '/api/tasks/T-1'],
  ['POST', '/api/inbox/I-1/approve'], ['POST', '/api/inbox/I-1/deny'], ['POST', '/api/inbox/I-1/answer', { answers: {} }],
  ['POST', '/api/routines', { name: 'r' }], ['PATCH', '/api/routines/r', { enabled: false }], ['POST', '/api/routines/r/run'], ['POST', '/api/routines/r/pause'], ['DELETE', '/api/routines/r'],
  ['POST', '/api/boards', { title: 'x' }], ['PUT', '/api/boards/b-1', { title: 'y' }], ['POST', '/api/boards/b-1/publish'], ['DELETE', '/api/boards/b-1'], ['POST', '/api/boards/preview', { widget: {} }],
];

test('viewers are read-only on the server: every write route answers 403 before its handler', async () => {
  for (const [method, path, body] of viewerWrites) {
    const result = await call(method, path, body, 'view-vera');
    assert.equal(result.status, 403, `${method} ${path}`);
    assert.match(result.body.error, /read-only/);
  }
});

test('viewers still read, and use the read-only POSTs (board data, marking an inbox item read)', async () => {
  for (const path of ['/api/tasks', '/api/inbox', '/api/tickets', '/api/boards', '/api/routines', '/api/overview']) assert.equal((await call('GET', path, undefined, 'view-vera')).status, 200, path);
  assert.notEqual((await call('POST', '/api/boards/b-1/data', { filters: {} }, 'view-vera')).status, 403);
  assert.equal((await call('POST', `/api/inbox/${inboxId}/read`, undefined, 'view-vera')).status, 200);
});

test('developers keep their abilities', async () => {
  const ticket = await call('POST', '/api/tickets', { title: 'Backfill', category: 'data', priority: 'low' });
  assert.equal(ticket.status, 201);
  assert.equal((await call('POST', `/api/tickets/${ticket.body.ticketId}/comments`, { body: 'on it' })).status, 201);
  assert.equal((await call('PATCH', `/api/tickets/${ticket.body.ticketId}`, { priority: 'high' })).status, 200);
  assert.equal((await call('POST', '/api/boards', { title: 'Dana board', widgets: [{ type: 'text', title: 'Note', markdown: 'x' }] })).status, 201);
  for (const [method, path, body] of [['POST', '/api/tasks', { prompt: '' }], ['POST', `/api/inbox/${inboxId}/approve`], ['POST', '/api/routines', { name: '' }], ['POST', '/api/boards/preview', { widget: {} }]]) {
    assert.notEqual((await call(method, path, body)).status, 403, `${method} ${path}`);
  }
  assert.equal((await call('GET', '/api/connectors')).status, 200);
});

test('connectors list, secret status, connection test and data-quality analysis are closed to viewers', async () => {
  const closed = [['GET', '/api/connectors'], ['GET', '/api/secrets/connectors%2Fgit%2FTOKEN/status'], ['POST', '/api/connections/databricks/test'], ['POST', '/api/data-quality/analyze', {}], ['POST', '/api/boards/preview', { widget: {} }]];
  for (const [method, path, body] of closed) assert.equal((await call(method, path, body, 'view-vera')).status, 403, `viewer ${method} ${path}`);
  assert.equal((await call('GET', '/api/connectors', undefined, ADMIN)).status, 200);
  // Secrets, connection tests and warehouse analysis are admin-only: a developer is refused, an admin is not.
  for (const [method, path, body] of closed.slice(1, 4)) {
    assert.equal((await call(method, path, body)).status, 403, `developer ${method} ${path}`);
    assert.notEqual((await call(method, path, body, ADMIN)).status, 403, `admin ${method} ${path}`);
  }
});

test('route guard: a declared permission is checked, an undeclared write is admin-only, reads and ANY_USER are open', async () => {
  const [viewer, developer] = [ROLES.VIEWER, ROLES.DEVELOPER].map(role => ({ id: role, role, permissions: projectPermissionsFor(role) }));
  const admin = { id: 'admin', role: ROLES.ADMIN, permissions: permissionsFor(ROLES.ADMIN) };
  assert.equal(hasPermission(developer, 'approvals.decide'), true); assert.equal(hasPermission(viewer, 'tickets.manage'), false); assert.equal(hasPermission(developer, 'users.manage'), false);
  assert.throws(() => authorizeRoute(viewer, 'POST', 'tasks.manage'), { statusCode: 403 });
  authorizeRoute(developer, 'POST', 'tasks.manage');
  assert.throws(() => authorizeRoute(developer, 'DELETE', undefined), { statusCode: 403 });
  authorizeRoute(admin, 'DELETE', undefined); authorizeRoute(viewer, 'GET', undefined); authorizeRoute(viewer, 'POST', ANY_USER);
  const ran = [];
  const routes = [route('POST', '/api/new-thing', () => { ran.push('thing'); return {}; })];
  await assert.rejects(dispatch(routes, { m: 'POST', p: ['api', 'new-thing'], authorize: (needs, method) => authorizeRoute(developer, method, needs) }), { statusCode: 403 });
  assert.deepEqual(ran, []);
});
