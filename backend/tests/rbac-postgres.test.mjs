import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FileRbacPersistence, PostgresRbacPersistence, RbacStore } from '../src/app/rbac-store.mjs';
import { tempDir } from './helpers.mjs';

// On k8s the directory lives in Postgres; before, a restart put back the file baked into the
// image, so deletions and role changes made in Settings > Users & roles came undone. A pool
// stand-in answers the statements the adapter sends, with rows kept in memory across "restarts".

const tmp = await tempDir('nc-rbac-pg-');

function fakePool() {
  const users = new Map(); const meta = new Map();
  return {
    users, meta,
    async query(sql, params = []) {
      const text = sql.replace(/\s+/g, ' ').trim();
      if (text.startsWith('CREATE ')) return { rows: [], rowCount: 0 };
      if (text.startsWith('SELECT data FROM ops_rbac_users')) return { rows: [...users.values()].map(data => ({ data })) };
      if (text.startsWith('INSERT INTO ops_rbac_users')) {
        const [id, json] = params;
        if (users.has(id) && !text.includes('DO UPDATE')) return { rows: [], rowCount: 0 };
        users.set(id, JSON.parse(json)); return { rows: [], rowCount: 1 };
      }
      if (text.startsWith('DELETE FROM ops_rbac_users')) return { rows: [], rowCount: users.delete(params[0]) ? 1 : 0 };
      // ADR 0003: the import-once marker lives in ops_rbac_meta; there is no audit table to write to.
      if (text.startsWith('INSERT INTO ops_rbac_meta')) {
        const [key] = params;
        if (meta.has(key)) return { rows: [], rowCount: 0 };
        meta.set(key, new Date().toISOString()); return { rows: [{ key }], rowCount: 1 };
      }
      throw new Error(`unexpected SQL: ${text}`);
    },
  };
}

const usersFile = path.join(tmp, 'rbac-users.json');
await fs.writeFile(usersFile, JSON.stringify({ users: [
  { id: 'demo.user', name: 'Demo User', role: 'admin', blocked: false },
  { id: 'admin.local', name: 'Local Admin', role: 'admin', blocked: false },
] }));
const file = new FileRbacPersistence({ usersFile });
const boot = async pool => { const store = new RbacStore({ persistence: new PostgresRbacPersistence({ pool, file }) }); await store.init(); return store; };
const actor = { id: 'admin@zs.com', name: 'Admin' };

test('on Postgres a deleted user stays deleted after a restart, and the file is imported once', async () => {
  const pool = fakePool();
  const first = await boot(pool);
  assert.ok(first.get('demo.user') && first.get('admin.local'), 'the first boot carries the existing file directory over');
  assert.equal(await first.remove('demo.user', actor), true);

  const restarted = await boot(pool);
  assert.equal(restarted.get('demo.user'), null, 'the image file does not bring a deleted user back');
  assert.ok(restarted.get('admin.local'));
  assert.deepEqual([...pool.meta.keys()], ['rbac-file-import'], 'the import is claimed once, in ops_rbac_meta');
});

test('on Postgres role changes and blocks survive a restart', async () => {
  const pool = fakePool();
  const first = await boot(pool);
  await first.setRole('admin.local', 'viewer', actor);
  await first.upsert({ id: 'priya@zs.com', name: 'Priya', role: 'developer' }, actor);
  await first.setBlocked('priya@zs.com', true, actor, 'left the team');

  const restarted = await boot(pool);
  assert.equal(restarted.get('admin.local').role, 'viewer');
  assert.equal(restarted.get('priya@zs.com').blocked, true);
  assert.equal(pool.users.get('priya@zs.com').blocked, true, 'only the changed row is written');
});

test('two pods booting together import the file only once', async () => {
  const pool = fakePool();
  await Promise.all([boot(pool), boot(pool)]);
  assert.deepEqual([...pool.meta.keys()], ['rbac-file-import']);
  assert.ok(pool.users.has('demo.user') && pool.users.has('admin.local'));
});
