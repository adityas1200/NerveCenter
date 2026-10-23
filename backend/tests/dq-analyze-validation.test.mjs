import test from 'node:test';
import assert from 'node:assert/strict';
import { createBackend } from '../src/bootstrap.mjs';
import { createApiServer } from '../src/api/server.mjs';

test('SPEC-data-quality-03 FR-1: analyzing without DDL returns an actionable 400', async () => {
  const backend = await createBackend();
  await backend.projectStore.addMember('pilot', 'alice', { id: 'test' }, { role: 'owner' });
  const server = createApiServer(backend);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/data-quality/analyze`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-nervecenter-project': 'pilot', 'x-user-id': 'alice' },
      body: JSON.stringify({ provider: 'databricks', catalog: 'example', schema: 'quality', resultTable: 'results', ddl: '' }),
    });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: 'Paste the result table DDL before analyzing.', code: 'INVALID_REQUEST' });
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
