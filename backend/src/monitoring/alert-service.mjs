import { ownerHold } from '../tasks/agent-access.mjs';
import { systemScope } from '../projects/project-access.mjs';
import { now, actorOf, httpError } from '../lib/util.mjs';
import { triggerFor } from './automation-settings.mjs';
import { alertHeadline, alertPrompt, ticketDraft, ticketNotes } from './alert-prompts.mjs';

// Alerts: the record that groups occurrences of one problem, decides whether Sonic investigates, opens and updates the ticket,
// and closes when the problem recovers (SPEC-automations-01 FR-12..FR-18, FR-27..FR-31; SPEC-tickets-07).

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const STALE_MS = 6 * HOUR;
const MAX_OCCURRENCES = 200;
const MAX_TICKET_ATTEMPTS = 5;
const IN_FLIGHT = ['queued', 'running'];
const AUTOMATION_ACTOR = { type: 'system', id: 'nervecenter-automation', name: 'NerveCenter automation' };
const ms = value => { const at = Date.parse(String(value || '')); return Number.isFinite(at) ? at : null; };
const startOfUtcDay = clock => { const day = new Date(clock); day.setUTCHours(0, 0, 0, 0); return day.toISOString(); };
const SEVERITY_PRIORITY = { critical: 'critical', high: 'high', medium: 'medium', warning: 'medium', low: 'low', info: 'low' };
const PRIORITY_ORDER = ['critical', 'high', 'medium', 'low'];

/** The priority a ticket gets when the trigger says `auto`: failures high, late runs medium, DQ by its worst severity. */
export function autoPriority(alert) {
  if (alert.trigger === 'pipelineFailed') return 'high';
  if (alert.trigger === 'pipelineLate') return 'medium';
  const levels = (alert.occurrences || []).map(item => SEVERITY_PRIORITY[String(item.severity || '').toLowerCase()] || 'medium');
  return PRIORITY_ORDER.find(level => levels.includes(level)) || 'medium';
}
const occurrenceOf = event => { const { alertKey: _a, subject: _s, trigger: _t, occurrenceKey, ...rest } = event; return { ...rest, key: occurrenceKey }; };
const alertContext = alert => ({ alertId: alert.id, trigger: alert.trigger, subject: alert.subject, openedAt: alert.openedAt, occurrences: (alert.occurrences || []).slice(-20) });
const subjectArgs = alert => ({ pipelineId: alert.subject?.type === 'pipeline' ? alert.subject.id : undefined, tableId: alert.subject?.tableId, platform: alert.subject?.platform });

