import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { BOARD_LIST_MAX, FileOperationsStore, PostgresOperationsStore } from '../src/app/operations-store.mjs';
import { BoardService } from '../src/boards/board-service.mjs';
import { ROOT } from '../src/config.mjs';
import { systemScope } from '../src/projects/project-access.mjs';
import { up } from '../migrations/009-per-project-settings.mjs';
import { tempDir } from './helpers.mjs';

// ADR 0004: boards and data quality configs are stored per project, a board per record, not in one shared settings blob.
const tmp = await tempDir('nc-per-project-');
const builder = { id: 'dev@zs.com', name: 'Dev', role: 'developer' };
const fileStore = async () => { const store = new FileOperationsStore(path.join(tmp, `ops-${Math.random().toString(36).slice(2, 8)}.json`)); await store.init(); return store; };
const widget = { id: 'w1', type: 'text', title: 'Note', text: 'hi' };

test('ADR 0004: boards made at the same time in two projects are all kept, and each project lists only its own', async () => {
  const boards = new BoardService({ store: await fileStore() });
  // One shared blob read-modify-written per change lost all but the last of these.
  const made = await Promise.all([
    ...Array.from({ length: 4 }, (_, i) => boards.create({ title: `Pilot ${i}` }, builder, systemScope('pilot'))),
    ...Array.from({ length: 4 }, (_, i) => boards.create({ title: `Sales ${i}` }, builder, systemScope('sales'))),
  ]);
  assert.equal(new Set(made.map(board => board.id)).size, 8);
  const pilot = await boards.list(builder, systemScope('pilot'));
  const sales = await boards.list(builder, systemScope('sales'));
  assert.deepEqual(pilot.map(board => board.title).sort(), ['Pilot 0', 'Pilot 1', 'Pilot 2', 'Pilot 3']);
  assert.deepEqual(sales.map(board => board.title).sort(), ['Sales 0', 'Sales 1', 'Sales 2', 'Sales 3']);
  await assert.rejects(boards.get(sales[0].id, builder, systemScope('pilot')), /do not have access/);
});

test('ADR 0004: views counted while the board is edited never undo the edit, and do not move updatedAt', async () => {
  const boards = new BoardService({ store: await fileStore() });
  const scope = systemScope('pilot');
  const board = await boards.create({ title: 'Busy' }, builder, scope);
  await Promise.all([boards.update(board.id, { title: 'Renamed', widgets: [widget] }, builder, scope), ...Array.from({ length: 5 }, () => boards.noteView(board.id))]);
  const after = await boards.get(board.id, builder, scope);
  assert.equal(after.title, 'Renamed');
  assert.equal(after.views, 5);
  await boards.noteView(board.id);
  assert.equal((await boards.get(board.id, builder, scope)).updatedAt, after.updatedAt);
});

test('ADR 0004: deleting a board removes only that board', async () => {
  const boards = new BoardService({ store: await fileStore() });
  const scope = systemScope('pilot');
  const keep = await boards.create({ title: 'Keep' }, builder, scope);
  const drop = await boards.create({ title: 'Drop' }, builder, scope);
  assert.deepEqual(await boards.remove(drop.id, builder, scope), { id: drop.id, deleted: true });
  assert.deepEqual((await boards.list(builder, scope)).map(board => board.id), [keep.id]);
});

test('ADR 0004: each project has its own data quality config; no project means PILOT', async () => {
  const store = await fileStore();
  await store.setDataQualityConfig({ tables: ['pilot.t'] });
  await store.setDataQualityConfig({ tables: ['sales.t'] }, 'sales');
  assert.deepEqual(await store.getDataQualityConfig('pilot'), { tables: ['pilot.t'] });
  assert.deepEqual(await store.getDataQualityConfig('sales'), { tables: ['sales.t'] });
  assert.equal(await store.getDataQualityConfig('finance'), null);
});

