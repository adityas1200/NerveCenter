import test from 'node:test';
import assert from 'node:assert/strict';
import { createBackend } from '../src/bootstrap.mjs';
import { createApiServer } from '../src/api/server.mjs';

// SPEC-projects-02 as amended by SPEC-projects-03: project owners, developers and viewers; developer-created projects;
// shareable connection grants; project-wide and private tickets.
const ADMIN = 'mitesh.shinde@zs.com';
let backend; let server; let base;
const call = async (method, path, body, user, project) => {
  const headers = { 'content-type': 'application/json', 'x-user-id': user, 'x-user-name': user };
  if (project) headers['x-nervecenter-project'] = project;
  const response = await fetch(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, body: await response.json().catch(() => null) };
};

test.before(async () => {
  backend = await createBackend();
  server = createApiServer(backend);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  // Sign everyone in once so they exist in the user directory. New people are app viewers; dev1..dev3 are made developers.
  for (const user of ['dev1', 'dev2', 'dev3', 'vic']) await call('GET', '/api/me', undefined, user);
  for (const user of ['dev1', 'dev2', 'dev3']) assert.equal((await call('POST', `/api/admin/rbac/users/${user}/role`, { role: 'developer' }, ADMIN)).status, 200);
});
test.after(() => new Promise(resolve => server.close(resolve)));

test('FR-3, FR-5 (03): a developer creates a project and becomes its owner; an app viewer cannot create one but can be made owner', async () => {
  const created = await call('POST', '/api/projects', { id: 'sales', name: 'Sales' }, 'dev1');
  assert.equal(created.status, 201);
  assert.deepEqual((await backend.projectStore.listMembers('sales')).map(member => [member.userId, member.role]), [['dev1', 'owner']]);
  assert.equal((await call('GET', '/api/me/projects', undefined, 'dev1')).body.items.find(item => item.id === 'sales').role, 'owner');
  assert.equal((await call('POST', '/api/projects', { id: 'vics', name: 'Vics' }, 'vic')).status, 403);
  assert.equal((await call('POST', '/api/projects/sales/members', { userId: 'vic', role: 'owner' }, 'dev1', 'sales')).status, 201, 'the app role does not cap the project role');
  assert.equal((await call('DELETE', '/api/projects/sales/members/vic', undefined, 'dev1', 'sales')).status, 200);
  assert.equal((await call('POST', '/api/projects/sales/members', { userId: 'nobody-here' }, 'dev1', 'sales')).status, 400, 'members are existing users');
  assert.equal((await call('POST', '/api/projects/sales/members', { userId: 'dev3', role: 'admin' }, 'dev1', 'sales')).status, 400, 'admin and member are not project roles any more');
});

test('FR-7 (03): an owner manages people of their own project only; developers, viewers and other owners cannot', async () => {
  await call('POST', '/api/projects', { id: 'ops', name: 'Ops' }, 'dev3');
  assert.equal((await call('POST', '/api/projects/sales/members', { userId: 'dev2', role: 'developer' }, 'dev1', 'sales')).status, 201);
  assert.equal((await call('POST', '/api/projects/sales/members', { userId: 'vic', role: 'viewer' }, 'dev1', 'sales')).status, 201);
  for (const [user, project] of [['dev2', 'sales'], ['vic', 'sales'], ['dev3', 'sales'], ['dev3', 'ops']]) {
    assert.equal((await call('POST', '/api/projects/sales/members', { userId: 'dev3' }, user, project)).status, 403, `${user} via ${project}`);
    assert.equal((await call('GET', '/api/projects/sales/grants', undefined, user, project)).status, 403);
  }
  const seen = await call('GET', '/api/projects/sales/members', undefined, 'vic', 'sales');
  assert.equal(seen.status, 200, 'everyone in the project sees who is in it');
  assert.equal(seen.body.items.find(member => member.userId === 'dev2').name, 'dev2', 'with their name from the directory');
  assert.equal((await call('PATCH', '/api/projects/sales/members/dev2', { role: 'owner' }, 'dev1', 'sales')).status, 200);
  assert.equal((await call('PATCH', '/api/projects/sales', { name: 'Renamed' }, 'dev2', 'sales')).status, 403, 'renaming stays app-admin only');
  assert.equal((await call('POST', '/api/projects/sales/archive', undefined, 'dev2', 'sales')).status, 403);
  assert.equal((await call('PATCH', '/api/projects/sales', { color: 'teal', description: 'Sales data' }, 'dev2', 'sales')).status, 200, 'an owner sets the colour and description');
});

test('FR-7 (03): the last explicit owner cannot step down or leave; an app admin can make that change', async () => {
  assert.equal((await call('PATCH', '/api/projects/ops/members/dev3', { role: 'developer' }, 'dev3', 'ops')).status, 400);
  assert.equal((await call('DELETE', '/api/projects/ops/members/dev3', undefined, 'dev3', 'ops')).status, 400);
  assert.match((await call('PATCH', '/api/projects/ops/members/dev3', { role: 'viewer' }, 'dev3', 'ops')).body.error, /needs an owner/);
  assert.equal((await call('PATCH', '/api/projects/ops/members/dev3', { role: 'developer' }, ADMIN, 'ops')).status, 200);
  assert.equal((await call('PATCH', '/api/projects/ops/members/dev3', { role: 'owner' }, ADMIN, 'ops')).status, 200);
});

