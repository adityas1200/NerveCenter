import test from 'node:test';
import assert from 'node:assert/strict';
import { createBackend } from '../src/bootstrap.mjs';
import { createApiServer } from '../src/api/server.mjs';
import { createSecretStore } from '../src/secrets/secret-store.mjs';
import { NO_PROJECT_KEY, ProjectApiKeys, apiKeyRef } from '../src/projects/project-api-keys.mjs';
import { DdlMappingAgent } from '../src/data-quality/ddl-mapping-agent.mjs';
import { fakeSdk, makeRuntime, pilot, tempDir, wait } from './helpers.mjs';

// SPEC-projects-04: a project's own Anthropic API key, set by app admins, and the only key its Claude calls use.
const ADMIN = 'mitesh.shinde@zs.com';
const KEY = 'sk-ant-api03-projectkeyAAAAAAAAAAAAAAAAAA1234';
let backend; let server; let base;
const call = async (method, path, body, user, project) => {
  const headers = { 'content-type': 'application/json', 'x-user-id': user, 'x-user-name': user };
  if (project) headers['x-nervecenter-project'] = project;
  const response = await fetch(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, body: await response.json().catch(() => null) };
};

test.before(async () => {
  backend = await createBackend();
  // Never ask Anthropic from a test: a key ending in BAD is rejected, one ending in OFFLINE cannot be checked.
  backend.projectApiKeys.check = async key => (key.endsWith('BAD') ? false : key.endsWith('OFFLINE') ? null : true);
  server = createApiServer(backend);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  for (const user of ['owner1', 'outsider']) await call('GET', '/api/me', undefined, user);
  assert.equal((await call('POST', `/api/admin/rbac/users/owner1/role`, { role: 'developer' }, ADMIN)).status, 200);
  assert.equal((await call('POST', '/api/projects', { id: 'billing', name: 'Billing' }, 'owner1')).status, 201);
});
test.after(() => new Promise(resolve => server.close(resolve)));

test('FR-1..FR-3: an app admin sets the key; the owner sees only its state; nobody gets the key back', async () => {
  assert.deepEqual((await call('GET', '/api/projects/billing/api-key', undefined, 'owner1', 'billing')).body, { set: false });
  assert.equal((await call('PUT', '/api/projects/billing/api-key', { apiKey: KEY }, 'owner1', 'billing')).status, 403, 'a project owner cannot set it');
  const saved = await call('PUT', '/api/projects/billing/api-key', { apiKey: KEY }, ADMIN, 'billing');
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal(saved.body.set, true); assert.equal(saved.body.last4, '1234'); assert.equal(saved.body.verified, true);
  assert.ok(!JSON.stringify(saved.body).includes(KEY), 'the key is never returned');
  const seen = await call('GET', '/api/projects/billing/api-key', undefined, 'owner1', 'billing');
  assert.equal(seen.body.last4, '1234'); assert.ok(!JSON.stringify(seen.body).includes(KEY));
  assert.equal((await call('GET', '/api/projects/billing/api-key', undefined, 'outsider')).status, 403);
  assert.equal(JSON.parse(await backend.secretStore.get(apiKeyRef('billing'))).key, KEY);
  assert.equal((await call('DELETE', '/api/projects/billing/api-key', undefined, 'owner1', 'billing')).status, 403);
  assert.deepEqual((await call('DELETE', '/api/projects/billing/api-key', undefined, ADMIN, 'billing')).body, { set: false });
  assert.equal(await backend.secretStore.get(apiKeyRef('billing')), undefined);
});

