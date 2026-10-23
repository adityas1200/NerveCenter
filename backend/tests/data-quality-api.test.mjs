import test from 'node:test';
import assert from 'node:assert/strict';
import { createBackend } from '../src/bootstrap.mjs';
import { createApiServer } from '../src/api/server.mjs';

let server; let base;
const call = async (method, path, body, user = 'alice') => {
  const response = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', 'x-nervecenter-project': 'pilot', 'x-user-id': user, 'x-user-name': user }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
};

test.before(async () => {
  const backend = await createBackend();
  await backend.projectStore.addMember('pilot', 'alice', { id: 'test' });
  server = createApiServer(backend);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => new Promise(resolve => server.close(resolve)));

test('data quality config lists result tables and removing one is admin only', async () => {
  const config = await call('GET', '/api/data-quality/config');
  assert.equal(config.status, 200); assert.equal(config.body.configuration, null); assert.deepEqual(config.body.tables, []);
  const denied = await call('DELETE', '/api/data-quality/config/dq-1');
  assert.equal(denied.status, 403);
  const missing = await call('DELETE', '/api/data-quality/config/dq-1', undefined, 'mitesh.shinde@zs.com');
  assert.equal(missing.status, 404); assert.match(missing.body.error, /Result table not found/);
  const monitor = await call('GET', '/api/data-quality/monitor');
  assert.equal(monitor.status, 200); assert.deepEqual(monitor.body.tables, []); assert.deepEqual(monitor.body.sources, []);
});
