import { randomUUID } from 'node:crypto';
import { errorText } from '../lib/errors.mjs';
import { httpError } from '../lib/util.mjs';

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_LEASE_MS = 60_000;
const DEFAULT_RENEW_MS = 20_000;
const DEFAULT_RETRY_MS = 1_000;
const DEFAULT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Small source-agnostic dispatcher for durable scheduled jobs. A source supplies a bounded list
 * of due slots and an executor. Routine task ownership is deliberately left to the caller.
 */
export class ScheduledJobDispatcher {
  constructor({ store, workerId = randomUUID(), concurrencyPerProject = 1, maxConcurrentJobs = 16, leaseMs = DEFAULT_LEASE_MS,
    renewMs = DEFAULT_RENEW_MS, retryDelayMs = DEFAULT_RETRY_MS, retentionMs = DEFAULT_RETENTION_MS,
    cleanupLimit = 500, clock = () => new Date(), log = console } = {}) {
    if (!store) throw new TypeError('A scheduled job store is required');
    if (!Number.isInteger(concurrencyPerProject) || concurrencyPerProject < 1) throw new TypeError('concurrencyPerProject must be a positive integer');
    Object.assign(this, { store, workerId, concurrencyPerProject, maxConcurrentJobs, leaseMs, renewMs, retryDelayMs,
      retentionMs, cleanupLimit, clock, log });
    this.sources = new Map();
    this.activeByProject = new Map();
    this.ticking = false;
  }

  registerSource(source, { dueJobs, execute, maxAttempts = DEFAULT_MAX_ATTEMPTS, catchUpLatestOnly = false } = {}) {
    const key = String(source || '').trim();
    if (!key || typeof dueJobs !== 'function' || typeof execute !== 'function') throw new TypeError('A source needs a name, dueJobs function, and execute function');
    if (this.sources.has(key)) throw new Error(`Scheduled job source is already registered: ${key}`);
    this.sources.set(key, { dueJobs, execute, maxAttempts, catchUpLatestOnly });
    return this;
  }

  /** Enqueue due slots idempotently. Sources cap recovery output to the latest missed slot per project. */
  async enqueueDue({ at = this.clock() } = {}) {
    const dueAt = new Date(at);
    if (!Number.isFinite(dueAt.getTime())) throw new TypeError('at must be a valid date');
    const enqueued = [];
    for (const [source, handler] of this.sources) {
      const due = await handler.dueJobs({ at: dueAt });
      if (!Array.isArray(due)) throw new TypeError(`dueJobs for ${source} must return an array`);
      if (!handler.catchUpLatestOnly) {
        for (const candidate of due) {
          if (!candidate?.projectId || candidate.slot == null) continue;
          enqueued.push(await this.store.enqueue({ ...candidate, source, dueAt: candidate.dueAt || dueAt,
            maxAttempts: candidate.maxAttempts ?? handler.maxAttempts }));
        }
        continue;
      }
      // Routine recovery keeps only the latest missed slot per project to avoid a backlog burst.
      const latest = new Map();
      const older = [];
      for (const candidate of due) {
        if (!candidate?.projectId || candidate.slot == null) continue;
        const previous = latest.get(candidate.projectId);
        if (!previous || compareSlot(candidate, previous) > 0) {
          if (previous) older.push(previous);
          latest.set(candidate.projectId, candidate);
        } else older.push(candidate);
      }
      for (const candidate of older) {
        if (this.store.markSkipped) await this.store.markSkipped({ ...candidate, source });
      }
      for (const candidate of latest.values()) {
        enqueued.push(await this.store.enqueue({ ...candidate, source, dueAt: candidate.dueAt || dueAt,
          maxAttempts: candidate.maxAttempts ?? handler.maxAttempts }));
      }
    }
    return enqueued;
  }

