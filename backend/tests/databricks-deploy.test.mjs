import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabricksAuth } from '../src/connectors/databricks/databricks-service.mjs';
import { LakebaseTokenProvider } from '../src/platform/databricks-app.mjs';
import { DatabricksVolumeStore } from '../src/storage/object-store.mjs';
import { WorkspaceSync } from '../src/workspace/workspace-sync.mjs';
import { requestDatabricksAppsUser } from '../src/app/identity.mjs';
import { serveStatic } from '../src/lib/static.mjs';
import { tempDir } from './helpers.mjs';

// What NerveCenter needs to run as a Databricks App: the workspace mirrored to a Unity Catalog volume,
// Lakebase passwords minted as OAuth tokens, secrets encrypted into Postgres, the user the Apps proxy
// forwards, and the frontend served by the backend.

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = await tempDir('nc-databricks-');

/** A stand-in workspace: the Files API over an in-memory volume, plus Lakebase database credentials. */
async function fakeWorkspace() {
  const files = new Map(); const calls = { credentials: 0, auth: new Set(), listPages: 0 };
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x'); calls.auth.add(req.headers.authorization);
    const json = (status, payload) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(payload)); };
    const chunks = []; req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      if (url.pathname === '/api/2.0/database/credentials') { calls.credentials += 1; calls.instances = JSON.parse(Buffer.concat(chunks).toString()).instance_names; return json(200, { token: `db-token-${calls.credentials}`, expiration_time: new Date(Date.now() + 3_600_000).toISOString() }); }
      const target = decodeURIComponent(url.pathname.replace(/^\/api\/2\.0\/fs\/(files|directories)/, ''));
      if (url.pathname.startsWith('/api/2.0/fs/directories') && req.method === 'GET') {
        const children = new Map();
        for (const [file, body] of files) {
          if (!file.startsWith(`${target}/`)) continue;
          const [name, ...rest] = file.slice(target.length + 1).split('/');
          children.set(name, rest.length ? { path: `${target}/${name}`, is_directory: true, name } : { path: file, is_directory: false, file_size: body.length, last_modified: 1, name });
        }
        if (!children.size) return json(404, { error_code: 'NOT_FOUND' });
        const entries = [...children.values()]; const start = Number(url.searchParams.get('page_token') || 0); calls.listPages += 1;
        return json(200, { contents: entries.slice(start, start + 2), ...(start + 2 < entries.length ? { next_page_token: String(start + 2) } : {}) });
      }
      if (req.method === 'PUT') { files.set(target, Buffer.concat(chunks)); res.writeHead(204); return res.end(); }
      if (req.method === 'GET') { if (!files.has(target)) return json(404, {}); res.writeHead(200, { 'content-type': 'application/octet-stream' }); return res.end(files.get(target)); }
      if (req.method === 'DELETE') { const had = files.delete(target); return had ? (res.writeHead(204), res.end()) : json(404, {}); }
      json(400, { message: 'unexpected' });
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { host: `http://127.0.0.1:${server.address().port}`, files, calls, close: () => server.close() };
}

test('the workspace mirrors to a Unity Catalog volume and restores from it on an empty disk', async () => {
  const workspace = await fakeWorkspace();
  try {
    const store = new DatabricksVolumeStore({ root: '/Volumes/main/ops/nervecenter', auth: new DatabricksAuth({ host: workspace.host, token: 'dapi-test' }) });
    const dir = path.join(tmp, 'ws-a');
    await fs.mkdir(path.join(dir, 'knowledge', 'runbooks'), { recursive: true }); await fs.mkdir(path.join(dir, 'workflows'), { recursive: true });
    await fs.writeFile(path.join(dir, 'operations.yaml'), 'team:\n  name: Ops\n'); await fs.writeFile(path.join(dir, 'workflows', 'daily.yaml'), 'name: daily\n');
    await fs.writeFile(path.join(dir, 'knowledge', 'runbooks', 'index.md'), '# Runbooks\n'); await fs.writeFile(path.join(dir, 'knowledge', 'runbooks', 'a b.md'), 'spaces\n'); await fs.writeFile(path.join(dir, 'knowledge', 'runbooks', 'z.md'), 'z\n');
    const sync = new WorkspaceSync({ dir, store, prefix: 'nervecenter', log: {} });
    assert.deepEqual(await sync.push(), { uploaded: 5, deleted: 0 });
    assert.ok(workspace.files.has('/Volumes/main/ops/nervecenter/nervecenter/workspace/knowledge/runbooks/a b.md'), 'paths with spaces survive the URL encoding');
    await fs.rm(path.join(dir, 'workflows', 'daily.yaml'));
    assert.deepEqual(await sync.push(), { uploaded: 0, deleted: 1 });

    const fresh = path.join(tmp, 'ws-b');
    const restored = await new WorkspaceSync({ dir: fresh, store, prefix: 'nervecenter', log: {} }).restore();
    assert.equal(restored.restored, 4);
    assert.equal(await fs.readFile(path.join(fresh, 'knowledge', 'runbooks', 'index.md'), 'utf8'), '# Runbooks\n');
    assert.equal(workspace.calls.listPages, 4, 'walks nested folders and follows next_page_token');
    assert.deepEqual([...workspace.calls.auth], ['Bearer dapi-test']);
  } finally { workspace.close(); }
});