test('FR-8 (03): changing someone\'s app role leaves their project roles alone', async () => {
  assert.equal((await backend.projectStore.memberRole('sales', 'dev2')), 'owner');
  assert.equal((await call('POST', '/api/admin/rbac/users/dev2/role', { role: 'viewer' }, ADMIN)).status, 200);
  assert.equal((await backend.projectStore.memberRole('sales', 'dev2')), 'owner');
  assert.equal((await call('PUT', '/api/settings/team', { name: 'Sales team', timezone: 'UTC' }, 'dev2', 'sales')).status, 200, 'an app viewer who owns a project runs it');
  await call('POST', '/api/admin/rbac/users/dev2/role', { role: 'developer' }, ADMIN);
});

test('FR-14, FR-15: an owner grants only shareable connections; an app admin grants any', async () => {
  const base = { provider: 'jira', config: { site: 'https://example.atlassian.net', email: 'a@b.c' }, credentials: { apiToken: 't' } };
  for (const [id, shareable] of [['jira-shared', true], ['jira-locked', false]]) {
    const saved = await call('POST', '/api/connections', { ...base, id, name: id, library: true, projectAdminsMayGrant: shareable }, ADMIN, 'pilot');
    assert.equal(saved.status, 201, JSON.stringify(saved.body));
  }
  assert.equal((await call('PUT', '/api/projects/sales/grants', { resourceType: 'connection', resourceId: 'jira-shared', scope: { projectKeys: ['SAL'] } }, 'dev2', 'sales')).status, 200);
  const locked = await call('PUT', '/api/projects/sales/grants', { resourceType: 'connection', resourceId: 'jira-locked' }, 'dev2', 'sales');
  assert.equal(locked.status, 403); assert.equal(locked.body.error, 'A global admin must grant this connection');
  assert.equal((await call('PUT', '/api/projects/sales/grants', { resourceType: 'connection', resourceId: 'jira-locked' }, ADMIN, 'sales')).status, 200);
});

test('FR-15: an app admin flips only the shareable flag; an owner cannot', async () => {
  assert.equal((await call('PATCH', '/api/connections/jira-locked', { projectAdminsMayGrant: true }, 'dev2', 'sales')).status, 403);
  const shared = await call('PATCH', '/api/connections/jira-locked', { projectAdminsMayGrant: true }, ADMIN, 'sales');
  assert.equal(shared.status, 200, JSON.stringify(shared.body));
  assert.equal(shared.body.projectAdminsMayGrant, true);
  assert.equal(shared.body.config.site, 'https://example.atlassian.net');
  assert.equal((await call('PUT', '/api/projects/sales/grants', { resourceType: 'connection', resourceId: 'jira-locked' }, 'dev2', 'sales')).status, 200);
  assert.equal((await call('PATCH', '/api/connections/jira-locked', { projectAdminsMayGrant: false }, ADMIN, 'sales')).body.projectAdminsMayGrant, false);
  assert.equal((await call('PATCH', '/api/connections/missing-one', { projectAdminsMayGrant: true }, ADMIN, 'sales')).status, 404);
});

test('FR-6 (03): an owner writes the project settings; a developer works but cannot; a viewer only reads', async () => {
  assert.equal((await call('PUT', '/api/settings/team', { name: 'Sales team', timezone: 'UTC' }, 'dev2', 'sales')).status, 200);
  await call('POST', '/api/projects/sales/members', { userId: 'dev3', role: 'developer' }, 'dev1', 'sales');
  assert.equal((await call('PUT', '/api/settings/team', { name: 'Nope', timezone: 'UTC' }, 'dev3', 'sales')).status, 403);
  assert.equal((await call('POST', '/api/tickets', { title: 'Developer ticket' }, 'dev3', 'sales')).status, 201);
  assert.equal((await call('POST', '/api/tickets', { title: 'Viewer ticket' }, 'vic', 'sales')).status, 403);
  assert.equal((await call('GET', '/api/tickets', undefined, 'vic', 'sales')).status, 200);
  const access = await call('GET', '/api/me/access', undefined, 'dev3', 'sales');
  assert.equal(access.body.projectRole, 'developer'); assert.ok(access.body.permissions.includes('tickets.manage')); assert.ok(!access.body.permissions.includes('project.settings'));
});

test('FR-20..FR-22: project tickets are open to members, private ones to their people and the owners; owners assign and close', async () => {
  const open = (await call('POST', '/api/tickets', { title: 'Shared ticket' }, 'dev1', 'sales')).body;
  assert.equal(open.visibility, 'project');
  const secret = (await call('POST', '/api/tickets', { title: 'Private ticket', visibility: 'private' }, 'dev1', 'sales')).body;
  assert.equal((await call('GET', `/api/tickets/${open.ticketId}`, undefined, 'dev3', 'sales')).status, 200);
  assert.equal((await call('GET', `/api/tickets/${secret.ticketId}`, undefined, 'dev3', 'sales')).status, 403);
  assert.ok(!(await call('GET', '/api/tickets', undefined, 'dev3', 'sales')).body.items.some(item => item.ticketId === secret.ticketId));
  assert.equal((await call('GET', `/api/tickets/${secret.ticketId}`, undefined, 'dev2', 'sales')).status, 200, 'an owner sees private tickets');
  assert.equal((await call('PATCH', `/api/tickets/${secret.ticketId}`, { status: 'closed', resolutionSummary: 'done' }, 'dev2', 'sales')).status, 200, 'an owner closes any ticket');
  assert.equal((await call('PATCH', `/api/tickets/${open.ticketId}`, { visibility: 'private' }, 'dev3', 'sales')).status, 403);
  assert.equal((await call('PATCH', `/api/tickets/${open.ticketId}`, { visibility: 'private' }, 'dev2', 'sales')).status, 200, 'an owner marks any ticket private');
});
