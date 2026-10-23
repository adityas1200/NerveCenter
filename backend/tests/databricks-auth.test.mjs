import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { DatabricksAuth, DatabricksOperationsService, databricksCredentials, databricksFromConnection } from '../src/connectors/databricks/databricks-service.mjs';

// Databricks accepts two credentials: a personal access token, or a service principal exchanged for
// a short-lived OAuth token. These cover the exchange, its caching, and what happens when it expires.

const SECRET = 'dose-super-secret-value';

/** A stand-in workspace: /oidc/v1/token mints tokens, /api/2.2/jobs/list answers only the live one. */
async function fakeWorkspace({ expiresIn = 3600, tokenStatus = 200, tokenBody } = {}) {
  const calls = { mint: 0, jobs: [] };
  let issued = null;
  const server = createServer((req, res) => {
    const json = (status, payload) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(payload)); };
    if (req.url.startsWith('/oidc/v1/token')) {
      calls.mint += 1;
      let body = ''; req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        calls.grant = new URLSearchParams(body).get('grant_type');
        calls.scope = new URLSearchParams(body).get('scope');
        calls.basic = Buffer.from(String(req.headers.authorization || '').replace(/^Basic /, ''), 'base64').toString();
        if (tokenStatus !== 200) return json(tokenStatus, tokenBody ?? { error: 'invalid_client', error_description: 'authentication failed' });
        issued = `oauth-${calls.mint}`;
        json(200, { access_token: issued, token_type: 'Bearer', expires_in: expiresIn });
      });
      return;
    }
    calls.jobs.push(String(req.headers.authorization || ''));
    if (req.headers.authorization !== `Bearer ${issued}`) return json(401, { message: 'token expired' });
    json(200, { jobs: [{ job_id: 7, settings: { name: 'daily_refresh' } }] });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { host: `http://127.0.0.1:${server.address().port}`, calls, close: () => server.close(), expire: () => { issued = null; } };
}

test('a personal access token is sent as-is and never mints an OAuth token', async () => {
  const auth = new DatabricksAuth({ host: 'https://adb-1.azuredatabricks.net', token: 'dapi-123' });
  assert.equal(auth.mode, 'pat');
  assert.equal(await auth.header(), 'Bearer dapi-123');
  auth.invalidate();
  assert.equal(await auth.header(), 'Bearer dapi-123', 'there is nothing to invalidate');
});

test('a service principal is exchanged once and the token is reused until it nears expiry', async () => {
  const workspace = await fakeWorkspace();
  try {
    const service = new DatabricksOperationsService({ host: workspace.host, clientId: 'sp-client', clientSecret: SECRET });
    assert.equal(service.auth.mode, 'service_principal');
    const first = await service.listPipelines({ limit: 1 });
    assert.deepEqual(first.map(item => item.name), ['daily_refresh']);
    await service.listPipelines({ limit: 1 });
    await service.listPipelines({ limit: 1 });
    assert.equal(workspace.calls.mint, 1, 'three calls, one token');
    assert.equal(workspace.calls.grant, 'client_credentials');
    assert.equal(workspace.calls.scope, 'all-apis');
    assert.equal(workspace.calls.basic, `sp-client:${SECRET}`, 'the secret is sent as HTTP basic, never in the URL');
  } finally { workspace.close(); }
});

test('concurrent callers share one token exchange', async () => {
  const workspace = await fakeWorkspace();
  try {
    const service = new DatabricksOperationsService({ host: workspace.host, clientId: 'sp-client', clientSecret: SECRET });
    await Promise.all([service.listPipelines({ limit: 1 }), service.listPipelines({ limit: 1 }), service.listPipelines({ limit: 1 })]);
    assert.equal(workspace.calls.mint, 1, 'a burst from the pipelines page does not mint three tokens');
  } finally { workspace.close(); }
});

