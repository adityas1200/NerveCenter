import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { applyFileMigrations } from '../src/storage/file-migrations.mjs';
import { applyControlMigrations } from '../src/storage/migrations.mjs';
import { FileOperationsStore } from '../src/app/operations-store.mjs';
import { FileTaskStore } from '../src/tasks/task-store.mjs';
import { FileProjectPersistence, ProjectStore } from '../src/projects/project-store.mjs';
import { systemScope } from '../src/projects/project-access.mjs';
import { MIGRATIONS_DIR } from '../src/config.mjs';
import { tempDir } from './helpers.mjs';

// SPEC-projects-01 FR-41, FR-43: everything that exists before projects is PILOT's, in both stores, and a
// second run changes nothing. The Postgres half runs only when NC_TEST_DATABASE_URL points at a database
// (the shared test environment strips DATABASE_URL on purpose), in its own schema that it drops afterwards.
const tmp = await tempDir('nc-projects-migration-');
const write = (file, value) => fs.mkdir(path.dirname(file), { recursive: true }).then(() => fs.writeFile(file, JSON.stringify(value)));
const read = async file => JSON.parse(await fs.readFile(file, 'utf8'));

async function legacyRuntime(name) {
  const runtimeDir = path.join(tmp, name);
  await write(path.join(runtimeDir, 'application-state.json'), { tickets: { 'OPS-1': { ticketId: 'OPS-1', title: 'Old' }, 'OPS-2': { ticketId: 'OPS-2', projectId: 'alpha' } }, settings: { boards: { b1: { id: 'b1', title: 'Board' } } } });
  await write(path.join(runtimeDir, 'tasks', 'index.json'), { tasks: { 'T-1': { id: 'T-1', type: 'agent' } } });
  await write(path.join(runtimeDir, 'tasks', 'inbox.json'), { items: { 'I-1': { id: 'I-1', kind: 'notification' } } });
  return runtimeDir;
}

test('FR-41: the file migration puts PILOT and Unrouted in place and stamps every old ticket, task, inbox item and board with pilot', async () => {
  const runtimeDir = await legacyRuntime('legacy');
  assert.deepEqual((await applyFileMigrations({ runtimeDir })).ran, ['003-projects.mjs', '004-ticket-connection.mjs', '005-project-roles.mjs', '006-project-access.mjs', '007-monitoring-ledger.mjs', '008-drop-rbac-audit.mjs', '009-per-project-settings.mjs', '010-ticket-events.mjs', '011-dq-result-key.mjs', '012-scheduled-jobs.mjs', '013-routine-task-slot.mjs', '014-ticket-triage-key.mjs']);
  const projects = await read(path.join(runtimeDir, 'projects.json'));
  assert.deepEqual(Object.keys(projects.projects).sort(), ['pilot', 'unrouted']);
  assert.equal(projects.projects.pilot.name, 'PILOT'); assert.equal(projects.projects.unrouted.kind, 'unrouted');
  const state = await read(path.join(runtimeDir, 'application-state.json'));
  assert.equal(state.tickets['OPS-1'].projectId, 'pilot'); assert.equal(state.tickets['OPS-2'].projectId, 'alpha', 'a row that already has a project is left alone');
  assert.equal(state.boards.b1.projectId, 'pilot');
  assert.equal((await read(path.join(runtimeDir, 'tasks', 'index.json'))).tasks['T-1'].projectId, 'pilot');
  assert.equal((await read(path.join(runtimeDir, 'tasks', 'inbox.json'))).items['I-1'].projectId, 'pilot');
});

test('FR-41: a second run of the file migration changes nothing, byte for byte', async () => {
  const runtimeDir = await legacyRuntime('twice');
  await applyFileMigrations({ runtimeDir });
  const files = ['projects.json', 'application-state.json', path.join('tasks', 'index.json'), path.join('tasks', 'inbox.json')];
  const before = await Promise.all(files.map(file => fs.readFile(path.join(runtimeDir, file), 'utf8')));
  assert.deepEqual((await applyFileMigrations({ runtimeDir })).ran, []);
  // Even with the marker gone the migration itself is idempotent (FR-44's belt and braces).
  await fs.rm(path.join(runtimeDir, 'file-migrations.json'));
  await applyFileMigrations({ runtimeDir });
  assert.deepEqual(await Promise.all(files.map(file => fs.readFile(path.join(runtimeDir, file), 'utf8'))), before);
});

test('FR-51: a fresh file install gets no PILOT project', async () => {
  const runtimeDir = path.join(tmp, 'fresh'); await fs.mkdir(runtimeDir, { recursive: true });
  await applyFileMigrations({ runtimeDir });
  assert.deepEqual(Object.keys((await read(path.join(runtimeDir, 'projects.json'))).projects).sort(), ['unrouted']);
  await assert.rejects(fs.access(path.join(runtimeDir, 'application-state.json')));
});

