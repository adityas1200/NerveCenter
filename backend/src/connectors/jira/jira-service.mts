// Read-only Jira Cloud client for the Tickets page: search issues with JQL and map them to
// NerveCenter tickets. Writes to Jira are the agent's job through its MCP connection.

import { normalizeOrigin } from '../../lib/endpoint.mjs';
import { errorText } from '../../lib/errors.mjs';

type JiraUser = { displayName?: string; emailAddress?: string; accountId?: string };
type JiraAdf = { type?: string; text?: string; content?: JiraAdf[] } | null | undefined;
type JiraIssue = { id: string | number; key: string; fields?: { status?: { name?: string; statusCategory?: { key?: string } }; labels?: string[]; summary?: string; description?: string | JiraAdf; priority?: { name?: string }; issuetype?: { name?: string }; project?: { key?: string }; assignee?: JiraUser; reporter?: JiraUser; created?: string; updated?: string; duedate?: string } };
type JiraTransition = { id: string; name?: string; isAvailable?: boolean; to?: { name?: string; statusCategory?: { key?: string } } };
type JiraSettings = { mode: 'live' | 'disabled'; site?: string; email?: string; project?: string; secretRef?: string };
type JiraStore = { get?(ref: string): Promise<string | undefined> };
type JiraConnections = { getDefault(kind: 'jira'): Promise<{ id: string; config?: { site?: string; email?: string; project?: string } } | null | undefined>; getRaw(id: string): Promise<{ secretRef?: string } | null | undefined> };
type JiraPriority = 'critical' | 'high' | 'medium' | 'low';
type JiraPersonInput = { accountId?: string; email?: string; name?: string; id?: string } | null;
type JiraRequestOptions = { method?: string; body?: unknown; timeout?: number };
type JiraSearchOptions = { jql?: string; project?: string; limit?: number; updatedSinceHours?: number; keys?: string[] };

const text = (value: unknown, fallback = '') => (typeof value === 'string' && value.trim() ? value.trim() : fallback);
const PRIORITY = new Map([['highest', 'critical'], ['blocker', 'critical'], ['critical', 'critical'], ['high', 'high'], ['major', 'high'], ['medium', 'medium'], ['normal', 'medium'], ['low', 'low'], ['lowest', 'low'], ['minor', 'low'], ['trivial', 'low']]);
const STATUS = new Map([['new', 'open'], ['to do', 'open'], ['open', 'open'], ['backlog', 'open'], ['selected for development', 'open'], ['in progress', 'in_progress'], ['in review', 'waiting'], ['review', 'waiting'], ['blocked', 'waiting'], ['waiting', 'waiting'], ['on hold', 'waiting'], ['done', 'closed'], ['closed', 'closed'], ['resolved', 'resolved'], ['cancelled', 'cancelled'], ['canceled', 'cancelled'], ['won\'t do', 'cancelled']]);
const normalizePriority = (value: unknown) => PRIORITY.get(text(value).toLowerCase()) || 'medium';
const normalizeStatus = (status: unknown, category: unknown) => STATUS.get(text(status).toLowerCase()) || (text(category).toLowerCase() === 'done' ? 'closed' : text(category).toLowerCase() === 'indeterminate' ? 'in_progress' : 'open');
const redacted = (error: unknown) => errorText(error, 'Jira request failed');
// Atlassian's own hard per-request cap for /rest/api/3/search/jql; requesting more just gets silently
// capped, so pagination is required to honor a caller's `limit` above this.
const JIRA_PAGE_SIZE = 100;
// A backstop, not a normal ceiling: guards a stray extra digit in a typed "Maximum" and the documented
// Atlassian bug where isLast can fail to ever turn true.
const SAFETY_CEILING = 2000;
const MAX_PAGES = Math.ceil(SAFETY_CEILING / JIRA_PAGE_SIZE) + 1;

