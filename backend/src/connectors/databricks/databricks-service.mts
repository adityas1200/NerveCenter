import { errorText } from '../../lib/errors.mjs';

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
type JsonRecord = { [key: string]: JsonValue | undefined };
type DatabricksState = { state?: string; state_message?: string; message?: string; result_state?: string; life_cycle_state?: string; termination_details?: { code?: string; message?: string } };
type DatabricksTask = { task_key?: string; run_name?: string; run_id?: string | number; depends_on?: Array<{ task_key?: string }>; state?: DatabricksState; status?: DatabricksState };
type DatabricksRun = { task_key?: string; run_id?: string | number; job_id?: string | number; run_name?: string; run_duration?: number; execution_duration?: number; start_time?: number; end_time?: number; state?: DatabricksState; status?: DatabricksState; tasks?: DatabricksTask[] };
type DatabricksJob = { job_id: string | number; creator_user_name?: string; settings?: { name?: string; description?: string; schedule?: DatabricksSchedule | null } };
type DatabricksSchedule = { quartz_cron_expression?: string; quartzCronExpression?: string; timezone_id?: string; timezoneId?: string; pause_status?: string; pauseStatus?: string };
type DatabricksPayload = JsonRecord & { jobs?: DatabricksJob[]; runs?: DatabricksRun[]; has_more?: boolean; next_page_token?: string; job_id?: string | number; creator_user_name?: string; settings?: DatabricksJob['settings']; statement_id?: string; status?: { state?: string; error?: { message?: string } }; manifest?: { schema?: { columns?: Array<{ name: string }> } }; result?: { data_array?: unknown[][] }; message?: string; error_code?: string };
type AuthOptions = { host?: string; token?: string; clientId?: string; clientSecret?: string };
type AuthMode = 'service_principal' | 'pat' | null;
type CredentialProfile = { config?: { host?: string }; credentials?: { token?: string; pat?: string; accessToken?: string; clientId?: string; clientSecret?: string } };
type HttpQuery = Record<string, string | number | null | undefined>;
type HttpOptions = { query?: HttpQuery; body?: JsonRecord };
type SqlOptions = { statement?: string; warehouseId?: string; catalog?: string; schema?: string; parameters?: JsonRecord[]; timeoutSeconds?: number; rowLimit?: number };
type ListRunsOptions = { pipelineId?: string; limit?: number; maxRuns?: number; startTimeFrom?: number; startTimeTo?: number };
type RunNormalizeOptions = { pipelineId?: string; includeGraph?: boolean };
type NormalizedRun = { runId: string; pipelineId: string; name: string | null; status: string; rawState: string; rawLifecycleState: string; startTime: string | null; endTime: string | null; durationMs: number | null; failingTask: string | null; failureSummary: string | null; taskGraph?: ReturnType<typeof taskGraph> };

// Read-only Databricks Jobs and SQL access for the Pipelines and Data Quality pages.
// Anything that changes a workspace (repairs, retriggers, code fixes) is the agent's job
// through its own Databricks MCP connection, not this client.

