import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBackend } from '../src/bootstrap.mjs';
import { buildRoutes, createApiServer } from '../src/api/server.mjs';
import { authorizeRoute, isAdminOnlyRoute } from '../src/app/rbac.mjs';
import { assertRouteTable } from '../src/lib/router.mjs';
import { SCOPE_CLASSES, assertScope, systemScope, resolveScope } from '../src/projects/project-access.mjs';
import { FileTaskStore } from '../src/tasks/task-store.mjs';
import { FileOperationsStore } from '../src/app/operations-store.mjs';
import { tempDir } from './helpers.mjs';

// SPEC-projects-01 phase 1: scope resolution, the route table, list and by-id scoping, create stamping.
const ADMIN = 'mitesh.shinde@zs.com';
let backend; let server; let base;
const call = async (method, route, body, { user = 'alice', project = 'pilot' } = {}) => {
  const headers = { 'content-type': 'application/json', 'x-user-id': user, 'x-user-name': user };
  if (project) headers['x-nervecenter-project'] = project;
  const response = await fetch(`${base}${route}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, body: await response.json().catch(() => null) };
};

test.before(async () => {
  backend = await createBackend();
  for (const [project, name] of [['alpha', 'Alpha'], ['beta', 'Beta']]) await backend.projectStore.create({ id: project, name }, { id: 'test' });
  await backend.projectStore.addMember('alpha', 'alice', { id: 'test' });
  await backend.projectStore.addMember('beta', 'bob', { id: 'test' });
  await backend.projectStore.addMember('pilot', 'carol', { id: 'test' });
  server = createApiServer(backend);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => new Promise(resolve => server.close(resolve)));

test('FR-9: a non-admin with no header gets 403 Project required, and a non-member gets the same 403 as an unknown project', async () => {
  const none = await call('GET', '/api/tickets', undefined, { project: null });
  assert.equal(none.status, 403); assert.equal(none.body.error, 'Project required');
  const stranger = await call('GET', '/api/tickets', undefined, { project: 'beta' });
  const unknown = await call('GET', '/api/tickets', undefined, { project: 'nonesuch' });
  assert.equal(stranger.status, 403); assert.equal(unknown.status, 403);
  assert.deepEqual(stranger.body, unknown.body, 'a project you are not in looks exactly like one that does not exist');
  const malformed = await call('GET', '/api/tickets', undefined, { project: '../x' });
  assert.equal(malformed.status, 403);
  assert.equal((await call('GET', '/api/tickets', undefined, { user: 'nobody' })).body.error, 'No project', 'a user in no project');
});

test('FR-9: a member reads and writes their project; a non-admin cannot ask for All', async () => {
  assert.equal((await call('GET', '/api/tickets', undefined, { project: 'alpha' })).status, 200);
  assert.equal((await call('POST', '/api/tickets', { title: 'Mine' }, { project: 'alpha' })).status, 201);
  assert.equal((await call('GET', '/api/tickets', undefined, { project: '*' })).status, 403);
});

test('FR-9: an admin reads across all projects with *, cannot write there, and may write in one project', async () => {
  const all = await call('GET', '/api/tickets', undefined, { user: ADMIN, project: '*' });
  assert.equal(all.status, 200);
  const write = await call('POST', '/api/tickets', { title: 'Nope' }, { user: ADMIN, project: '*' });
  assert.equal(write.status, 403); assert.equal(write.body.error, 'Project required');
  assert.equal((await call('POST', '/api/tickets', { title: 'Admin in alpha' }, { user: ADMIN, project: 'alpha' })).status, 201);
});

test('FR-10: with the UI sending the header (phase 3), no header is 403 Project required for admins too', async () => {
  const created = await call('POST', '/api/tickets', { title: 'Admin without a header' }, { user: ADMIN, project: null });
  assert.equal(created.status, 403); assert.equal(created.body.error, 'Project required');
  assert.equal((await call('GET', '/api/tickets', undefined, { user: 'carol', project: null })).status, 403);
});

test('FR-9: a write to an archived project is 409 and reads still work', async () => {
  await backend.projectStore.create({ id: 'old', name: 'Old' }, { id: 'test' });
  await backend.projectStore.addMember('old', 'alice', { id: 'test' });
  assert.equal((await call('POST', '/api/tickets', { title: 'Before' }, { project: 'old' })).status, 201);
  await backend.projectStore.setArchived('old', true, { id: 'test' });
  assert.equal((await call('POST', '/api/tickets', { title: 'After' }, { project: 'old' })).status, 409);
  assert.equal((await call('GET', '/api/tickets', undefined, { project: 'old' })).status, 200);
});

test('FR-10: scope objects cannot be forged, and an undefined scope is an error, never "everything"', async () => {
  assert.throws(() => assertScope({ projectId: 'pilot', projectIds: ['pilot'], all: true }), /scope is required/);
  assert.throws(() => assertScope(undefined), /scope is required/);
  assert.throws(() => systemScope('*'), /no project/);
  assert.throws(() => systemScope(''), /no project/);
  assert.equal(Object.isFrozen(systemScope('pilot')), true);
  await assert.rejects(resolveScope({ store: backend.projectStore, user: { id: 'alice', role: 'developer' }, header: 'alpha', scopeClass: 'nonsense' }), /no scope class/);
  const dir = await tempDir('nc-scope-lists-');
  await assert.rejects(new FileOperationsStore(path.join(dir, 'ops')).listTickets(undefined), /scope is required/);
  await assert.rejects(new FileTaskStore(path.join(dir, 'tasks')).listTasks(undefined, {}), /scope is required/);
  await assert.rejects(new FileTaskStore(path.join(dir, 'tasks')).listInbox(undefined, {}), /scope is required/);
});

test('FR-11: every route declares a scope class, and a project route refuses a request with no project', async () => {
  const routes = buildRoutes(backend);
  const mutating = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
  assert.equal(routes.filter(entry => (entry.methods || []).some(method => mutating.has(method))).filter(entry => entry.needs === undefined).length, 0);
  assert.doesNotThrow(() => assertRouteTable(routes, SCOPE_CLASSES));
  assert.throws(() => assertRouteTable([...routes, { methods: ['GET'], pattern: '/api/oops', parts: ['api', 'oops'], handler: () => ({}) }], SCOPE_CLASSES), /does not declare a scope class/);
  assert.throws(() => assertRouteTable([{ methods: ['GET'], pattern: '/api/x', scope: 'mine' }], SCOPE_CLASSES), /does not declare/);
  assert.throws(() => assertRouteTable([{ methods: ['POST'], pattern: '/api/write', parts: ['api', 'write'], handler: () => ({}), scope: 'global' }], SCOPE_CLASSES), /does not declare a permission/);
  assert.throws(() => assertRouteTable([{ methods: null, pattern: '/api/any', parts: ['api', 'any'], handler: () => ({}), scope: 'global' }], SCOPE_CLASSES), /does not declare a permission/);
  assert.throws(() => authorizeRoute({ id: 'developer', role: 'developer' }, 'POST', 'admin'), /Administrator role is required/);
  assert.doesNotThrow(() => authorizeRoute({ id: 'admin', role: 'admin' }, 'POST', 'admin'));
  assert.throws(() => createApiServer({ ...backend, projectStore: undefined }), /needs the project store/);

  // Walk the table: each project route must stop a signed-in member who sends no project.
  const projectRoutes = routes.filter(entry => entry.scope === 'project' || entry.scope === 'project-read');
  assert.ok(projectRoutes.length > 30, 'the table has the project routes');
  for (const entry of projectRoutes) {
    const concrete = `/${entry.parts.map(part => (part[0] === ':' || part[0] === '$' ? 'x' : part === '*' ? 'x' : part)).join('/')}`;
    for (const method of entry.methods || ['GET']) {
      if (isAdminOnlyRoute(method, concrete)) continue; // stopped at the admin gate; an admin always resolves to some project
      const result = await call(method, concrete, method === 'GET' ? undefined : {}, { user: 'carol', project: null });
      assert.equal(result.status, 403, `${method} ${entry.pattern}`);
      // A write route that needs a role (or defaults to admin-only) the member lacks may stop at that gate first; it still never reaches its handler.
      if (result.body?.error !== 'Project required') assert.ok(entry.needs || method !== 'GET', `${method} ${entry.pattern} must fail on the project, not elsewhere: ${result.body?.error}`);
    }
  }
  // The same walk with a project the user is not in.
  for (const entry of projectRoutes) {
    const concrete = `/${entry.parts.map(part => (part[0] === ':' || part[0] === '$' || part === '*' ? 'x' : part)).join('/')}`;
    for (const method of entry.methods || ['GET']) if (!isAdminOnlyRoute(method, concrete)) assert.equal((await call(method, concrete, method === 'GET' ? undefined : {}, { user: 'carol', project: 'beta' })).status, 403, `${method} ${entry.pattern} (other project)`);
  }
});

test('FR-12: lists return only the caller\'s project, and the admin All view returns every project', async () => {
  await call('POST', '/api/tickets', { title: 'Alpha ticket' }, { user: 'alice', project: 'alpha' });
  await call('POST', '/api/tickets', { title: 'Beta ticket' }, { user: 'bob', project: 'beta' });
  const titles = async options => ((await call('GET', '/api/tickets', undefined, options)).body.items || []).map(ticket => ticket.title);
  const alpha = await titles({ user: 'alice', project: 'alpha' });
  assert.ok(alpha.includes('Alpha ticket')); assert.ok(!alpha.includes('Beta ticket'));
  const beta = await titles({ user: 'bob', project: 'beta' });
  assert.ok(beta.includes('Beta ticket')); assert.ok(!beta.includes('Alpha ticket'));
  const everything = await titles({ user: ADMIN, project: '*' });
  assert.ok(everything.includes('Alpha ticket') && everything.includes('Beta ticket'));
  for (const route of ['/api/overview', '/api/notifications', '/api/tasks', '/api/inbox']) {
    const mine = await call('GET', route, undefined, { user: 'alice', project: 'alpha' });
    assert.equal(mine.status, 200, route);
    assert.ok(!JSON.stringify(mine.body).includes('Beta ticket'), `${route} does not carry another project's ticket`);
  }
});