/**
 * Jira's "done" status category is every terminal status at once: Done sits in it next to
 * Cancelled, Won't Do, Duplicate and Rejected. Resolving a ticket must not take whichever the
 * workflow happens to list first, so the target status name decides between finishing the work
 * and abandoning it. Anything unrecognised keeps the workflow's own order, as before.
 */
const ABANDONED = /\b(cancell?ed|cancel|won'?t\s*(do|fix)|wont\s*(do|fix)|rejected?|declined?|abandoned?|duplicate|invalid|obsolete|not\s+doing)\b/i;
const COMPLETED = /\b(done|resolved?|completed?|closed?|fixed|finished|delivered?|shipped|accepted?)\b/i;
export function terminalRank(transition: JiraTransition, abandon: boolean) {
  const name = `${transition?.to?.name || ''} ${transition?.name || ''}`;
  if (ABANDONED.test(name)) return abandon ? 2 : 0;
  if (COMPLETED.test(name)) return abandon ? 0 : 2;
  return 1;
}

export function normalizeJiraSite(value: string | undefined) {
  if (!text(value)) throw new Error('Jira site is not configured');
  return normalizeOrigin(value, { label: 'Jira site' });
}

const jiraPerson = (user?: JiraUser) => (user?.displayName ? { type: 'user', id: user.emailAddress || user.accountId || user.displayName, name: user.displayName, ...(user.emailAddress ? { email: user.emailAddress } : {}), ...(user.accountId ? { accountId: user.accountId } : {}) } : null);
export function mapIssue(issue: JiraIssue, site: string) {
  const fields = issue.fields || {};
  const statusName = fields.status?.name; const category = fields.status?.statusCategory?.key;
  const labels = Array.isArray(fields.labels) ? fields.labels : [];
  return {
    source: 'jira', sourceKey: `jira:${issue.id}`,
    externalReference: { system: 'jira', sysId: String(issue.id), number: issue.key, url: `${site}/browse/${issue.key}` },
    platform: 'jira', pipelineName: issue.key,
    title: text(fields.summary, '(no summary)'),
    description: typeof fields.description === 'string' ? fields.description : adfToText(fields.description),
    failureSummary: typeof fields.description === 'string' ? text(fields.description, 'Jira issue imported for investigation.') : adfToText(fields.description) || 'Jira issue imported for investigation.',
    priority: normalizePriority(fields.priority?.name), status: normalizeStatus(statusName, category),
    category: labels.find(label => /dq|quality/i.test(label)) ? 'data_quality' : labels.find(label => /pipeline|job/i.test(label)) ? 'pipeline_failure' : labels.find(label => /access/i.test(label)) ? 'access_request' : text(fields.issuetype?.name, 'Uncategorized'),
    type: text(fields.issuetype?.name) || undefined, tags: labels,
    creator: { id: 'jira', name: 'Jira' }, assignee: jiraPerson(fields.assignee), requester: jiraPerson(fields.reporter),
    createdAt: text(fields.created, new Date().toISOString()), updatedAt: text(fields.updated, new Date().toISOString()),
    metadata: { source: 'jira', jira: { key: issue.key, id: String(issue.id), status: statusName || null, statusCategory: category || null, priority: fields.priority?.name || null, issueType: fields.issuetype?.name || null, project: fields.project?.key || null, reporter: fields.reporter?.displayName || null, assignee: fields.assignee?.displayName || null, labels, dueDate: fields.duedate || null } },
  };
}
/** Atlassian Document Format to plain text, enough for a description. */
export function adfToText(node: JiraAdf): string { if (!node || typeof node !== 'object') return ''; if (node.type === 'text') return String(node.text || ''); const parts = (node.content || []).map(adfToText); const joined = parts.join(node.type === 'paragraph' || node.type === 'heading' || node.type === 'listItem' ? '' : ''); return ['paragraph', 'heading', 'listItem', 'codeBlock', 'blockquote'].includes(node.type || '') ? `${joined}\n` : joined; }

export class JiraService {
  secretStore?: JiraStore;
  connectionService?: JiraConnections;
  fetchFn!: typeof globalThis.fetch;
  constructor({ secretStore, connectionService, fetchFn = globalThis.fetch }: { secretStore?: JiraStore; connectionService?: JiraConnections; fetchFn?: typeof globalThis.fetch } = {}) { Object.assign(this, { secretStore, connectionService, fetchFn }); }
  async settings(): Promise<JiraSettings> {
    const profile = await this.connectionService?.getDefault?.('jira');
    if (!profile) return { mode: 'disabled' };
    const raw = await this.connectionService?.getRaw(profile.id);
    return { mode: 'live', site: profile.config?.site, email: profile.config?.email, project: profile.config?.project || '', secretRef: raw?.secretRef };
  }
  async credentials(settings: JiraSettings) { const stored = settings.secretRef ? await this.secretStore?.get?.(settings.secretRef) : undefined; let token = ''; try { token = text((JSON.parse(stored || '{}') as { apiToken?: string }).apiToken); } catch { token = text(stored); } if (!settings.email || !token) throw new Error('Jira credential is missing'); return { email: settings.email, token }; }
  async status({ verify = false }: { verify?: boolean } = {}) {
    const settings = await this.settings();
    if (settings.mode === 'disabled') return { mode: 'disabled', configured: false, ready: false, reason: 'Jira is not connected' };
    try { const site = normalizeJiraSite(settings.site); await this.credentials(settings); if (verify) await this.searchIssues({ limit: 1 }); return { mode: 'live', configured: true, ready: true, site, project: settings.project || null, source: 'jira' }; }
    catch (error) { return { mode: 'live', configured: Boolean(settings.site), ready: false, reason: redacted(error) }; }
  }
  /** JQL search. `jql` overrides the default "open issues in the default project" query. */
  /** `keys` looks specific issues up regardless of status; that is how issues closed in Jira are noticed. */
  /**
   * /rest/api/3/search/jql caps a single request's maxResults at 100 - Atlassian's own hard limit,
   * not ours - and paginates by opaque nextPageToken/isLast (no startAt, no total). To honor a
   * `limit` above 100, page through 100 at a time until isLast, the requested limit, or the safety
   * ceiling is reached. The ceiling also guards a documented Atlassian bug where isLast can fail to
   * ever turn true and nextPageToken cycles without making progress.
   */
  async searchIssues({ jql, project, limit = 50, updatedSinceHours, keys }: JiraSearchOptions = {}) {
    const connection = await this.#connect(); const { settings, site } = connection;
    const key = text(project) || settings.project;
    const wanted = (Array.isArray(keys) ? keys : []).map(value => String(value || '').trim().toUpperCase()).filter(value => /^[A-Z][A-Z0-9_]+-\d+$/.test(value));
    const clauses = [key ? `project = "${key.replace(/"/g, '')}"` : null, 'statusCategory != Done', Number(updatedSinceHours) > 0 ? `updated >= -${Math.round(Number(updatedSinceHours))}h` : null].filter(Boolean);
    const query = wanted.length ? `key in (${wanted.join(', ')}) ORDER BY updated DESC` : text(jql) || `${clauses.join(' AND ')} ORDER BY priority DESC, updated DESC`;
    const wanted_total = Math.max(1, Math.min(SAFETY_CEILING, Number(limit) || 50));
    const fields = ['summary', 'description', 'status', 'priority', 'issuetype', 'project', 'labels', 'reporter', 'assignee', 'created', 'updated', 'duedate'];
    const issues = [];
    let nextPageToken; let pages = 0; let previousToken;
    while (issues.length < wanted_total && pages < MAX_PAGES) {
      pages += 1;
      const body = { jql: query, maxResults: Math.min(JIRA_PAGE_SIZE, wanted_total - issues.length), fields, ...(nextPageToken ? { nextPageToken } : {}) };
      const { response, raw } = await this.#send(connection, '/rest/api/3/search/jql', { method: 'POST', body, timeout: 20_000 });
      if (!response.ok) throw new Error(`Jira returned HTTP ${response.status}${response.status === 400 ? ' (check the JQL and project key)' : ''}`);
      let parsed: { issues?: JiraIssue[]; isLast?: boolean; nextPageToken?: string }; try { parsed = JSON.parse(raw) as typeof parsed; } catch { throw new Error('Jira returned invalid JSON'); }
      const page = Array.isArray(parsed.issues) ? parsed.issues : [];
      issues.push(...page);
      // Guard the documented isLast-never-true bug: if a page is empty or the token didn't move, stop rather than loop.
      if (parsed.isLast || !page.length || !parsed.nextPageToken || parsed.nextPageToken === previousToken) break;
      previousToken = parsed.nextPageToken; nextPageToken = parsed.nextPageToken;
    }
    const trimmed = issues.slice(0, wanted_total);
    return { incidents: trimmed.map(issue => mapIssue(issue, site)), total: trimmed.length, site, source: 'jira', query };
  }

  /* ------------------------------------------------------------------ writes */

  async #connect() {
    const settings = await this.settings(); if (settings.mode === 'disabled') throw new Error('Jira is not connected');
    const site = normalizeJiraSite(settings.site); const { email, token } = await this.credentials(settings);
    return { settings, site, authorization: `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}` };
  }
  async #send({ site, authorization }: { site: string; authorization: string }, path: string, { method, body, timeout = 15_000 }: JiraRequestOptions = {}) {
    let response;
    try { response = await this.fetchFn(new URL(`${site}${path}`), { method, headers: { Authorization: authorization, Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(timeout) }); }
    catch (error) { throw new Error(`Jira request failed: ${redacted(error)}`); }
    return { response, raw: await response.text() };
  }
  async #request(method: string, path: string, body?: unknown): Promise<unknown> {
    const { response, raw } = await this.#send(await this.#connect(), path, { method, body });
    if (!response.ok) { let detail = ''; try { const parsed = JSON.parse(raw); detail = [...(parsed.errorMessages || []), ...Object.values(parsed.errors || {})].join('; '); } catch { /* not JSON */ } throw new Error(`Jira refused the change (HTTP ${response.status}${detail ? `: ${detail}` : ''})`); }
    if (!raw) return null; try { return JSON.parse(raw); } catch { return null; }
  }
  /**
   * Open an issue (SPEC-tickets-07) and return it mapped like an imported one. `label` is NerveCenter's idempotency key (Jira has
   * none): the caller looks it up with findByLabel first. A project whose create screen has no priority field gets the issue
   * without one rather than no issue at all.
   */
  async createIssue({ projectKey, issueType = 'Task', title, description, priority, label }: { projectKey?: string; issueType?: string; title?: string; description?: string; priority?: string; label?: string } = {}) {
    const connection = await this.#connect();
    const key = text(projectKey) || connection.settings.project;
    if (!key) throw new Error('A Jira project key is needed to open an issue. Set one in Settings > Automations or on the Jira connection.');
    if (!text(title)) throw new Error('title is required');
    const adf = { type: 'doc', version: 1, content: String(description || '').split(/\r?\n\r?\n/).map(paragraph => ({ type: 'paragraph', content: paragraph ? [{ type: 'text', text: paragraph }] : [] })) };
    const fields = { project: { key }, issuetype: { name: text(issueType, 'Task') }, summary: String(title).slice(0, 250), description: adf, labels: label ? [label] : [], ...(priority ? { priority: { name: priority } } : {}) };
    let created: { id?: string; key?: string } | null;
    try { created = await this.#request('POST', '/rest/api/3/issue', { fields }) as { id?: string; key?: string } | null; }
    catch (error) { if (!priority || !/priority/i.test(String((error as Error).message))) throw error; const { priority: _p, ...rest } = fields; created = await this.#request('POST', '/rest/api/3/issue', { fields: rest }) as { id?: string; key?: string } | null; }
    if (!created?.key) throw new Error('Jira did not return the new issue');
    const found = await this.searchIssues({ keys: [created.key], limit: 1 }).catch(() => null);
    return found?.incidents?.[0] || mapIssue({ id: created.id || created.key, key: created.key, fields: { summary: fields.summary, description: adf, labels: fields.labels, issuetype: fields.issuetype, status: { name: 'To Do', statusCategory: { key: 'new' } } } }, connection.site);
  }

  /** The issue NerveCenter opened earlier under `label`, or null. */
  async findByLabel(label: string) {
    if (!/^[A-Za-z0-9_-]+$/.test(String(label || ''))) return null;
    const result = await this.searchIssues({ jql: `labels = "${label}" ORDER BY created DESC`, limit: 1 });
    return result.incidents[0] || null;
  }

  /** A comment on the issue, as plain text in Atlassian Document Format. */
  async addComment(key: string, text: string) { return this.#request('POST', `/rest/api/3/issue/${encodeURIComponent(key)}/comment`, { body: { type: 'doc', version: 1, content: String(text).split(/\r?\n\r?\n/).map(paragraph => ({ type: 'paragraph', content: paragraph ? [{ type: 'text', text: paragraph }] : [] })) } }); }
  /**
   * Move the issue into the wanted status category (new, indeterminate, done). Within the terminal
   * "done" category, `intent` picks which terminal status is meant: resolving a ticket lands on Done
   * or Resolved, cancelling one lands on Cancelled or Won't Do.
   */
  async transitionTo(key: string, category: string, intent?: string) {
    const response = await this.#request('GET', `/rest/api/3/issue/${encodeURIComponent(key)}/transitions`);
    const { transitions = [] } = (response || {}) as { transitions?: JiraTransition[] };
    const inCategory = transitions.filter(item => item.to?.statusCategory?.key === category);
    const available = inCategory.filter(item => item.isAvailable !== false);
    const candidates = available.length ? available : inCategory;
    // Only the terminal category is ambiguous; the others keep the first-match behaviour.
    const ranked = category === 'done'
      ? candidates.map((item, index) => ({ item, index, rank: terminalRank(item, intent === 'cancelled') })).sort((a, b) => b.rank - a.rank || a.index - b.index)
      : candidates.map((item, index) => ({ item, index }));
    const match = ranked[0]?.item;
    if (!match) throw new Error(`Jira has no transition to a ${category === 'done' ? 'Done' : category === 'new' ? 'To Do' : 'In Progress'} status for ${key}`);
    await this.#request('POST', `/rest/api/3/issue/${encodeURIComponent(key)}/transitions`, { transition: { id: match.id } });
    return match.to?.name || null;
  }
  /** Summary, description or priority. */
  async updateFields(key: string, { title, description, priority }: { title?: string; description?: string; priority?: JiraPriority } = {}) {
    const fields: Record<string, unknown> = {};
    if (title !== undefined) fields.summary = String(title);
    if (description !== undefined) fields.description = { type: 'doc', version: 1, content: [{ type: 'paragraph', content: String(description) ? [{ type: 'text', text: String(description) }] : [] }] };
    if (priority !== undefined) fields.priority = { name: ({ critical: 'Highest', high: 'High', medium: 'Medium', low: 'Low' })[priority] || 'Medium' };
    if (Object.keys(fields).length) await this.#request('PUT', `/rest/api/3/issue/${encodeURIComponent(key)}`, { fields });
  }
  /** Assign by account id, or look the person up by email or name. `null` unassigns. */
  async assign(key: string, person: JiraPersonInput) {
    let accountId = person?.accountId || null;
    if (person && !accountId) {
      const query = person.email || person.name || person.id;
      const users = await this.#request('GET', `/rest/api/3/user/search?query=${encodeURIComponent(query!)}`) || [];
      accountId = ((Array.isArray(users) ? users : []) as Array<{ accountId?: string }>)[0]?.accountId || null;
      if (!accountId) throw new Error(`No Jira user matches ${person.name || person.email || person.id}`);
    }
    await this.#request('PUT', `/rest/api/3/issue/${encodeURIComponent(key)}/assignee`, { accountId });
    return accountId;
  }
}
