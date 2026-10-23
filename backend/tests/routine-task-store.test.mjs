import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { tempDir } from './helpers.mjs';

const scheduledTask = (id, key, projectId = 'pilot') => ({
  id, projectId, type: 'routine', title: 'Daily', status: 'queued', createdAt: '2026-10-12T00:00:00.000Z', updatedAt: '2026-10-12T00:00:00.000Z',
  context: { routine: { name: 'daily', scheduledJobKey: key } }, pendingStart: { prompt: 'Inspect', user: null },
});

test('SPEC-routines-03 FR-4: file task store atomically creates one task for a scheduled key', async () => {
  const { FileTaskStore } = await import('../src/tasks/task-store.mjs');
  const root = await tempDir('nc-routine-task-store-'); const store = new FileTaskStore(root); await store.init();
  const [a, b] = await Promise.all([store.createScheduledTask(scheduledTask('T-1', 'pilot/daily/10'), 'pilot/daily/10'), store.createScheduledTask(scheduledTask('T-2', 'pilot/daily/10'), 'pilot/daily/10')]);
  assert.equal([a, b].filter(row => row.created).length, 1);
  assert.equal(a.task.id, b.task.id);
});

const url = process.env.NC_TEST_DATABASE_URL;
test('SPEC-routines-03 FR-4: Postgres unique slot index arbitrates concurrent task creation', { skip: !url && 'NC_TEST_DATABASE_URL is not set' }, async () => {
  const schema = `nc_routine_task_${randomBytes(4).toString('hex')}`;
  const { default: pg } = await import('pg');
  const admin = new pg.Pool({ connectionString: url, max: 1 });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new pg.Pool({ connectionString: url, max: 4, options: `-c search_path=${schema}` });
  const { applyControlMigrations } = await import('../src/storage/migrations.mjs');
  try {
    await applyControlMigrations(pool);
    const { PostgresTaskStore } = await import('../src/tasks/task-store.mjs');
    const store = new PostgresTaskStore(pool);
    await store.init();
    await pool.query("INSERT INTO ops_projects (id, name, slug) VALUES ('routine-test', 'Routine test', 'routine-test')");
    const rows = await Promise.all([
      store.createScheduledTask(scheduledTask('T-ROUTINE-1', 'routine-test/daily/100', 'routine-test'), 'routine-test/daily/100'),
      store.createScheduledTask(scheduledTask('T-ROUTINE-2', 'routine-test/daily/100', 'routine-test'), 'routine-test/daily/100'),
    ]);
    assert.equal(rows.filter(row => row.created).length, 1);
    assert.equal(rows[0].task.id, rows[1].task.id);
  } finally {
    await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => {});
    await pool.end();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => {});
    await admin.end();
  }
});