test('FR-13: by-id access to another project\'s ticket, task or inbox item is 403, with the same body as a missing one', async () => {
  const beta = await call('POST', '/api/tickets', { title: 'Beta secret' }, { user: 'bob', project: 'beta' });
  const id = beta.body.ticketId;
  const task = await backend.taskStore.createTask({ id: 'T-beta', type: 'agent', status: 'completed', projectId: 'beta', createdBy: { id: 'bob' }, createdAt: new Date().toISOString() });
  const item = await backend.taskStore.createInboxItem({ taskId: task.id, kind: 'notification', projectId: 'beta', title: 'Beta only' });
  const attempts = [
    ['GET', `/api/tickets/${id}`], ['PATCH', `/api/tickets/${id}`, { status: 'closed' }], ['POST', `/api/tickets/${id}/comments`, { body: 'x' }],
    ['GET', `/api/tasks/${task.id}`], ['POST', `/api/tasks/${task.id}/cancel`], ['DELETE', `/api/tasks/${task.id}`],
    ['POST', `/api/inbox/${item.id}/read`], ['POST', `/api/inbox/${item.id}/approve`],
  ];
  for (const [method, route, body] of attempts) {
    const result = await call(method, route, body, { user: 'alice', project: 'alpha' });
    assert.equal(result.status, 403, `${method} ${route}`);
    assert.equal(result.body.error, 'You do not have access to this project.');
  }
  const missing = await call('GET', '/api/tickets/OPS-99999', undefined, { user: 'alice', project: 'alpha' });
  assert.equal(missing.status, 403, 'a ticket that does not exist is the same 403');
  assert.equal((await call('GET', `/api/tickets/${id}`, undefined, { user: 'bob', project: 'beta' })).status, 200, 'the owner project still reads it');
  assert.equal((await call('GET', `/api/tickets/${id}`, undefined, { user: ADMIN, project: '*' })).status, 200, 'the admin All view reads it');
  assert.equal((await call('PATCH', `/api/tickets/${id}`, { status: 'closed' }, { user: ADMIN, project: '*' })).status, 403, 'but cannot write through All');
});

