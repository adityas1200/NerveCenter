import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { tempDir } from './helpers.mjs';
import { FileMonitorStore, PostgresMonitorStore, runKey } from '../src/monitoring/monitor-store.mjs';

// Rows that share a time come back in one fixed order, so walking the pages by offset sees each row exactly once
// (AI_CODE_GUIDELINES section 6: list queries order deterministically).

const projectId = 'paging';
const at = '2026-10-14T09:00:00.000Z';
const SIZE = 10;

async function walk(read) {
  const seen = []; let total = Infinity;
  for (let offset = 0; offset < total; offset += SIZE) { const pageRows = await read({ limit: SIZE, offset }); total = pageRows.total; seen.push(...pageRows.items); }
  return seen;
}

async function scenario(store) {
  // Runs: all on one start time, plus two with none (they sort last).
  const runs = Array.from({ length: 25 }, (_, i) => ({ platform: 'databricks', pipelineId: `job-${i % 3}`, runId: `r-${String(i).padStart(2, '0')}`, status: 'failed', startTime: i < 23 ? at : null }));
  await store.upsertRuns(projectId, runs);
  const seenRuns = await walk((page) => store.listRuns(projectId, page));
  assert.equal(seenRuns.length, 25);
  assert.equal(new Set(seenRuns.map(runKey)).size, 25, 'every run once');
  assert.deepEqual(seenRuns.slice(-2).map((run) => run.startTime ?? null), [null, null]);

  const results = Array.from({ length: 25 }, (_, i) => ({ key: `chk-${String(i).padStart(2, '0')}`, tableId: 't1', status: i % 2 ? 'passed' : 'failed', severity: 'high', executedAt: at }));
  await store.upsertDqResults(projectId, results);
  const seenDq = await walk((page) => store.listDqResults(projectId, page));
  assert.equal(new Set(seenDq.map((item) => item.key)).size, 25, 'every DQ result once');

  for (let i = 0; i < 25; i++) await store.createAlert({ id: `AL-${String(i).padStart(2, '0')}`, projectId, key: `k-${i}`, trigger: 'pipelineFailed', subjectId: `job-${i}`, openedAt: at });
  const seenAlerts = await walk((page) => store.listAlerts([projectId], page));
  assert.equal(new Set(seenAlerts.map((alert) => alert.id)).size, 25, 'every alert once');
}

test('file monitor store: runs, DQ results and alerts with the same time page without repeats or gaps', async () => {
  await scenario(new FileMonitorStore(await tempDir('nc-monitor-paging-')));
});

test('Postgres monitor store: runs, DQ results and alerts with the same time page without repeats or gaps', { skip: !process.env.NC_TEST_DATABASE_URL && 'NC_TEST_DATABASE_URL is not set' }, async () => {
  Object.assign(process.env, { OPS_METADATA_STORE: 'postgres', DATABASE_URL: process.env.NC_TEST_DATABASE_URL, NC_DB_SCHEMA: `nc_paging_${randomBytes(4).toString('hex')}`, OPS_PG_SSL: 'disable' });
  const { getPgPool, ensureControlSchema } = await import('../src/storage/postgres.mjs');
  const pool = await getPgPool();
  try {
    await ensureControlSchema(pool);
    await pool.query("INSERT INTO ops_projects (id, name, slug, kind, created_by) VALUES ($1, 'Paging', 'paging', 'normal', 'test') ON CONFLICT DO NOTHING", [projectId]);
    await scenario(new PostgresMonitorStore(pool));
  } finally {
    await pool.query(`DROP SCHEMA IF EXISTS ${process.env.NC_DB_SCHEMA} CASCADE`);
    await pool.end();
  }
});
