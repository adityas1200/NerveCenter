import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { applyFileMigrations, FILE_MIGRATIONS_STATE } from '../src/storage/file-migrations.mjs';
import { tempDir } from './helpers.mjs';

// SPEC-projects-01 FR-44: a marker-tracked, forward-only, idempotent runner for the file store.
const tmp = await tempDir('nc-file-migrations-');
let counter = 0;
async function fixture(files) {
  counter += 1;
  const directory = path.join(tmp, `migrations-${counter}`); const runtimeDir = path.join(tmp, `runtime-${counter}`);
  await fs.mkdir(directory, { recursive: true }); await fs.mkdir(runtimeDir, { recursive: true });
  for (const [name, body] of Object.entries(files)) await fs.writeFile(path.join(directory, name), body);
  return { directory, runtimeDir };
}
const appendTo = (marker, label) => `import fs from 'node:fs/promises'; import path from 'node:path'; export async function up({ runtimeDir }) { await fs.appendFile(path.join(runtimeDir, '${marker}'), '${label}\\n'); }`;

test('FR-44: migrations run in file-name order, once each, and the .sql twins are ignored', async () => {
  const dirs = await fixture({ '002-b.mjs': appendTo('log', 'b'), '001-a.mjs': appendTo('log', 'a'), '001-a.sql': 'SELECT 1;', 'README.md': 'x' });
  assert.deepEqual((await applyFileMigrations(dirs)).ran, ['001-a.mjs', '002-b.mjs']);
  assert.equal(await fs.readFile(path.join(dirs.runtimeDir, 'log'), 'utf8'), 'a\nb\n');
  const state = JSON.parse(await fs.readFile(path.join(dirs.runtimeDir, FILE_MIGRATIONS_STATE), 'utf8'));
  assert.deepEqual(Object.keys(state.applied), ['001-a.mjs', '002-b.mjs']);
});

test('FR-44: a second run applies nothing, and a new migration added later runs alone', async () => {
  const dirs = await fixture({ '001-a.mjs': appendTo('log', 'a') });
  await applyFileMigrations(dirs);
  assert.deepEqual((await applyFileMigrations(dirs)).ran, []);
  await fs.writeFile(path.join(dirs.directory, '002-b.mjs'), appendTo('log', 'b'));
  assert.deepEqual((await applyFileMigrations(dirs)).ran, ['002-b.mjs']);
  assert.equal(await fs.readFile(path.join(dirs.runtimeDir, 'log'), 'utf8'), 'a\nb\n');
});

test('FR-44: a failing migration is not marked, stops the run, and runs again once fixed', async () => {
  const dirs = await fixture({ '001-a.mjs': appendTo('log', 'a'), '002-bad.mjs': 'export async function up() { throw new Error("boom"); }', '003-c.mjs': appendTo('log', 'c') });
  await assert.rejects(applyFileMigrations(dirs), /boom/);
  const state = JSON.parse(await fs.readFile(path.join(dirs.runtimeDir, FILE_MIGRATIONS_STATE), 'utf8'));
  assert.deepEqual(Object.keys(state.applied), ['001-a.mjs']);
  await fs.writeFile(path.join(dirs.directory, '002-bad.mjs'), appendTo('log', 'b'));
  assert.deepEqual((await applyFileMigrations(dirs)).ran, ['002-bad.mjs', '003-c.mjs']);
  assert.equal(await fs.readFile(path.join(dirs.runtimeDir, 'log'), 'utf8'), 'a\nb\nc\n');
});

test('FR-44: a migration without up() is rejected by name', async () => {
  const dirs = await fixture({ '001-nothing.mjs': 'export const x = 1;' });
  await assert.rejects(applyFileMigrations(dirs), /001-nothing\.mjs must export up/);
});

test('FR-44: concurrent starts in one process run each migration once', async () => {
  const dirs = await fixture({ '001-a.mjs': appendTo('log', 'a') });
  await Promise.all([applyFileMigrations(dirs), applyFileMigrations(dirs), applyFileMigrations(dirs)]);
  assert.equal(await fs.readFile(path.join(dirs.runtimeDir, 'log'), 'utf8'), 'a\n');
});
