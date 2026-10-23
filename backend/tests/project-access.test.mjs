import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createBackend } from '../src/bootstrap.mjs';
import { createApiServer } from '../src/api/server.mjs';
import { createAppTools } from '../src/tasks/nervecenter-tools.mjs';
import { FileTaskStore } from '../src/tasks/task-store.mjs';
import { up as migrate006 } from '../migrations/006-project-access.mjs';
import { exists, readJson, writeJson } from '../src/lib/fs.mjs';
import { DATA_DIR } from '../src/config.mjs';
import os from 'node:os';
import { fakeMcpSdk } from './helpers.mjs';

const scratch = () => fs.mkdtemp(path.join(os.tmpdir(), 'nc-project-access-'));

// SPEC-projects-03: owner, developer and viewer in every project, open projects, creating a project with its setup,
// what the home page and the admin console read, and Sonic acting with the starter's project role.
const ADMIN = 'mitesh.shinde@zs.com';
let backend; let server; let base;
const call = async (method, route, body, user, project) => {
  const headers = { 'content-type': 'application/json', 'x-user-id': user, 'x-user-name': user };
  if (project) headers['x-nervecenter-project'] = project;
  const response = await fetch(`${base}${route}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, body: await response.json().catch(() => null) };
};

test.before(async () => {
  backend = await createBackend();
  server = createApiServer(backend);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  for (const user of ['olga', 'devi', 'vince', 'newbie', 'walt']) await call('GET', '/api/me', undefined, user);
  for (const user of ['olga', 'devi']) await call('POST', `/api/admin/rbac/users/${user}/role`, { role: 'developer' }, ADMIN);
  await call('POST', '/api/connections', { provider: 'jira', id: 'jira-open', name: 'Jira', library: true, projectAdminsMayGrant: true, config: { site: 'https://example.atlassian.net', email: 'a@b.c' }, credentials: { apiToken: 't' } }, ADMIN, 'pilot');
  await call('POST', '/api/connections', { provider: 'jira', id: 'jira-closed', name: 'Jira closed', library: true, projectAdminsMayGrant: false, config: { site: 'https://other.atlassian.net', email: 'a@b.c' }, credentials: { apiToken: 't' } }, ADMIN, 'pilot');
});
test.after(() => new Promise(resolve => server.close(resolve)));

test('FR-1: someone signing in for the first time is an app viewer, sees no projects and cannot create one', async () => {
  const me = await call('GET', '/api/me', undefined, 'newbie');
  assert.equal(me.body.role, 'viewer'); assert.deepEqual(me.body.permissions, []);
  assert.deepEqual((await call('GET', '/api/me/projects', undefined, 'newbie')).body.items, []);
  assert.equal((await call('POST', '/api/projects', { id: 'nope', name: 'Nope' }, 'newbie')).status, 403);
  assert.equal((await call('GET', '/api/tickets', undefined, 'newbie', 'pilot')).body.error, 'No project');
});

test('FR-18, FR-5: a project is created with its settings, grants and people in one call; the creator owns it', async () => {
  const created = await call('POST', '/api/projects', {
    id: 'market-mix', name: 'Market Mix Modelling', description: 'MMM', color: 'sky',
    grants: [{ resourceType: 'connection', resourceId: 'jira-open', scope: { projectKeys: ['MMM'] } }],
    members: [{ userId: 'devi', role: 'developer' }, { userId: 'vince', role: 'viewer' }],
    settings: { model: 'opus', autonomy: 'read' },
  }, 'olga');
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.color, 'sky'); assert.equal(created.body.open, false);
  assert.deepEqual((await backend.projectStore.listMembers('market-mix')).map(member => [member.userId, member.role]).sort(), [['devi', 'developer'], ['olga', 'owner'], ['vince', 'viewer']]);
  assert.deepEqual((await backend.projectStore.listGrants('market-mix', 'connection')).map(grant => [grant.resourceId, grant.scope.projectKeys]), [['jira-open', ['MMM']]]);
  const settings = await call('GET', '/api/settings', undefined, 'olga', 'market-mix');
  assert.equal(settings.body.operations.agent.model, 'opus');
  assert.equal(settings.body.operations.policy.default_write, 'deny'); assert.equal(settings.body.operations.policy.knowledge_drafts, 'allow');
  const mine = (await call('GET', '/api/me/projects', undefined, 'devi')).body.items;
  assert.deepEqual(mine.map(item => [item.id, item.role, item.color]), [['market-mix', 'developer', 'sky']]);
});

test('FR-18: a create request is checked whole first, so a bad part creates nothing', async () => {
  const before = (await backend.projectStore.list()).length;
  const cases = [
    [{ id: 'bad-1', name: 'Bad one', grants: [{ resourceType: 'connection', resourceId: 'jira-open', scope: { projectKeys: ['MMM'] } }] }, 409, 'overlaps another project'],
    [{ id: 'bad-2', name: 'Bad two', grants: [{ resourceType: 'connection', resourceId: 'jira-closed' }] }, 403, 'not shareable'],
    [{ id: 'bad-3', name: 'Bad three', members: [{ userId: 'never-signed-in', role: 'viewer' }] }, 400, 'unknown person'],
    [{ id: 'bad-4', name: 'Bad four', members: [{ userId: 'devi', role: 'admin' }] }, 400, 'unknown role'],
    [{ id: 'bad-5', name: 'Bad five', open: true }, 403, 'only admins open'],
    [{ id: 'bad-6', name: 'Bad six', copyFrom: 'pilot' }, 403, 'copy from a project you do not own'],
    [{ id: 'bad-7', name: 'Bad seven', grants: [{ resourceType: 'knowledge', resourceId: 'no-such-base' }] }, 404, 'unknown base'],
    [{ id: 'bad-8', name: 'Bad eight', settings: { autonomy: 'yolo' } }, 400, 'unknown autonomy'],
    [{ id: 'bad-9', name: 'Bad nine', color: 'mauve' }, 400, 'unknown colour'],
  ];
  for (const [body, status, why] of cases) assert.equal((await call('POST', '/api/projects', body, 'olga')).status, status, why);
  assert.equal((await backend.projectStore.list()).length, before, 'nothing was created');
  assert.ok(!(await fs.stat(path.join(process.env.OPS_WORKSPACE_DIR, 'projects', 'bad-1')).catch(() => null)), 'and no workspace folder either');
});

test('FR-18: an owner copies settings from their project; an app admin may open a project and name its owners', async () => {
  const copy = await call('POST', '/api/projects', { id: 'mmm-copy', name: 'MMM copy', copyFrom: 'market-mix' }, 'olga');
  assert.equal(copy.status, 201);
  const settings = (await call('GET', '/api/settings', undefined, 'olga', 'mmm-copy')).body.operations;
  assert.equal(settings.agent.model, 'opus'); assert.equal(settings.policy.default_write, 'deny');
  assert.deepEqual(await backend.projectStore.listGrants('mmm-copy'), [], 'grants are not copied');
  const opened = await call('POST', '/api/projects', { id: 'commons', name: 'Commons', open: true, ownerUserIds: ['walt'] }, ADMIN);
  assert.equal(opened.status, 201); assert.equal(opened.body.open, true);
  assert.deepEqual((await backend.projectStore.listMembers('commons')).map(member => [member.userId, member.role]), [['walt', 'owner']]);
  assert.equal((await call('POST', '/api/projects', { id: 'own-pick', name: 'Own pick', ownerUserIds: ['devi'] }, 'olga')).status, 403, 'only an admin names other owners');
});

test('FR-11: only an app admin opens a project to everyone', async () => {
  assert.equal((await call('PATCH', '/api/projects/market-mix', { open: true }, 'olga', 'market-mix')).status, 403);
  assert.equal((await call('PATCH', '/api/projects/market-mix', { open: true }, ADMIN)).status, 200);
});

test('FR-12, FR-13, FR-15: a visitor reads an open project, cannot write, and does not see members, settings, tasks or private tickets', async () => {
  const shared = (await call('POST', '/api/tickets', { title: 'Shared MMM ticket' }, 'devi', 'market-mix')).body;
  const secret = (await call('POST', '/api/tickets', { title: 'Private MMM ticket', visibility: 'private' }, 'devi', 'market-mix')).body;
  const home = (await call('GET', '/api/me/projects', undefined, 'newbie')).body.items;
  assert.ok(home.some(item => item.id === 'market-mix' && item.role === 'open'), 'open projects are listed for everyone');
  assert.ok(home.some(item => item.id === 'commons' && item.role === 'open'));
  const list = await call('GET', '/api/tickets', undefined, 'newbie', 'market-mix');
  assert.equal(list.status, 200);
  assert.ok(list.body.items.some(item => item.ticketId === shared.ticketId)); assert.ok(!list.body.items.some(item => item.ticketId === secret.ticketId));
  assert.equal((await call('GET', `/api/tickets/${secret.ticketId}`, undefined, 'newbie', 'market-mix')).status, 403);
  assert.equal((await call('POST', '/api/tickets', { title: 'Visitor' }, 'newbie', 'market-mix')).status, 403);
  for (const route of ['/api/settings', '/api/tasks', '/api/inbox', '/api/routines', '/api/connections']) assert.equal((await call('GET', route, undefined, 'newbie', 'market-mix')).status, 403, route);
  assert.equal((await call('GET', '/api/projects/market-mix/members', undefined, 'newbie')).status, 403);
  const access = (await call('GET', '/api/me/access', undefined, 'newbie', 'market-mix')).body;
  assert.equal(access.projectRole, 'open'); assert.equal(access.access, 'open'); assert.deepEqual(access.permissions, []);
  // A closed project stays closed, and an archived open project is no longer open.
  assert.equal((await call('GET', '/api/tickets', undefined, 'newbie', 'mmm-copy')).status, 403);
  await call('POST', '/api/projects/commons/archive', undefined, ADMIN);
  assert.ok(!(await call('GET', '/api/me/projects', undefined, 'newbie')).body.items.some(item => item.id === 'commons'));
});

test('FR-15, FR-20: an admin sees every project, and the People tab lists each person with their projects', async () => {
  const items = (await call('GET', '/api/me/projects', undefined, ADMIN)).body.items;
  assert.ok(items.some(item => item.id === 'market-mix' && item.role === 'admin'));
  assert.ok(!items.some(item => item.id === 'unrouted'));
  const people = (await call('GET', '/api/admin/rbac/users', undefined, ADMIN)).body.items;
  assert.deepEqual(people.find(item => item.id === 'devi').projects, [{ projectId: 'market-mix', role: 'developer' }]);
  assert.equal((await call('GET', '/api/admin/rbac/users', undefined, 'olga')).status, 403);
  const found = (await call('GET', '/api/people?q=dev', undefined, 'olga')).body.items;
  assert.ok(found.some(item => item.id === 'devi'));
});

test('FR-22: Sonic acts with the starter\'s role in the task\'s project, re-read before every call', async () => {
  const tmp = await scratch();
  const tools = createAppTools({ operationsService: backend.operationsService, taskStore: new FileTaskStore(path.join(tmp, 'store')), rbacStore: backend.rbacStore, projects: backend.projectStore })({ id: 'T-1', projectId: 'market-mix', createdBy: { id: 'vince', name: 'vince' } }, fakeMcpSdk);
  const create = () => tools.tools.find(item => item.name === 'create_ticket').handler({ title: 'From Sonic' });
  assert.equal((await create()).isError, true, 'a viewer\'s task cannot write');
  await backend.projectStore.setMemberRole('market-mix', 'vince', 'developer', { id: 'olga', role: 'developer' });
  const made = await create();
  assert.notEqual(made.isError, true, made.content?.[0]?.text);
  await backend.projectStore.setMemberRole('market-mix', 'vince', 'viewer', { id: 'olga', role: 'developer' });
  assert.equal((await create()).isError, true, 'the change applies on the next call');
});

test('FR-23: migration 006 maps admin to owner and member to developer, or viewer for app viewers, and is safe to run twice', async () => {
  const runtimeDir = await scratch();
  const usersFile = path.join(runtimeDir, 'users.json');
  await fs.writeFile(usersFile, JSON.stringify({ users: [{ id: 'Vee', role: 'viewer' }, { id: 'dee', role: 'developer' }] }));
  await fs.writeFile(path.join(runtimeDir, 'projects.json'), JSON.stringify({ projects: { pilot: { id: 'pilot', name: 'PILOT', kind: 'normal' } }, members: [{ projectId: 'pilot', userId: 'boss', role: 'admin' }, { projectId: 'pilot', userId: 'vee', role: 'member' }, { projectId: 'pilot', userId: 'dee', role: 'member' }, { projectId: 'pilot', userId: 'ghost' }], grants: [] }));
  const previous = process.env.OPS_RBAC_USERS_FILE; process.env.OPS_RBAC_USERS_FILE = usersFile;
  const migrationContext = { runtimeDir, files: { exists, readJson, writeJson }, dataDir: DATA_DIR };
  try { await migrate006(migrationContext); await migrate006(migrationContext); } finally { process.env.OPS_RBAC_USERS_FILE = previous; }
  const doc = JSON.parse(await fs.readFile(path.join(runtimeDir, 'projects.json'), 'utf8'));
  assert.deepEqual(doc.members.map(member => [member.userId, member.role]), [['boss', 'owner'], ['vee', 'viewer'], ['dee', 'developer'], ['ghost', 'developer']]);
  assert.equal(doc.projects.pilot.open, false); assert.equal(doc.projects.pilot.color, null);
});

test('FR-20, FR-14: an admin switches whether owners may grant a connection; the ids all and unrouted are reserved', async () => {
  assert.equal((await call('PATCH', '/api/connections/jira-closed', { projectAdminsMayGrant: true }, 'olga')).status, 403);
  const shared = await call('PATCH', '/api/connections/jira-closed', { projectAdminsMayGrant: true }, ADMIN);
  assert.equal(shared.status, 200); assert.equal(shared.body.projectAdminsMayGrant, true);
  for (const id of ['all', 'unrouted']) assert.equal((await call('POST', '/api/projects', { id, name: `Reserved ${id}` }, ADMIN)).status, 409, id);
});