test('an empty volume restores nothing, and a bad volume path is refused', async () => {
  const workspace = await fakeWorkspace();
  try {
    const store = new DatabricksVolumeStore({ root: '/Volumes/main/ops/empty', auth: new DatabricksAuth({ host: workspace.host, token: 'dapi-test' }) });
    const result = await new WorkspaceSync({ dir: path.join(tmp, 'ws-c'), store, log: {} }).restore();
    assert.equal(result.restored, 0); assert.match(result.skipped, /nothing mirrored/);
    assert.throws(() => new DatabricksVolumeStore({ root: '/tmp/somewhere' }), /\/Volumes\/<catalog>/);
  } finally { workspace.close(); }
});

test('Lakebase passwords are database credentials for the instance, cached until near expiry', async () => {
  const workspace = await fakeWorkspace();
  try {
    const tokens = new LakebaseTokenProvider({ auth: new DatabricksAuth({ host: workspace.host, token: 'dapi-test' }), instance: 'nervecenter-db' });
    const [a, b] = await Promise.all([tokens.password(), tokens.password()]);
    assert.equal(a, 'db-token-1'); assert.equal(b, 'db-token-1');
    assert.equal(await tokens.password(), 'db-token-1');
    assert.equal(workspace.calls.credentials, 1, 'one credential for a burst of new connections');
    assert.deepEqual(workspace.calls.instances, ['nervecenter-db']);
  } finally { workspace.close(); }
});

test('without an instance name the service principal token is the Lakebase password', async () => {
  const tokens = new LakebaseTokenProvider({ auth: new DatabricksAuth({ host: 'https://adb-1.azuredatabricks.net', token: 'dapi-abc' }), instance: '' });
  assert.equal(await tokens.password(), 'dapi-abc');
});

test('the user comes from the headers the Databricks Apps proxy forwards', async () => {
  const user = await requestDatabricksAppsUser({ headers: { 'x-forwarded-email': 'Jane.Doe@Example.com', 'x-forwarded-user': '123@456', 'x-forwarded-preferred-username': 'Jane Doe' } });
  assert.equal(user.id, 'jane.doe@example.com'); assert.equal(user.name, 'Jane Doe'); assert.equal(user.email, 'Jane.Doe@Example.com');
  await assert.rejects(requestDatabricksAppsUser({ headers: {} }), error => error.statusCode === 401);
});

test('the backend serves the built frontend with a client-side-route fallback', async () => {
  const root = path.join(tmp, 'web'); await fs.mkdir(path.join(root, 'assets'), { recursive: true });
  await fs.writeFile(path.join(root, 'index.html'), '<html>app</html>'); await fs.writeFile(path.join(root, 'assets', 'app-1.js'), 'console.log(1)');
  await fs.writeFile(path.join(tmp, 'secret.txt'), 'outside');
  const server = createServer((req, res) => serveStatic(req, res, new URL(req.url, 'http://x'), root));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const asset = await fetch(`${base}/assets/app-1.js`);
    assert.equal(await asset.text(), 'console.log(1)'); assert.match(asset.headers.get('content-type'), /javascript/); assert.match(asset.headers.get('cache-control'), /immutable/);
    assert.equal(await (await fetch(`${base}/tickets/OPS-1001`)).text(), '<html>app</html>');
    assert.equal(await (await fetch(`${base}/..%2Fsecret.txt`)).text(), '<html>app</html>', 'no escaping the frontend folder');
  } finally { server.close(); }
});

test('on Databricks the config defaults to Lakebase, a volume, the Apps identity and the app port', () => {
  const env = { PATH: process.env.PATH, OPS_TEST_DATA_ROOT: tmp, DATABRICKS_APP_PORT: '8000', DATABRICKS_APP_URL: 'https://nervecenter-123.aws.databricksapps.com', DATABRICKS_HOST: 'adb-1.cloud.databricks.com', PGHOST: 'instance-1.database.cloud.databricks.com', PGUSER: 'sp-client-id', PGDATABASE: 'databricks_postgres', PGPORT: '5432', OPS_VOLUME_PATH: 'main.ops.nervecenter' };
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', "const { config } = await import('./src/config.mjs'); console.log(JSON.stringify(config));"], { cwd: backendRoot, env, encoding: 'utf8' });
  const config = JSON.parse(out.trim().split('\n').pop());
  assert.equal(config.platform, 'databricks');
  assert.equal(config.identityMode, 'databricks-apps');
  assert.equal(config.host, '0.0.0.0'); assert.equal(config.port, 8000);
  assert.equal(config.corsOrigin, 'https://nervecenter-123.aws.databricksapps.com');
  assert.equal(config.metadataStore, 'postgres'); assert.equal(config.dbAuth, 'databricks-oauth');
  assert.equal(config.databaseUrl, 'postgresql://sp-client-id@instance-1.database.cloud.databricks.com:5432/databricks_postgres');
  assert.equal(config.secretStore, 'postgres');
  assert.equal(config.objectStore, 'volume'); assert.equal(config.volumePath, '/Volumes/main/ops/nervecenter');
  assert.equal(config.databricksHost, 'https://adb-1.cloud.databricks.com');
});
