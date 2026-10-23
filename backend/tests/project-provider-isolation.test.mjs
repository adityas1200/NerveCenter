import test from 'node:test';
import assert from 'node:assert/strict';
import { createBackend } from '../src/bootstrap.mjs';
import { createApiServer } from '../src/api/server.mjs';

test('SPEC-projects-01 FR-32/FR-33: platform and board reads use only the requesting project grant', async () => {
  const backend = await createBackend();
  for (const id of ['alpha', 'beta', 'empty']) await backend.projectStore.create({ id, name: id }, { id: 'test' });
  for (const id of ['alpha', 'beta']) {
    await backend.connectionProfileStore.put({ id: `db-${id}`, provider: 'databricks', name: id, enabled: true, config: { host: `https://${id}.example.com`, warehouseId: 'warehouse' }, secretRef: `test/${id}` });
    await backend.secretStore.set(`test/${id}`, JSON.stringify({ token: `fake-${id}` }));
    await backend.projectStore.putGrant(id, { resourceType: 'connection', resourceId: `db-${id}`, isDefault: true }, { id: 'test' });
  }
  backend.boards.databricksFactory = resolved => ({ queryRows: async () => [{ profile: resolved.profile?.id }] });
  for (const id of ['alpha', 'beta']) {
    const catalog = await backend.dataPlatform.for(id);
    catalog.listTables = async () => [{ id: `${id}.allowed_table`, platform: 'databricks', kind: 'table' }];
  }
  const server = createApiServer(backend);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, route, project, body) => {
    const response = await fetch(`${base}${route}`, { method, headers: { 'content-type': 'application/json', 'x-nervecenter-project': project, 'x-user-id': 'mitesh.shinde@zs.com', 'x-user-name': 'Admin' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  const widget = { type: 'table', title: 'Profile', source: { kind: 'sql', provider: 'databricks', statement: 'SELECT profile FROM allowed_table' } };
  try {
    for (const project of ['alpha', 'beta']) {
      const preview = await call('POST', '/api/boards/preview', project, { widget });
      assert.equal(preview.status, 200);
      assert.deepEqual(preview.body.rows, [[`db-${project}`]]);
      const profiles = await call('GET', '/api/connections', project);
      assert.equal(profiles.status, 200);
      assert.deepEqual(profiles.body.items.map(item => item.id), [`db-${project}`]);
      const status = await call('GET', '/api/data-platform/status', project);
      assert.equal(status.status, 200);
      assert.equal(status.body.providers.find(item => item.provider === 'databricks').configured, true);
      const discovered = await backend.boards.describeData({ provider: 'databricks' }, { id: 'builder', role: 'developer' }, { projectId: project, all: false });
      assert.deepEqual(discovered.tables.map(item => item.id), [`${project}.allowed_table`]);
    }
    const denied = await call('POST', '/api/boards/preview', 'empty', { widget });
    assert.equal(denied.status, 400);
    assert.match(denied.body.error, /No databricks connection/);
    const status = await call('GET', '/api/data-platform/status', 'empty');
    assert.equal(status.body.providers.find(item => item.provider === 'databricks').configured, false);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('SPEC-projects-01 FR-31/FR-32: saving connectors in two projects keeps distinct profiles and credentials', async () => {
  const backend = await createBackend();
  for (const id of ['first', 'second']) await backend.projectStore.create({ id, name: id }, { id: 'test' });
  const server = createApiServer(backend);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, project, body) => {
    const response = await fetch(`${base}/api/connectors/databricks`, { method, headers: { 'content-type': 'application/json', 'x-nervecenter-project': project, 'x-user-id': 'mitesh.shinde@zs.com', 'x-user-name': 'Admin' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  try {
    for (const id of ['first', 'second']) {
      const saved = await call('PUT', id, { settings: { host: `https://${id}.example.com` }, secrets: { token: `fake-${id}` } });
      assert.equal(saved.status, 200);
    }
    const first = await backend.connectionService.resolve('databricks', 'first');
    const second = await backend.connectionService.resolve('databricks', 'second');
    assert.notEqual(first?.profile?.id, second?.profile?.id);
    assert.equal(first?.credentials.token, 'fake-first');
    assert.equal(second?.credentials.token, 'fake-second');
    assert.equal((await call('DELETE', 'first')).status, 200);
    assert.equal(await backend.connectionService.resolve('databricks', 'first'), null);
    assert.equal((await backend.connectionService.resolve('databricks', 'second'))?.credentials.token, 'fake-second');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