  /** One polling pass: enqueue due work and claim/execute up to available per-project capacity. */
  async tick({ at = this.clock() } = {}) {
    if (this.ticking) return { enqueued: [], completed: [] };
    this.ticking = true;
    try {
      const enqueued = await this.enqueueDue({ at });
      const running = [];
      // claim() is intentionally sequential; each claimed job starts immediately, while execution
      // runs concurrently for independent projects.
      while (running.length < this.maxConcurrentJobs) {
        const job = await this.store.claim({ workerId: this.workerId, leaseMs: this.leaseMs, at: this.clock(), sources: [...this.sources.keys()] });
        if (!job) break;
        running.push(this.#run(job));
      }
      const completed = await Promise.all(running);
      return { enqueued, completed };
    } finally { this.ticking = false; }
  }

  /** Submit one explicit job and wait for its persisted terminal result. Manual routes keep a synchronous response. */
  async runNow({ source, projectId, payload = {}, timeoutMs = 120_000 } = {}) {
    const handler = this.sources.get(source);
    if (!handler) throw new TypeError(`No scheduled job source registered: ${source}`);
    const { job } = await this.store.enqueue({ source, projectId, slot: `manual:${randomUUID()}`,
      dueAt: this.clock(), payload, maxAttempts: handler.maxAttempts });
    this.tick().catch(error => this.log.error?.('[jobs] manual dispatch failed', error));
    const deadline = Date.now() + timeoutMs;
    let lastKick = Date.now();
    while (Date.now() < deadline) {
      const current = await this.store.get(job.id);
      if (current && ['succeeded', 'failed', 'skipped'].includes(current.state)) return current;
      // A manual submission can arrive during an active tick; start another pass once that tick ends.
      if (!this.ticking && Date.now() - lastKick >= 1_000) {
        lastKick = Date.now();
        this.tick().catch(error => this.log.error?.('[jobs] manual dispatch failed', error));
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw httpError(504, 'The refresh is still running. Check its status and try again shortly.');
  }

  async #run(job) {
    const source = this.sources.get(job.source);
    if (!source) {
      await this.store.fail({ id: job.id, leaseToken: job.leaseToken, error: `No handler registered for source ${job.source}`, retryDelayMs: this.retryDelayMs, at: this.clock() });
      return { id: job.id, state: 'failed' };
    }
    const projectId = job.projectId;
    let renewing = false;
    const renewal = setInterval(async () => {
      if (renewing) return;
      renewing = true;
      try {
        const renewed = await this.store.renew({ id: job.id, leaseToken: job.leaseToken, leaseMs: this.leaseMs, at: this.clock() });
        if (!renewed) this.log.warn?.(`[jobs] lease lost for ${job.id}`);
      } catch (error) { this.log.error?.('[jobs] lease renewal failed', error); }
      finally { renewing = false; }
    }, this.renewMs);
    renewal.unref?.();
    try {
      while ((this.activeByProject.get(projectId) || 0) >= this.concurrencyPerProject) await new Promise(resolve => setTimeout(resolve, Math.min(this.renewMs, 100)));
      this.activeByProject.set(projectId, (this.activeByProject.get(projectId) || 0) + 1);
      const result = await source.execute(job);
      const row = result?.skipped
        ? await this.store.skip({ id: job.id, leaseToken: job.leaseToken, reason: result.reason || result.skipped, at: this.clock() })
        : await this.store.complete({ id: job.id, leaseToken: job.leaseToken, result: result ?? null, at: this.clock() });
      return { id: job.id, state: row?.state || 'stale' };
    } catch (error) {
      const message = errorText(error, 'Scheduled job failed').replace(/[\r\n]+/g, ' ');
      const retryDelayMs = Math.min(60_000, this.retryDelayMs * 2 ** Math.max(0, job.attempts - 1));
      const row = await this.store.fail({ id: job.id, leaseToken: job.leaseToken, error: message, retryDelayMs, at: this.clock() });
      return { id: job.id, state: row?.state || 'stale', error: message };
    } finally {
      clearInterval(renewal);
      if (this.activeByProject.has(projectId)) {
        const active = this.activeByProject.get(projectId) - 1;
        if (active) this.activeByProject.set(projectId, active); else this.activeByProject.delete(projectId);
      }
    }
  }

  async cleanup({ at = this.clock() } = {}) {
    const before = new Date(new Date(at).getTime() - this.retentionMs);
    return this.store.prune({ before, limit: this.cleanupLimit });
  }
}

function compareSlot(a, b) {
  const left = Number.isFinite(Number(a.slot)) ? Number(a.slot) : Date.parse(a.dueAt || a.slot);
  const right = Number.isFinite(Number(b.slot)) ? Number(b.slot) : Date.parse(b.dueAt || b.slot);
  return (Number.isFinite(left) ? left : String(a.slot)).toString().localeCompare((Number.isFinite(right) ? right : String(b.slot)).toString(), undefined, { numeric: true });
}