const FAILED_STATES = new Set(['FAILED', 'ERROR', 'TIMEDOUT', 'TIMED_OUT', 'CANCELED', 'CANCELLED', 'USER_CANCELED', 'SUCCESS_WITH_FAILURES', 'INTERNAL_ERROR', 'UPSTREAM_FAILED', 'CLIENT_ERROR', 'DRIVER_ERROR', 'MAXIMUM_CONCURRENT_RUNS_REACHED', 'SYSTEM_FAILURE', 'CLOUD_FAILURE', 'LAUNCH_TIMEOUT', 'MAX_SPARK_CONTEXTS_REACHED', 'BILLING_FAILURE', 'LIBRARY_INSTALLATION_ERROR', 'TASK_EXECUTION_ERROR', 'STORAGE_ACCESS_ERROR', 'RUN_EXECUTION_ERROR', 'COMMUNICATION_LOST', 'CLUSTER_ERROR', 'WORKSPACE_RUN_LIMIT_EXCEEDED', 'SERVERLESS_COMPUTE_CAPACITY_UNAVAILABLE', 'RESOURCE_LIMIT_EXCEEDED']);
/** How long one SQL statement may run before Databricks stops it (Databricks accepts 5 to 50 seconds). */
export const STATEMENT_TIMEOUT_SECONDS = 30;
const SUCCESS_STATES = new Set(['SUCCESS', 'SUCCEEDED']);
const MAX_RUNS_PER_CALL = 10_000;
const RUNNING_STATES = new Set(['RUNNING', 'PENDING', 'QUEUED', 'BLOCKED', 'WAITING_FOR_RETRY', 'TERMINATING']);
const SKIPPED_STATES = new Set(['SKIPPED', 'EXCLUDED', 'NOT_RUN', 'DISABLED']);
const upper = (v: unknown) => String(v ?? 'UNKNOWN').toUpperCase();
// Jobs API 2.2 adds `status.state` (lifecycle only, e.g. "TERMINATED" for both success and
// failure) alongside `status.termination_details.code` (the actual outcome). Read the outcome first.
const stateOf = (item: DatabricksRun | DatabricksTask) => item?.status?.termination_details?.code || item?.state?.result_state || item?.status?.state || item?.state?.life_cycle_state || 'UNKNOWN';
const lifecycleOf = (item: DatabricksRun | DatabricksTask) => upper(item?.status?.state || item?.state?.life_cycle_state || 'UNKNOWN');
const resultState = (item: DatabricksRun | DatabricksTask) => upper(stateOf(item));
const toIso = (ms?: number) => ms ? new Date(Number(ms)).toISOString() : null;
const normalizeSchedule = (s?: DatabricksSchedule | null) => s ? { quartzCronExpression: s.quartz_cron_expression || s.quartzCronExpression || null, timezoneId: s.timezone_id || s.timezoneId || null, pauseStatus: s.pause_status || s.pauseStatus || null } : null;

function failingTask(run: DatabricksRun = {}) {
  const tasks = run.tasks || [];
  return tasks.find(t => FAILED_STATES.has(resultState(t))) || tasks.find(t => !SUCCESS_STATES.has(resultState(t))) || run;
}
function taskGraph(run: DatabricksRun = {}) {
  return (run.tasks || []).map(t => ({ taskKey: t.task_key || t.run_name || String(t.run_id || ''), runId: t.run_id, state: resultState(t), dependsOn: (t.depends_on || []).map(d => d.task_key).filter(Boolean) }));
}

/**
 * Two ways to authenticate, both ending in one Authorization header:
 *   - personal access token: a token that belongs to a person, sent as-is;
 *   - service principal: a client ID and secret exchanged at {host}/oidc/v1/token for a
 *     short-lived OAuth token, cached until just before it expires.
 * A service principal is the credential a deployment should use: it belongs to the workspace
 * rather than to an employee, so it survives that person leaving and can be scoped on its own.
 */
const TOKEN_SKEW_MS = 60_000; // refresh a minute early, so no request carries a token that expires in flight
const scrub = (text: unknown, secret: string) => (secret ? String(text ?? '').split(secret).join('[redacted]') : String(text ?? ''));

export class DatabricksAuth {
  #cached: { token: string; expiresAt: number } | null = null;
  #pending: Promise<string> | null = null;
  host: string;
  token: string;
  clientId: string;
  clientSecret: string;
  mode: AuthMode;
  constructor({ host, token, clientId, clientSecret }: AuthOptions = {}) {
    this.host = String(host || '').replace(/\/$/, '');
    this.token = String(token || '').trim();
    this.clientId = String(clientId || '').trim();
    this.clientSecret = String(clientSecret || '').trim();
    // An explicit service principal wins: a deployment that sets both means the principal.
    this.mode = this.clientId && this.clientSecret ? 'service_principal' : this.token ? 'pat' : null;
    if (!this.host) throw new Error('Databricks requires a workspace URL');
    if (!this.mode) throw new Error(this.clientId || this.clientSecret
      ? 'A Databricks service principal needs both a client ID and a client secret'
      : 'Databricks requires a personal access token, or a service principal client ID and secret');
  }

  /** The Authorization header for the next request. */
  async header() { return `Bearer ${this.mode === 'pat' ? this.token : await this.#accessToken()}`; }

