import test from 'node:test';
import assert from 'node:assert/strict';
import { PostgresSecretStore } from '../src/secrets/secret-store.mjs';

/** Enough of pg for the secret store's four statements. */
function fakePool() {
  const rows = new Map();
  return {
    rows,
    async query(sql, params = []) {
      if (/^CREATE TABLE/.test(sql)) return { rows: [], rowCount: 0 };
      if (/^INSERT/.test(sql)) { rows.set(params[0], params[1]); return { rows: [], rowCount: 1 }; }
      if (/^SELECT value/.test(sql)) return { rows: rows.has(params[0]) ? [{ value: rows.get(params[0]) }] : [] };
      if (/^SELECT 1/.test(sql)) return { rows: rows.has(params[0]) ? [{}] : [] };
      if (/^DELETE/.test(sql)) { const had = rows.delete(params[0]); return { rows: [], rowCount: had ? 1 : 0 }; }
      throw new Error(`unexpected ${sql}`);
    },
  };
}

test('secrets are encrypted into Postgres and only the right key reads them back', async () => {
  const pool = fakePool();
  const store = new PostgresSecretStore({ key: 'k1', pool });
  await store.set('integrations/jira/token', 'jira-secret-value');
  assert.equal(await store.get('integrations/jira/token'), 'jira-secret-value');
  assert.ok(!pool.rows.get('integrations/jira/token').includes('jira-secret-value'), 'never stored in the clear');
  assert.deepEqual(await store.status('integrations/jira/token'), { ref: 'integrations/jira/token', present: true });
  await assert.rejects(new PostgresSecretStore({ key: 'other', pool }).get('integrations/jira/token'), 'a different key cannot decrypt');
  assert.equal(await store.delete('integrations/jira/token'), true);
  assert.equal(await store.get('integrations/jira/token'), undefined);
  assert.throws(() => new PostgresSecretStore({ key: '', pool }), /OPS_SECRET_ENCRYPTION_KEY/);
});

test('an operator-named aws: secret is read from Secrets Manager, not the table', async () => {
  const pool = fakePool();
  const aws = { get: async ref => (ref === 'aws:beacon/dev/jira' ? '{"token":"t"}' : undefined), has: async ref => ref === 'aws:beacon/dev/jira' };
  const store = new PostgresSecretStore({ key: 'k1', pool, aws });
  assert.equal(await store.get('aws:beacon/dev/jira'), '{"token":"t"}');
  assert.equal(await store.has('aws:beacon/dev/jira'), true);
  assert.equal(await store.has('aws:missing'), false);
  assert.equal(pool.rows.size, 0);
});