export class AlertService {
  constructor({ store, operationsService, ticketTasks, runtime, log = console, clock = () => Date.now() }) {
    Object.assign(this, { store, ops: operationsService, ticketTasks, runtime, log, clock });
    this.warned = new Map();
    runtime?.on?.('task', task => { this.#onTask(task).catch(error => this.log.error('[alerts] task update failed', error)); });
  }

  /**
   * New events in, alerts out. Each occurrence is claimed once, ever (FR-12), before anything acts on it; a failure releases
   * the claims so the next pass tries again.
   */
  async handle(projectId, events, config) {
    const groups = new Map();
    for (const event of events) { const list = groups.get(event.alertKey) || []; list.push(event); groups.set(event.alertKey, list); }
    const results = [];
    for (const [key, group] of groups) {
      group.sort((a, b) => (ms(a.at) ?? 0) - (ms(b.at) ?? 0));
      const trigger = triggerFor(config, group[0].trigger, { pipelineId: group[0].subject?.type === 'pipeline' ? group[0].subject.id : undefined, tableId: group[0].subject?.tableId, platform: group[0].subject?.platform });
      if (trigger.action === 'off') continue;
      const fresh = [];
      for (const event of group) if (await this.store.claimOccurrence(projectId, event.occurrenceKey, event.at)) fresh.push(event);
      if (!fresh.length) continue;
      try { results.push(await this.#apply(projectId, key, fresh, trigger, config)); }
      catch (error) {
        for (const event of fresh) await this.store.releaseOccurrence(projectId, event.occurrenceKey).catch(() => {});
        this.log.error(`[alerts] ${projectId} ${key} not handled:`, error?.message || error);
        results.push({ key, error: error?.message || String(error) });
      }
    }
    return results;
  }

  async #apply(projectId, key, fresh, trigger, config) {
    const occurrences = fresh.map(occurrenceOf);
    const open = await this.store.getOpenAlert(projectId, key);
    if (open) return this.#append(open, occurrences);
    const latest = await this.store.getLatestAlert(projectId, key);
    const reopenMs = config.limits.reopenHours * HOUR;
    // Back within the reopen window after recovering: the same alert, investigated again (FR-30).
    if (latest?.status === 'resolved' && reopenMs > 0 && this.clock() - (ms(latest.resolvedAt) ?? 0) <= reopenMs) {
      const reopened = await this.store.updateAlert(projectId, latest.id, { status: 'open', reopenedCount: (latest.reopenedCount || 0) + 1, reopenedAt: now(), resolvedAt: null, recovery: null, resolvedBy: null, occurrences: [...(latest.occurrences || []), ...occurrences].slice(-MAX_OCCURRENCES), occurrenceCount: (latest.occurrenceCount || latest.occurrences?.length || 0) + occurrences.length, action: trigger.action });
      if (reopened) return this.#respond(reopened, trigger, config, { reopen: true, fresh: occurrences });
      const nowOpen = await this.store.getOpenAlert(projectId, key); if (nowOpen) return this.#append(nowOpen, occurrences);
    }
    const { alert, created } = await this.store.createAlert({ projectId, key, trigger: fresh[0].trigger, subject: fresh[0].subject, occurrences, occurrenceCount: occurrences.length, action: trigger.action, previousAlertId: latest?.id || null, reopenedCount: 0, investigation: { status: 'none', starts: [] }, ticketId: null, ticket: null });
    if (!created) return this.#append(alert, occurrences);
    return this.#respond(alert, trigger, config, { reopen: false, fresh: occurrences });
  }

  /** More of the same while the alert is open: recorded on the alert, the task and the ticket, without starting another turn (FR-28). */
  async #append(alert, occurrences) {
    const updated = await this.store.updateAlert(alert.projectId, alert.id, { occurrences: [...(alert.occurrences || []), ...occurrences].slice(-MAX_OCCURRENCES), occurrenceCount: (alert.occurrenceCount || alert.occurrences?.length || 0) + occurrences.length });
    const detail = ticketNotes.occurrence(alert, occurrences);
    if (alert.investigation?.taskId) await this.#noteOnTask(alert.investigation.taskId, 'It happened again', detail);
    if (alert.ticketId) await this.ops.systemNote(alert.ticketId, detail).catch(error => this.log.warn?.('[alerts] ticket note failed', error?.message));
    return { key: alert.key, alertId: alert.id, appended: occurrences.length, alert: updated };
  }

  async #respond(alert, trigger, config, { reopen, fresh }) {
    let current = alert;
    if (trigger.action === 'ticket' || trigger.action === 'task_and_ticket') current = await this.#ensureTicket(current, trigger, { reopen, fresh });
    if (trigger.action === 'task' || trigger.action === 'task_and_ticket') current = await this.#investigate(current, trigger, config, { reopen });
    return { key: alert.key, alertId: alert.id, action: trigger.action, reopen, alert: current };
  }

  /* ----------------------------------------------------------------- tickets */

  async #ticketPlatform(projectId, configured) {
    const scope = systemScope(projectId);
    const ready = async system => { try { return Boolean((system === 'servicenow' ? await this.ops.serviceNowStatus({ scope }) : await this.ops.jiraStatus({ scope }))?.ready); } catch { return false; } };
    if (configured === 'servicenow' || configured === 'jira') return (await ready(configured)) ? { platform: configured } : { platform: 'nervecenter', fallback: `${configured === 'jira' ? 'Jira' : 'ServiceNow'} is not connected, so the ticket was opened in NerveCenter` };
    if (configured === 'nervecenter') return { platform: 'nervecenter' };
    // auto: the project's first ticketing source that is connected, else NerveCenter.
    const sources = await this.ticketTasks?.sources?.(await this.#workspace(projectId)).catch(() => []) || [];
    for (const source of sources) if (['servicenow', 'jira'].includes(source.platform) && await ready(source.platform)) return { platform: source.platform };
    return { platform: 'nervecenter' };
  }
  async #workspace(projectId) { return this.ticketTasks?.workspaces ? this.ticketTasks.workspaces.for(projectId) : this.ticketTasks?.workspace; }

  /** The alert's ticket, opened once (FR-34). A platform that refuses is retried by later passes, up to five times. */
  async #ensureTicket(alert, trigger, { reopen = false, fresh = [] } = {}) {
    if (alert.ticketId) { if (reopen) await this.ops.systemNote(alert.ticketId, ticketNotes.occurrence(alert, fresh)).catch(() => {}); return alert; }
    const scope = systemScope(alert.projectId);
    const priority = trigger.ticket.priority === 'auto' ? autoPriority(alert) : trigger.ticket.priority;
    let ticket = null; let fallback = null;
    try {
      const target = await this.#ticketPlatform(alert.projectId, trigger.ticket.platform); fallback = target.fallback || null;
      if (target.platform === 'servicenow' || target.platform === 'jira') {
        const { title, description } = ticketDraft(alert);
        const run = alert.trigger === 'pipelineFailed' ? alert.occurrences?.[0] : null;
        ticket = await this.ops.createSourceTicket({ scope, system: target.platform, title, description, priority, assignmentGroup: trigger.ticket.assignmentGroup, projectKey: trigger.ticket.projectKey, issueType: trigger.ticket.issueType, correlationKey: alert.id, extra: { alertId: alert.id, ...(alert.subject?.type === 'pipeline' ? { pipelineId: alert.subject.id, ...(run?.runId ? { runId: run.runId } : {}) } : {}) } });
      } else ticket = await this.#nervecenterTicket(alert, priority, scope);
    } catch (error) {
      this.log.warn?.(`[alerts] ${alert.id} ticket not opened:`, error?.message || error);
      return this.store.updateAlert(alert.projectId, alert.id, { ticketError: error?.message || String(error), ticketAttempts: (alert.ticketAttempts || 0) + 1 });
    }
    const updated = await this.store.updateAlert(alert.projectId, alert.id, { ticketId: ticket.ticketId, ticket: { ticketId: ticket.ticketId, number: ticket.externalReference?.number || null, system: ticket.externalReference?.system || 'nervecenter', url: ticket.externalReference?.url || null }, ticketError: null, ticketFallback: fallback });
    // A task that started before the ticket existed is named on the ticket once it does.
    if (updated.investigation?.taskId && ticket.externalReference) await this.ops.systemNote(ticket.ticketId, ticketNotes.started(updated, updated.investigation.taskId)).catch(() => {});
    return updated;
  }

