import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

// The whole backend boots on Postgres: schema and migrations run before any store reads, so the RBAC store's
// first query finds ops_rbac_meta (ADR 0003, migration 008). Skipped unless NC_TEST_DATABASE_URL is set, e.g.
//   docker run -d --name nc-pg -e POSTGRES_PASSWORD=nc -p 55432:5432 postgres:16
//   NC_TEST_DATABASE_URL=postgresql://postgres:nc@localhost:55432/postgres npm test
// It works in its own schema and drops it afterwards. Config is read when first imported, so every app import is
// dynamic and comes after the environment below.
const url = process.env.NC_TEST_DATABASE_URL;
const skip = !url && 'NC_TEST_DATABASE_URL is not set';
const schema = `nc_boot_${randomBytes(4).toString('hex')}`;

test('a fresh schema boots, and boots again, with every migration applied first', { skip }, async () => {
  Object.assign(process.env, { OPS_METADATA_STORE: 'postgres', DATABASE_URL: url, NC_DB_SCHEMA: schema, OPS_PG_SSL: 'disable' });
  const { createBackend } = await import('../src/bootstrap.mjs');
  const { getPgPool } = await import('../src/storage/postgres.mjs');
  const pool = await getPgPool();
  try {
    await createBackend();
    await createBackend(); // an existing database: nothing to migrate, nothing imported twice
    const tables = (await pool.query('SELECT table_name FROM information_schema.tables WHERE table_schema = $1', [schema])).rows.map(row => row.table_name);
    for (const name of ['ops_rbac_meta', 'ops_rbac_users', 'ops_secrets', 'ops_tickets', 'ops_tasks', 'ops_task_events', 'ops_inbox', 'ops_connection_profiles', 'ops_projects', 'ops_ticket_events', 'ops_schema_migrations']) assert.ok(tables.includes(name), `${name} exists`);
    assert.ok(!tables.includes('ops_rbac_audit'), 'migration 008 dropped the audit table');
    const migrated = (await pool.query('SELECT name FROM ops_schema_migrations')).rows.map(row => row.name);
    assert.ok(migrated.includes('001-control-schema.sql'));
    assert.ok(migrated.includes('008-drop-rbac-audit.sql'));
    assert.equal(migrated.length, 14);
    const indexes = (await pool.query('SELECT indexname FROM pg_indexes WHERE schemaname = $1', [schema])).rows.map(row => row.indexname);
    for (const name of ['ops_tickets_status_idx', 'ops_tasks_status_idx', 'ops_inbox_status_idx', 'ops_tasks_routine_slot_uq', 'ops_tasks_ticket_triage_key_uq']) assert.ok(indexes.includes(name), `${name} exists`);
  } finally {
    await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => {});
    await pool.end();
  }
});