test('FR-15: a ticket is stamped from the scope, whatever the body says, and the project never moves', async () => {
  const created = await call('POST', '/api/tickets', { title: 'Stamped', projectId: 'beta', project_id: 'beta', scope: { all: true } }, { user: 'alice', project: 'alpha' });
  assert.equal(created.status, 201); assert.equal(created.body.projectId, 'alpha');
  const updated = await call('PATCH', `/api/tickets/${created.body.ticketId}`, { projectId: 'beta', priority: 'high' }, { user: 'alice', project: 'alpha' });
  assert.equal(updated.status, 200);
  assert.equal((await backend.operationsStore.getTicket(created.body.ticketId)).projectId, 'alpha');
});

test('FR-13: a task and an inbox item without a project cannot be stored', async () => {
  await assert.rejects(backend.taskStore.createTask({ id: 'T-none', type: 'agent', status: 'running' }), /needs a project/);
  await assert.rejects(backend.taskStore.createInboxItem({ taskId: 'T-none', kind: 'notification' }), /needs a project/);
});

test('FR-18: /api/me/projects lists what the caller may pick, and the admin sees every normal project with all: true', async () => {
  const mine = await call('GET', '/api/me/projects', undefined, { user: 'alice', project: null });
  assert.equal(mine.status, 200); assert.equal(mine.body.all, false);
  assert.deepEqual(mine.body.items.map(project => project.id), ['alpha', 'old']);
  const admin = await call('GET', '/api/me/projects', undefined, { user: ADMIN, project: null });
  assert.equal(admin.body.all, true);
  assert.ok(['pilot', 'alpha', 'beta'].every(id => admin.body.items.some(project => project.id === id)));
  assert.ok(!admin.body.items.some(project => project.id === 'unrouted'), 'Unrouted is not a project to pick');
});

