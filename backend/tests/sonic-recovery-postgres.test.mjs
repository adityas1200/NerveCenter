import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

const url = process.env.NC_TEST_DATABASE_URL;

test('ADR 0013: Postgres atomically appends accepted follow-ups and claims a turn once', { skip: !url && 'NC_TEST_DATABASE_URL is not set' }, async () => {
  const schema = `nc_sonic_${randomBytes(4).toString('hex')}`;
  Object.assign(process.env, { OPS_METADATA_STORE: 'postgres', DATABASE_URL: url, NC_DB_SCHEMA: schema, OPS_PG_SSL: 'disable' });
  const { createTaskStore } = await import('../src/tasks/task-store.mjs');
  const { getPgPool } = await import('../src/storage/postgres.mjs');
  const pool = await getPgPool();
  try {
    const store = await createTaskStore();
    await pool.query("INSERT INTO ops_projects (id, name, slug) VALUES ('sonic-test', 'Sonic test', 'sonic-test')");
    const at = new Date().toISOString();
    await store.createTask({ id: 'T-RESTART', projectId: 'sonic-test', type: 'adhoc', status: 'queued', createdAt: at, updatedAt: at, pendingStart: { prompt: 'Inspect only', user: { id: 'reviewer' } } });
    const first = { id: 'q-1', text: 'Check another run', user: { id: 'reviewer' } };
    const second = { id: 'q-2', text: 'Summarize results', user: { id: 'reviewer' } };
    await Promise.all([store.appendPendingMessage('T-RESTART', first), store.appendPendingMessage('T-RESTART', second)]);
    await store.updateTask('T-RESTART', { title: 'Inspection' });
    assert.deepEqual((await store.getTask('T-RESTART')).pendingMessages.map(item => item.id).sort(), ['q-1', 'q-2']);

    const claims = await Promise.all([store.claimRun('T-RESTART', null, at), store.claimRun('T-RESTART', null, at)]);
    assert.equal(claims.filter(Boolean).length, 1);
    assert.equal((await store.getTask('T-RESTART')).pendingStart, null);
    const claimedMessage = await store.claimRun('T-RESTART', 'q-1', at);
    assert.ok(claimedMessage);
    assert.equal(await store.claimRun('T-RESTART', 'q-1', at), null);
    assert.deepEqual((await store.getTask('T-RESTART')).pendingMessages.map(item => item.id), ['q-2']);
  } finally {
    await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => {});
    await pool.end();
  }
});
