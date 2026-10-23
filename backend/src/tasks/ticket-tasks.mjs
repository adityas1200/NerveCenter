// One ticket, one task. New tickets that enter the configured scope get a read-only triage task;
// a person can start or open the task from the ticket ("Investigate"). Task state is mirrored
// onto the ticket so the Tickets page can show it without joining two stores.

import { ownerHold } from './agent-access.mjs';
import { AGENT_NAME, reportFrom } from './task-runtime.mjs';
import { automaticSyncSettings } from '../sync/sync-settings.mjs';
import { errorText } from '../lib/errors.mjs';
import { now, CLOSED_STATUSES as CLOSED, httpError } from '../lib/util.mjs';
import { DEFAULT_PROJECT_ID, systemScope } from '../projects/project-access.mjs';

const PRIORITY_RANK = { critical: 0, high: 1, medium: 2, low: 3 };
const IN_FLIGHT = ['queued', 'running', 'waiting'];
export const DEFAULT_TICKET_POLL_SECONDS = 15;
const triageKey = (projectId, ticketId) => `auto-triage:${projectId}:${ticketId}`;

const TRIAGE_PROMPT = `Triage this ticket. Read-only: do not change any system.
1. Say in one line what the ticket is about and what type of work it is (access, data quality, pipeline failure, other).
2. Check the live systems you are connected to for the evidence the ticket points at (runs, checks, users) and state what you found.
3. Give the likely cause if there is enough evidence, or the smallest next check if not.
4. Say exactly what you would change to resolve it and which approval that would need.
Lead with the one-line summary. Keep the whole reply short. Finish with the recommendation, not a question: nobody is waiting to answer, a person reads this on the ticket.`;

function ticketContext(ticket) {
  return { ticketId: ticket.ticketId, title: ticket.title || null, description: ticket.description || ticket.failureSummary || null, priority: ticket.priority || null, status: ticket.status || null, category: ticket.category || null, type: ticket.type || null, source: ticket.source || null, assignee: ticket.assignee || null, externalReference: ticket.externalReference || null, pipelineId: ticket.pipelineId || null, runId: ticket.runId || null, platform: ticket.platform || null, createdAt: ticket.createdAt, metadata: ticket.metadata?.serviceNow || ticket.metadata?.jira || null };
}