  async #nervecenterTicket(alert, priority, scope) {
    const run = alert.trigger === 'pipelineFailed' ? alert.occurrences?.find(item => item.runId) : null;
    if (run) {
      // One ticket per failed run, as before automations (D4); an existing one is used, never rewritten.
      const existing = await this.ops.runTicket({ pipelineId: alert.subject.id, runId: run.runId, platform: alert.subject.platform, scope });
      if (existing?.projectId === alert.projectId) return existing;
      // Another project tracks this run already; this project gets its own plain ticket below rather than touching that one.
      if (!existing) try { return await this.ops.createTicket({ pipelineId: alert.subject.id, runId: run.runId, platform: alert.subject.platform, visibility: 'project', priority, assignee: null, creator: AUTOMATION_ACTOR, scope, metadata: { alertId: alert.id } }); }
      catch (error) { this.log.warn?.(`[alerts] run ticket for ${alert.id} fell back to a plain ticket:`, error?.message); }
    }
    const { title, description } = ticketDraft(alert);
    const ticket = await this.ops.createTicket({ title, description, source: 'nervecenter-alert', sourceRef: alert.id, category: alert.trigger === 'dqFailed' ? 'data_quality' : 'incident', type: alert.trigger === 'dqFailed' ? 'dq_failure' : alert.trigger === 'pipelineLate' ? 'pipeline_late' : 'pipeline_failure', tags: ['auto-investigation', alert.trigger], priority, visibility: 'project', assignee: null, creator: AUTOMATION_ACTOR, scope, metadata: { alertId: alert.id } });
    // The Pipelines page links a ticket to a pipeline by its id.
    if (alert.subject?.type === 'pipeline' && !ticket.pipelineId) {
      const updated = await this.ops.store.updateTicket(ticket.ticketId, { pipelineId: alert.subject.id }, { touch: false });
      await this.ops.publishTicketChange?.(ticket.ticketId);
      return updated;
    }
    return ticket;
  }

  /* ----------------------------------------------------------- investigation */

  async #suppress(alert, reason) { return this.store.updateAlert(alert.projectId, alert.id, { investigation: { ...(alert.investigation || {}), status: 'suppressed', reason, suppressedAt: now() } }); }

  /** Whether Sonic starts now, waits for a slot, or is held back by the owner, the cooldown or the daily cap (FR-13..FR-16). */
  async #investigate(alert, trigger, config, { reopen }) {
    const actor = config.updatedBy || null;
    const hold = await ownerHold(actor, alert.projectId);
    if (hold) return this.#suppress(alert, `No investigation: ${hold}`);
    if (!reopen && config.limits.cooldownMinutes > 0) {
      const recent = await this.store.listAlerts(alert.projectId, { subjectId: alert.subject?.id, limit: 20 });
      const last = recent.items.filter(item => item.id !== alert.id && item.subject?.type === alert.subject?.type).flatMap(item => item.investigation?.starts || []).sort().pop();
      if (last && this.clock() - (ms(last) ?? 0) < config.limits.cooldownMinutes * MINUTE) return this.#suppress(alert, `Not investigated: ${alert.subject?.name || 'this asset'} was investigated less than ${config.limits.cooldownMinutes} minutes ago`);
    }
    if (await this.#overDailyCap(alert.projectId, config)) return this.#suppress(alert, `Not investigated: the project reached its limit of ${config.limits.maxPerDay} investigations today`);
    if (await this.#inFlight(alert.projectId) >= config.limits.maxConcurrent) return this.store.updateAlert(alert.projectId, alert.id, { investigation: { ...(alert.investigation || {}), status: 'queued', queuedAt: now(), reopen: Boolean(reopen), reason: `Waiting: ${config.limits.maxConcurrent} investigations are already running` } });
    return this.#start(alert, trigger, actor);
  }

  async #overDailyCap(projectId, config) {
    const started = await this.store.countStartedSince(projectId, startOfUtcDay(this.clock()));
    if (started < config.limits.maxPerDay) return false;
    const day = startOfUtcDay(this.clock());
    if (this.warned.get(projectId) !== day) { this.warned.set(projectId, day); this.log.warn?.(`[alerts] project ${projectId} reached its daily limit of ${config.limits.maxPerDay} investigations`); }
    return true;
  }
  async #inFlight(projectId) {
    const scope = systemScope(projectId); let count = 0;
    for (const type of ['alert', 'ticket']) for (const status of IN_FLIGHT) count += (await this.runtime.store.listTasks(scope, { type, status, archived: 'all', limit: 500 })).filter(task => task.context?.alert).length;
    return count;
  }

  async #start(alert, trigger, actor) {
    const permission = trigger.permission === 'policy' ? 'policy' : 'read-only';
    const prompt = alertPrompt(alert, { permission, playbook: trigger.playbook, ticket: alert.ticket });
    const user = actor || undefined; let task = null;
    try {
      // Coming back after recovering continues the same conversation (FR-30).
      const previous = alert.investigation?.taskId ? await this.runtime.getTask(alert.investigation.taskId).catch(() => null) : null;
      if (previous && previous.status !== 'cancelled') task = (await this.runtime.sendMessage(previous.id, user, prompt, { permission })).task;
      else if (alert.ticketId) task = (await this.ticketTasks.ensureTask(alert.ticketId, { user, permission, prompt, title: alertHeadline(alert), context: { alert: alertContext(alert) } })).task;
      else task = await this.runtime.startTask({ type: 'alert', title: alertHeadline(alert), prompt, permission, notify: true, user, scope: systemScope(alert.projectId), context: { alert: alertContext(alert) } });
    } catch (error) {
      return this.store.updateAlert(alert.projectId, alert.id, { investigation: { ...(alert.investigation || {}), status: 'failed', reason: `${alertHeadline(alert)}: the investigation did not start (${error?.message || error})` } });
    }
    const at = now();
    const updated = await this.store.updateAlert(alert.projectId, alert.id, { investigation: { ...(alert.investigation || {}), status: 'started', taskId: task.id, taskStatus: task.status, startedAt: at, starts: [...(alert.investigation?.starts || []), at], permission, reason: null, queuedAt: null } });
    if (alert.ticketId) { const ticket = await this.ops.store.getTicket(alert.ticketId).catch(() => null); if (ticket?.externalReference) await this.ops.systemNote(alert.ticketId, ticketNotes.started(alert, task.id)).catch(() => {}); }
    return updated;
  }

  /** Queued investigations start as slots free, oldest first; ones older than six hours are dropped. Tickets that failed are retried. */
  async drain(projectId, config) {
    const open = (await this.store.listAlerts(projectId, { status: 'open', limit: 500 })).items;
    let started = 0; let dropped = 0; let tickets = 0;
    for (const alert of open.filter(item => ['ticket', 'task_and_ticket'].includes(item.action) && !item.ticketId && item.ticketError && (item.ticketAttempts || 0) < MAX_TICKET_ATTEMPTS)) {
      const trigger = triggerFor(config, alert.trigger, subjectArgs(alert)); if (trigger.action === 'off') continue;
      const updated = await this.#ensureTicket(alert, trigger); if (updated?.ticketId) tickets += 1;
    }
    const queued = open.filter(item => item.investigation?.status === 'queued').sort((a, b) => String(a.investigation.queuedAt).localeCompare(String(b.investigation.queuedAt)));
    for (const alert of queued) {
      if (this.clock() - (ms(alert.investigation.queuedAt) ?? 0) > STALE_MS) { await this.#suppress(alert, 'Not investigated: it waited more than six hours for a free slot'); dropped += 1; continue; }
      const trigger = triggerFor(config, alert.trigger, subjectArgs(alert));
      if (!['task', 'task_and_ticket'].includes(trigger.action)) { await this.#suppress(alert, 'Not investigated: the automation was switched off'); dropped += 1; continue; }
      if (await this.#inFlight(projectId) >= config.limits.maxConcurrent) break;
      if (await this.#overDailyCap(projectId, config)) { await this.#suppress(alert, `Not investigated: the project reached its limit of ${config.limits.maxPerDay} investigations today`); dropped += 1; continue; }
      const fresh = await this.store.getAlert(projectId, alert.id);
      await this.#start(fresh || alert, trigger, config.updatedBy || null); started += 1;
    }
    return { started, dropped, tickets, queued: queued.length - started - dropped };
  }

  /* ---------------------------------------------------------------- closing */

  /** Close an alert: because its subject recovered (the detector) or because a person resolved it. */
  async resolve(alert, recovery, { by = null, config = null } = {}) {
    if (alert.status !== 'open') return alert;
    const investigation = alert.investigation?.status === 'queued' ? { ...alert.investigation, status: 'suppressed', reason: 'Not investigated: it recovered first' } : alert.investigation;
    const updated = await this.store.updateAlert(alert.projectId, alert.id, { status: 'resolved', resolvedAt: now(), recovery: recovery || null, resolvedBy: by ? actorOf(by) : null, investigation });
    if (!updated) return alert;
    const detail = recovery ? ticketNotes.recovered(alert, recovery) : `${by?.name || by?.id || 'Someone'} resolved the alert.`;
    if (alert.investigation?.taskId) await this.#noteOnTask(alert.investigation.taskId, recovery ? 'Recovered' : 'Alert resolved', detail);
    if (alert.ticketId && recovery && config) {
      const trigger = triggerFor(config, alert.trigger, subjectArgs(alert));
      if (trigger.ticket.onRecovery !== 'none') await this.ops.systemNote(alert.ticketId, detail).catch(() => {});
      if (trigger.ticket.onRecovery === 'resolve') await this.ops.systemResolve(alert.ticketId, detail).catch(error => this.log.warn?.('[alerts] ticket not resolved', error?.message));
    }
    return updated;
  }

  async resolveById(projectId, id, user) {
    const alert = await this.store.getAlert(projectId, id); if (!alert) throw httpError(404, 'Alert not found');
    if (alert.status !== 'open') throw httpError(409, 'This alert is already resolved.');
    return this.resolve(alert, null, { by: user });
  }

  async #noteOnTask(taskId, title, detail) {
    const task = await this.runtime.getTask(taskId).catch(() => null); if (!task || task.status === 'cancelled') return;
    await this.runtime.store.appendEvent(taskId, { type: 'status', status: 'alert', title, detail: detail || null }).catch(() => {});
  }

  /** The task's outcome goes back on the alert, and its findings on the ticket in the source (FR-36). */
  async #onTask(task) {
    const ref = task?.context?.alert; if (!ref?.alertId || !task.projectId) return;
    if (!['done', 'failed', 'waiting'].includes(task.status)) return;
    const alert = await this.store.getAlert(task.projectId, ref.alertId); if (!alert || alert.investigation?.taskId !== task.id) return;
    if (alert.investigation.taskStatus === task.status && alert.investigation.finishedAt === (task.finishedAt || null)) return;
    let updated = await this.store.updateAlert(alert.projectId, alert.id, { investigation: { ...alert.investigation, status: task.status === 'failed' ? 'failed' : task.status === 'waiting' ? 'waiting' : 'finished', taskStatus: task.status, finishedAt: task.finishedAt || null, summary: task.summary || null } });
    if (alert.ticketId && task.finishedAt && task.status !== 'waiting' && alert.lastReportedFinishAt !== task.finishedAt) {
      const ticket = await this.ops.store.getTicket(alert.ticketId).catch(() => null);
      if (ticket?.externalReference) await this.ops.systemNote(alert.ticketId, ticketNotes.finished(task)).catch(() => {});
      updated = await this.store.updateAlert(alert.projectId, alert.id, { lastReportedFinishAt: task.finishedAt });
    }
    return updated;
  }
}
