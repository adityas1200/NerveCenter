import { config } from '../../config.mjs';
import { normalizeOrigin, schemeForHost } from '../../lib/endpoint.mjs';
import { errorText } from '../../lib/errors.mjs';

const FIELDS = [
  'sys_id', 'number', 'short_description', 'description', 'priority', 'state',
  'sys_created_on', 'sys_updated_on', 'opened_by.name', 'caller_id.name', 'assigned_to.name', 'assigned_to.email', 'assignment_group.name', 'category', 'sys_tags',
].join(',');
type ServiceNowValue = string | { display_value?: string; value?: string } | null | undefined;
type ServiceNowIncidentRow = Record<string, ServiceNowValue>;
type ServiceNowStore = { get?(ref: string): Promise<string | undefined> };
type ServiceNowConnections = {
  getDefault?(kind: 'servicenow'): Promise<{ id: string; config?: { instance?: string } } | null | undefined>;
  getRaw(id: string): Promise<{ secretRef?: string } | null | undefined>;
};
type ServiceNowSettings = { mode: 'live' | 'disabled'; instance?: string; query: string; secretRef?: string };
type ServiceNowFilters = { assignmentGroup?: string; states?: string | string[]; tag?: string; updatedSinceHours?: number; priorities?: string | string[]; numbers?: string | string[] };
type ServiceNowIncidentFields = Record<string, string | number | boolean | null>;
// Encoded-query codes for the incident choice fields. Accepts ServiceNow display names,
// NerveCenter statuses, or raw numeric codes so the UI can send whichever it has.
const STATE_CODES = new Map([
  ['1', '1'], ['new', '1'], ['open', '1'], ['2', '2'], ['in progress', '2'], ['in_progress', '2'], ['3', '3'], ['on hold', '3'], ['on_hold', '3'], ['awaiting_approval', '3'],
  ['6', '6'], ['resolved', '6'], ['7', '7'], ['closed', '7'], ['8', '8'], ['canceled', '8'], ['cancelled', '8'],
]);
const PRIORITY_CODES = new Map([
  ['1', '1'], ['critical', '1'], ['1 - critical', '1'], ['2', '2'], ['high', '2'], ['2 - high', '2'], ['3', '3'], ['medium', '3'], ['moderate', '3'], ['3 - moderate', '3'],
  ['4', '4'], ['low', '4'], ['4 - low', '4'], ['5', '5'], ['planning', '5'], ['5 - planning', '5'],
]);
const codes = (values: string | string[] | undefined, table: Map<string, string>) => [...new Set((Array.isArray(values) ? values : [values]).map(value => table.get(String(value ?? '').trim().toLowerCase())).filter((value): value is string => Boolean(value)))];
const list = (values: string | string[] | undefined) => (Array.isArray(values) ? values : values === undefined || values === null || values === '' ? [] : [values]).map(value => String(value).trim()).filter(Boolean);
// ServiceNow renders sys_created_on/sys_updated_on as "YYYY-MM-DD HH:mm:ss" (UTC for the API user); store ISO.
function toIso(value: ServiceNowValue, fallback: string) { const raw = text(value); if (!raw) return fallback; const at = Date.parse(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw) ? `${raw.replace(' ', 'T')}Z` : raw); return Number.isFinite(at) ? new Date(at).toISOString() : fallback; }
const tagsOf = (value: ServiceNowValue) => [...new Set(display(value).split(',').map(tag => tag.trim()).filter(Boolean))];

const stateMap = new Map([
  ['new', 'open'], ['1', 'open'], ['in progress', 'in_progress'], ['2', 'in_progress'],
  ['on hold', 'awaiting_approval'], ['3', 'awaiting_approval'], ['resolved', 'closed'],
  ['6', 'closed'], ['closed', 'closed'], ['7', 'closed'], ['canceled', 'closed'], ['cancelled', 'closed'], ['8', 'closed'],
]);
const priorityMap = new Map([
  ['1 - critical', 'critical'], ['1', 'critical'], ['2 - high', 'high'], ['2', 'high'],
  ['3 - moderate', 'medium'], ['3', 'medium'], ['4 - low', 'low'], ['4', 'low'], ['5 - planning', 'low'], ['5', 'low'],
]);