export class TicketTaskService {
  pollSeconds = DEFAULT_TICKET_POLL_SECONDS;
  // `projects` (the project store) lets the report backfill sweep every project; without one only PILOT is swept.
  constructor({ store, runtime, operationsService, workspace, projects = null, workspaces = null, pollSeconds = Number(process.env.OPS_TICKET_POLL_SECONDS || DEFAULT_TICKET_POLL_SECONDS), isAppActive = () => true, clock = () => Date.now(), log = console }) {
    Object.assign(this, { store, runtime, operationsService, workspace, projects, workspaces, pollSeconds, isAppActive, clock, log });
    this.timer = null; this.polling = false; this.triaging = false; this.lastPollAt = new Map(); this.lastTriageAt = new Map();
    runtime?.on?.('task', task => { this.#mirror(task).catch(error => this.log.error('[ticket-tasks] mirror failed', error)); });
  }

  /**
   * Start (or reuse) the task for a ticket. `permission` is read-only for automatic triage, ask when a person clicks Investigate.
   * An auto-investigation passes its own `title` and `context` (the alert, SPEC-automations-01 FR-18) next to the ticket.
   */
  async ensureTask(ticketId, { user, permission = 'read-only', prompt = TRIAGE_PROMPT, title = null, context = null } = {}) {
    const ticket = await this.store.getTicket(ticketId); if (!ticket) throw httpError(404, 'Ticket not found');
    const hold = await ownerHold(user, ticket.projectId); if (hold) throw httpError(403, `No task started: ${hold}`);
    if (ticket.taskId) {
      const existing = await this.runtime.getTask(ticket.taskId);
      // A person asking something specific about a ticket that already has a task continues that task
      // (with their permission level) instead of getting the triage result back again.
      if (existing && existing.status !== 'cancelled' && user && prompt !== TRIAGE_PROMPT) { const sent = await this.runtime.sendMessage(existing.id, user, prompt, { permission }); return { task: sent.task, created: false, messaged: true, queued: sent.queued }; }
      if (existing && existing.status !== 'cancelled') return { task: existing, created: false };
    }
    const task = await this.runtime.startTask({ type: 'ticket', title: title || ticket.title || ticket.failureSummary || ticket.ticketId, prompt, permission, notify: true, user, scope: systemScope(ticket.projectId), context: { ...(context || {}), ticket: ticketContext(ticket) } });
    await this.store.updateTicket(ticketId, { taskId: task.id, taskStatus: task.status, agentSummary: null });
    await this.store.appendActivity(ticketId, [{ id: `task-${task.id}-start`, type: 'task.started', status: 'running', title: user ? `${user.name || user.id} asked ${AGENT_NAME} to work on it` : `${AGENT_NAME} started looking at it`, detail: `Task ${task.id}`, at: now(), ...(user?.id ? { actor: { id: String(user.id), name: user.name || String(user.id) } } : {}) }]);
    await this.operationsService.publishTicketChange?.(ticketId);
    return { task, created: true };
  }

  /** Keep ticket.taskStatus and the one-line agent summary in step with the task. */
  async #mirror(task) {
    const ticketId = task?.context?.ticket?.ticketId; if (!ticketId || task.type !== 'ticket') return;
    const ticket = await this.store.getTicket(ticketId); if (!ticket || ticket.taskId !== task.id) return;
    const patch = { taskStatus: task.status, taskChanges: task.changes || 0, taskFinishedAt: task.finishedAt || null };
    if (task.summary) patch.agentSummary = task.summary;
    if (task.report) patch.agentReport = task.report;
    const same = key => (ticket[key] || null) === (patch[key] || ticket[key] || null);
    if (ticket.taskStatus === task.status && (ticket.taskChanges || 0) === patch.taskChanges && (ticket.taskFinishedAt || null) === patch.taskFinishedAt && same('agentSummary') && same('agentReport')) return;
    await this.store.updateTicket(ticketId, patch);
    if (['done', 'failed', 'waiting'].includes(task.status) && ticket.taskStatus !== task.status) {
      const title = task.status === 'done' ? `${AGENT_NAME} finished` : task.status === 'failed' ? `${AGENT_NAME} stopped` : `${AGENT_NAME} is waiting on you`;
      await this.store.appendActivity(ticketId, [{ id: `task-${task.id}-${task.status}-${Date.now()}`, type: `task.${task.status}`, status: task.status === 'failed' ? 'failed' : task.status === 'done' ? 'completed' : 'waiting', title, detail: task.summary || task.error || `Task ${task.id}`, at: now() }]);
    }
    await this.operationsService.publishTicketChange?.(ticketId);
  }

  /** A person changed the ticket; tell the task so the agent sees it on its next turn. */
  async noteTicketChange(ticketId, event) {
    const ticket = await this.store.getTicket(ticketId); if (!ticket?.taskId) return;
    const task = await this.runtime.getTask(ticket.taskId); if (!task || task.status === 'cancelled') return;
    await this.runtime.store.appendEvent(ticket.taskId, { type: 'status', status: 'ticket', title: event.title, detail: event.detail || null });
  }

  /* --------------------------------------------------------------- polling */

  async sources(workspace = this.workspace) {
    const operations = await workspace.readOperations().catch(() => ({}));
    // The UI originally wrote ticketing.app.sources while the documented workspace shape uses
    // ticketing.sources. Accept both so background synchronization does not silently depend on
    // which setup path created operations.yaml.
    const configured = operations?.ticketing?.app?.sources ?? operations?.ticketing?.sources;
    if (Array.isArray(configured)) return configured.filter(source => source && source.platform).map(source => ({ ...source, platform: String(source.platform).toLowerCase() }));
    // Fall back to the plugin's single ticketing block when it names a platform we can read.
    const single = operations?.ticketing;
    return single?.platform ? [{ platform: String(single.platform).toLowerCase(), connection: single.connection || null, filters: {}, auto_create_tasks: false, max_concurrent_tasks: 3 }] : [];
  }

  /** Import one project's configured providers without starting or messaging Sonic. */
  async importProject(projectId, workspace = this.workspace) {
    const scope = systemScope(projectId);
    const sources = [];
    const failures = [];
    for (const source of await this.sources(workspace)) {
      if (source.platform !== 'servicenow' && source.platform !== 'jira') {
        sources.push({ platform: source.platform, skipped: 'unsupported platform' });
        continue;
      }
      try {
        let imported = [];
        if (source.platform === 'servicenow') imported = (await this.operationsService.syncServiceNow({ ...(source.filters || {}), startTriage: false, scope })).tickets;
        else imported = (await this.operationsService.syncJira?.({ ...(source.filters || {}), scope }))?.tickets || [];
        sources.push({ platform: source.platform, imported: imported.length });
      } catch (error) {
        const message = errorText(error, 'Ticket import failed');
        sources.push({ platform: source.platform, error: message });
        failures.push(`${source.platform}: ${message}`);
      }
    }
    if (failures.length) throw new Error(`Ticket imports failed for ${failures.join('; ')}`);
    return { sources };
  }

  async #linkAutomaticTask(ticket, task) {
    const current = await this.store.getTicket(ticket.ticketId);
    if (!current) return false;
    if (current.taskId && current.taskId !== task.id) return false;
    if (current.taskId !== task.id) await this.store.updateTicket(ticket.ticketId, { taskId: task.id, taskStatus: task.status, agentSummary: task.summary || null });
    const latest = await this.store.getTicket(ticket.ticketId);
    if (!latest?.activity?.some(event => event.id === `task-${task.id}-start`)) {
      await this.store.appendActivity(ticket.ticketId, [{ id: `task-${task.id}-start`, type: 'task.started', status: 'running', title: `${AGENT_NAME} started looking at it`, detail: `Task ${task.id}`, at: task.createdAt || now() }]);
    }
    await this.operationsService.publishTicketChange?.(ticket.ticketId);
    return current.taskId !== task.id;
  }