  /** Drop the cached OAuth token so the next request mints a fresh one. A personal access token never expires early. */
  invalidate() { if (this.mode === 'service_principal') this.#cached = null; }

  async #accessToken() {
    if (this.#cached && this.#cached.expiresAt > Date.now()) return this.#cached.token;
    return (this.#pending ??= this.#mint().finally(() => { this.#pending = null; }));
  }

  async #mint() {
    const url = new URL('/oidc/v1/token', this.host);
    const authorization = `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64')}`;
    const body = new URLSearchParams({ grant_type: 'client_credentials', scope: 'all-apis' });
    let response;
    try { response = await fetch(url, { method: 'POST', headers: { authorization, 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body, signal: AbortSignal.timeout(30_000) }); }
    catch (error) { throw new Error(`Databricks could not be reached at ${url.origin} to sign the service principal in: ${scrub(errorText(error), this.clientSecret)}`); }
    const text = await response.text(); let payload: { access_token?: string; expires_in?: number; error_description?: string; error?: string } = {}; try { payload = text ? JSON.parse(text) as typeof payload : {}; } catch { payload = {}; }
    if (!response.ok) throw new Error(`Databricks rejected the service principal (${response.status}): ${scrub(payload.error_description || payload.error || text.slice(0, 300), this.clientSecret) || 'check the client ID and secret, and that the service principal has access to this workspace'}`);
    const token = String(payload.access_token || '');
    if (!token) throw new Error('Databricks signed the service principal in but returned no access token');
    const lifetimeMs = (Number(payload.expires_in) || 3600) * 1000;
    this.#cached = { token, expiresAt: Date.now() + Math.max(lifetimeMs - TOKEN_SKEW_MS, 30_000) };
    return token;
  }
}

/** The Databricks credentials of a resolved connection, in either shape, ready for the service constructor. */
export function databricksCredentials({ config = {}, credentials = {} }: CredentialProfile = {}) {
  return { host: config.host, token: credentials.token || credentials.pat || credentials.accessToken, clientId: credentials.clientId, clientSecret: credentials.clientSecret };
}
/** One read-only client from a resolved connection, so every caller authenticates the same way. */
export function databricksFromConnection(resolved: CredentialProfile) { return new DatabricksOperationsService(databricksCredentials(resolved)); }

class DatabricksHttpClient {
  host: string;
  auth: DatabricksAuth;
  constructor({ host, auth }: { host?: string; auth: DatabricksAuth }) { this.host = String(host || '').replace(/\/$/, ''); this.auth = auth; }
  async request(method: string, pathname: string, { query, body }: HttpOptions = {}): Promise<DatabricksPayload> {
    const url = new URL(pathname, this.host); for (const [k, v] of Object.entries(query || {})) if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    const requestBody = body ? JSON.stringify(body) : undefined;
    for (let attempt = 0; ; attempt += 1) {
      const headers = { authorization: await this.auth.header(), 'content-type': 'application/json', accept: 'application/json' };
      let response; try { response = await fetch(url, { method, headers, body: requestBody, signal: AbortSignal.timeout(30_000) }); } catch (error) { throw new Error(`Databricks could not be reached at ${url.origin}: ${errorText(error)}`); }
      // A service principal's OAuth token can be revoked or expire ahead of schedule: mint one more and retry once.
      if (attempt === 0 && (response.status === 401 || response.status === 403) && this.auth.mode === 'service_principal') { this.auth.invalidate(); continue; }
      const text = await response.text(); let payload: DatabricksPayload; try { payload = text ? JSON.parse(text) as DatabricksPayload : {}; } catch { payload = { message: text }; }
      if (!response.ok) throw new Error(`Databricks ${method} ${pathname} failed (${response.status}): ${payload.message || payload.error_code || text.slice(0, 500)}`);
      return payload;
    }
  }
  get(pathname: string, query?: HttpQuery) { return this.request('GET', pathname, { query }); }
  post(pathname: string, body?: JsonRecord) { return this.request('POST', pathname, { body }); }
}

export class DatabricksOperationsService {
  host?: string;
  token?: string;
  clientId?: string;
  clientSecret?: string;
  _auth?: DatabricksAuth;
  constructor({ host = process.env.DATABRICKS_HOST, token = process.env.DATABRICKS_TOKEN, clientId = process.env.DATABRICKS_CLIENT_ID, clientSecret = process.env.DATABRICKS_CLIENT_SECRET }: AuthOptions = {}) { Object.assign(this, { host, token, clientId, clientSecret }); }
  /** One auth per service, so a service principal's OAuth token is minted once and reused across calls. */
  get auth() { return (this._auth ??= new DatabricksAuth({ host: this.host, token: this.token, clientId: this.clientId, clientSecret: this.clientSecret })); }
  client() { return new DatabricksHttpClient({ host: this.host, auth: this.auth }); }

  async listPipelines({ limit = 1000 }: { limit?: number } = {}) {
    const target = Math.max(1, Math.min(5000, Number(limit) || 1000));
    const client = this.client(); const jobs: DatabricksJob[] = []; let pageToken: string | null | undefined; let pages = 0;
    do {
      const payload = await client.get('/api/2.2/jobs/list', { limit: Math.min(100, target - jobs.length), page_token: pageToken });
      jobs.push(...(payload.jobs || [])); pageToken = payload.next_page_token || null; pages += 1;
      if (!pageToken && payload.has_more) throw new Error('Databricks jobs/list returned has_more without next_page_token; refusing to report an incomplete pipeline inventory');
    } while (pageToken && jobs.length < target && pages < 50);
    // Run health is joined by the operations service from one paginated workspace run feed,
    // which avoids an N+1 burst that Databricks can rate-limit.
    return jobs.slice(0, target).map(j => ({ pipelineId: String(j.job_id), name: j.settings?.name || `job-${j.job_id}`, platform: 'databricks', status: 'no_runs', summary: j.settings?.description || '', owner: j.creator_user_name || null, schedule: normalizeSchedule(j.settings?.schedule), lastRunId: null, lastRunAt: null, lastSuccessAt: null }));
  }

  async queryRows({ statement, warehouseId, catalog, schema, parameters = [], timeoutSeconds, rowLimit }: SqlOptions = {}) {
    if (!warehouseId) throw new Error('Databricks SQL warehouse ID is required');
    if (!/^\s*SELECT\b/i.test(String(statement || '')) || String(statement).includes(';')) throw new Error('Only one read-only SELECT statement is allowed');
    const result = await this.#executeStatement(statement, warehouseId, { catalog, schema, parameters, timeoutSeconds, rowLimit });
    const columns = (result.manifest?.schema?.columns || []).map(column => column.name); const values = result.result?.data_array || [];
    return values.map(row => Object.fromEntries(columns.map((column, index) => [column, row[index]])));
  }

  async executeStatement({ statement, warehouseId, catalog, schema, parameters = [] }: SqlOptions = {}) {
    if (!warehouseId) throw new Error('Databricks SQL warehouse ID is required');
    const sql = String(statement || '').trim();
    if (!sql || sql.includes(';')) throw new Error('One SQL statement is required');
    return this.#executeStatement(sql, warehouseId, { catalog, schema, parameters });
  }

  async getPipeline({ pipelineId }: { pipelineId?: string }) {
    if (!pipelineId) throw new Error('pipelineId is required');
    const c = this.client(); const j = await c.get('/api/2.2/jobs/get', { job_id: pipelineId }); const runs = await this.listRuns({ pipelineId, limit: 1, maxRuns: 1 }); const r = runs[0];
    return { pipelineId: String(j.job_id), name: j.settings?.name || `job-${j.job_id}`, platform: 'databricks', status: r?.status || 'no_runs', summary: j.settings?.description || '', owner: j.creator_user_name || null, schedule: normalizeSchedule(j.settings?.schedule), lastRunId: r?.runId || null, lastRunAt: r?.startTime || null, lastSuccessAt: r?.status === 'healthy' ? r?.endTime : null };
  }

  async listRuns({ pipelineId, limit = 20, maxRuns, startTimeFrom, startTimeTo }: ListRunsOptions = {}) {
    const c = this.client();
    // The background fetch asks for up to 10,000 runs bounded by its window (ADR-0002); runs/list pages hold at most 25.
    const target = Math.max(1, Math.min(MAX_RUNS_PER_CALL, Number(maxRuns || limit) || 20));
    const pageSize = Math.max(1, Math.min(25, target));
    const rows: DatabricksRun[] = []; let pageToken: string | null | undefined; let pages = 0;
    do {
      const payload = await c.get('/api/2.2/jobs/runs/list', { job_id: pipelineId, limit: pageSize, expand_tasks: 'true', start_time_from: startTimeFrom, start_time_to: startTimeTo, page_token: pageToken });
      rows.push(...(payload.runs || [])); pages += 1; pageToken = payload.next_page_token || null;
      if (!pageToken && payload.has_more) throw new Error('Databricks runs/list returned has_more without next_page_token; refusing to report an incomplete monitor result');
    } while (pageToken && rows.length < target && pages < Math.ceil(MAX_RUNS_PER_CALL / 25));
    return rows.slice(0, target).map(r => this.#normalizeRun(r, { pipelineId: String(r.job_id || pipelineId) })).sort((a, b) => String(b.startTime || '').localeCompare(String(a.startTime || '')));
  }

  async getRun({ runId, pipelineId }: { runId?: string; pipelineId?: string }) {
    if (!runId) throw new Error('runId is required');
    const r = await this.client().get('/api/2.2/jobs/runs/get', { run_id: runId });
    return this.#normalizeRun(r, { pipelineId: String(r.job_id || pipelineId || ''), includeGraph: true });
  }

  /**
   * Run one statement and wait at most `timeoutSeconds` (5 to 50, the range Databricks accepts).
   * `on_wait_timeout: CANCEL` makes Databricks stop the statement itself when the wait runs out, so a slow
   * query never keeps holding the warehouse after the caller has given up. If the statement is somehow
   * still running after that, it is cancelled explicitly before the error is raised.
   */
  async #executeStatement(statement: string | undefined, warehouseId: string, { catalog, schema, parameters = [], timeoutSeconds = STATEMENT_TIMEOUT_SECONDS, rowLimit }: SqlOptions = {}): Promise<DatabricksPayload> {
    const client = this.client();
    const seconds = Math.max(5, Math.min(50, Math.round(Number(timeoutSeconds) || STATEMENT_TIMEOUT_SECONDS)));
    const timedOut = () => Object.assign(new Error(`The query took longer than ${seconds} seconds and was stopped.`), { code: 'STATEMENT_TIMEOUT' });
    const created = await client.post('/api/2.0/sql/statements', { warehouse_id: warehouseId, statement, wait_timeout: `${seconds}s`, on_wait_timeout: 'CANCEL', ...(catalog ? { catalog } : {}), ...(schema ? { schema } : {}), ...(parameters.length ? { parameters } : {}), ...(Number.isSafeInteger(rowLimit) && rowLimit! > 0 ? { row_limit: rowLimit } : {}) } as JsonRecord);
    let current = created;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const state = current.status?.state;
      if (state === 'SUCCEEDED') return current;
      if (state === 'CANCELED') throw timedOut();
      if (state && ['FAILED', 'CLOSED'].includes(state)) throw new Error(`SQL statement failed: ${current.status?.error?.message || state}`);
      if (!created.statement_id) break;
      await new Promise(resolve => setTimeout(resolve, 1000));
      current = await client.get(`/api/2.0/sql/statements/${created.statement_id}`);
    }
    if (created.statement_id) await client.post(`/api/2.0/sql/statements/${created.statement_id}/cancel`).catch(() => null);
    throw timedOut();
  }
  #normalizeRun(r: DatabricksRun, { pipelineId, includeGraph = false }: RunNormalizeOptions = {}): NormalizedRun {
    const raw = resultState(r); const status = this.#normalizeStatus(r, raw); const failed = failingTask(r);
    const out: NormalizedRun = { runId: String(r.run_id), pipelineId: String(pipelineId || r.job_id || ''), name: r.run_name || null, status, rawState: raw, rawLifecycleState: lifecycleOf(r), startTime: toIso(r.start_time), endTime: toIso(r.end_time), durationMs: r.run_duration || r.execution_duration || null, failingTask: status === 'failed' ? failed?.task_key || null : null, failureSummary: status === 'failed' ? (failed?.state?.state_message || failed?.status?.termination_details?.message || failed?.status?.message || r?.state?.state_message || r?.status?.termination_details?.message || r?.status?.message || 'Pipeline run failed') : null };
    if (includeGraph) out.taskGraph = taskGraph(r);
    return out;
  }
  #statusFromState(raw: string) { raw = upper(raw); if (FAILED_STATES.has(raw) || /(?:FAILED|FAILURE|ERROR|TIMEOUT|TIMED_OUT|CANCEL)/.test(raw)) return 'failed'; if (SUCCESS_STATES.has(raw)) return 'healthy'; if (RUNNING_STATES.has(raw)) return 'running'; if (SKIPPED_STATES.has(raw)) return 'skipped'; if (raw === 'TERMINATED') return 'completed'; return 'status_not_reported'; }
  #normalizeStatus(run: DatabricksRun, raw: string) { const direct = this.#statusFromState(raw); if (['failed', 'healthy', 'running'].includes(direct)) return direct; const tasks = (run?.tasks || []).map(task => this.#statusFromState(resultState(task))); if (tasks.includes('failed')) return 'failed'; if (tasks.includes('running')) return 'running'; if (tasks.length && tasks.every(status => ['healthy', 'skipped', 'completed'].includes(status)) && tasks.includes('healthy')) return 'healthy'; return direct; }
}
