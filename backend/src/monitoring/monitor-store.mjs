import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { RUNTIME_DIR, config } from '../config.mjs';
import { ensureDir, readJson, writeJson, exists } from '../lib/fs.mjs';
import { getPgPool, ensureControlSchema } from '../storage/postgres.mjs';
import { now, clone } from '../lib/util.mjs';

// The per-project ledger behind the Pipelines and Data Quality pages and the alerts the detector opens (ADR-0002).
// The background fetch writes it; pages, agent tools and the detector read it, so nothing waits on a platform call.

// The file store is for one developer's machine: it keeps the newest rows up to these caps. Postgres keeps what the retention allows.
export const FILE_MAX_RUNS = 20_000;
export const FILE_MAX_DQ = 20_000;
const FILE_MAX_ALERTS = 2_000;
const MAX_PAGE = 50_000;

// State keys shared by the fetch, the detector and the readers.
export const STATE = Object.freeze({ inventory: 'pipelines:inventory', slots: 'pipelines:slots', fetchPipelines: 'fetch:pipelines', fetchDataQuality: 'fetch:dataQuality', dqSnapshot: 'dq:snapshot', armed: 'armed', prune: 'prune', capWarned: 'cap-warned' });
export const runKey = run => `${run.platform || 'unknown'}:${run.pipelineId}:${run.runId}`;
const ms = value => { const at = Date.parse(String(value || '')); return Number.isFinite(at) ? at : null; };
const byStartDesc = (a, b) => (ms(b.startTime) ?? -Infinity) - (ms(a.startTime) ?? -Infinity);
const byExecutedDesc = (a, b) => (ms(b.executedAt) ?? -Infinity) - (ms(a.executedAt) ?? -Infinity);
// Pages are cut by offset, so rows with the same time need a fixed order or a page can repeat or skip one: break ties on the row key.
const byKey = (key) => (a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0);
const runsInPageOrder = (a, b) => byStartDesc(a, b) || byKey(runKey)(a, b);
const dqInPageOrder = (a, b) => byExecutedDesc(a, b) || byKey(item => String(item.key))(a, b);
const alertsInPageOrder = (a, b) => String(b.openedAt).localeCompare(String(a.openedAt)) || byKey(item => String(item.id))(a, b);
const page = (rows, { limit, offset } = {}) => { const start = Math.max(0, Number(offset) || 0); const size = Math.max(1, Math.min(MAX_PAGE, Number(limit) || MAX_PAGE)); return rows.slice(start, start + size); };
const newAlertId = () => `AL-${Date.now().toString(36).toUpperCase()}${randomUUID().slice(0, 4).toUpperCase()}`;
// Runs without a start time are kept whatever the window (SPEC-pipelines-01 FR-6).
const inRunWindow = (run, fromMs, toMs) => { const at = ms(run.startTime); if (at === null) return true; return (fromMs == null || at >= fromMs) && (toMs == null || at <= toMs); };
const inDqWindow = (item, fromMs, toMs) => { const at = ms(item.executedAt); if (at === null) return fromMs == null && toMs == null; return (fromMs == null || at >= fromMs) && (toMs == null || at <= toMs); };
const dqMatches = (item, { status, severity, tableId, tableIds, q } = {}) => {
  if (Array.isArray(tableIds) && !tableIds.includes(item.tableId)) return false;
  if (status && status !== 'all' && item.status !== status) return false;
  if (severity && severity !== 'all' && item.severity !== severity) return false;
  if (tableId && tableId !== 'all' && item.tableId !== tableId) return false;
  const text = String(q || '').trim().toLowerCase();
  return !text || [item.name, item.checkId, item.dataset, item.field, item.rule, item.message, item.table].some(value => String(value || '').toLowerCase().includes(text));
};
export function summarizeDq(items) { return { total: items.length, passed: items.filter(item => item.status === 'passed').length, failed: items.filter(item => item.status === 'failed').length, warning: items.filter(item => item.status === 'warning').length, unreported: items.filter(item => item.status === 'status_not_reported').length }; }
const alertMatches = (alert, { status, trigger, subjectId, taskId } = {}) => (!status || status === 'all' || alert.status === status) && (!trigger || alert.trigger === trigger) && (!subjectId || String(alert.subject?.id) === String(subjectId)) && (!taskId || alert.investigation?.taskId === taskId);

