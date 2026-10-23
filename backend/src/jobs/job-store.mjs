import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { RUNTIME_DIR, config } from '../config.mjs';
import { ensureDir, exists, readJson, writeJson } from '../lib/fs.mjs';
import { getPgPool, ensureControlSchema } from '../storage/postgres.mjs';

const MAX_ATTEMPTS = 3;
const MAX_LEASE_MS = 15 * 60_000;
const MAX_RETRY_MS = 60 * 60_000;
const MAX_PRUNE = 1000;
const asIso = value => new Date(value ?? Date.now()).toISOString();
const timeMs = value => Date.parse(value);
const slotOrder = (left, right) => {
  const a = String(left), b = String(right);
  if (/^\d+$/.test(a) && /^\d+$/.test(b)) return BigInt(a) > BigInt(b) ? 1 : BigInt(a) < BigInt(b) ? -1 : 0;
  return a.localeCompare(b);
};
const boundedInt = (value, fallback, max) => Math.max(1, Math.min(max, Math.trunc(Number(value) || fallback)));
const clone = value => value == null ? value : structuredClone(value);
const cleanJob = row => row ? ({
  id: row.id,
  projectId: row.project_id ?? row.projectId,
  source: row.source,
  slot: row.slot,
  dueAt: asIso(row.due_at ?? row.dueAt),
  state: row.state,
  payload: clone(row.payload ?? {}),
  result: clone(row.result),
  error: row.error ?? null,
  attempts: Number(row.attempts),
  maxAttempts: Number(row.max_attempts ?? row.maxAttempts),
  workerId: row.worker_id ?? row.workerId ?? null,
  leaseToken: row.lease_token ?? row.leaseToken ?? null,
  leaseExpiresAt: (row.lease_expires_at ?? row.leaseExpiresAt)
    ? asIso(row.lease_expires_at ?? row.leaseExpiresAt)
    : null,
  createdAt: asIso(row.created_at ?? row.createdAt),
  updatedAt: asIso(row.updated_at ?? row.updatedAt),
  finishedAt: (row.finished_at ?? row.finishedAt)
    ? asIso(row.finished_at ?? row.finishedAt)
    : null,
  history: clone(row.history ?? []),
}) : null;

export class FileJobStore {
  constructor(runtimeDir = RUNTIME_DIR) {
    this.file = path.join(runtimeDir, 'jobs', 'jobs.json');
    this.queue = Promise.resolve();
  }

  async init() { await ensureDir(path.dirname(this.file)); }