test('a token revoked before it expires is replaced and the request retried once', async () => {
  const workspace = await fakeWorkspace();
  try {
    const service = new DatabricksOperationsService({ host: workspace.host, clientId: 'sp-client', clientSecret: SECRET });
    await service.listPipelines({ limit: 1 });
    workspace.expire(); // revoked at the workspace while our cached token still looks valid
    const after = await service.listPipelines({ limit: 1 });
    assert.deepEqual(after.map(item => item.name), ['daily_refresh'], 'the caller never sees the 401');
    assert.equal(workspace.calls.mint, 2);
  } finally { workspace.close(); }
});

test('a token that expires quickly is re-minted rather than reused', async () => {
  const workspace = await fakeWorkspace({ expiresIn: 1 }); // floors to the 30s minimum, so still cached
  try {
    const service = new DatabricksOperationsService({ host: workspace.host, clientId: 'sp-client', clientSecret: SECRET });
    await service.listPipelines({ limit: 1 });
    await service.listPipelines({ limit: 1 });
    assert.equal(workspace.calls.mint, 1, 'a short lifetime never becomes a token minted per request');
  } finally { workspace.close(); }
});

test('a rejected service principal explains itself without leaking the secret', async () => {
  const workspace = await fakeWorkspace({ tokenStatus: 401 });
  try {
    const service = new DatabricksOperationsService({ host: workspace.host, clientId: 'sp-client', clientSecret: SECRET });
    const failure = await service.listPipelines({ limit: 1 }).catch(error => error);
    assert.match(failure.message, /rejected the service principal \(401\)/);
    assert.match(failure.message, /authentication failed/);
    assert.equal(failure.message.includes(SECRET), false, 'the client secret never reaches an error message');
  } finally { workspace.close(); }
});

test('an echoed secret is scrubbed out of the failure', async () => {
  const workspace = await fakeWorkspace({ tokenStatus: 400, tokenBody: { error_description: `bad secret ${SECRET}` } });
  try {
    const service = new DatabricksOperationsService({ host: workspace.host, clientId: 'sp-client', clientSecret: SECRET });
    const failure = await service.listPipelines({ limit: 1 }).catch(error => error);
    assert.equal(failure.message.includes(SECRET), false);
    assert.match(failure.message, /\[redacted\]/);
  } finally { workspace.close(); }
});

test('half a service principal, or no credential at all, is refused before any request is made', () => {
  assert.throws(() => new DatabricksAuth({ host: 'https://adb-1.azuredatabricks.net', clientId: 'sp-client' }), /needs both a client ID and a client secret/);
  assert.throws(() => new DatabricksAuth({ host: 'https://adb-1.azuredatabricks.net', clientSecret: SECRET }), /needs both a client ID and a client secret/);
  assert.throws(() => new DatabricksAuth({ host: 'https://adb-1.azuredatabricks.net' }), /personal access token, or a service principal/);
  assert.throws(() => new DatabricksAuth({ token: 'dapi-123' }), /requires a workspace URL/);
});

test('a resolved connection becomes a client in either shape, and a service principal wins over a token', () => {
  assert.deepEqual(databricksCredentials({ config: { host: 'https://adb-1.net' }, credentials: { pat: 'dapi-1' } }), { host: 'https://adb-1.net', token: 'dapi-1', clientId: undefined, clientSecret: undefined });
  const principal = databricksFromConnection({ config: { host: 'https://adb-1.net' }, credentials: { clientId: 'sp-client', clientSecret: SECRET } });
  assert.equal(principal.auth.mode, 'service_principal');
  const person = databricksFromConnection({ config: { host: 'https://adb-1.net' }, credentials: { accessToken: 'dapi-2' } });
  assert.equal(person.auth.mode, 'pat');
  const both = databricksFromConnection({ config: { host: 'https://adb-1.net' }, credentials: { token: 'dapi-3', clientId: 'sp-client', clientSecret: SECRET } });
  assert.equal(both.auth.mode, 'service_principal', 'a deployment that sets both means the principal');
});