export class FileMonitorStore {
  constructor(dir = path.join(RUNTIME_DIR, 'monitoring')) { this.dir = dir; this.queues = new Map(); this.cache = new Map(); }
  async init() { await ensureDir(this.dir); }
  #file(projectId, name) { return path.join(this.dir, String(projectId), `${name}.json`); }
  async #read(file, fallback) { if (this.cache.has(file)) return this.cache.get(file); const value = (await exists(file)) ? await readJson(file) : fallback; this.cache.set(file, value); return value; }
  async #write(file, value) { await ensureDir(path.dirname(file)); await writeJson(file, value); this.cache.set(file, value); }
  async #exclusive(file, task) { const prior = this.queues.get(file) || Promise.resolve(); let release; const next = new Promise(resolve => { release = resolve; }); this.queues.set(file, prior.then(() => next)); await prior; try { return await task(); } finally { release(); } }

  async upsertRuns(projectId, runs = []) {
    if (!runs.length) return 0;
    const file = this.#file(projectId, 'runs');
    return this.#exclusive(file, async () => {
      const doc = clone(await this.#read(file, { runs: {} }));
      for (const run of runs) doc.runs[runKey(run)] = { ...run, fetchedAt: now() };
      const all = Object.values(doc.runs);
      if (all.length > FILE_MAX_RUNS) { all.sort(byStartDesc); doc.runs = Object.fromEntries(all.slice(0, FILE_MAX_RUNS).map(run => [runKey(run), run])); }
      await this.#write(file, doc); return runs.length;
    });
  }
  async listRuns(projectId, { platform, pipelineId, fromMs, toMs, limit, offset } = {}) {
    const doc = await this.#read(this.#file(projectId, 'runs'), { runs: {} });
    const rows = Object.values(doc.runs).filter(run => (!platform || run.platform === platform) && (!pipelineId || String(run.pipelineId) === String(pipelineId)) && inRunWindow(run, fromMs, toMs)).sort(runsInPageOrder);
    return { items: clone(page(rows, { limit, offset })), total: rows.length };
  }
  async pruneRuns(projectId, beforeMs) {
    const file = this.#file(projectId, 'runs');
    return this.#exclusive(file, async () => { const doc = clone(await this.#read(file, { runs: {} })); let n = 0; for (const [key, run] of Object.entries(doc.runs)) { const at = ms(run.startTime); if (at !== null && at < beforeMs) { delete doc.runs[key]; n += 1; } } if (n) await this.#write(file, doc); return n; });
  }

  async upsertDqResults(projectId, items = []) {
    if (!items.length) return 0;
    const file = this.#file(projectId, 'dq');
    return this.#exclusive(file, async () => {
      const doc = clone(await this.#read(file, { results: {} }));
      for (const item of items) doc.results[item.key] = { ...item, fetchedAt: now() };
      const all = Object.values(doc.results);
      if (all.length > FILE_MAX_DQ) { all.sort(byExecutedDesc); doc.results = Object.fromEntries(all.slice(0, FILE_MAX_DQ).map(item => [item.key, item])); }
      await this.#write(file, doc); return items.length;
    });
  }
  // The table's stored results from fromMs on become exactly `items` (ADR-0007).
  async replaceDqResults(projectId, tableId, items = [], { fromMs } = {}) {
    const file = this.#file(projectId, 'dq');
    return this.#exclusive(file, async () => {
      const doc = clone(await this.#read(file, { results: {} })); const keep = new Set(items.map(item => item.key)); let removed = 0;
      for (const [key, item] of Object.entries(doc.results)) { const at = ms(item.executedAt); if (item.tableId === tableId && !keep.has(key) && at !== null && at >= fromMs) { delete doc.results[key]; removed += 1; } }
      for (const item of items) doc.results[item.key] = { ...item, fetchedAt: now() };
      const all = Object.values(doc.results);
      if (all.length > FILE_MAX_DQ) { all.sort(byExecutedDesc); doc.results = Object.fromEntries(all.slice(0, FILE_MAX_DQ).map(item => [item.key, item])); }
      await this.#write(file, doc); return { upserted: items.length, removed };
    });
  }
  async listDqResults(projectId, { fromMs, toMs, limit, offset, ...filters } = {}) {
    const doc = await this.#read(this.#file(projectId, 'dq'), { results: {} });
    const windowed = Object.values(doc.results).filter(item => inDqWindow(item, fromMs, toMs));
    const rows = windowed.filter(item => dqMatches(item, filters)).sort(dqInPageOrder);
    return { items: clone(page(rows, { limit, offset })), total: rows.length, summary: summarizeDq(windowed) };
  }
  async pruneDq(projectId, beforeMs) {
    const file = this.#file(projectId, 'dq');
    return this.#exclusive(file, async () => { const doc = clone(await this.#read(file, { results: {} })); let n = 0; for (const [key, item] of Object.entries(doc.results)) { const at = ms(item.executedAt); if (at !== null && at < beforeMs) { delete doc.results[key]; n += 1; } } if (n) await this.#write(file, doc); return n; });
  }

  async getState(projectId, key) { const doc = await this.#read(this.#file(projectId, 'state'), {}); return doc[key] ? clone(doc[key]) : null; }
  async setState(projectId, key, value) { const file = this.#file(projectId, 'state'); return this.#exclusive(file, async () => { const doc = clone(await this.#read(file, {})); doc[key] = clone(value); await this.#write(file, doc); return clone(value); }); }

  async claimOccurrence(projectId, key, at = now()) {
    const file = this.#file(projectId, 'occurrences');
    return this.#exclusive(file, async () => { const doc = clone(await this.#read(file, {})); if (doc[key]) return false; doc[key] = at; await this.#write(file, doc); return true; });
  }
  async releaseOccurrence(projectId, key) { const file = this.#file(projectId, 'occurrences'); return this.#exclusive(file, async () => { const doc = clone(await this.#read(file, {})); delete doc[key]; await this.#write(file, doc); }); }
  async pruneOccurrences(projectId, beforeMs) {
    const file = this.#file(projectId, 'occurrences');
    return this.#exclusive(file, async () => { const doc = clone(await this.#read(file, {})); let n = 0; for (const [key, at] of Object.entries(doc)) if ((ms(at) ?? 0) < beforeMs) { delete doc[key]; n += 1; } if (n) await this.#write(file, doc); return n; });
  }

  /** Opens an alert, unless one with the same key is already open: then that one comes back with `created: false`. */
  async createAlert(alert) {
    const file = this.#file(alert.projectId, 'alerts');
    return this.#exclusive(file, async () => {
      const doc = clone(await this.#read(file, { alerts: {} }));
      const open = Object.values(doc.alerts).find(item => item.key === alert.key && item.status === 'open');
      if (open) return { alert: clone(open), created: false };
      const at = now(); const stored = { ...clone(alert), id: alert.id || newAlertId(), status: 'open', openedAt: alert.openedAt || at, updatedAt: at };
      doc.alerts[stored.id] = stored;
      const all = Object.values(doc.alerts);
      if (all.length > FILE_MAX_ALERTS) { const drop = all.filter(item => item.status !== 'open').sort((a, b) => String(a.updatedAt).localeCompare(String(b.updatedAt))).slice(0, all.length - FILE_MAX_ALERTS); for (const item of drop) delete doc.alerts[item.id]; }
      await this.#write(file, doc); return { alert: clone(stored), created: true };
    });
  }
  async getAlert(projectId, id) { const doc = await this.#read(this.#file(projectId, 'alerts'), { alerts: {} }); return doc.alerts[id] ? clone(doc.alerts[id]) : null; }
  async getOpenAlert(projectId, key) { const doc = await this.#read(this.#file(projectId, 'alerts'), { alerts: {} }); const found = Object.values(doc.alerts).find(item => item.key === key && item.status === 'open'); return found ? clone(found) : null; }
  async getLatestAlert(projectId, key) { const doc = await this.#read(this.#file(projectId, 'alerts'), { alerts: {} }); const found = Object.values(doc.alerts).filter(item => item.key === key).sort((a, b) => String(b.openedAt).localeCompare(String(a.openedAt)))[0]; return found ? clone(found) : null; }
  async updateAlert(projectId, id, patch) {
    const file = this.#file(projectId, 'alerts');
    return this.#exclusive(file, async () => {
      const doc = clone(await this.#read(file, { alerts: {} })); const current = doc.alerts[id];
      if (!current) throw new Error(`Alert not found: ${id}`);
      // Reopening must not collide with another open alert of the same key.
      if (patch.status === 'open' && current.status !== 'open' && Object.values(doc.alerts).some(item => item.id !== id && item.key === current.key && item.status === 'open')) return null;
      doc.alerts[id] = { ...current, ...clone(patch), id, projectId: current.projectId, key: current.key, updatedAt: now() };
      await this.#write(file, doc); return clone(doc.alerts[id]);
    });
  }
  async listAlerts(projectIds, { limit, offset, ...filters } = {}) {
    const ids = projectIds ? [].concat(projectIds) : await this.#projectDirs();
    const rows = [];
    for (const id of ids) { const doc = await this.#read(this.#file(id, 'alerts'), { alerts: {} }); rows.push(...Object.values(doc.alerts).filter(alert => alertMatches(alert, filters))); }
    rows.sort(alertsInPageOrder);
    return { items: clone(page(rows, { limit, offset })), total: rows.length };
  }
  async countStartedSince(projectId, sinceIso) { const doc = await this.#read(this.#file(projectId, 'alerts'), { alerts: {} }); return Object.values(doc.alerts).reduce((total, alert) => total + (alert.investigation?.starts || []).filter(at => String(at) >= sinceIso).length, 0); }
  async #projectDirs() { const fs = await import('node:fs/promises'); try { return (await fs.readdir(this.dir, { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name); } catch { return []; } }
}

const DATA = 'data';
export class PostgresMonitorStore {
  constructor(pool) { this.pool = pool; }
  async init() { this.pool ||= await getPgPool(); await ensureControlSchema(this.pool); }

  async upsertRuns(projectId, runs = []) {
    for (let i = 0; i < runs.length; i += 500) {
      const batch = runs.slice(i, i + 500); const values = []; const params = [];
      for (const run of batch) { const at = now(); params.push(projectId, run.platform || 'unknown', String(run.pipelineId), String(run.runId), run.status || null, run.startTime || null, JSON.stringify({ ...run, fetchedAt: at })); const n = params.length; values.push(`($${n - 6},$${n - 5},$${n - 4},$${n - 3},$${n - 2},$${n - 1}::timestamptz,$${n}::jsonb,now())`); }
      await this.pool.query(`INSERT INTO ops_pipeline_runs(project_id,platform,pipeline_id,run_id,status,start_time,data,updated_at) VALUES ${values.join(',')} ON CONFLICT (project_id,platform,pipeline_id,run_id) DO UPDATE SET status=EXCLUDED.status,start_time=EXCLUDED.start_time,data=EXCLUDED.data,updated_at=now()`, params);
    }
    return runs.length;
  }
  async listRuns(projectId, { platform, pipelineId, fromMs, toMs, limit, offset } = {}) {
    const clauses = ['project_id=$1']; const params = [projectId];
    if (platform) { params.push(platform); clauses.push(`platform=$${params.length}`); }
    if (pipelineId) { params.push(String(pipelineId)); clauses.push(`pipeline_id=$${params.length}`); }
    if (fromMs != null) { params.push(new Date(fromMs).toISOString()); clauses.push(`(start_time IS NULL OR start_time >= $${params.length})`); }
    if (toMs != null) { params.push(new Date(toMs).toISOString()); clauses.push(`(start_time IS NULL OR start_time <= $${params.length})`); }
    const where = clauses.join(' AND ');
    const { rows: [{ total }] } = await this.pool.query(`SELECT count(*)::int AS total FROM ops_pipeline_runs WHERE ${where}`, params);
    const size = Math.max(1, Math.min(MAX_PAGE, Number(limit) || MAX_PAGE)); const skip = Math.max(0, Number(offset) || 0);
    const { rows } = await this.pool.query(`SELECT ${DATA} FROM ops_pipeline_runs WHERE ${where} ORDER BY start_time DESC NULLS LAST, platform, pipeline_id, run_id LIMIT ${size} OFFSET ${skip}`, params);
    return { items: rows.map(row => row.data), total };
  }
  async pruneRuns(projectId, beforeMs) { const { rowCount } = await this.pool.query('DELETE FROM ops_pipeline_runs WHERE project_id=$1 AND start_time < $2', [projectId, new Date(beforeMs).toISOString()]); return rowCount; }

  async upsertDqResults(projectId, items = [], db = this.pool) {
    for (let i = 0; i < items.length; i += 500) {
      const batch = items.slice(i, i + 500); const values = []; const params = [];
      for (const item of batch) { params.push(projectId, item.key, item.tableId || null, item.status || null, item.severity || null, ms(item.executedAt) === null ? null : item.executedAt, JSON.stringify({ ...item, fetchedAt: now() })); const n = params.length; values.push(`($${n - 6},$${n - 5},$${n - 4},$${n - 3},$${n - 2},$${n - 1}::timestamptz,$${n}::jsonb,now())`); }
      await db.query(`INSERT INTO ops_dq_results(project_id,result_key,table_id,status,severity,executed_at,data,updated_at) VALUES ${values.join(',')} ON CONFLICT (project_id,result_key) DO UPDATE SET status=EXCLUDED.status,severity=EXCLUDED.severity,executed_at=EXCLUDED.executed_at,data=EXCLUDED.data,updated_at=now()`, params);
    }
    return items.length;
  }
  async listDqResults(projectId, { fromMs, toMs, limit, offset, status, severity, tableId, tableIds, q } = {}) {
    const clauses = ['project_id=$1']; const params = [projectId];
    if (Array.isArray(tableIds)) { params.push(tableIds); clauses.push(`table_id = ANY($${params.length})`); }
    if (fromMs != null) { params.push(new Date(fromMs).toISOString()); clauses.push(`executed_at >= $${params.length}`); }
    if (toMs != null) { params.push(new Date(toMs).toISOString()); clauses.push(`executed_at <= $${params.length}`); }
    const windowWhere = clauses.join(' AND '); const windowParams = [...params];
    if (status && status !== 'all') { params.push(status); clauses.push(`status=$${params.length}`); }
    if (severity && severity !== 'all') { params.push(severity); clauses.push(`severity=$${params.length}`); }
    if (tableId && tableId !== 'all') { params.push(tableId); clauses.push(`table_id=$${params.length}`); }
    if (String(q || '').trim()) { params.push(`%${String(q).trim().toLowerCase()}%`); clauses.push(`lower(concat_ws(' ', data->>'name', data->>'checkId', data->>'dataset', data->>'field', data->>'rule', data->>'message', data->>'table')) LIKE $${params.length}`); }
    const where = clauses.join(' AND ');
    const size = Math.max(1, Math.min(MAX_PAGE, Number(limit) || MAX_PAGE)); const skip = Math.max(0, Number(offset) || 0);
    const [{ rows: [{ total }] }, { rows }, { rows: [counts] }] = await Promise.all([
      this.pool.query(`SELECT count(*)::int AS total FROM ops_dq_results WHERE ${where}`, params),
      this.pool.query(`SELECT ${DATA} FROM ops_dq_results WHERE ${where} ORDER BY executed_at DESC NULLS LAST, result_key LIMIT ${size} OFFSET ${skip}`, params),
      this.pool.query(`SELECT count(*)::int AS total, count(*) FILTER (WHERE status='passed')::int AS passed, count(*) FILTER (WHERE status='failed')::int AS failed, count(*) FILTER (WHERE status='warning')::int AS warning, count(*) FILTER (WHERE status='status_not_reported')::int AS unreported FROM ops_dq_results WHERE ${windowWhere}`, windowParams),
    ]);
    return { items: rows.map(row => row.data), total, summary: counts };
  }
  // One transaction, so a reader sees the table's old set or its new one (ADR-0007).
  async replaceDqResults(projectId, tableId, items = [], { fromMs } = {}) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rowCount } = await client.query('DELETE FROM ops_dq_results WHERE project_id=$1 AND table_id=$2 AND executed_at >= $3 AND NOT (result_key = ANY($4::text[]))', [projectId, tableId, new Date(fromMs).toISOString(), items.map(item => item.key)]);
      await this.upsertDqResults(projectId, items, client);
      await client.query('COMMIT');
      return { upserted: items.length, removed: rowCount };
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; } finally { client.release(); }
  }
  async pruneDq(projectId, beforeMs) { const { rowCount } = await this.pool.query('DELETE FROM ops_dq_results WHERE project_id=$1 AND executed_at < $2', [projectId, new Date(beforeMs).toISOString()]); return rowCount; }

  async getState(projectId, key) { const { rows } = await this.pool.query('SELECT data FROM ops_monitor_state WHERE project_id=$1 AND state_key=$2', [projectId, key]); return rows[0]?.data ?? null; }
  async setState(projectId, key, value) { await this.pool.query('INSERT INTO ops_monitor_state(project_id,state_key,data,updated_at) VALUES($1,$2,$3::jsonb,now()) ON CONFLICT (project_id,state_key) DO UPDATE SET data=EXCLUDED.data,updated_at=now()', [projectId, key, JSON.stringify(value)]); return value; }

  async claimOccurrence(projectId, key, at = now()) { const { rowCount } = await this.pool.query('INSERT INTO ops_alert_occurrences(project_id,occurrence_key,at) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [projectId, key, at]); return rowCount === 1; }
  async releaseOccurrence(projectId, key) { await this.pool.query('DELETE FROM ops_alert_occurrences WHERE project_id=$1 AND occurrence_key=$2', [projectId, key]); }
  async pruneOccurrences(projectId, beforeMs) { const { rowCount } = await this.pool.query('DELETE FROM ops_alert_occurrences WHERE project_id=$1 AND at < $2', [projectId, new Date(beforeMs).toISOString()]); return rowCount; }

  #row(alert) { return [alert.id, alert.projectId, alert.key, alert.status, alert.trigger, alert.subject?.id ? String(alert.subject.id) : null, alert.investigation?.taskId || null, alert.ticketId || null, JSON.stringify(alert), alert.openedAt, alert.updatedAt]; }
  async createAlert(alert) {
    const at = now(); const stored = { ...alert, id: alert.id || newAlertId(), status: 'open', openedAt: alert.openedAt || at, updatedAt: at };
    const { rows } = await this.pool.query(`INSERT INTO ops_alerts(id,project_id,alert_key,status,trigger,subject_id,task_id,ticket_id,data,opened_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11) ON CONFLICT (project_id, alert_key) WHERE status='open' DO NOTHING RETURNING data`, this.#row(stored));
    if (rows[0]) return { alert: rows[0].data, created: true };
    return { alert: await this.getOpenAlert(alert.projectId, alert.key), created: false };
  }
  async getAlert(projectId, id) { const { rows } = await this.pool.query('SELECT data FROM ops_alerts WHERE project_id=$1 AND id=$2', [projectId, id]); return rows[0]?.data || null; }
  async getOpenAlert(projectId, key) { const { rows } = await this.pool.query("SELECT data FROM ops_alerts WHERE project_id=$1 AND alert_key=$2 AND status='open'", [projectId, key]); return rows[0]?.data || null; }
  async getLatestAlert(projectId, key) { const { rows } = await this.pool.query('SELECT data FROM ops_alerts WHERE project_id=$1 AND alert_key=$2 ORDER BY opened_at DESC LIMIT 1', [projectId, key]); return rows[0]?.data || null; }
  async updateAlert(projectId, id, patch) {
    const current = await this.getAlert(projectId, id); if (!current) throw new Error(`Alert not found: ${id}`);
    const next = { ...current, ...patch, id, projectId: current.projectId, key: current.key, updatedAt: now() };
    try {
      const { rows } = await this.pool.query('UPDATE ops_alerts SET status=$2,task_id=$3,ticket_id=$4,data=$5::jsonb,updated_at=now() WHERE id=$1 RETURNING data', [id, next.status, next.investigation?.taskId || null, next.ticketId || null, JSON.stringify(next)]);
      return rows[0]?.data || null;
    } catch (error) { if (error?.code === '23505') return null; throw error; }
  }
  async listAlerts(projectIds, { limit, offset, status, trigger, subjectId, taskId } = {}) {
    const clauses = []; const params = [];
    if (projectIds) { params.push([].concat(projectIds)); clauses.push(`project_id = ANY($${params.length})`); }
    if (status && status !== 'all') { params.push(status); clauses.push(`status=$${params.length}`); }
    if (trigger) { params.push(trigger); clauses.push(`trigger=$${params.length}`); }
    if (subjectId) { params.push(String(subjectId)); clauses.push(`subject_id=$${params.length}`); }
    if (taskId) { params.push(taskId); clauses.push(`task_id=$${params.length}`); }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const size = Math.max(1, Math.min(MAX_PAGE, Number(limit) || MAX_PAGE)); const skip = Math.max(0, Number(offset) || 0);
    const [{ rows: [{ total }] }, { rows }] = await Promise.all([
      this.pool.query(`SELECT count(*)::int AS total FROM ops_alerts ${where}`, params),
      this.pool.query(`SELECT data FROM ops_alerts ${where} ORDER BY opened_at DESC, id LIMIT ${size} OFFSET ${skip}`, params),
    ]);
    return { items: rows.map(row => row.data), total };
  }
  async countStartedSince(projectId, sinceIso) { const { rows: [{ n }] } = await this.pool.query("SELECT COALESCE(sum((SELECT count(*) FROM jsonb_array_elements_text(COALESCE(data->'investigation'->'starts','[]'::jsonb)) AS s(at) WHERE s.at >= $2)),0)::int AS n FROM ops_alerts WHERE project_id=$1", [projectId, sinceIso]); return n; }
}

export async function createMonitorStore() { const store = config.metadataStore === 'postgres' ? new PostgresMonitorStore() : new FileMonitorStore(); await store.init(); return store; }