test('ADR 0004: the Postgres store reads one project with a bounded, ordered query and writes one row', async () => {
  const sent = [];
  const store = new PostgresOperationsStore({ async query(sql, params) { sent.push({ sql: sql.replace(/\s+/g, ' '), params }); return { rows: [{ data: { id: 'B-1', projectId: 'sales' } }], rowCount: 1 }; } });
  await store.listBoards(systemScope('sales'), { limit: 10_000 });
  assert.match(sent[0].sql, /FROM ops_boards WHERE project_id = ANY\(\$2\) ORDER BY updated_at DESC, id LIMIT \$1/);
  assert.deepEqual(sent[0].params, [BOARD_LIST_MAX, ['sales']], 'a caller cannot ask for more than the cap');
  await store.putBoard({ id: 'B-1', projectId: 'sales', title: 'x' });
  assert.match(sent[1].sql, /^INSERT INTO ops_boards\(id,project_id,data,updated_at\)/);
  await store.noteBoardView('B-1', '2026-10-06T00:00:00Z');
  assert.match(sent[2].sql, /^UPDATE ops_boards SET data = jsonb_set/, 'a view is one atomic UPDATE');
  await store.setDataQualityConfig({ tables: [] });
  assert.equal(sent[3].params[0], 'pilot');
});

async function legacyState(settings) {
  const runtimeDir = await fs.mkdtemp(path.join(tmp, 'rt-'));
  await fs.writeFile(path.join(runtimeDir, 'application-state.json'), JSON.stringify({ ticketCounter: 1001, tickets: { 'OPS-1': { ticketId: 'OPS-1' } }, settings }));
  return runtimeDir;
}
const readState = async runtimeDir => JSON.parse(await fs.readFile(path.join(runtimeDir, 'application-state.json'), 'utf8'));

test('ADR 0004: file migration 009 moves boards and data quality configs out of settings, and runs twice', async () => {
  const runtimeDir = await legacyState({
    boards: { b1: { id: 'b1', title: 'Old' }, b2: { id: 'b2', title: 'Sales', projectId: 'sales' } },
    dataQuality: { tables: ['pilot.t'] },
    'dataQuality:sales': { tables: ['sales.t'] },
  });
  await up({ runtimeDir });
  const once = await readState(runtimeDir);
  await up({ runtimeDir });
  assert.deepEqual(await readState(runtimeDir), once, 'a second run changes nothing');
  assert.equal(once.settings, undefined);
  assert.equal(once.boards.b1.projectId, 'pilot', 'a board from before projects is PILOT\'s');
  assert.equal(once.boards.b2.projectId, 'sales');
  assert.deepEqual(once.dataQuality, { pilot: { tables: ['pilot.t'] }, sales: { tables: ['sales.t'] } });
  assert.deepEqual(once.tickets, { 'OPS-1': { ticketId: 'OPS-1' } }, 'tickets are untouched');
});

test('ADR 0004: file migration 009 stops on a settings key it does not know, and leaves the file as it was', async () => {
  const runtimeDir = await legacyState({ boards: {}, theme: { dark: true } });
  const before = await readState(runtimeDir);
  await assert.rejects(up({ runtimeDir }), /does not move: theme/);
  assert.deepEqual(await readState(runtimeDir), before);
});

// No test may reach a real Postgres (the Postgres migration test runs only with NC_TEST_DATABASE_URL), so the SQL is
// checked for its guards: copy before drop, unknown keys stop it, a fresh database is skipped, a rerun is a no-op.
test('ADR 0004: SQL migration 009 copies before it drops and is guarded', async () => {
  const sql = await fs.readFile(path.join(ROOT, 'migrations', '009-per-project-settings.sql'), 'utf8');
  const at = text => { const index = sql.indexOf(text); assert.ok(index >= 0, `missing: ${text}`); return index; };
  const order = [
    at('CREATE TABLE IF NOT EXISTS ops_boards'), at('CREATE TABLE IF NOT EXISTS ops_data_quality_configs'),
    at("IF to_regclass('ops_application_settings') IS NOT NULL THEN"), at('RAISE EXCEPTION'),
    at('INSERT INTO ops_boards'), at('INSERT INTO ops_data_quality_configs'), at('DROP TABLE IF EXISTS ops_application_settings;'),
  ];
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
  assert.equal((sql.match(/ON CONFLICT \((id|project_id)\) DO NOTHING/g) || []).length, 2);
  const migration003 = await fs.readFile(path.join(ROOT, 'migrations', '003-projects.sql'), 'utf8');
  assert.match(migration003, /IF to_regclass\('ops_application_settings'\) IS NOT NULL THEN\s+EXECUTE \$q\$UPDATE ops_application_settings/, '003 runs on a fresh database without the table');
});