test('FR-51: a fresh Postgres install gets no PILOT project', { skip: !process.env.NC_TEST_DATABASE_URL && 'NC_TEST_DATABASE_URL is not set' }, async () => {
  const { default: pg } = await import('pg');
  const schema = `nc_test_${randomBytes(4).toString('hex')}`;
  const admin = new pg.Pool({ connectionString: process.env.NC_TEST_DATABASE_URL, max: 1 });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new pg.Pool({ connectionString: process.env.NC_TEST_DATABASE_URL, max: 2, options: `-c search_path=${schema}` });
  try {
    await applyControlMigrations(pool);
    assert.deepEqual((await pool.query('SELECT id FROM ops_projects ORDER BY id')).rows.map(row => row.id), ['unrouted']);
  } finally {
    await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end();
  }
});

test('FR-41: after the migration the stores read the old rows as PILOT\'s and nobody else\'s', async () => {
  const runtimeDir = await legacyRuntime('read-back');
  await applyFileMigrations({ runtimeDir });
  const ops = new FileOperationsStore(path.join(runtimeDir, 'application-state.json')); await ops.init();
  const tasks = new FileTaskStore(path.join(runtimeDir, 'tasks')); await tasks.init();
  assert.deepEqual((await ops.listTickets(systemScope('pilot'))).map(ticket => ticket.ticketId), ['OPS-1']);
  assert.deepEqual((await ops.listTickets(systemScope('alpha'))).map(ticket => ticket.ticketId), ['OPS-2']);
  assert.deepEqual((await tasks.listTasks(systemScope('pilot'), {})).map(task => task.id), ['T-1']);
  assert.deepEqual(await tasks.listTasks(systemScope('alpha'), {}), []);
  assert.deepEqual((await tasks.listInbox(systemScope('pilot'), {})).map(item => item.id), ['I-1']);
  const store = new ProjectStore({ persistence: new FileProjectPersistence(path.join(runtimeDir, 'projects.json')) }); await store.init();
  assert.deepEqual((await store.list()).map(project => project.id).sort(), ['pilot', 'unrouted']);
});

const url = process.env.NC_TEST_DATABASE_URL;
test('FR-41: the Postgres migration backfills tickets, tasks and inbox to pilot, and a re-run is a no-op', { skip: !url && 'NC_TEST_DATABASE_URL is not set' }, async () => {
  const { default: pg } = await import('pg');
  const schema = `nc_test_${randomBytes(4).toString('hex')}`;
  const admin = new pg.Pool({ connectionString: url, max: 1 });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new pg.Pool({ connectionString: url, max: 2, options: `-c search_path=${schema}` });
  try {
    // The tables as they were before this migration (what ensureControlSchema creates), with one old row each.
    await pool.query(`
      CREATE TABLE ops_application_settings (key text PRIMARY KEY, data jsonb NOT NULL DEFAULT '{}'::jsonb, updated_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE ops_tickets (ticket_id text PRIMARY KEY, pipeline_id text, run_id text, source_key text, status text NOT NULL, data jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(pipeline_id, run_id));
      CREATE TABLE ops_tasks (id text PRIMARY KEY, type text NOT NULL, status text NOT NULL, data jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE ops_inbox (id text PRIMARY KEY, task_id text, kind text NOT NULL, status text NOT NULL, data jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
      INSERT INTO ops_tickets(ticket_id, status, data) VALUES ('OPS-1', 'open', '{"ticketId":"OPS-1"}');
      INSERT INTO ops_tasks(id, type, status, data) VALUES ('T-1', 'agent', 'completed', '{"id":"T-1"}');
      INSERT INTO ops_inbox(id, kind, status, data) VALUES ('I-1', 'notification', 'pending', '{"id":"I-1"}');
      INSERT INTO ops_application_settings(key, data) VALUES ('boards', '{"b1":{"id":"b1"}}');`);
    await applyControlMigrations(pool);
    const check = async () => ({
      projects: (await pool.query('SELECT id FROM ops_projects ORDER BY id')).rows.map(row => row.id),
      ticket: (await pool.query('SELECT project_id, data->>\'projectId\' AS copy FROM ops_tickets')).rows,
      task: (await pool.query('SELECT project_id FROM ops_tasks')).rows,
      inbox: (await pool.query('SELECT project_id FROM ops_inbox')).rows,
      board: (await pool.query('SELECT project_id AS project FROM ops_boards WHERE id = \'b1\'')).rows,
    });
    const first = await check();
    assert.deepEqual(first.projects, ['pilot', 'unrouted']);
    assert.deepEqual(first.ticket, [{ project_id: 'pilot', copy: 'pilot' }]);
    assert.deepEqual(first.task, [{ project_id: 'pilot' }]); assert.deepEqual(first.inbox, [{ project_id: 'pilot' }]);
    assert.deepEqual(first.board, [{ project: 'pilot' }]);
    await assert.rejects(pool.query("INSERT INTO ops_tickets(ticket_id, status, data) VALUES ('OPS-2', 'open', '{}')"), /null value/, 'project_id is NOT NULL');
    // The SQL itself is safe to run again, and the runner does not re-apply it.
    await pool.query(await fs.readFile(path.join(MIGRATIONS_DIR, '003-projects.sql'), 'utf8'));
    await applyControlMigrations(pool);
    assert.deepEqual(await check(), first);
  } finally {
    await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end();
  }
});