// Unlike Jira, ServiceNow's Table API has no comparable hard per-request platform cap (sysparm_limit is
// governed by the instance's own configured "Web Service Limit", typically well above this); one request
// suffices, no pagination needed here. 2000 is a safety backstop against a stray typed value, not a real limit.
function boundedLimit(value: number | undefined) { return Math.max(1, Math.min(2000, Number(value) || 50)); }
function text(value: unknown, fallback = '') { return typeof value === 'string' && value.trim() ? value.trim() : fallback; }
function display(value: ServiceNowValue) { return typeof value === 'object' && value ? text(value.display_value || value.value) : text(value); }
function normalizeState(value: ServiceNowValue) { return stateMap.get(display(value).toLowerCase()) || 'open'; }
function normalizePriority(value: ServiceNowValue) { return priorityMap.get(display(value).toLowerCase()) || 'medium'; }
function redactedError(error: unknown) { return errorText(error, 'ServiceNow request failed'); }

export function normalizeServiceNowInstance(value: string | undefined) {
  const raw = text(value);
  if (!raw) throw new Error('ServiceNow instance is not configured');
  const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  let url;
  try { url = new URL(candidate); } catch { throw new Error('ServiceNow instance must be a valid hostname or HTTPS URL'); }
  if (url.pathname && url.pathname !== '/') throw new Error('ServiceNow instance must be a bare HTTPS hostname');
  return new URL(normalizeOrigin(candidate, { label: 'ServiceNow instance' })).host; // host keeps a non-default port so a loopback stub works
}

/** Base URL for an instance stored as host[:port]: HTTPS for real instances, HTTP for loopback stubs. */
export function serviceNowBaseUrl(instance: string) { return `${schemeForHost(instance)}://${instance}`; }

// A person from a source system. The id is the email when known, otherwise the name; NerveCenter
// matches people across systems by id, email or name.
const person = (name: string, email = '') => (name && !/^(unassigned|undefined|null)$/i.test(name) ? { type: 'user', id: email && email.includes('@') ? email : name, name, ...(email && email.includes('@') ? { email } : {}) } : null);

function mapIncident(row: ServiceNowIncidentRow, instance: string) {
  const sysId = text(row?.sys_id);
  if (!sysId) throw new Error('ServiceNow incident is missing sys_id');
  const number = text(row?.number, sysId);
  return {
    source: 'servicenow',
    sourceKey: `servicenow:${sysId}`,
    externalReference: { system: 'servicenow', sysId, number, url: `${serviceNowBaseUrl(instance)}/nav_to.do?uri=${encodeURIComponent(`incident.do?sys_id=${sysId}`)}` },
    platform: 'servicenow',
    pipelineName: number,
    title: text(row?.short_description, '(no short description)'),
    description: text(row?.description, ''),
    failureSummary: text(row?.description, 'ServiceNow incident imported for investigation.'),
    priority: normalizePriority(row?.priority),
    status: normalizeState(row?.state),
    category: display(row?.category) || 'Uncategorized',
    tags: tagsOf(row?.sys_tags),
    creator: { id: 'servicenow', name: 'ServiceNow' },
    assignee: person(display(row?.['assigned_to.name']), display(row?.['assigned_to.email'])),
    requester: person(display(row?.['caller_id.name']) || display(row?.['opened_by.name'])),
    createdAt: toIso(row?.sys_created_on, new Date().toISOString()),
    updatedAt: toIso(row?.sys_updated_on, new Date().toISOString()),
    metadata: {
      source: 'servicenow', serviceNow: {
        sysId, number, state: display(row?.state), priority: display(row?.priority),
        requester: display(row?.['opened_by.name']) || 'Unknown',
        assignedTo: display(row?.['assigned_to.name']) || 'Unassigned',
        assignmentGroup: display(row?.['assignment_group.name']) || null,
        category: display(row?.category) || 'Uncategorized',
        tags: tagsOf(row?.sys_tags),
      },
    },
  };
}