  async #forEachTriageCandidatePage(scope, platform, visit) {
    const access = { all: true, userId: 'system', ownerProjects: [], approverIds: [], routing: {} };
    const limit = 200;
    let offset = 0;
    let count = 0;
    while (true) {
      const page = await this.store.listTicketPage(scope, { limit, offset, scope: 'active', source: [platform], sort: 'priority', dir: 'asc', access });
      const candidates = page.items.filter(ticket => String(ticket.source || ticket.externalReference?.system || '').toLowerCase() === platform && !ticket.taskId && !CLOSED.has(String(ticket.status || '').toLowerCase()));
      count += candidates.length;
      for (const ticket of candidates) await visit(ticket);
      offset += page.items.length;
      if (!page.items.length || offset >= page.total) break;
    }
    return count;
  }

  async ensureAutomaticTriageTask(ticket, { permission = 'read-only' } = {}) {
    const projectId = ticket.projectId || DEFAULT_PROJECT_ID;
    const key = triageKey(projectId, ticket.ticketId);
    let task = await this.runtime.store.findTicketTriageTask(projectId, key);
    if (task) {
      const linked = await this.#linkAutomaticTask(ticket, task);
      return { task, created: false, linked };
    }
    const started = await this.runtime.startScheduledTask({
      scheduledJobKey: key,
      scheduledKeyType: 'ticket-triage',
      returnCreation: true,
      type: 'ticket',
      title: ticket.title || ticket.failureSummary || ticket.ticketId,
      prompt: TRIAGE_PROMPT,
      permission,
      notify: true,
      scope: systemScope(projectId),
      context: { ticket: { ...ticketContext(ticket), autoTriageKey: key } },
    });
    task = started.task;
    const linked = await this.#linkAutomaticTask(ticket, task);
    return { task, created: started.created, linked };
  }

  /** Store-only automatic triage pass; provider imports run in scheduled ticket jobs. */
  async triagePass({ force = false } = {}) {
    if (!force && !this.isAppActive()) return { skipped: 'app inactive' };
    if (this.triaging) return { skipped: true };
    this.triaging = true;
    const projectIds = this.projects && this.workspaces ? (await this.projects.list()).filter(project => project.kind === 'normal' && !project.archivedAt).map(project => project.id) : [DEFAULT_PROJECT_ID];
    const result = { projects: {}, created: [], linked: [] };
    try {
      for (const projectId of projectIds) {
        const workspace = this.workspaces ? await this.workspaces.for(projectId) : this.workspace;
        try {
          const sync = await automaticSyncSettings(workspace, this.pollSeconds, 'tickets');
          if (!force && !sync.enabled) { result.projects[projectId] = { skipped: 'auto sync disabled' }; continue; }
          const at = this.clock();
          const last = this.lastTriageAt.get(projectId);
          if (!force && last !== undefined && at - last < sync.intervalSeconds * 1000) { result.projects[projectId] = { skipped: 'not due' }; continue; }
          this.lastTriageAt.set(projectId, at);
          const configured = await this.sources(workspace);
          const projectResult = { sources: [], created: [], linked: [] };
          for (const source of configured) {
            if (!source.auto_create_tasks || !['servicenow', 'jira'].includes(source.platform)) continue;
            let running = 0;
            for (const status of IN_FLIGHT) running += (await this.runtime.store.listTasks(systemScope(projectId), { type: 'ticket', status, archived: 'all' })).length;
            const cap = Math.max(1, Number(source.max_concurrent_tasks) || 3);
            let slots = Math.max(0, cap - running);
            let started = 0;
            const candidates = await this.#forEachTriageCandidatePage(systemScope(projectId), source.platform, async ticket => {
              const existing = await this.runtime.store.findTicketTriageTask(projectId, triageKey(projectId, ticket.ticketId));
              if (existing) {
                if (await this.#linkAutomaticTask(ticket, existing)) projectResult.linked.push({ ticketId: ticket.ticketId, taskId: existing.id });
                return;
              }
              if (slots <= 0) return;
              const outcome = await this.ensureAutomaticTriageTask(ticket, { permission: source.permission || 'read-only' });
              if (outcome.created) { projectResult.created.push({ ticketId: ticket.ticketId, taskId: outcome.task.id }); started += 1; slots -= 1; }
              else if (outcome.linked) projectResult.linked.push({ ticketId: ticket.ticketId, taskId: outcome.task.id });
            });
            projectResult.sources.push({ platform: source.platform, candidates, started, running, cap });
          }
          result.projects[projectId] = projectResult;
          result.created.push(...projectResult.created);
          result.linked.push(...projectResult.linked);
        } catch (error) { result.projects[projectId] = { error: error.message }; }
      }
    } finally { this.triaging = false; }
    return projectIds.length === 1 ? result.projects[projectIds[0]] : result;
  }

  start() { if (this.timer || !(this.pollSeconds > 0) || process.env.OPS_TICKET_POLLING === '0') return; const checkSeconds = Math.min(this.pollSeconds, DEFAULT_TICKET_POLL_SECONDS); this.timer = setInterval(() => this.triagePass().catch(error => this.log.error('[ticket-tasks] triage failed', error)), checkSeconds * 1000); this.timer.unref?.(); setTimeout(() => this.triagePass().catch(error => this.log.error('[ticket-tasks] triage failed', error)), 5000).unref?.(); }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }

  /**
   * Tasks finished before the report existed: read each one's last reply, store the report on the task
   * and mirror it (with the finish time) onto its ticket. Runs once at start; a ticket panel then shows
   * the paragraph instead of the 160-character summary. Idempotent: tickets already carrying a report are skipped.
   */
  async backfillReports() {
    const scopes = (this.projects ? (await this.projects.list()).map(project => project.id) : [DEFAULT_PROJECT_ID]).map(systemScope);
    const tickets = (await Promise.all(scopes.map(scope => this.store.listTickets(scope)))).flat();
    let updated = 0;
    for (const ticket of tickets) {
      if (!ticket.taskId || (ticket.agentReport && ticket.taskFinishedAt)) continue;
      const task = await this.runtime.getTask(ticket.taskId).catch(() => null);
      if (!task || !['done', 'failed', 'waiting'].includes(task.status)) continue;
      let current = task;
      if (!task.report) {
        const events = await this.runtime.store.listEvents(task.id).catch(() => []);
        const reply = [...events].reverse().find(event => (event.type === 'assistant.text' && !event.parentToolUseId && event.text?.trim()) || (event.type === 'result' && event.text?.trim()));
        const report = reportFrom(reply?.text || '');
        if (report) current = await this.runtime.store.updateTask(task.id, { report });
      }
      await this.#mirror(current);
      updated += 1;
    }
    return { updated };
  }

  /** Import in-scope tickets from every source; where auto-create is on, start triage for the new ones under the per-source cap. */
  async poll({ force = false } = {}) {
    if (!force && !this.isAppActive()) return { skipped: 'app inactive' };
    if (this.polling) return { skipped: true };
    this.polling = true;
    // Each project polls its own sources with its own connections (SPEC-projects-01 FR-39); imports are routed by grant filter.
    const projectIds = this.projects && this.workspaces ? (await this.projects.list()).filter(project => project.kind === 'normal' && !project.archivedAt).map(project => project.id) : [DEFAULT_PROJECT_ID];
    const result = { sources: [], created: [], projects: {} };
    try {
      for (const projectId of projectIds) {
        const workspace = this.workspaces ? await this.workspaces.for(projectId) : this.workspace;
        try { const done = await this.#pollProject(projectId, workspace, force); result.projects[projectId] = done; result.sources.push(...(done.sources || [])); result.created.push(...(done.created || [])); }
        catch (error) { result.projects[projectId] = { error: error.message }; }
      }
    } finally { this.polling = false; }
    return projectIds.length === 1 ? result.projects[projectIds[0]] : result;
  }

  async #pollProject(projectId, workspace, force) {
    if (!force) {
      const sync = await automaticSyncSettings(workspace, this.pollSeconds, 'tickets');
      if (!sync.enabled) return { skipped: 'auto sync disabled' };
      const at = this.clock(); const last = this.lastPollAt.get(projectId);
      if (last !== undefined && at - last < sync.intervalSeconds * 1000) return { skipped: 'not due' };
      this.lastPollAt.set(projectId, at);
    }
    const result = { sources: [], created: [] };
    const scope = systemScope(projectId);
    for (const source of await this.sources(workspace)) {
      const cap = Math.max(1, Number(source.max_concurrent_tasks) || 3);
      let imported = [];
      try {
        if (source.platform === 'servicenow') imported = (await this.operationsService.syncServiceNow({ ...(source.filters || {}), startTriage: false, scope })).tickets;
        else if (source.platform === 'jira') imported = (await this.operationsService.syncJira?.({ ...(source.filters || {}), scope }))?.tickets || [];
        else { result.sources.push({ platform: source.platform, skipped: 'unsupported platform' }); continue; }
      } catch (error) { result.sources.push({ platform: source.platform, error: error.message }); continue; }
      if (!source.auto_create_tasks) { result.sources.push({ platform: source.platform, imported: imported.length, started: 0, autoCreate: false }); continue; }
      let running = 0; for (const status of IN_FLIGHT) running += (await this.runtime.store.listTasks(scope, { type: 'ticket', status, archived: 'all' })).length;
      let slots = Math.max(0, cap - running);
      const candidates = imported.filter(ticket => !ticket.taskId && !CLOSED.has(String(ticket.status || '').toLowerCase())).sort((a, b) => (PRIORITY_RANK[String(a.priority || '').toLowerCase()] ?? 9) - (PRIORITY_RANK[String(b.priority || '').toLowerCase()] ?? 9));
      for (const ticket of candidates) { if (slots <= 0) break; const { task, created } = await this.ensureAutomaticTriageTask(ticket, { permission: source.permission || 'read-only' }); if (created) { result.created.push({ ticketId: ticket.ticketId, taskId: task.id }); slots -= 1; } }
      result.sources.push({ platform: source.platform, imported: imported.length, started: result.created.length, running, cap });
    }
    return result;
  }
}
