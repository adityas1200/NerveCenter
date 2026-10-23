import path from 'node:path';
import { RUNTIME_DIR } from '../config.mjs';
import { ensureDir, exists, readJson, writeJson } from '../lib/fs.mjs';
import { cronFromSchedule, describeCron, nextRun, parseCron, matchesCron } from './cron.mjs';
import { capPermission, ownerHold, permissionCeiling, roleOf } from '../tasks/agent-access.mjs';
import { now, slug, httpError, actorOf } from '../lib/util.mjs';
import { DEFAULT_PROJECT_ID, systemScope } from '../projects/project-access.mjs';
import { PerProject, forEachActiveProject } from '../projects/project-bound.mjs';
import { asRegistry } from '../workspace/workspace.mjs';

// Routines are the plugin's workflow files (workspace/workflows/<name>.yaml) plus an `app` block
// for the parts only NerveCenter cares about. The durable dispatcher owns scheduled starts.

const humanize = value => String(value || '').replace(/[-_]+/g, ' ').replace(/^\w/, c => c.toUpperCase());
const PERMISSIONS = new Set(['read-only', 'policy', 'ask', 'allow']);
const NOTIFY = new Set(['on_complete', 'on_failure', 'never']);

/** Map the plugin's authority block to a task permission. `writes: denied` → read-only, `writes: allowed` → allow, `policy` or nothing → the workspace policy, anything else → ask. */
export function permissionFromAuthority(authority = {}) {
  const writes = String(authority?.writes || authority?.default_write || authority?.default || '').toLowerCase();
  if (['denied', 'deny', 'read-only', 'readonly', 'none'].includes(writes)) return 'read-only';
  if (['allowed', 'allow', 'auto'].includes(writes)) return 'allow';
  if (!writes || ['policy', 'workspace'].includes(writes)) return 'policy';
  return 'ask';
}
function authorityFromPermission(permission) { return permission === 'read-only' ? { writes: 'denied' } : permission === 'allow' ? { writes: 'allowed' } : permission === 'policy' ? { default_write: 'policy' } : { default_write: 'ask' }; }

