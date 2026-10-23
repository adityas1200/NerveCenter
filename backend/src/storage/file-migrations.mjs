import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { DATA_DIR, MIGRATIONS_DIR, RUNTIME_DIR } from '../config.mjs';
import { exists, readJson, writeJson } from '../lib/fs.mjs';
import { now } from '../lib/util.mjs';

// The file-store twin of migrations.mjs: every schema or data migration covers both stores. A migration is
// `backend/migrations/<number>-<title>.mjs` exporting `up({ runtimeDir, files, dataDir })`, next to the .sql of the same
// number. They run in file-name order, once each, and applied names are recorded in `file-migrations.json`
// under the runtime dir. Forward-only: there is no down. A migration that throws is not recorded and runs
// again on the next start, so `up` has to be safe to run twice (guard every rewrite).
export const FILE_MIGRATIONS_STATE = 'file-migrations.json';
let running = Promise.resolve();
let importCount = 0; // makes each import URL unique, so a migration that failed is read again after it is fixed

export function applyFileMigrations({ runtimeDir = RUNTIME_DIR, directory = MIGRATIONS_DIR } = {}) {
  // One run at a time in this process, so two boots in one process (tests) cannot interleave a rewrite.
  const result = running.catch(() => {}).then(() => apply(runtimeDir, directory));
  running = result;
  return result;
}

async function apply(runtimeDir, directory) {
  const stateFile = path.join(runtimeDir, FILE_MIGRATIONS_STATE);
  const state = (await exists(stateFile)) ? await readJson(stateFile) : {};
  const applied = state.applied && typeof state.applied === 'object' ? state.applied : {};
  const names = (await fs.readdir(directory)).filter(name => name.endsWith('.mjs')).sort();
  const ran = [];
  for (const name of names) {
    if (applied[name]) continue;
    // The query string keeps a retry in the same process from reusing the module that failed.
    const migration = await import(`${pathToFileURL(path.join(directory, name)).href}?run=${Date.now()}-${(importCount += 1)}`);
    if (typeof migration.up !== 'function') throw new Error(`File migration ${name} must export up()`);
    await migration.up({ runtimeDir, files: { exists, readJson, writeJson }, dataDir: DATA_DIR });
    applied[name] = now();
    await writeJson(stateFile, { applied });
    ran.push(name);
  }
  return { ran };
}
