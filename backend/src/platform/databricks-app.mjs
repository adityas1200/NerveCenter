import { randomUUID } from 'node:crypto';
import { config } from '../config.mjs';
import { errorText } from '../lib/errors.mjs';
import { DatabricksAuth } from '../connectors/databricks/databricks-service.mjs';

// The deployment's own Databricks identity: the service principal a Databricks App runs as
// (DATABRICKS_CLIENT_ID/SECRET, injected by the Apps runtime), or a token for local testing. Lakebase
// and the workspace volume use it. The Connectors page's Databricks connection is separate: that is
// the workspace the agent operates on, which need not be the one hosting NerveCenter.

let shared = null;
export function appDatabricksAuth() {
  shared ??= new DatabricksAuth({ host: config.databricksHost, token: process.env.DATABRICKS_TOKEN, clientId: process.env.DATABRICKS_CLIENT_ID, clientSecret: process.env.DATABRICKS_CLIENT_SECRET });
  return shared;
}

/** One authenticated call against the hosting workspace. `raw` returns the Response for binary bodies. */
export async function databricksRequest(auth, method, pathname, { query, json, body, headers = {}, raw = false, allow = [] } = {}) {
  const url = new URL(pathname, auth.host);
  for (const [key, value] of Object.entries(query || {})) if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  for (let attempt = 0; ; attempt += 1) {
    const requestHeaders = { authorization: await auth.header(), ...(json ? { 'content-type': 'application/json' } : {}), ...headers };
    let response;
    try { response = await fetch(url, { method, headers: requestHeaders, body: json ? JSON.stringify(json) : body, signal: AbortSignal.timeout(60_000) }); }
    catch (error) { throw new Error(`Databricks could not be reached at ${url.origin}: ${errorText(error)}`); }
    // A service principal's token can expire ahead of schedule: mint a new one and retry once.
    if (attempt === 0 && response.status === 401 && auth.mode === 'service_principal') { auth.invalidate(); continue; }
    if (allow.includes(response.status)) return response;
    if (!response.ok) { const text = await response.text().catch(() => ''); throw Object.assign(new Error(`Databricks ${method} ${url.pathname} failed (${response.status}): ${text.slice(0, 500)}`), { statusCode: response.status }); }
    if (raw) return response;
    const text = await response.text();
    return text ? JSON.parse(text) : {};
  }
}

const TOKEN_SKEW_MS = 5 * 60_000;

/**
 * Passwords for Lakebase. Lakebase signs Postgres roles in with Databricks OAuth tokens that last
 * about an hour, so the pool asks for one each time it opens a connection; the token is cached
 * until shortly before it expires. With LAKEBASE_INSTANCE_NAME set the token is a database
 * credential scoped to that instance; otherwise the service principal's workspace token is used.
 */
export class LakebaseTokenProvider {
  #cached = null; #pending = null;
  constructor({ auth = appDatabricksAuth(), instance = config.lakebaseInstance } = {}) { this.auth = auth; this.instance = instance; }

  async password() {
    if (this.#cached && this.#cached.expiresAt > Date.now()) return this.#cached.token;
    return (this.#pending ??= this.#mint().finally(() => { this.#pending = null; }));
  }

  async #mint() {
    if (!this.instance) {
      const token = (await this.auth.header()).replace(/^Bearer /, '');
      // DatabricksAuth caches and refreshes this itself; re-ask it every few minutes.
      this.#cached = { token, expiresAt: Date.now() + TOKEN_SKEW_MS };
      return token;
    }
    const payload = await databricksRequest(this.auth, 'POST', '/api/2.0/database/credentials', { json: { instance_names: [this.instance], request_id: randomUUID() } });
    if (!payload.token) throw new Error('Lakebase returned no database credential');
    const expiresAt = payload.expiration_time ? Date.parse(payload.expiration_time) : Date.now() + 3_600_000;
    this.#cached = { token: payload.token, expiresAt: Math.max(expiresAt - TOKEN_SKEW_MS, Date.now() + 30_000) };
    return payload.token;
  }
}