  async #locked(fn) {
    const previous = this.queue;
    let release;
    this.queue = new Promise(resolve => { release = resolve; });
    await previous;
    try {
      return await fn();
    } finally {
      release();
    }
  }

  async #read() { return (await exists(this.file)) ? readJson(this.file) : { jobs: {} }; }
  async #write(doc) { await writeJson(this.file, doc); }

  async enqueue(input) {
    const values = normalizeEnqueue(input);
    return this.#locked(async () => {
      const doc = await this.#read();
      const existing = Object.values(doc.jobs).find(j =>
        j.projectId === values.projectId && j.source === values.source && j.slot === values.slot);
      if (existing) return { job: clone(existing), created: false };

      const at = asIso();
      const job = {
        id: randomUUID(),
        ...values,
        state: 'queued',
        result: null,
        error: null,
        attempts: 0,
        workerId: null,
        leaseToken: null,
        leaseExpiresAt: null,
        createdAt: at,
        updatedAt: at,
        finishedAt: null,
        history: [{ state: 'queued', at }],
      };
      doc.jobs[job.id] = job;
      await this.#write(doc);
      return { job: clone(job), created: true };
    });
  }
  async markSkipped(input) {
    const values = normalizeEnqueue(input);
    return this.#locked(async () => {
      const doc = await this.#read();
      const existing = Object.values(doc.jobs).find(j =>
        j.projectId === values.projectId && j.source === values.source && j.slot === values.slot);
      if (existing) return { job: clone(existing), created: false };

      const at = asIso();
      const job = {
        id: randomUUID(),
        ...values,
        state: 'skipped',
        result: null,
        error: null,
        attempts: 0,
        workerId: null,
        leaseToken: null,
        leaseExpiresAt: null,
        createdAt: at,
        updatedAt: at,
        finishedAt: at,
        history: [{ state: 'skipped', at }],
      };
      doc.jobs[job.id] = job;
      await this.#write(doc);
      return { job: clone(job), created: true };
    });
  }

  async claim({ workerId = 'worker', leaseMs = 60_000, at = new Date(), sources = null } = {}) {
    return this.#locked(async () => {
      const doc = await this.#read();
      const now = asIso(at);
      const nowMs = timeMs(now);
      let expired = false;
      for (const j of Object.values(doc.jobs)) {
        if (j.state === 'running' && timeMs(j.leaseExpiresAt) <= nowMs && j.attempts >= j.maxAttempts) {
          expired = true;
          j.state = 'failed';
          j.leaseToken = null;
          j.leaseExpiresAt = null;
          j.workerId = null;
          j.error = j.error || 'Worker lease expired';
          j.finishedAt = now;
          j.updatedAt = now;
          j.history.push({ state: 'failed', at: now, error: j.error });
        }
      }
      const job = Object.values(doc.jobs)
        .filter(j => (!sources || sources.includes(j.source))
          && (j.state === 'queued' || j.state === 'retry'
            || (j.state === 'running' && timeMs(j.leaseExpiresAt) <= nowMs))
          && timeMs(j.dueAt) <= nowMs
          && j.attempts < j.maxAttempts
          && !Object.values(doc.jobs).some(active => active.projectId === j.projectId
            && active.id !== j.id && active.state === 'running' && timeMs(active.leaseExpiresAt) > nowMs))
        .sort((a, b) => timeMs(a.dueAt) - timeMs(b.dueAt)
          || timeMs(a.createdAt) - timeMs(b.createdAt)
          || a.id.localeCompare(b.id))[0];
      if (!job) {
        if (expired) await this.#write(doc);
        return null;
      }

      const token = randomUUID();
      job.state = 'running';
      job.attempts += 1;
      job.workerId = String(workerId);
      job.leaseToken = token;
      job.leaseExpiresAt = new Date(nowMs + boundedInt(leaseMs, 60_000, MAX_LEASE_MS)).toISOString();
      job.updatedAt = now;
      job.history.push({ state: 'running', at: now, attempt: job.attempts, workerId: job.workerId });
      await this.#write(doc);
      return clone(job);
    });
  }

  async #owned({ id, leaseToken }, mutate) {
    return this.#locked(async () => {
      const doc = await this.#read();
      const j = doc.jobs[id];
      if (!j || j.state !== 'running' || j.leaseToken !== leaseToken) return null;
      mutate(j);
      await this.#write(doc);
      return clone(j);
    });
  }

  async renew({ id, leaseToken, leaseMs = 60_000, at = new Date() }) {
    return this.#owned({ id, leaseToken }, j => {
      const now = asIso(at);
      j.leaseExpiresAt = new Date(timeMs(now) + boundedInt(leaseMs, 60_000, MAX_LEASE_MS)).toISOString();
      j.updatedAt = now;
    });
  }

  async complete({ id, leaseToken, result = null, at = new Date() }) {
    return this.#owned({ id, leaseToken }, j => {
      const now = asIso(at);
      j.state = 'succeeded';
      j.result = clone(result);
      j.error = null;
      j.leaseToken = null;
      j.leaseExpiresAt = null;
      j.workerId = null;
      j.updatedAt = now;
      j.finishedAt = now;
      j.history.push({ state: 'succeeded', at: now });
    });
  }

  async skip({ id, leaseToken, reason = 'Scheduled work is no longer eligible', at = new Date() }) {
    return this.#owned({ id, leaseToken }, j => {
      const now = asIso(at);
      j.state = 'skipped'; j.result = { skipped: true }; j.error = String(reason).slice(0, 2000);
      j.leaseToken = null; j.leaseExpiresAt = null; j.workerId = null; j.updatedAt = now; j.finishedAt = now;
      j.history.push({ state: 'skipped', at: now, error: j.error });
    });
  }

  async fail({ id, leaseToken, error, retryDelayMs = 1000, at = new Date() }) {
    return this.#owned({ id, leaseToken }, j => {
      const now = asIso(at);
      j.error = String(error || 'Scheduled job failed').slice(0, 2000);
      j.leaseToken = null;
      j.leaseExpiresAt = null;
      j.workerId = null;
      j.updatedAt = now;
      const retry = j.attempts < j.maxAttempts;
      j.state = retry ? 'retry' : 'failed';
      j.dueAt = retry
        ? new Date(timeMs(now) + boundedInt(retryDelayMs, 1000, MAX_RETRY_MS)).toISOString()
        : j.dueAt;
      j.finishedAt = retry ? null : now;
      j.history.push({ state: j.state, at: now, error: j.error });
    });
  }

  async get(id) {
    const doc = await this.#read();
    return clone(doc.jobs[id] || null);
  }

  async latest(projectId, source, { routine } = {}) {
    const doc = await this.#read();
    const found = Object.values(doc.jobs)
      .filter(j => j.projectId === String(projectId) && j.source === String(source) && (routine === undefined || j.payload?.routine === String(routine)))
      .sort((a, b) => timeMs(b.dueAt) - timeMs(a.dueAt) || slotOrder(b.slot, a.slot) || b.id.localeCompare(a.id))[0];
    return clone(found || null);
  }

  async prune({ before, limit = MAX_PRUNE } = {}) {
    return this.#locked(async () => {
      const doc = await this.#read();
      const cutoff = timeMs(before);
      const cap = boundedInt(limit, MAX_PRUNE, MAX_PRUNE);
      const candidates = Object.values(doc.jobs)
        .filter(j => ['succeeded', 'failed', 'skipped'].includes(j.state) && timeMs(j.finishedAt) < cutoff)
        .sort((a, b) => timeMs(a.finishedAt) - timeMs(b.finishedAt))
        .slice(0, cap);
      for (const j of candidates) delete doc.jobs[j.id];
      if (candidates.length) await this.#write(doc);
      return candidates.length;
    });
  }
}

