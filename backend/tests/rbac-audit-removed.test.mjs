import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createBackend } from '../src/bootstrap.mjs';
import { createApiServer } from '../src/api/server.mjs';
import { ROOT } from '../src/config.mjs';
import { up } from '../migrations/008-drop-rbac-audit.mjs';
import { tempDir } from './helpers.mjs';

// ADR 0003: the RBAC audit log is gone. No route, no store methods, no file, no table; the import-once
// marker lives on in ops_rbac_meta (covered with a pool stand-in in rbac-postgres.test.mjs).
const ADMIN = 'mitesh.shinde@zs.com';
let backend; let server; let base;
const call = async (method, url, user = ADMIN) => {
  const response = await fetch(`${base}${url}`, { method, headers: { 'x-user-id': user, 'x-user-name': user } });
  return { status: response.status, body: await response.json().catch(() => null) };
};

test.before(async () => {
  backend = await createBackend();
  server = createApiServer(backend);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => new Promise(resolve => server.close(resolve)));

test('ADR 0003: an app admin asking for the audit log gets 404', async () => {
  assert.equal((await call('GET', '/api/me')).status, 200);
  assert.equal((await call('GET', '/api/admin/rbac/audit?limit=200')).status, 404);
  assert.equal((await call('GET', '/api/admin/rbac/roles')).status, 200, 'the other RBAC routes stay');
});

test('ADR 0003: user changes are saved and nothing writes an audit file', async () => {
  const user = 'audit.free@zs.com';
  await call('GET', '/api/me', user);
  await backend.rbacStore.setRole(user, 'developer', { id: ADMIN, name: ADMIN });
  assert.equal(backend.rbacStore.get(user).role, 'developer');
  assert.equal(backend.rbacStore.listAudit, undefined);
  assert.equal(backend.rbacStore.recordAudit, undefined);
  const beside = path.join(path.dirname(process.env.OPS_RBAC_USERS_FILE), 'rbac-audit.json');
  await assert.rejects(fs.access(beside), { code: 'ENOENT' });
});

test('ADR 0003: file migration 008 deletes the audit file wherever a stack kept it, and runs twice', async () => {
  const dir = await tempDir('nc-mig-007-');
  const saved = { users: process.env.OPS_RBAC_USERS_FILE, audit: process.env.OPS_RBAC_AUDIT_FILE };
  try {
    process.env.OPS_RBAC_USERS_FILE = path.join(dir, 'runtime', 'rbac-users.json');
    process.env.OPS_RBAC_AUDIT_FILE = path.join(dir, 'elsewhere', 'audit.json');
    const beside = path.join(dir, 'runtime', 'rbac-audit.json');
    for (const file of [process.env.OPS_RBAC_USERS_FILE, process.env.OPS_RBAC_AUDIT_FILE, beside]) {
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, '{"entries":[]}');
    }
    await up();
    await up();
    await assert.rejects(fs.access(beside), { code: 'ENOENT' });
    await assert.rejects(fs.access(process.env.OPS_RBAC_AUDIT_FILE), { code: 'ENOENT' });
    await fs.access(process.env.OPS_RBAC_USERS_FILE); // the directory itself is untouched
  } finally {
    for (const [key, value] of [['OPS_RBAC_USERS_FILE', saved.users], ['OPS_RBAC_AUDIT_FILE', saved.audit]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

// No test may reach a real Postgres, so the SQL is checked for the guards that make it safe: the marker is
// copied before the drop, a fresh database (no ops_rbac_audit yet) is skipped, and a second run is a no-op.
test('ADR 0003: SQL migration 008 keeps the import marker and is guarded for fresh databases and reruns', async () => {
  const sql = await fs.readFile(path.join(ROOT, 'migrations', '008-drop-rbac-audit.sql'), 'utf8');
  const create = sql.indexOf('CREATE TABLE IF NOT EXISTS ops_rbac_meta');
  const copy = sql.indexOf("INSERT INTO ops_rbac_meta(key, at) SELECT id, at FROM ops_rbac_audit WHERE id = 'rbac-file-import' ON CONFLICT (key) DO NOTHING");
  const drop = sql.indexOf('DROP TABLE IF EXISTS ops_rbac_audit;');
  assert.ok(create >= 0 && copy > create && drop > copy, 'create the table, copy the marker, then drop');
  assert.match(sql, /IF to_regclass\('ops_rbac_audit'\) IS NOT NULL THEN/);
});