// Sync and preview filters become one encoded sysparm_query.
export function buildServiceNowQuery(baseQuery: string, filters: ServiceNowFilters = {}) {
  const [base, ...order] = String(baseQuery || 'active=true').split(/\^(?=ORDERBY)/);
  // Looking up specific incidents by number ignores the active filter: that is how closed ones are noticed.
  const numbers = list(filters.numbers);
  const parts = numbers.length ? [`numberIN${numbers.join(',')}`] : [base].filter(Boolean);
  const group = text(filters.assignmentGroup); if (group) parts.push(`assignment_group.name=${group}`);
  const states = codes(list(filters.states), STATE_CODES); if (states.length) parts.push(`stateIN${states.join(',')}`);
  const hours = Number(filters.updatedSinceHours); if (Number.isFinite(hours) && hours > 0) parts.push(`sys_updated_on>=javascript:gs.hoursAgo(${Math.round(hours)})`);
  const priorities = codes(list(filters.priorities), PRIORITY_CODES); if (priorities.length) parts.push(`priorityIN${priorities.join(',')}`);
  const tag = text(filters.tag); if (tag) parts.push(`sys_tagsLIKE${tag}`);
  return [...parts, ...order].join('^');
}

export class ServiceNowService {
  secretStore?: ServiceNowStore;
  connectionService?: ServiceNowConnections;
  fetchFn!: typeof globalThis.fetch;
  instance!: string;
  query!: string;
  secretRef!: string;
  environment!: boolean;
  // `environment: false` (a project's instance) never reads deployment variables: the environment is imported once as the
  // profile `servicenow-env` and a project uses it only through a grant (SPEC-projects-01 FR-32).
  constructor({ secretStore, connectionService, fetchFn = globalThis.fetch, instance = config.serviceNowInstance, query = config.serviceNowQuery, secretRef = config.serviceNowSecretRef, environment = true }: { secretStore?: ServiceNowStore; connectionService?: ServiceNowConnections; fetchFn?: typeof globalThis.fetch; instance?: string; query?: string; secretRef?: string; environment?: boolean } = {}) {
    if (!environment) { instance = ''; secretRef = ''; }
    Object.assign(this, { secretStore, connectionService, fetchFn, instance, query, secretRef, environment });
  }

  // A managed connection profile wins; otherwise deployment env vars; otherwise disabled.
  async settings(): Promise<ServiceNowSettings> {
    const profile = await this.connectionService?.getDefault?.('servicenow');
    if (profile) return { mode: 'live', instance: profile.config?.instance, query: this.query, secretRef: (await this.connectionService?.getRaw(profile.id))?.secretRef || this.secretRef };
    if (this.instance) return { mode: 'live', instance: this.instance, query: this.query, secretRef: this.secretRef };
    return { mode: 'disabled', instance: '', query: this.query, secretRef: this.secretRef };
  }
  async enabled() { return (await this.settings()).mode !== 'disabled'; }