export class PostgresJobStore {
  constructor(pool) {
    this.pool = pool;
  }

  async init() {
    this.pool ||= await getPgPool();
    await ensureControlSchema(this.pool);
  }

  async enqueue(input) {
    const v = normalizeEnqueue(input);
    const id = randomUUID();
    const at = new Date().toISOString();
    const r = await this.pool.query(`INSERT INTO ops_scheduled_jobs (id,project_id,source,slot,due_at,state,payload,max_attempts,history) VALUES ($1,$2,$3,$4,$5,'queued',$6::jsonb,$7,jsonb_build_array(jsonb_build_object('state','queued','at',$8::text))) ON CONFLICT (project_id,source,slot) DO NOTHING RETURNING *`, [id, v.projectId, v.source, v.slot, v.dueAt, JSON.stringify(v.payload), v.maxAttempts, at]);
    if (r.rows[0]) return { job: cleanJob(r.rows[0]), created: true };
    const existing = await this.pool.query('SELECT * FROM ops_scheduled_jobs WHERE project_id=$1 AND source=$2 AND slot=$3', [v.projectId, v.source, v.slot]);
    return { job: cleanJob(existing.rows[0]), created: false };
  }

  async markSkipped(input) {
    const v = normalizeEnqueue(input);
    const id = randomUUID();
    const at = new Date().toISOString();
    const r = await this.pool.query(`INSERT INTO ops_scheduled_jobs (id,project_id,source,slot,due_at,state,payload,max_attempts,finished_at,history) VALUES ($1,$2,$3,$4,$5,'skipped',$6::jsonb,$7,$8::timestamptz,jsonb_build_array(jsonb_build_object('state','skipped','at',$8::text))) ON CONFLICT (project_id,source,slot) DO NOTHING RETURNING *`, [id, v.projectId, v.source, v.slot, v.dueAt, JSON.stringify(v.payload), v.maxAttempts, at]);
    if (r.rows[0]) return { job: cleanJob(r.rows[0]), created: true };
    const existing = await this.pool.query('SELECT * FROM ops_scheduled_jobs WHERE project_id=$1 AND source=$2 AND slot=$3', [v.projectId, v.source, v.slot]);
    return { job: cleanJob(existing.rows[0]), created: false };
  }

