import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { applyControlMigrations } from '../src/storage/migrations.mjs';
import { PostgresJobStore } from '../src/jobs/job-store.mjs';

const url = process.env.NC_TEST_DATABASE_URL;

test('SPEC-platform-12 FR-1/FR-2: two Postgres workers claim distinct projects and fence an expired lease', { skip: !url && 'NC_TEST_DATABASE_URL is not set' }, async () => {
  const { default: pg } = await import('pg');
  const schema = `nc_jobs_${randomBytes(4).toString('hex')}`;
  const admin = new pg.Pool({ connectionString: url, max: 1 });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new pg.Pool({ connectionString: url, max: 4, options: `-c search_path=${schema}` });
  try {
    await applyControlMigrations(pool);
    await applyControlMigrations(pool);
    const first = new PostgresJobStore(pool);
    const second = new PostgresJobStore(pool);
    const dueAt = '2026-10-11T00:00:00Z';
    const enqueue = (projectId, slot) => first.enqueue({ projectId, source: 'github', slot, dueAt });
    const initial = await enqueue('alpha', '1');
    assert.equal(initial.created, true);
    assert.equal((await enqueue('alpha', '1')).created, false);
    await enqueue('alpha', '2');
    await enqueue('beta', '1');

    const at = '2026-10-11T00:01:00Z';
    const claims = await Promise.all([first.claim({ workerId: 'one', leaseMs: 1000, at }), second.claim({ workerId: 'two', leaseMs: 1000, at })]);
    assert.deepEqual(claims.map(job => job.projectId).sort(), ['alpha', 'beta']);
    assert.equal(await first.claim({ workerId: 'three', at }), null, 'another alpha job waits behind the active lease');
    const alpha = claims.find(job => job.projectId === 'alpha');
    const reclaimed = await second.claim({ workerId: 'recovery', at: '2026-10-11T00:01:02Z' });
    assert.equal(reclaimed.id, alpha.id);
    assert.notEqual(reclaimed.leaseToken, alpha.leaseToken);
    assert.equal(await first.complete({ id: alpha.id, leaseToken: alpha.leaseToken, at: '2026-10-11T00:01:02Z' }), null);
    assert.equal((await second.complete({ id: reclaimed.id, leaseToken: reclaimed.leaseToken, at: '2026-10-11T00:01:02Z' })).state, 'succeeded');
    assert.equal((await first.latest('alpha', 'github')).slot, '2');
    const next = await first.claim({ workerId: 'next', at: '2026-10-11T00:01:02Z' });
    assert.equal(next.projectId, 'alpha');
    assert.equal(next.slot, '2');
    assert.equal((await first.fail({ id: next.id, leaseToken: next.leaseToken, error: 'temporary provider error', retryDelayMs: 1000, at: '2026-10-11T00:01:02Z' })).state, 'retry');
    assert.equal((await first.latest('alpha', 'github')).state, 'retry');
    const skipped = await first.markSkipped({ projectId: 'gamma', source: 'github', slot: 'old', dueAt });
    assert.equal(skipped.job.state, 'skipped');
    assert.equal(await first.prune({ before: '2026-10-12T00:00:00Z', limit: 10 }), 2, 'only terminal history is removed');
    await pool.query('DELETE FROM ops_scheduled_jobs');
    await first.enqueue({ projectId: 'alpha', source: 'future-source', slot: '1', dueAt });
    assert.equal(await first.claim({ workerId: 'old-version', sources: ['github'], at }), null);
    assert.equal((await second.claim({ workerId: 'new-version', sources: ['future-source'], at })).source, 'future-source');
    await pool.query('DELETE FROM ops_scheduled_jobs');
    const ambiguous = (await first.enqueue({ projectId: 'alpha', source: 'routine', slot: '1', dueAt, maxAttempts: 1 })).job;
    const held = await first.claim({ workerId: 'routine-owner', leaseMs: 1000, at });
    assert.equal(held.id, ambiguous.id);
    assert.equal(await second.claim({ workerId: 'another-owner', at: '2026-10-11T00:01:02Z' }), null, 'a one-attempt job is never replayed after lease expiry');
    assert.equal((await first.get(ambiguous.id)).state, 'failed');
  } finally {
    await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
});
