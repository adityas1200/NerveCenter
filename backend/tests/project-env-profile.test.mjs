import test from 'node:test';
import assert from 'node:assert/strict';
import { createBackend } from '../src/bootstrap.mjs';

test('SPEC-projects-01 FR-32/FR-41: deployment credentials import as a PILOT-granted profile', async () => {
  process.env.DATABRICKS_HOST = 'https://pilot.example.com';
  process.env.DATABRICKS_TOKEN = 'fake-deployment-token';
  try {
    const backend = await createBackend();
    const profile = await backend.connectionService.resolve('databricks', 'pilot');
    assert.equal(profile?.profile?.id, 'databricks-env');
    assert.equal(profile?.credentials.token, 'fake-deployment-token');
    assert.equal(await backend.connectionService.resolve('databricks', 'unrouted'), null);
    await backend.projectStore.removeGrant('pilot', 'connection', 'databricks-env', { id: 'test' });
    await backend.connectionService.delete('databricks-env');
    const ref = 'connections/env-profile-import-state';
    await backend.connectionService.importEnvProfiles({ state: {
      get: async () => JSON.parse(await backend.secretStore.get(ref)),
      set: async value => backend.secretStore.set(ref, JSON.stringify(value)),
    } });
    assert.equal(await backend.connectionService.resolve('databricks', 'pilot'), null, 'a removed import must stay removed');
  } finally {
    delete process.env.DATABRICKS_HOST;
    delete process.env.DATABRICKS_TOKEN;
  }
});