test('FR-1..FR-6: projects are created and members managed (developers may create, SPEC-projects-02 FR-3); archive, never delete', async () => {
  // SPEC-projects-03 FR-1, FR-2: a new person is an app viewer and cannot create; an app developer can.
  assert.equal((await call('POST', '/api/projects', { id: 'gamma-dev', name: 'Gamma dev' }, { user: 'alice', project: null })).status, 403);
  assert.equal((await call('POST', '/api/admin/rbac/users/alice/role', { role: 'developer' }, { user: ADMIN, project: null })).status, 200);
  assert.equal((await call('POST', '/api/projects', { id: 'gamma-dev', name: 'Gamma dev' }, { user: 'alice', project: null })).status, 201);
  for (const user of ['dave', 'erin']) await call('GET', '/api/me', undefined, { user, project: null });
  const created = await call('POST', '/api/projects', { id: 'gamma', name: 'Gamma' }, { user: ADMIN, project: null });
  assert.equal(created.status, 201);
  assert.equal((await call('POST', '/api/projects', { id: 'gamma', name: 'Other' }, { user: ADMIN, project: null })).status, 409);
  assert.equal((await call('POST', '/api/projects', { id: 'unrouted', name: 'X' }, { user: ADMIN, project: null })).status, 409);
  assert.equal((await call('POST', '/api/projects', { id: 'Bad Id', name: 'X' }, { user: ADMIN, project: null })).status, 400);
  assert.equal((await call('PUT', '/api/projects/gamma/members', { userIds: ['dave', 'erin'] }, { user: ADMIN, project: null })).status, 200);
  assert.equal((await call('POST', '/api/projects/unrouted/members', { userId: 'dave' }, { user: ADMIN, project: null })).status, 409, 'Unrouted takes no members');
  const members = await call('GET', '/api/projects/gamma/members', undefined, { user: ADMIN, project: null });
  assert.deepEqual(members.body.items.map(member => member.userId).sort(), ['dave', 'erin']);
  assert.equal((await call('GET', '/api/projects/gamma/members', undefined, { user: 'alice', project: null })).status, 403);
  assert.equal((await call('DELETE', '/api/projects/gamma/members/erin', undefined, { user: ADMIN, project: null })).body.removed, true);
  assert.equal((await call('GET', '/api/tickets', undefined, { user: 'erin', project: 'gamma' })).status, 403, 'removing a member applies on the next request');
  assert.equal((await call('POST', '/api/projects/unrouted/archive', undefined, { user: ADMIN, project: null })).status, 409);
  assert.equal((await call('POST', '/api/projects/gamma/archive', undefined, { user: ADMIN, project: null })).status, 200);
  assert.equal((await call('DELETE', '/api/projects/gamma', undefined, { user: ADMIN, project: null })).status, 404, 'there is no hard delete');
  assert.equal((await call('GET', '/api/projects/gamma', undefined, { user: 'alice', project: null })).status, 403, 'a project you are not in');
});

test('FR-12: no code outside project-access and the project store reads the header or decides membership', async () => {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
  const offenders = [];
  const walk = async dir => {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) { await walk(file); continue; }
      if (!file.endsWith('.mjs')) continue;
      const rel = path.relative(root, file);
      if (['projects/project-access.mjs', 'projects/project-store.mjs', 'lib/http.mjs'].includes(rel)) continue;
      const text = await fs.readFile(file, 'utf8');
      if (/x-nervecenter-project|PROJECT_HEADER|memberProjectIds|projectIdsForUser/.test(text) && rel !== 'api/server.mjs' && rel !== 'projects/project-routes.mjs') offenders.push(rel);
    }
  };
  await walk(root);
  assert.deepEqual(offenders, []);
});

test('FR-14: a link to a row in another project of yours names that project; a non-member learns nothing', async () => {
  await backend.projectStore.addMember('alpha', 'dave', { id: 'test' });
  await backend.projectStore.addMember('beta', 'dave', { id: 'test' });
  const ticket = (await call('POST', '/api/tickets', { title: 'In beta' }, { user: 'bob', project: 'beta' })).body;
  const mine = await call('GET', `/api/tickets/${ticket.ticketId}`, undefined, { user: 'dave', project: 'alpha' });
  assert.equal(mine.status, 403); assert.equal(mine.body.projectId, 'beta');
  const stranger = await call('GET', `/api/tickets/${ticket.ticketId}`, undefined, { user: 'alice', project: 'alpha' });
  assert.equal(stranger.status, 403); assert.equal(stranger.body.projectId, undefined);
});