// One scheduler serves ONE project: its workflows/, its routines-state file and its tasks (SPEC-projects-01 FR-19, FR-39).
// `Routines` below is the registry that owns one per project and ticks them all.
export class RoutineScheduler {
  constructor({ workspace, runtime, stateFile = path.join(RUNTIME_DIR, 'routines-state.json'), tickMs = 30_000, log = console, clock = () => new Date() }) {
    Object.assign(this, { workspace, runtime, stateFile, tickMs, log, clock }); this.timer = null; this.ticking = false;
    this.projectId = workspace.projectId || DEFAULT_PROJECT_ID;
  }
  async #state() { await ensureDir(path.dirname(this.stateFile)); return (await exists(this.stateFile)) ? readJson(this.stateFile) : { routines: {} }; }
  async #patchState(name, patch) { const state = await this.#state(); state.routines[name] = { ...(state.routines[name] || {}), ...patch }; await writeJson(this.stateFile, state); return state.routines[name]; }
  /** Routines without a timezone of their own run in the workspace timezone (operations.yaml team.timezone), else UTC. */
  async #defaultTimezone() {
    const operations = await this.workspace.readOperations().catch(() => ({}));
    const timezone = String(operations?.team?.timezone || '').trim();
    if (!timezone) return 'UTC';
    try { new Intl.DateTimeFormat('en-US', { timeZone: timezone }); return timezone; } catch { return 'UTC'; }
  }

  /* --------------------------------------------------------------- listing */

  async list() {
    const [routines, state, timezone] = await Promise.all([this.workspace.listRoutines(), this.#state(), this.#defaultTimezone()]);
    const tasks = await this.runtime.store.listTasks(systemScope(this.projectId), { type: 'routine', archived: 'all', limit: 500 });
    return routines.map(routine => this.#view(routine, state.routines[routine.name] || {}, tasks.filter(task => task.context?.routine?.name === routine.name), timezone));
  }
  async get(name) {
    const routine = await this.workspace.getRoutine(name); if (!routine) return null;
    const state = (await this.#state()).routines[routine.name] || {};
    const tasks = (await this.runtime.store.listTasks(systemScope(this.projectId), { type: 'routine', archived: 'all', limit: 500 })).filter(task => task.context?.routine?.name === routine.name);
    return this.#view(routine, state, tasks, await this.#defaultTimezone());
  }
  #view(routine, state, tasks, defaultTimezone = 'UTC') {
    const trigger = routine.trigger || { type: 'manual' };
    const enabled = routine.app?.enabled !== false;
    let scheduleText = 'Manual'; let nextRunAt = null; let scheduleError = routine.error || null;
    if (trigger.type === 'schedule' && trigger.expression) {
      const timezone = trigger.timezone || defaultTimezone;
      try { scheduleText = describeCron(trigger.expression, timezone); nextRunAt = enabled ? nextRun(trigger.expression, timezone, this.clock())?.toISOString() || null : null; }
      catch (error) { scheduleError = error.message; scheduleText = String(trigger.expression); }
    }
    const runs = tasks.filter(task => !task.context?.routine?.test).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    const tests = tasks.filter(task => task.context?.routine?.test).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    const running = runs.find(task => ['queued', 'running'].includes(task.status)) || null;
    return {
      name: routine.name, title: routine.app?.title || humanize(routine.name), objective: routine.objective || '', trigger, uses: routine.uses || [], authority: routine.authority || {}, success: routine.success || [], on_failure: routine.on_failure || null,
      permission: permissionFromAuthority(routine.authority), enabled, notify: routine.app?.notify || 'on_complete', connections: routine.app?.connections || [], createdBy: routine.app?.created_by || null, file: routine.file,
      scheduleText, nextRunAt, scheduleError, lastFiredAt: state.lastFiredAt || null, skippedReason: state.skippedReason || null,
      status: running ? 'running' : !enabled ? 'paused' : scheduleError ? 'error' : 'scheduled',
      lastRun: runs[0] ? summarizeTask(runs[0]) : null, lastTest: tests[0] ? summarizeTask(tests[0]) : null,
      recentRuns: runs.slice(0, 10).map(summarizeTask),
    };
  }

  /* --------------------------------------------------------------- editing */

  /** Create or replace a routine from the form. `schedule` is either { cron } or { kind, time, timezone, weekday, dayOfMonth, everyHours }. */
  async save({ name, title, objective, schedule, permission = 'read-only', notify = 'on_complete', connections = [], enabled, user } = {}) {
    const key = slug(name || title || objective?.slice(0, 40)); if (!key) throw new Error('Give the routine a name');
    const text = String(objective || '').trim(); if (!text) throw new Error('Say what should happen');
    if (!PERMISSIONS.has(permission)) throw new Error('permission must be read-only, policy, ask, or allow');
    // A routine runs as the person who set it up, so it can never be given more than their role allows.
    if (user && capPermission(permission, roleOf(user)) !== permission) throw httpError(403, `A ${roleOf(user)} can set a routine to at most ${permissionCeiling(roleOf(user))}`);
    if (!NOTIFY.has(notify)) throw new Error('notify must be on_complete, on_failure, or never');
    let trigger = { type: 'manual' };
    if (schedule && (schedule.cron || schedule.kind)) {
      const expression = schedule.cron ? String(schedule.cron).trim() : cronFromSchedule(schedule);
      parseCron(expression);
      const timezone = String(schedule.timezone || await this.#defaultTimezone()); try { new Intl.DateTimeFormat('en-US', { timeZone: timezone }); } catch { throw new Error(`Unknown timezone: ${timezone}`); }
      trigger = { type: 'schedule', timezone, expression };
    }
    const existing = await this.workspace.getRoutine(key);
    const routine = {
      ...(existing || {}),
      objective: text, trigger, uses: existing?.uses || connections.map(slug).filter(Boolean), authority: authorityFromPermission(permission), success: existing?.success?.length ? existing.success : ['the routine completes and its result is recorded as a task'],
      on_failure: existing?.on_failure || { notify: 'inbox', retry: 0 },
      app: { ...(existing?.app || {}), title: String(title || '').trim() || existing?.app?.title || humanize(key), enabled: enabled === undefined ? existing?.app?.enabled !== false : Boolean(enabled), notify, connections: connections.map(slug).filter(Boolean), result: 'tasks', created_by: existing?.app?.created_by || actorOf(user), updated_at: now() },
    };
    delete routine.file; delete routine.error; delete routine.name;
    await this.workspace.saveRoutine(key, routine);
    return this.get(key);
  }
  async setEnabled(name, enabled) { const routine = await this.workspace.getRoutine(name); if (!routine) throw httpError(404, 'Routine not found'); const { file, error, name: _n, ...rest } = routine; await this.workspace.saveRoutine(name, { ...rest, app: { ...(rest.app || {}), enabled: Boolean(enabled), updated_at: now() } }); return this.get(name); }
  async remove(name) { return this.workspace.deleteRoutine(name); }

  /* --------------------------------------------------------------- running */

  /** Start a Routine Task. `test` runs read-only regardless of the routine's authority and never notifies. */
  async run(name, { user, test = false, trigger = 'manual', scope, scheduledJobKey = null } = {}) {
    const routine = await this.workspace.getRoutine(name); if (!routine) throw httpError(404, 'Routine not found');
    if (trigger === 'schedule' && (routine.app?.enabled === false || routine.error || routine.trigger?.type !== 'schedule')) return null;
    const view = await this.get(name);
    // Work for an owner who is now blocked or a viewer is parked: no task starts, and the routine's state says why.
    const hold = await ownerHold(user || view.createdBy, scope?.projectId || this.workspace?.projectId || null);
    if (hold) {
      if (trigger !== 'schedule') throw httpError(403, hold);
      await this.#patchState(routine.name, { lastFiredMinute: currentMinute(this.clock()), skippedAt: now(), skippedReason: hold });
      this.log.warn?.(`[routines] ${routine.name} not started: ${hold}`);
      return null;
    }
    const prompt = [
      `Run the routine "${view.title}".`, '', routine.objective,
      '', `This routine is defined in workflows/${routine.file}. Follow its objective and success criteria; the workflow skill describes how routines are meant to run.`,
      test ? 'This is a TEST RUN in preview mode: do not change any system, and say clearly what the real run would do.' : '',
      'Finish with a two-line summary: what you found, and what (if anything) needs a person.',
    ].filter(line => line !== '').join('\n');
    // A scheduled run acts for the routine's owner (their role caps what it may do); a person pressing Run acts for themselves.
    // A routine belongs to its project: a run starts there, whoever presses Run.
    const taskInput = { scope: scope || systemScope(this.projectId), type: 'routine', title: `${view.title}${test ? ' · test run' : ''}`, prompt, permission: test ? 'read-only' : view.permission, notify: !test && view.notify !== 'never', user: user || view.createdBy || undefined, context: { routine: { name: routine.name, title: view.title, objective: routine.objective, trigger: routine.trigger, authority: routine.authority, test, fired: trigger, ...(scheduledJobKey ? { scheduledJobKey } : {}) } } };
    const task = scheduledJobKey ? await this.runtime.startScheduledTask({ ...taskInput, scheduledJobKey }) : await this.runtime.startTask(taskInput);
    if (!task) return null;
    await this.#patchState(routine.name, { lastFiredAt: now(), lastTaskId: task.id, ...(trigger === 'schedule' ? { lastFiredMinute: currentMinute(this.clock()) } : {}) });
    return task;
  }

  /** A local sanity check for the routine: schedule parses, timezone exists, connections it names exist in operations.yaml. */
  async check(name) {
    const view = await this.get(name); if (!view) throw httpError(404, 'Routine not found');
    const operations = await this.workspace.readOperations();
    const connections = operations.connections || {};
    const checks = [];
    checks.push(view.scheduleError ? { id: 'schedule', ok: false, title: 'Schedule', detail: view.scheduleError } : { id: 'schedule', ok: true, title: view.trigger.type === 'schedule' ? 'Schedule valid' : 'Manual routine', detail: view.trigger.type === 'schedule' ? `${view.scheduleText}${view.nextRunAt ? ` · next ${view.nextRunAt}` : ''}` : 'Runs only when you press Run now' });
    for (const connection of view.connections) checks.push(connections[connection] ? { id: `connection:${connection}`, ok: true, title: `${humanize(connection)} connected`, detail: `${connections[connection].kind}${connections[connection].transport ? ` · ${connections[connection].transport}` : ''}` } : { id: `connection:${connection}`, ok: false, title: `${humanize(connection)} not connected`, detail: 'Add it in Connectors or remove it from the routine' });
    const team = operations.team || {};
    checks.push(team.name && team.timezone ? { id: 'workspace', ok: true, title: 'Workspace configured', detail: `${team.name} · ${team.timezone}` } : { id: 'workspace', ok: false, title: 'Workspace not configured', detail: 'Set the team name and timezone in Settings' });
    checks.push({ id: 'skills', ok: true, title: 'Required skills available', detail: `operations-fleet plugin · ${(await this.workspace.listPluginSkills()).length} skills` });
    return { name: view.name, ok: checks.every(check => check.ok), checks, checkedAt: now() };
  }

  start() { /* Scheduled routines are owned by the durable jobs dispatcher. */ }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }

  /** Fire every enabled scheduled routine whose cron matches the current minute and has not fired this minute. */
  async scheduledCandidates({ at, lookbackMinutes = 10_080, cursorFor } = {}) {
    const [routines, defaultTimezone, state] = await Promise.all([this.workspace.listRoutines(), this.#defaultTimezone(), this.#state()]);
    const end = currentMinute(new Date(at)); const start = end - Math.min(10_080, Math.max(1, lookbackMinutes)); const result = [];
    for (const routine of routines) {
      if (routine.error || routine.app?.enabled === false || routine.trigger?.type !== 'schedule' || !routine.trigger.expression) continue;
      let parsed; try { parsed = parseCron(routine.trigger.expression); } catch { continue; }
      const savedLastFired = state.routines?.[routine.name]?.lastFiredMinute;
      const lastFired = savedLastFired == null ? NaN : Number(savedLastFired);
      const cursorSlot = cursorFor ? (await cursorFor(this.projectId, routine.name))?.slot : null;
      const queueCursor = cursorSlot == null || !String(cursorSlot).startsWith(`${routine.name}:`) ? NaN : Number(String(cursorSlot).split(':').at(-1));
      const editedAt = Date.parse(routine.app?.updated_at);
      const watermarks = [queueCursor, lastFired, Number.isFinite(editedAt) ? currentMinute(new Date(editedAt)) - 1 : NaN].filter(Number.isFinite);
      const baseline = watermarks.length ? Math.max(...watermarks) : end - 1;
      const first = Math.max(start, baseline + 1);
      const timezone = routine.trigger.timezone || defaultTimezone;
      let latest = null; const older = [];
      let cursor = new Date((first - 1) * 60_000);
      while (currentMinute(cursor) < end) {
        const next = nextRun(routine.trigger.expression, timezone, cursor, end - currentMinute(cursor));
        if (!next) break;
        const minute = currentMinute(next);
        if (minute >= first && matchesCron(parsed, next, timezone)) { if (latest !== null) older.push(latest); latest = minute; }
        cursor = next;
      }
      for (const minute of older) result.push({ projectId: this.projectId, routine: routine.name, slot: `${routine.name}:${minute}`, dueAt: new Date(minute * 60_000).toISOString(), skipped: true });
      if (latest !== null) result.push({ projectId: this.projectId, routine: routine.name, slot: `${routine.name}:${latest}`, dueAt: new Date(latest * 60_000).toISOString() });
    }
    return result;
  }
  async executeScheduled(job) {
    const name = String(job.payload?.routine || '');
    const routine = await this.workspace.getRoutine(name);
    if (!routine || routine.error || routine.app?.enabled === false || routine.trigger?.type !== 'schedule') return { skipped: true, reason: 'Routine was deleted, paused, or is no longer valid' };
    const minute = String(job.slot).split(':').at(-1);
    const slotMinute = Number(minute);
    const editedAt = Date.parse(routine.app?.updated_at);
    if (Number.isFinite(editedAt) && slotMinute < currentMinute(new Date(editedAt))) return { skipped: true, reason: 'Routine changed after this slot was queued' };
    try {
      const parsed = parseCron(routine.trigger.expression);
      if (matchesCron(parsed, new Date(slotMinute * 60_000), routine.trigger.timezone || await this.#defaultTimezone()) !== true) return { skipped: true, reason: 'Routine schedule changed before the queued slot started' };
    } catch { return { skipped: true, reason: 'Routine schedule is no longer valid' }; }
    const task = await this.run(name, { trigger: 'schedule', scheduledJobKey: `${job.projectId}/${name}/${minute}` });
    return task ? { taskId: task.id } : { skipped: true, reason: 'Routine owner is no longer authorized' };
  }
  // Deterministic diagnostic hook; production starts are owned by the durable dispatcher.
  async tick() {
    const at = this.clock(); const minute = currentMinute(at); const state = await this.#state(); const fired = [];
    const timezone = await this.#defaultTimezone();
    for (const routine of await this.workspace.listRoutines()) {
      if (routine.error || routine.app?.enabled === false || routine.trigger?.type !== 'schedule' || !routine.trigger.expression || state.routines[routine.name]?.lastFiredMinute === minute) continue;
      let parsed; try { parsed = parseCron(routine.trigger.expression); } catch { continue; }
      if (!matchesCron(parsed, at, routine.trigger.timezone || timezone)) continue;
      const task = await this.run(routine.name, { trigger: 'schedule' }).catch(error => { this.log.error(`[routines] ${routine.name} failed to start`, error); return null; });
      if (task) fired.push({ routine: routine.name, taskId: task.id });
    }
    return fired;
  }
}

const currentMinute = date => Math.floor(date.getTime() / 60_000);
function summarizeTask(task) { return { taskId: task.id, status: task.status, summary: task.summary || '', createdAt: task.createdAt, finishedAt: task.finishedAt || null, test: Boolean(task.context?.routine?.test), costUsd: task.cost?.totalUsd ?? 0 }; }

/**
 * Every project's routines (FR-39): `for(project)` is that project's scheduler, and one timer ticks each active project in
 * turn, so a failure in one never stops another. Archived projects are skipped (FR-4).
 */
export class Routines extends PerProject {
  constructor({ workspace, runtime, projects = null, stateFileFor = null, tickMs = 30_000, log = console, clock } = {}) {
    super(async id => new RoutineScheduler({ workspace: await this.workspaces.for(id), runtime, tickMs, log, ...(clock ? { clock } : {}), ...(stateFileFor ? { stateFile: stateFileFor(id) } : {}) }));
    Object.assign(this, { workspaces: asRegistry(workspace), projects, tickMs, log }); this.timer = null;
  }
  start() { /* Scheduled routine starts are registered with the durable dispatcher. */ }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }
  async scheduledCandidates(options) {
    const candidates = [];
    await forEachActiveProject(this.projects, async project => candidates.push(...await (await this.for(project.id)).scheduledCandidates(options)), { log: this.log, name: 'routines' });
    return candidates;
  }
  /** Callable diagnostic hook; production scheduled starts use the durable dispatcher. */
  async tick() {
    const fired = [];
    await forEachActiveProject(this.projects, async project => {
      for (const item of await (await this.for(project.id)).tick()) fired.push({ ...item, projectId: project.id });
    }, { log: this.log, name: 'routines' });
    return fired;
  }
  async executeScheduled(job) {
    if (this.projects) {
      const project = (await this.projects.list()).find(item => item.id === job.projectId);
      if (!project || project.kind !== 'normal' || project.archivedAt) return { skipped: true, reason: 'Project is no longer active' };
    }
    return (await this.for(job.projectId)).executeScheduled(job);
  }
}
