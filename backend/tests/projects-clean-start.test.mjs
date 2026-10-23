import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createBackend } from '../src/bootstrap.mjs';
import { RUNTIME_DIR, WORKSPACE_DIR } from '../src/config.mjs';

test('FR-51: startup leaves a clean deployment without PILOT and sync accepts the first new project', async () => {
  await fs.rm(path.join(RUNTIME_DIR, 'projects.json'));
  const backend = await createBackend();
  assert.deepEqual((await backend.projectStore.list()).map(project => project.id), ['unrouted']);
  await assert.rejects(fs.access(path.join(WORKSPACE_DIR, 'projects', 'pilot')));
  assert.deepEqual(await backend.integrationSync.poll({ force: true }), { skipped: 'no projects' });

  await backend.projectStore.create({ id: 'alpha', name: 'Alpha' }, { id: 'admin', type: 'system' });
  const result = await backend.integrationSync.poll({ force: true });
  assert.equal(result.github.skipped, 'GitHub source control is not configured');
  assert.deepEqual((await backend.projectStore.list()).map(project => project.id).sort(), ['alpha', 'unrouted']);
  await assert.rejects(fs.access(path.join(WORKSPACE_DIR, 'projects', 'pilot')));
});
