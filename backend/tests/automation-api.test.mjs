import test from 'node:test';
import assert from 'node:assert/strict';
import { createBackend } from '../src/bootstrap.mjs';
import { createApiServer } from '../src/api/server.mjs';

// SPEC-automations-01 FR-3, FR-4, FR-37..FR-40 and SPEC-platform-10 FR-6: who may change automations, read alerts and refresh.
const ADMIN = 'mitesh.shinde@zs.com';
let backend; let server; let base;
const call = async (method, path, body, user, project = 'ops') => {
  const headers = { 'content-type': 'application/json', 'x-user-id': user, 'x-user-name': user, 'x-nervecenter-project': project };
  const response = await fetch(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, body: await response.json().catch(() => null) };
};

test.before(async () => {
  backend = await createBackend();
  server = createApiServer(backend);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  for (const user of ['owner1', 'dev1', 'view1']) await call('GET', '/api/me', undefined, user, undefined);
  for (const user of ['owner1', 'dev1']) assert.equal((await call('POST', `/api/admin/rbac/users/${user}/role`, { role: 'developer' }, ADMIN, undefined)).status, 200);
  assert.equal((await call('POST', '/api/projects', { id: 'ops', name: 'Ops' }, 'owner1', undefined)).status, 201);
  assert.equal((await call('POST', '/api/projects/ops/members', { userId: 'dev1', role: 'developer' }, 'owner1')).status, 201);
  assert.equal((await call('POST', '/api/projects/ops/members', { userId: 'view1', role: 'viewer' }, 'owner1')).status, 201);
});
test.after(() => new Promise(resolve => server.close(resolve)));

test('FR-4: only a project owner saves automations; the save is stamped with who and when', async () => {
  const body = { pipelineFailed: { action: 'task_and_ticket' }, limits: { maxPerDay: 20 } };
  assert.equal((await call('PUT', '/api/settings/automation', body, 'dev1')).status, 403);
  assert.equal((await call('PUT', '/api/settings/automation', body, 'view1')).status, 403);
  const saved = await call('PUT', '/api/settings/automation', body, 'owner1');
  assert.equal(saved.status, 200);
  const read = await call('GET', '/api/automation', undefined, 'dev1');
  assert.equal(read.status, 200);
  assert.deepEqual([read.body.config.pipelineFailed.action, read.body.config.limits.maxPerDay, read.body.config.updatedBy.id, read.body.config.legacy], ['task_and_ticket', 20, 'owner1', false]);
  assert.ok(read.body.config.updatedAt);
  assert.equal(read.body.status.automation.active, true);
});

test('FR-3: an invalid automation or cadence is refused with a plain message', async () => {
  const bad = await call('PUT', '/api/settings/automation', { pipelineFailed: { action: 'nuke' } }, 'owner1');
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /automation\.pipelineFailed\.action/);
  const cadence = await call('PUT', '/api/settings/sync', { enabled: true, intervalValue: 15, intervalUnit: 'seconds', pipelines: { every: 1, unit: 'seconds' } }, 'owner1');
  assert.equal(cadence.status, 400);
  assert.equal((await call('PUT', '/api/settings/sync', { enabled: true, intervalValue: 15, intervalUnit: 'seconds', pipelines: { every: 5, unit: 'minutes' } }, 'owner1')).status, 200);
  assert.equal((await call('GET', '/api/automation', undefined, 'view1')).body.status.sources.pipelines.everySeconds, 300);
});

test('FR-38, FR-39: members list alerts; resolving one needs tickets.manage; refresh is rate limited', async () => {
  const { alert } = await backend.monitorStore.createAlert({ projectId: 'ops', key: 'pipeline:databricks:1:failed', trigger: 'pipelineFailed', subject: { type: 'pipeline', id: '1', platform: 'databricks', name: 'job 1' }, occurrences: [], investigation: { status: 'none', starts: [] } });
  const list = await call('GET', '/api/alerts?status=open', undefined, 'view1');
  assert.deepEqual([list.status, list.body.total, list.body.items[0].id], [200, 1, alert.id]);
  assert.equal((await call('GET', '/api/alerts', undefined, 'view1', 'pilot')).status, 403, 'not a member of PILOT');
  assert.equal((await call('POST', `/api/alerts/${alert.id}/resolve`, {}, 'view1')).status, 403);
  const resolved = await call('POST', `/api/alerts/${alert.id}/resolve`, {}, 'dev1');
  assert.deepEqual([resolved.status, resolved.body.status, resolved.body.resolvedBy.id], [200, 'resolved', 'dev1']);
  assert.equal((await call('POST', `/api/alerts/${alert.id}/resolve`, {}, 'dev1')).status, 409);
  const first = await call('POST', '/api/monitor/refresh', { sources: ['pipelines'] }, 'view1');
  assert.equal(first.status, 200);
  assert.ok(first.body.status.sources.pipelines.lastFetchAt);
  assert.equal((await call('POST', '/api/monitor/refresh', {}, 'view1')).status, 429);
});
