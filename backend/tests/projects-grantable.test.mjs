import test from 'node:test';
import assert from 'node:assert/strict';
import { createBackend } from '../src/bootstrap.mjs';
import { createApiServer } from '../src/api/server.mjs';

// SPEC-projects-02 FR-27: the grants editor lists what a project could be granted, for its owners only (SPEC-projects-03).
const ADMIN = 'mitesh.shinde@zs.com';
let server; let base;
const call = async (method, path, body, user, project) => {
  const headers = { 'content-type': 'application/json', 'x-user-id': user, 'x-user-name': user };
  if (project) headers['x-nervecenter-project'] = project;
  const response = await fetch(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, body: await response.json().catch(() => null) };
};

test.before(async () => {
  const backend = await createBackend();
  server = createApiServer(backend);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  for (const user of ['owner', 'plain']) await call('GET', '/api/me', undefined, user);
  // New people are app viewers (SPEC-projects-03 FR-1); creating a project needs an app developer.
  await call('POST', '/api/admin/rbac/users/owner/role', { role: 'developer' }, ADMIN);
  await call('POST', '/api/projects', { id: 'shop', name: 'Shop' }, 'owner');
  await call('POST', '/api/projects/shop/members', { userId: 'plain' }, 'owner', 'shop');
  await call('POST', '/api/connections', { provider: 'jira', id: 'jira-lib', name: 'Jira', library: true, projectAdminsMayGrant: true, config: { site: 'https://example.atlassian.net', email: 'a@b.c' }, credentials: { apiToken: 't' } }, ADMIN, 'pilot');
});
test.after(() => new Promise(resolve => server.close(resolve)));

test('FR-27: a project owner sees the grantable connections with their safeguard flag; a developer in the project does not', async () => {
  const listed = await call('GET', '/api/projects/shop/grantable', undefined, 'owner', 'shop');
  assert.equal(listed.status, 200);
  assert.deepEqual(listed.body.connections.find(item => item.id === 'jira-lib'), { id: 'jira-lib', name: 'Jira', provider: 'jira', projectAdminsMayGrant: true });
  assert.ok(Array.isArray(listed.body.knowledge) && Array.isArray(listed.body.skills));
  assert.equal((await call('GET', '/api/projects/shop/grantable', undefined, 'plain', 'shop')).status, 403);
});