  async credentials(settings?: ServiceNowSettings) {
    settings ||= await this.settings();
    let username = this.environment ? config.serviceNowUsername : '';
    let password = this.environment ? process.env.SERVICENOW_PASSWORD || '' : '';
    const stored = settings.secretRef ? await this.secretStore?.get?.(settings.secretRef) : undefined;
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as { username?: string; password?: string; token?: string };
        username = text(parsed.username, username);
        password = text(parsed.password || parsed.token, password);
      } catch { password = stored; }
    }
    if (!username || !password) throw new Error('ServiceNow credential is missing');
    return { username, password };
  }

  async status({ verify = false }: { verify?: boolean } = {}) {
    const settings = await this.settings();
    if (settings.mode === 'disabled') return { mode: 'disabled', configured: false, ready: false, reason: 'ServiceNow is not connected', assignmentGroups: [] };
    try {
      const instance = normalizeServiceNowInstance(settings.instance);
      await this.credentials(settings);
      if (verify) await this.listIncidents({ limit: 1 });
      return { mode: 'live', configured: true, ready: true, instance, source: 'servicenow', assignmentGroups: [] };
    } catch (error) { return { mode: 'live', configured: Boolean(settings.instance), ready: false, reason: redactedError(error), assignmentGroups: [] }; }
  }

  async #connect() {
    const settings = await this.settings();
    if (settings.mode === 'disabled') throw new Error('ServiceNow is not connected');
    const instance = normalizeServiceNowInstance(settings.instance);
    const { username, password } = await this.credentials(settings);
    return { settings, instance, authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}` };
  }
  async #send(url: URL, authorization: string, { method, body }: { method?: string; body?: ServiceNowIncidentFields } = {}) {
    let response;
    try { response = await this.fetchFn(url, { ...(method ? { method } : {}), headers: { Authorization: authorization, Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15_000) }); }
    catch (error) { throw new Error(`ServiceNow request failed: ${redactedError(error)}`); }
    return { response, body: await response.text() };
  }

  async listIncidents({ limit = 50, offset = 0, assignmentGroup, states, tag, updatedSinceHours, priorities, numbers }: { limit?: number; offset?: number } & ServiceNowFilters = {}) {
    const { settings, instance, authorization } = await this.#connect();
    const query = buildServiceNowQuery(settings.query, { assignmentGroup, states, tag, updatedSinceHours, priorities, numbers });
    const url = new URL(`${serviceNowBaseUrl(instance)}/api/now/table/incident`);
    url.searchParams.set('sysparm_limit', String(boundedLimit(limit)));
    url.searchParams.set('sysparm_offset', String(Math.max(0, Number(offset) || 0)));
    url.searchParams.set('sysparm_query', query);
    url.searchParams.set('sysparm_display_value', 'true');
    url.searchParams.set('sysparm_exclude_reference_link', 'true');
    url.searchParams.set('sysparm_fields', FIELDS);
    const { response, body } = await this.#send(url, authorization);
    if (!response.ok) throw new Error(`ServiceNow returned HTTP ${response.status}`);
    let parsed: { result?: ServiceNowIncidentRow[] };
    try { parsed = JSON.parse(body) as { result?: ServiceNowIncidentRow[] }; } catch { throw new Error('ServiceNow returned invalid JSON'); }
    const rows = Array.isArray(parsed.result) ? parsed.result : [];
    return { incidents: rows.map(row => mapIncident(row, instance)), total: rows.length, instance, source: 'servicenow', query };
  }

  /**
   * Write to one incident: work notes, state, assignee, priority, close fields. Values are sent as
   * display values (sysparm_input_display_value), so an assignee can be given by name or email.
   * Returns the incident as ServiceNow now has it.
   */
  async updateIncident({ sysId, fields = {} }: { sysId?: string; fields?: ServiceNowIncidentFields } = {}) {
    if (!sysId) throw new Error('sysId is required');
    const { instance, authorization } = await this.#connect();
    const url = new URL(`${serviceNowBaseUrl(instance)}/api/now/table/incident/${encodeURIComponent(sysId)}`);
    url.searchParams.set('sysparm_display_value', 'true');
    url.searchParams.set('sysparm_input_display_value', 'true');
    url.searchParams.set('sysparm_exclude_reference_link', 'true');
    url.searchParams.set('sysparm_fields', FIELDS);
    const { response, body } = await this.#send(url, authorization, { method: 'PATCH', body: fields });
    if (!response.ok) { let detail = ''; try { detail = JSON.parse(body)?.error?.message || ''; } catch { /* not JSON */ } throw new Error(`ServiceNow refused the update (HTTP ${response.status}${detail ? `: ${detail}` : ''})`); }
    let parsed: { result?: ServiceNowIncidentRow }; try { parsed = JSON.parse(body) as { result?: ServiceNowIncidentRow }; } catch { throw new Error('ServiceNow returned invalid JSON'); }
    return parsed.result ? mapIncident({ sys_id: sysId, ...parsed.result }, instance) : null;
  }

  /**
   * Open an incident (SPEC-tickets-07). `correlationId` is NerveCenter's idempotency key: ServiceNow has none of its own, so
   * the caller looks it up with findByCorrelation before creating. Values go in as display values, like updateIncident.
   */
  async createIncident({ title, description, priority, assignmentGroup, correlationId }: { title?: string; description?: string; priority?: string; assignmentGroup?: string; correlationId?: string } = {}) {
    if (!String(title || '').trim()) throw new Error('title is required');
    const { instance, authorization } = await this.#connect();
    const url = new URL(`${serviceNowBaseUrl(instance)}/api/now/table/incident`);
    url.searchParams.set('sysparm_display_value', 'true');
    url.searchParams.set('sysparm_input_display_value', 'true');
    url.searchParams.set('sysparm_exclude_reference_link', 'true');
    url.searchParams.set('sysparm_fields', FIELDS);
    const fields = { short_description: String(title).slice(0, 160), description: String(description || ''), ...(priority ? { priority } : {}), ...(assignmentGroup ? { assignment_group: assignmentGroup } : {}), ...(correlationId ? { correlation_id: correlationId, correlation_display: 'NerveCenter' } : {}) };
    const { response, body } = await this.#send(url, authorization, { method: 'POST', body: fields });
    if (!response.ok) { let detail = ''; try { detail = JSON.parse(body)?.error?.message || ''; } catch { /* not JSON */ } throw new Error(`ServiceNow refused the new incident (HTTP ${response.status}${detail ? `: ${detail}` : ''})`); }
    let parsed: { result?: ServiceNowIncidentRow }; try { parsed = JSON.parse(body) as { result?: ServiceNowIncidentRow }; } catch { throw new Error('ServiceNow returned invalid JSON'); }
    if (!parsed.result?.sys_id) throw new Error('ServiceNow did not return the new incident');
    return mapIncident(parsed.result, instance);
  }

  /** The incident NerveCenter opened earlier under `correlationId`, or null. */
  async findByCorrelation(correlationId: string) {
    if (!String(correlationId || '').trim()) return null;
    const { instance, authorization } = await this.#connect();
    const url = new URL(`${serviceNowBaseUrl(instance)}/api/now/table/incident`);
    url.searchParams.set('sysparm_limit', '1');
    url.searchParams.set('sysparm_query', `correlation_id=${String(correlationId).replace(/\^/g, '')}`);
    url.searchParams.set('sysparm_display_value', 'true');
    url.searchParams.set('sysparm_exclude_reference_link', 'true');
    url.searchParams.set('sysparm_fields', FIELDS);
    const { response, body } = await this.#send(url, authorization);
    if (!response.ok) throw new Error(`ServiceNow returned HTTP ${response.status}`);
    let parsed: { result?: ServiceNowIncidentRow[] }; try { parsed = JSON.parse(body) as { result?: ServiceNowIncidentRow[] }; } catch { throw new Error('ServiceNow returned invalid JSON'); }
    const row = Array.isArray(parsed.result) ? parsed.result[0] : null;
    return row ? mapIncident(row, instance) : null;
  }

  async getIncident({ sysId }: { sysId?: string } = {}) {
    if (!sysId) throw new Error('sysId is required');
    const result = await this.listIncidents({ limit: 100 });
    const incident = result.incidents.find(item => item.externalReference.sysId === String(sysId));
    if (!incident) throw new Error('ServiceNow incident not found');
    return incident;
  }
}
