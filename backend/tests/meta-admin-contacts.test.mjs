import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createBackend } from '../src/bootstrap.mjs';
import { createApiServer } from '../src/api/server.mjs';
import { tempDir } from './helpers.mjs';

// SPEC-platform-09 FR-9: /api/meta lists the emails in OPS_ADMIN_USER_IDS, nothing from admins.json or non-email ids.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = await tempDir('nc-admin-contacts-');

test('adminContacts keeps only email-like env entries and ignores admins.json', async () => {
  const file = path.join(tmp, 'admins.json');
  await fs.writeFile(file, JSON.stringify({ adminUserIds: ['file.admin@zs.com'] }));
  const env = { ...process.env, OPS_ADMIN_USER_IDS: 'a@zs.com, svc-account ,b@zs.com,a@zs.com', OPS_ADMIN_LIST_FILE: file };
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', "const { config } = await import('./src/config.mjs'); console.log(JSON.stringify(config.adminContacts));"], { cwd: root, env, encoding: 'utf8' });
  assert.deepEqual(JSON.parse(out.trim().split('\n').pop()), ['a@zs.com', 'b@zs.com']);
});

test('GET /api/meta returns adminContacts', async () => {
  const server = createApiServer(await createBackend());
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/meta`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.ok(Array.isArray(body.adminContacts));
    assert.ok(body.adminContacts.includes('mitesh.shinde@zs.com'));
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
