import { httpError, now } from '../lib/util.mjs';

// SPEC-projects-04: each project brings its own Anthropic API key, and its Claude calls use only that key.
// The key lives in the secret store, never in operations.yaml (the workspace is mirrored to S3 and the agent reads it).

export const apiKeyRef = projectId => `projects/${projectId}/anthropic/api-key`;
export const NO_PROJECT_KEY = 'This project has no Anthropic API key. Ask an app admin to add one in Settings > Model.';
const KEY_SHAPE = /^sk-ant-[A-Za-z0-9_-]{20,}$/;

/** FR-4: false when Anthropic rejects the key; null when it could not be asked (saved anyway, reported unverified). */
export async function checkWithAnthropic(key, fetchImpl = globalThis.fetch) {
  let response;
  try {
    response = await fetchImpl('https://api.anthropic.com/v1/models?limit=1', { headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' }, signal: AbortSignal.timeout(8_000) });
  } catch { return null; }
  if (response.status === 401 || response.status === 403) return false;
  return response.ok ? true : null;
}

export class ProjectApiKeys {
  constructor({ secretStore, check = checkWithAnthropic }) { Object.assign(this, { secretStore, check }); }

  async #read(projectId) {
    const raw = await this.secretStore.get(apiKeyRef(projectId)).catch(() => undefined);
    if (!raw) return null;
    try { const record = JSON.parse(raw); return typeof record?.key === 'string' && record.key ? record : null; } catch { return null; }
  }

  /** FR-2: what the UI may know. Never the key. */
  async status(projectId) {
    const record = await this.#read(projectId);
    return record ? { set: true, last4: record.key.slice(-4), setBy: record.setBy || null, setAt: record.setAt || null } : { set: false };
  }

  async key(projectId) { return projectId ? (await this.#read(projectId))?.key || null : null; }

  /** FR-6: the key a run must use; no fallback to the deployment key. */
  async require(projectId) {
    const key = await this.key(projectId);
    if (!key) throw httpError(409, NO_PROJECT_KEY);
    return key;
  }

  async set(projectId, input, actor = null) {
    const key = String(input ?? '').trim();
    if (!KEY_SHAPE.test(key)) throw httpError(400, 'That does not look like an Anthropic API key. It starts with sk-ant-.');
    const verified = await this.check(key);
    if (verified === false) throw httpError(400, 'Anthropic rejected this key. Check it and try again.');
    await this.secretStore.set(apiKeyRef(projectId), JSON.stringify({ key, setBy: actor?.name || actor?.id || 'unknown', setById: actor?.id || null, setAt: now() }));
    return { ...(await this.status(projectId)), verified: verified === true };
  }

  async remove(projectId, actor = null) {
    const record = await this.#read(projectId);
    if (record) {
      await this.secretStore.delete(apiKeyRef(projectId));
    }
    return { set: false };
  }
}