  async claim({ workerId = 'worker', leaseMs = 60_000, at = new Date(), sources = null } = {}) {
    const client = await this.pool.connect();
    const now = asIso(at);
    const lease = boundedInt(leaseMs, 60_000, MAX_LEASE_MS);
    const token = randomUUID();
    try {
      await client.query('BEGIN');
      // Serialize the short claim transaction so concurrent workers cannot pass the project-active check together.
      await client.query("SELECT pg_advisory_xact_lock(hashtext('ops-scheduled-job-claims'))");
      const r = await client.query(`WITH exhausted AS (
      UPDATE ops_scheduled_jobs SET state='failed',worker_id=NULL,lease_token=NULL,lease_expires_at=NULL,finished_at=$1::timestamptz,updated_at=$1::timestamptz,error=COALESCE(error,'Worker lease expired'),history=history||jsonb_build_array(jsonb_build_object('state','failed','at',$1::text,'error','Worker lease expired'))
      WHERE state='running' AND lease_expires_at<=$1::timestamptz AND attempts>=max_attempts RETURNING id
    ), candidate AS (
      SELECT j.id FROM ops_scheduled_jobs j
      WHERE j.due_at <= $1::timestamptz AND j.attempts < j.max_attempts
        AND ($5::text[] IS NULL OR j.source = ANY($5::text[]))
        AND (j.state IN ('queued','retry') OR (j.state='running' AND j.lease_expires_at <= $1::timestamptz))
        AND NOT EXISTS (SELECT 1 FROM ops_scheduled_jobs active WHERE active.project_id=j.project_id AND active.state='running' AND active.lease_expires_at > $1::timestamptz AND active.id<>j.id)
      ORDER BY j.due_at,j.created_at,j.id FOR UPDATE OF j SKIP LOCKED LIMIT 1
    ) UPDATE ops_scheduled_jobs j SET state='running', attempts=j.attempts+1, worker_id=$2, lease_token=$3,
      lease_expires_at=$1::timestamptz + ($4::bigint * interval '1 millisecond'), updated_at=$1::timestamptz,
      history=j.history || jsonb_build_array(jsonb_build_object('state','running','at',$1::text,'attempt',j.attempts+1,'workerId',$2::text))
      FROM candidate c WHERE j.id=c.id RETURNING j.*`, [now, String(workerId), token, lease, sources]);
      await client.query('COMMIT');
      return cleanJob(r.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async renew({ id, leaseToken, leaseMs = 60_000, at = new Date() }) {
    const now = asIso(at);
    const r = await this.pool.query(`UPDATE ops_scheduled_jobs SET lease_expires_at=$3::timestamptz + ($4::bigint * interval '1 millisecond'),updated_at=$3::timestamptz WHERE id=$1 AND state='running' AND lease_token=$2 RETURNING *`, [id, leaseToken, now, boundedInt(leaseMs, 60_000, MAX_LEASE_MS)]);
    return cleanJob(r.rows[0]);
  }

  async complete({ id, leaseToken, result = null, at = new Date() }) {
    const now = asIso(at);
    const r = await this.pool.query(`UPDATE ops_scheduled_jobs SET state='succeeded',result=$3::jsonb,error=NULL,worker_id=NULL,lease_token=NULL,lease_expires_at=NULL,updated_at=$4::timestamptz,finished_at=$4::timestamptz,history=history||jsonb_build_array(jsonb_build_object('state','succeeded','at',$4::text)) WHERE id=$1 AND state='running' AND lease_token=$2 RETURNING *`, [id, leaseToken, JSON.stringify(result), now]);
    return cleanJob(r.rows[0]);
  }

  async skip({ id, leaseToken, reason = 'Scheduled work is no longer eligible', at = new Date() }) {
    const safeReason = String(reason || 'Scheduled work is no longer eligible').slice(0, 2000);
    const now = asIso(at);
    const r = await this.pool.query(`UPDATE ops_scheduled_jobs SET state='skipped',result=$3::jsonb,error=$4,worker_id=NULL,lease_token=NULL,lease_expires_at=NULL,updated_at=$5::timestamptz,finished_at=$5::timestamptz,history=history||jsonb_build_array(jsonb_build_object('state','skipped','at',$5::text,'error',$4::text)) WHERE id=$1 AND state='running' AND lease_token=$2 RETURNING *`, [id, leaseToken, JSON.stringify({ skipped: true }), safeReason, now]);
    return cleanJob(r.rows[0]);
  }

  async fail({ id, leaseToken, error, retryDelayMs = 1000, at = new Date() }) {
    const now = asIso(at);
    const safeError = String(error || 'Scheduled job failed').slice(0, 2000);
    const delay = boundedInt(retryDelayMs, 1000, MAX_RETRY_MS);
    const r = await this.pool.query(`UPDATE ops_scheduled_jobs SET state=CASE WHEN attempts<max_attempts THEN 'retry' ELSE 'failed' END,error=$3,worker_id=NULL,lease_token=NULL,lease_expires_at=NULL,updated_at=$4::timestamptz,finished_at=CASE WHEN attempts<max_attempts THEN NULL ELSE $4::timestamptz END,due_at=CASE WHEN attempts<max_attempts THEN $4::timestamptz+($5::bigint*interval '1 millisecond') ELSE due_at END,history=history||jsonb_build_array(jsonb_build_object('state',CASE WHEN attempts<max_attempts THEN 'retry' ELSE 'failed' END,'at',$4::text,'error',$3::text)) WHERE id=$1 AND state='running' AND lease_token=$2 RETURNING *`, [id, leaseToken, safeError, now, delay]);
    return cleanJob(r.rows[0]);
  }

  async get(id) {
    const r = await this.pool.query('SELECT * FROM ops_scheduled_jobs WHERE id=$1', [id]);
    return cleanJob(r.rows[0]);
  }

  async latest(projectId, source, { routine } = {}) {
    const r = await this.pool.query(`SELECT * FROM ops_scheduled_jobs WHERE project_id=$1 AND source=$2${routine === undefined ? '' : " AND payload->>'routine'=$3"} ORDER BY due_at DESC, CASE WHEN slot ~ '^[0-9]+$' THEN slot::numeric END DESC NULLS LAST, slot DESC, id DESC LIMIT 1`, routine === undefined ? [String(projectId), String(source)] : [String(projectId), String(source), String(routine)]);
    return cleanJob(r.rows[0]);
  }

  async prune({ before, limit = MAX_PRUNE } = {}) {
    const r = await this.pool.query(`WITH old AS (SELECT id FROM ops_scheduled_jobs WHERE state IN ('succeeded','failed','skipped') AND finished_at<$1::timestamptz ORDER BY finished_at,id LIMIT $2) DELETE FROM ops_scheduled_jobs j USING old WHERE j.id=old.id`, [asIso(before), boundedInt(limit, MAX_PRUNE, MAX_PRUNE)]);
    return r.rowCount || 0;
  }
}

function normalizeEnqueue(input = {}) {
  const projectId = String(input.projectId || '').trim();
  const source = String(input.source || '').trim();
  const slot = String(input.slot || '').trim();
  if (!projectId || !source || !slot) {
    throw new TypeError('projectId, source and slot are required');
  }
  if (projectId.length > 200 || source.length > 200 || slot.length > 500) {
    throw new TypeError('projectId, source and slot exceed the supported length');
  }
  const due = Date.parse(input.dueAt ?? Date.now());
  if (!Number.isFinite(due)) throw new TypeError('dueAt must be a valid date');
  return {
    projectId,
    source,
    slot,
    dueAt: new Date(due).toISOString(),
    payload: clone(input.payload ?? {}),
    maxAttempts: boundedInt(input.maxAttempts, MAX_ATTEMPTS, MAX_ATTEMPTS),
  };
}

export async function createJobStore({ pool, runtimeDir } = {}) {
  const store = config.metadataStore === 'postgres'
    ? new PostgresJobStore(pool)
    : new FileJobStore(runtimeDir);
  await store.init();
  return store;
}
