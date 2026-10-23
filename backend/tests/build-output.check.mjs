import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ROOT, MIGRATIONS_DIR, RUNTIME_DIR } from '../dist/config.mjs';
import { createBackend } from '../dist/bootstrap.mjs';
import { createApiServer } from '../dist/api/server.mjs';
import { FileTaskStore } from '../dist/tasks/task-store.mjs';
import { FileOperationsStore } from '../dist/app/operations-store.mjs';
import { FileProjectPersistence, ProjectStore } from '../dist/projects/project-store.mjs';
import { FileRbacPersistence, RbacStore } from '../dist/app/rbac-store.mjs';
import { createConnectionProfileStore } from '../dist/connections/connection-profile-store.mjs';
import { FileSecretStore } from '../dist/secrets/secret-store.mjs';
import { DatabricksVolumeStore } from '../dist/storage/object-store.mjs';
import { systemScope } from '../dist/projects/project-access.mjs';

test('ADR 0002: compiled backend keeps its runtime root and serves HTTP', async () => {
  const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  assert.equal(ROOT, backendRoot);
  assert.equal(MIGRATIONS_DIR, path.join(backendRoot, 'migrations'));
  assert.ok(fs.existsSync(MIGRATIONS_DIR));

  const backend = await createBackend();
  const migrationState = JSON.parse(fs.readFileSync(path.join(RUNTIME_DIR, 'file-migrations.json'), 'utf8'));
  assert.ok(migrationState.applied['003-projects.mjs']);
  const server = createApiServer(backend);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/health`);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).ok, true);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test('ADR 0002: compiled task store keeps project scope, events, and inbox records', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nc-compiled-tasks-'));
  try {
    const store = new FileTaskStore(root);
    await store.init();
    const task = { id: 'T-1', type: 'adhoc', status: 'queued', projectId: 'pilot', createdAt: '2026-10-10T00:00:00.000Z' };
    await store.createTask(task);
    const event = await store.appendEvent(task.id, { type: 'status', title: 'Queued' });
    const item = await store.createInboxItem({ taskId: task.id, projectId: 'pilot', kind: 'notification', title: 'Queued' });
    assert.deepEqual((await store.listTasks(systemScope('pilot'))).map(row => row.id), [task.id]);
    assert.deepEqual(await store.listTasks(systemScope('other')), []);
    assert.equal((await store.listEvents(task.id))[0].seq, event.seq);
    assert.deepEqual((await store.listInbox(systemScope('pilot'))).map(row => row.id), [item.id]);
    assert.deepEqual(await store.listInbox(systemScope('other')), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('ADR 0002: compiled ticket store keeps source identity and project scope', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nc-compiled-tickets-'));
  try {
    const store = new FileOperationsStore(path.join(root, 'application-state.json'));
    await store.init();
    const base = { sourceKey: 'remote:1', status: 'open', createdAt: '2026-10-10T00:00:00.000Z' };
    await store.createTicket({ ...base, ticketId: 'OPS-1', connectionId: 'alpha', projectId: 'pilot' });
    await store.createTicket({ ...base, ticketId: 'OPS-2', connectionId: 'beta', projectId: 'other' });
    assert.equal((await store.findTicketBySourceKey('remote:1', 'alpha')).ticketId, 'OPS-1');
    assert.equal((await store.findTicketBySourceKey('remote:1', 'beta')).ticketId, 'OPS-2');
    assert.deepEqual((await store.listTickets(systemScope('pilot'))).map(row => row.ticketId), ['OPS-1']);
    assert.deepEqual((await store.listTickets(systemScope('other'))).map(row => row.ticketId), ['OPS-2']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('ADR 0002: compiled project store keeps owners and grants', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nc-compiled-projects-'));
  try {
    const store = await new ProjectStore({ persistence: new FileProjectPersistence(path.join(root, 'projects.json')) }).init();
    const admin = { id: 'alice', role: 'admin' };
    await store.create({ id: 'alpha', name: 'Alpha' }, admin);
    await store.addMember('alpha', 'bob', admin, { role: 'viewer' });
    await store.putGrant('alpha', { resourceType: 'knowledge', resourceId: 'base-1' }, admin);
    assert.deepEqual((await store.listMembers('alpha')).map(row => [row.userId, row.role]), [['alice', 'owner'], ['bob', 'viewer']]);
    assert.deepEqual((await store.listGrants('alpha')).map(row => row.resourceId), ['base-1']);
    await assert.rejects(store.removeMember('alpha', 'alice', { id: 'bob', role: 'developer' }), /needs an owner/);
    assert.equal((await store.listMembers('alpha')).length, 2);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('ADR 0002 and 0003: compiled RBAC store keeps roles and blocks after restart without an audit API', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nc-compiled-rbac-'));
  try {
    const persistence = new FileRbacPersistence({ usersFile: path.join(root, 'users.json') });
    const actor = { id: 'admin', name: 'Admin' };
    const first = new RbacStore({ persistence });
    await first.init();
    await first.upsert({ id: 'compiled-user', name: 'Compiled User', role: 'viewer' }, actor);
    await first.setRole('compiled-user', 'developer', actor);
    await first.setBlocked('compiled-user', true, actor, 'review');
    await assert.rejects(first.setRole('compiled-user', 'unknown', actor), /Invalid role/);

    const restarted = new RbacStore({ persistence });
    await restarted.init();
    assert.deepEqual([restarted.get('compiled-user').role, restarted.get('compiled-user').blocked], ['developer', true]);
    assert.equal(restarted.listAudit, undefined);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('ADR 0002: compiled connection profile store keeps its file record', async () => {
  const store = await createConnectionProfileStore();
  const profile = { id: 'compiled-profile', name: 'Compiled Profile', provider: 'databricks' };
  assert.deepEqual(await store.put(profile), profile);
  assert.deepEqual(await store.get(profile.id), profile);
  assert.ok((await store.list()).some(item => item.id === profile.id));
  assert.equal(await store.delete(profile.id), true);
  assert.equal(await store.get(profile.id), null);
});

test('ADR 0002: compiled secret store keeps a ref across file-backed restart', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nc-compiled-secrets-'));
  try {
    const file = path.join(root, 'secrets.json');
    const first = new FileSecretStore(file);
    await first.set('connections/compiled/credentials', 'test-value');
    const restarted = new FileSecretStore(file);
    assert.equal(await restarted.get('connections/compiled/credentials'), 'test-value');
    assert.deepEqual(await restarted.status('connections/compiled/credentials'), { ref: 'connections/compiled/credentials', present: true });
    assert.equal(await restarted.delete('connections/compiled/credentials'), true);
    assert.equal(await first.has('connections/compiled/credentials'), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('ADR 0002: compiled object store keeps volume keys and metadata', async () => {
  const calls = [];
  const request = async (_auth, method, url) => {
    calls.push([method, url]);
    if (url.includes('/directories')) return { contents: [{ path: '/Volumes/main/ops/nervecenter/reports/daily.csv', file_size: 3, last_modified: '2026-10-10' }] };
    return new Response(Buffer.from('abc'));
  };
  const store = new DatabricksVolumeStore({ root: '/Volumes/main/ops/nervecenter', request });
  assert.deepEqual([...await store.list('reports')], [['reports/daily.csv', { size: 3, etag: '2026-10-10' }]]);
  assert.equal((await store.get('reports/daily.csv')).toString(), 'abc');
  assert.ok(calls.some(([, url]) => url.endsWith('/Volumes/main/ops/nervecenter/reports/daily.csv')));
});

test('ADR 0002: packaged file migrations run without a source tree', () => {
  const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'nc-packaged-migrations-'));
  try {
    fs.cpSync(path.join(backendRoot, 'dist'), path.join(stage, 'dist'), { recursive: true });
    fs.cpSync(path.join(backendRoot, 'migrations'), path.join(stage, 'migrations'), { recursive: true });
    assert.equal(fs.existsSync(path.join(stage, 'src')), false);
    const runtimeDir = path.join(stage, 'runtime');
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', "import { applyFileMigrations } from './dist/storage/file-migrations.mjs'; await applyFileMigrations();"], {
      cwd: stage,
      env: { ...process.env, OPS_TEST_DATA_ROOT: stage, OPS_RUNTIME_DIR: runtimeDir },
      encoding: 'utf8',
    });
    assert.equal(child.status, 0, child.stderr || child.stdout);
    const state = JSON.parse(fs.readFileSync(path.join(runtimeDir, 'file-migrations.json'), 'utf8'));
    assert.ok(state.applied['006-project-access.mjs']);
    const projects = JSON.parse(fs.readFileSync(path.join(runtimeDir, 'projects.json'), 'utf8'));
    assert.deepEqual(Object.keys(projects.projects).sort(), ['unrouted']);
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
});