test('FR-4: a malformed or rejected key is refused; an unreachable check saves it unverified', async () => {
  assert.equal((await call('PUT', '/api/projects/billing/api-key', { apiKey: 'not-a-key' }, ADMIN, 'billing')).status, 400);
  const rejected = await call('PUT', '/api/projects/billing/api-key', { apiKey: 'sk-ant-api03-rejectedkeyAAAAAAAAAAAABAD' }, ADMIN, 'billing');
  assert.equal(rejected.status, 400); assert.match(rejected.body.error, /rejected/);
  assert.equal((await call('GET', '/api/projects/billing/api-key', undefined, ADMIN, 'billing')).body.set, false);
  const offline = await call('PUT', '/api/projects/billing/api-key', { apiKey: 'sk-ant-api03-offlinekeyAAAAAAAAAAAAAOFFLINE' }, ADMIN, 'billing');
  assert.equal(offline.status, 200); assert.equal(offline.body.verified, false);
  assert.equal((await call('PUT', '/api/projects/no-such-project/api-key', { apiKey: KEY }, ADMIN)).status, 404);
  await call('DELETE', '/api/projects/billing/api-key', undefined, ADMIN, 'billing');
});

test('FR-6: a run uses its project key over the deployment key, and a project without one does not start', async () => {
  const tmp = await tempDir('nc-apikey-');
  const keys = new ProjectApiKeys({ secretStore: createSecretStore(), check: async () => true });
  const sdk = fakeSdk();
  const { runtime, store } = await makeRuntime(tmp, sdk, { apiKey: task => keys.require(task.projectId) });
  const before = process.env.ANTHROPIC_API_KEY; process.env.ANTHROPIC_API_KEY = 'sk-ant-deployment-key';
  try {
    const blocked = await runtime.startTask({ scope: pilot, type: 'adhoc', prompt: 'hello', user: { id: 'u1', name: 'U1' }, permission: 'allow' });
    await wait(async () => (await store.getTask(blocked.id))?.status === 'failed', 10000, 'the run to fail without a key');
    assert.equal((await store.getTask(blocked.id)).error, NO_PROJECT_KEY);
    assert.equal(sdk.calls.length, 0, 'the SDK never started');
    await keys.set('pilot', KEY, { id: ADMIN });
    const ran = await runtime.startTask({ scope: pilot, type: 'adhoc', prompt: 'hello again', user: { id: 'u1', name: 'U1' }, permission: 'allow' });
    await wait(async () => (await store.getTask(ran.id))?.status === 'done', 10000, 'the run to finish');
    assert.equal(sdk.calls.at(-1).options.env.ANTHROPIC_API_KEY, KEY, 'the project key, not the deployment one');
  } finally { if (before === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = before; }
});

test('FR-7: the DQ mapping agent uses the project key, and stays off without one', async () => {
  const before = process.env.ANTHROPIC_API_KEY; process.env.ANTHROPIC_API_KEY = 'sk-ant-deployment-key';
  try {
    let seen = null;
    const sdk = { query: ({ options }) => { seen = options; return (async function* () { yield { type: 'result', result: '{"mapping":{},"confidence":0.5,"issues":[]}' }; })(); } };
    const agent = new DdlMappingAgent({ sdkLoader: async () => sdk });
    const input = { ddl: 'CREATE TABLE t (a int)', columns: [{ name: 'a', type: 'int', nullable: true }], mapping: {}, candidates: {} };
    assert.equal((await agent.suggest({ ...input, apiKey: KEY })).used, true);
    assert.equal(seen.env.ANTHROPIC_API_KEY, KEY);
    assert.equal(seen.env.DATABASE_URL, undefined, 'server secrets stay out');
  } finally { if (before === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = before; }
  const { DataQualityService } = await import('../src/data-quality/data-quality-service.mjs');
  let asked = false;
  const service = new DataQualityService({ store: {}, connectionService: { providerStatuses: async () => [{ id: 'databricks', name: 'Databricks', state: 'available', ready: true, source: 'deployment' }] }, ddlMappingAgent: { suggest: async () => { asked = true; return { used: true }; } } });
  const result = await service.analyzeConfig({ provider: 'databricks', ddl: 'CREATE TABLE t (a int, b int)', allowDataSample: true }, { apiKey: null });
  assert.equal(asked, false, 'the agent is not asked');
  assert.deepEqual(result.agent, { used: false, reason: NO_PROJECT_KEY });
  assert.equal(result.sample.used, false, 'no sample is read for an agent that will not run');
});
