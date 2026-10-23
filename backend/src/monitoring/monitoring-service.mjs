import { now, httpError } from '../lib/util.mjs';
import { systemScope } from '../projects/project-access.mjs';
import { forEachActiveProject, forProject } from '../projects/project-bound.mjs';
import { RUNNING } from '../platform/pipeline-health.mjs';
import { STATE } from './monitor-store.mjs';
import { TRIGGERS, automationActive, effectiveAutomation, fetchSeconds, retainDays, syncEnabled, triggerFor } from './automation-settings.mjs';
import { dqEvents, dqRecovered, pipelineEvents, pipelineKey, pipelineRecovered, slotCoverage, slotSummary } from './detector.mjs';

// The background fetch and detector (ADR-0002, SPEC-platform-10, SPEC-automations-01). One timer walks the active projects; each
// project fetches its pipelines and data-quality results on its own cadence into the ledger, then the detector turns the ledger
// into alerts. A project with an automation on is watched whether or not anyone has the app open (D2); others only while someone does.

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
// Each fetch re-reads this much before the newest run it has, so runs still going get their final state.
const OVERLAP_MS = 2 * HOUR;
// A pipeline new to the inventory is backfilled to the retention window; this many per fetch, the rest on the next.
const BACKFILL_MAX_PIPELINES_PER_PASS = 10;
const DETECT_EVERY_MS = MINUTE;
const PRUNE_EVERY_MS = 6 * HOUR;
const REFRESH_EVERY_MS = 30_000;
const ms = value => { const at = Date.parse(String(value || '')); return Number.isFinite(at) ? at : null; };
const iso = value => new Date(value).toISOString();
const statusOf = run => String(run?.status || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
const newest = (values, start = 0) => values.reduce((top, value) => (value !== null && value > top ? value : top), start);

/** Whether a trigger does something anywhere in the project: its own setting or any override. */
function triggerActive(config, trigger) {
  if (!config.enabled) return false;
  if (config[trigger]?.action && config[trigger].action !== 'off') return true;
  const group = trigger === 'dqFailed' ? config.overrides?.tables : config.overrides?.pipelines;
  return Object.values(group || {}).some(override => override?.[trigger]?.action && override[trigger].action !== 'off');
}

export class MonitoringService {
  constructor({ store, operationsService, dataQualityService = null, workspaces, projects = null, alerts, isAppActive = () => true, clock = () => Date.now(), log = console, checkSeconds = Number(process.env.OPS_MONITOR_CHECK_SECONDS || 15) }) {
    Object.assign(this, { store, ops: operationsService, dataQualityService, workspaces, projects, alerts, isAppActive, clock, log, checkSeconds });
    this.timer = null; this.ticking = false; this.busy = new Set(); this.lastDetect = new Map(); this.lastRefresh = new Map();
  }

  start() {
    if (this.timer || !(this.checkSeconds > 0)) return;
    this.timer = setInterval(() => this.tick().catch(error => this.log.error('[monitoring] tick failed', error)), this.checkSeconds * 1000);
    this.timer.unref?.();
    setTimeout(() => this.tick().catch(error => this.log.error('[monitoring] first tick failed', error)), 5000).unref?.();
  }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }

  /** The API startup supplies a queue-backed fetcher; direct service callers retain the existing refresh path. */
  setManualFetch(fetch) { this.manualFetch = fetch; }

  async tick() {
    if (this.ticking) return []; this.ticking = true;
    try { return await forEachActiveProject(this.projects, project => this.detectProject(project.id), { log: this.log, name: 'monitoring detector' }); }
    finally { this.ticking = false; }
  }

  /** Run one detector pass without polling providers. Scheduled fetch jobs call this only after success. */
  async detectProject(projectId, { force = false, sources = ['pipelines', 'dataQuality'] } = {}) {
    if (this.busy.has(projectId)) return { skipped: 'busy' };
    this.busy.add(projectId);
    try {
      const operations = await (await this.workspaces.for(projectId)).readOperations().catch(() => ({}));
      const config = effectiveAutomation(operations);
      if (!force && !syncEnabled(operations)) return { skipped: 'auto sync disabled' };
      if (!force && !automationActive(config) && !this.isAppActive()) return { skipped: 'app inactive' };
      await this.#arm(projectId, config);
      const result = {};
      const dq = this.dataQualityService ? await forProject(this.dataQualityService, projectId).catch(() => null) : null;
      if (force || this.clock() - (this.lastDetect.get(projectId) || 0) >= DETECT_EVERY_MS) {
        this.lastDetect.set(projectId, this.clock());
        if (sources.includes('pipelines')) result.detect = await this.#detectPipelines(projectId, config).catch(error => ({ error: error.message }));
        if (sources.includes('dataQuality') && dq?.ledgerProjectId === projectId) result.detectDq = await this.#detectDq(projectId, config, dq).catch(error => ({ error: error.message }));
        result.queue = await this.alerts.drain(projectId, config).catch(error => ({ error: error.message }));
      }
      await this.#prune(projectId, operations).catch(error => this.log.warn?.('[monitoring] prune failed', error?.message));
      return result;
    } finally { this.busy.delete(projectId); }
  }

  /** Retryable job body: provider fetch and ledger writes only. Errors escape for dispatcher retries. */
  async fetchScheduledSource(projectId, source, { force = false } = {}) {
    const operations = await (await this.workspaces.for(projectId)).readOperations().catch(() => ({}));
    if (!force && !syncEnabled(operations)) return { skipped: 'auto sync disabled' };
    if (source === 'pipelines') return this.#fetchPipelines(projectId, operations);
    if (source === 'dataQuality') {
      if (!this.dataQualityService) return { skipped: 'not configured' };
      const dq = await forProject(this.dataQualityService, projectId).catch(() => null);
      if (!dq || dq.ledgerProjectId !== projectId) return { skipped: 'not ledger project' };
      return this.#fetchDq(projectId, dq, operations);
    }
    throw new TypeError(`Unknown monitoring source: ${source}`);
  }

  /** "Refresh now": fetch and detect for one project straight away, at most every 30 seconds (FR-38 of SPEC-platform-10). */
  async refresh(projectId, { sources = ['pipelines', 'dataQuality'] } = {}) {
    // The Data Quality page refreshes on its own (ADR-0007). The shared result tables are fetched under the project that owns
    // them (FR-9), so any project's page can ask, and its throttle is kept apart so it does not block the Pipelines refresh.
    const dqOnly = sources.length === 1 && sources[0] === 'dataQuality';
    let target = projectId;
    if (dqOnly && this.dataQualityService) { const dq = await forProject(this.dataQualityService, projectId).catch(() => null); if (dq) target = dq.ledgerProjectId; }
    const key = dqOnly ? `dataQuality:${target}` : projectId;
    const last = this.lastRefresh.get(key) || 0;
    if (this.clock() - last < REFRESH_EVERY_MS) throw httpError(429, 'Refreshed a moment ago. Try again in half a minute.');
    this.lastRefresh.set(key, this.clock());
    if (this.manualFetch) {
      const result = {};
      const fetched = [];
      if (sources.includes('pipelines')) {
        result.pipelines = await this.manualFetch(target, 'pipelines');
        if (!result.pipelines?.error && !result.pipelines?.skipped) fetched.push('pipelines');
      }
      if (sources.includes('dataQuality')) {
        const dq = this.dataQualityService ? await forProject(this.dataQualityService, target).catch(() => null) : null;
        if (dq?.ledgerProjectId === target) {
          result.dataQuality = await this.manualFetch(target, 'dataQuality');
          if (!result.dataQuality?.error && !result.dataQuality?.skipped) fetched.push('dataQuality');
        }
      }
      return fetched.length ? { ...result, ...await this.detectProject(target, { force: true, sources: fetched }) } : result;
    }
    return this.runProject(target, { force: true, sources });
  }

  async runProject(projectId, { force = false, sources = ['pipelines', 'dataQuality'] } = {}) {
    if (this.busy.has(projectId)) return { skipped: 'busy' };
    this.busy.add(projectId);
    try {
      const operations = await (await this.workspaces.for(projectId)).readOperations().catch(() => ({}));
      const config = effectiveAutomation(operations);
      if (!force && !syncEnabled(operations)) return { skipped: 'auto sync disabled' };
      if (!force && !automationActive(config) && !this.isAppActive()) return { skipped: 'app inactive' };
      await this.#arm(projectId, config);
      const result = {};
      let fetched = false;
      if (sources.includes('pipelines') && (force || await this.#due(projectId, STATE.fetchPipelines, fetchSeconds(operations, 'pipelines')))) {
        result.pipelines = await this.#fetchPipelines(projectId, operations).catch(error => ({ error: error.message })); fetched = true;
      }
      const dq = this.dataQualityService ? await forProject(this.dataQualityService, projectId).catch(() => null) : null;
      // One shared result-table setup is fetched and watched once, under its own project (the ledger key), not once per project.
      const ownsDq = dq && dq.ledgerProjectId === projectId;
      if (ownsDq && sources.includes('dataQuality') && (force || await this.#due(projectId, STATE.fetchDataQuality, fetchSeconds(operations, 'dataQuality')))) {
        result.dataQuality = await this.#fetchDq(projectId, dq, operations).catch(error => ({ error: error.message })); fetched = true;
      }
      if (fetched || force || this.clock() - (this.lastDetect.get(projectId) || 0) >= DETECT_EVERY_MS) {
        this.lastDetect.set(projectId, this.clock());
        result.detect = await this.#detectPipelines(projectId, config).catch(error => ({ error: error.message }));
        if (ownsDq) result.detectDq = await this.#detectDq(projectId, config, dq).catch(error => ({ error: error.message }));
        result.queue = await this.alerts.drain(projectId, config).catch(error => ({ error: error.message }));
      }
      await this.#prune(projectId, operations).catch(error => this.log.warn?.('[monitoring] prune failed', error?.message));
      return result;
    } finally { this.busy.delete(projectId); }
  }

  /** When each trigger was switched on: occurrences from before then (less a short catch-up) are history, not alerts. */
  async #arm(projectId, config) {
    const armed = (await this.store.getState(projectId, STATE.armed)) || {}; let changed = false;
    for (const trigger of TRIGGERS) {
      const active = triggerActive(config, trigger);
      if (active && !armed[trigger]) { armed[trigger] = now(); changed = true; }
      if (!active && armed[trigger]) { delete armed[trigger]; changed = true; }
    }
    if (changed) await this.store.setState(projectId, STATE.armed, armed);
    return armed;
  }
  async #due(projectId, key, seconds) { const state = await this.store.getState(projectId, key); return !state?.lastFetchAt || this.clock() - (ms(state.lastFetchAt) ?? 0) >= seconds * 1000; }

  async #fetchPipelines(projectId, operations) {
    const state = (await this.store.getState(projectId, STATE.fetchPipelines)) || {};
    const clock = this.clock(); const oldest = clock - retainDays(operations) * DAY;
    let from = state.cursorMs ? state.cursorMs - OVERLAP_MS : oldest;
    const open = (await this.store.listRuns(projectId, { fromMs: clock - 7 * DAY, limit: 50_000 })).items.filter(run => RUNNING.has(statusOf(run))).map(run => ms(run.startTime)).filter(at => at !== null);
    if (open.length) from = Math.min(from, open.reduce((low, at) => Math.min(low, at), Infinity) - MINUTE);
    from = Math.max(from, oldest);
    try {
      const snapshot = await this.ops.fetchPlatformSnapshot({ scope: systemScope(projectId), startTimeFrom: from });
      const failedProviders = (snapshot.providerDiagnostics || []).filter(provider => provider.error);
      if (failedProviders.length) throw new Error(failedProviders.map(provider => `${provider.provider}: ${provider.error}`).join('; '));
      const ids = new Set(snapshot.pipelines.map(pipelineKey));
      const runs = snapshot.runs.filter(run => ids.has(`${run.platform || 'unknown'}:${run.pipelineId}`));
      await this.store.upsertRuns(projectId, runs);
      const fetchedAt = now();
      // A pipeline new to the inventory has only the cursor window so far: read its own history back to the retention window.
      // Projects fetched before `known` was recorded, and the first fetch (which already read it all), just record what is there.
      const keys = snapshot.pipelines.map(pipelineKey); const known = new Set(state.known || []);
      const fresh = state.cursorMs && state.known && typeof this.ops.fetchPipelineRunHistory === 'function' ? snapshot.pipelines.filter(pipeline => !known.has(pipelineKey(pipeline))).slice(0, BACKFILL_MAX_PIPELINES_PER_PASS) : [];
      const done = new Set(!state.cursorMs || !state.known ? keys : []);
      await Promise.all(fresh.map(async pipeline => {
        try {
          await this.store.upsertRuns(projectId, await this.ops.fetchPipelineRunHistory({ scope: systemScope(projectId), provider: pipeline.platform, pipelineId: pipeline.pipelineId, startTimeFrom: oldest }));
          done.add(pipelineKey(pipeline));
        } catch (error) { this.log.warn?.(`[monitoring] backfill of ${pipelineKey(pipeline)} failed`, error?.message); }
      }));
      const backfilled = fresh.filter(pipeline => done.has(pipelineKey(pipeline))).length;
      // A platform that failed this pass stays known, so its pipelines are not all backfilled again when it is back.
      const unreached = [...known].filter(key => !(snapshot.providers || []).includes(key.slice(0, key.indexOf(':'))));
      await this.store.setState(projectId, STATE.inventory, { pipelines: snapshot.pipelines, providers: snapshot.providers, sources: snapshot.sources, providerDiagnostics: snapshot.providerDiagnostics, fetchedAt });
      await this.store.setState(projectId, STATE.fetchPipelines, { lastFetchAt: fetchedAt, cursorMs: newest(runs.map(run => ms(run.startTime)), state.cursorMs || 0) || clock, lastError: null, runs: runs.length, jobs: snapshot.pipelines.length, from: iso(from), known: [...keys.filter(key => known.has(key) || done.has(key)), ...unreached], backfilled });
      return { runs: runs.length, jobs: snapshot.pipelines.length, ...(backfilled ? { backfilled } : {}) };
    } catch (error) {
      // With no platform connected the pages must say so (SPEC-pipelines-01 FR-1), not show the last snapshot.
      if (/No pipeline platform is connected/.test(error.message)) await this.store.setState(projectId, STATE.inventory, null);
      await this.store.setState(projectId, STATE.fetchPipelines, { ...state, lastFetchAt: now(), lastError: error.message });
      throw error;
    }
  }

  async #fetchDq(projectId, dq, operations) {
    const state = (await this.store.getState(projectId, STATE.fetchDataQuality)) || {};
    const previous = (await this.store.getState(projectId, STATE.dqSnapshot)) || {};
    // Every fetch reads the whole window so the ledger can mirror each table, deletions included (ADR-0007).
    const clock = this.clock(); const from = clock - retainDays(operations) * DAY;
    try {
      const result = await dq.fetchResults({ from: iso(from) });
      if (!result.configured && result.source?.mode === 'unconfigured') { await this.store.setState(projectId, STATE.dqSnapshot, null); await this.store.setState(projectId, STATE.fetchDataQuality, { lastFetchAt: now(), lastError: null }); return { skipped: 'not configured' }; }
      if (!result.configured) {
        await this.store.setState(projectId, STATE.dqSnapshot, { ...previous, fetchedAt: previous.fetchedAt || null, sources: result.sources || [], lastError: result.source?.reason || 'The result tables could not be read' });
        await this.store.setState(projectId, STATE.fetchDataQuality, { ...state, lastFetchAt: now(), lastError: result.source?.reason || 'The result tables could not be read' });
        throw new Error(result.source?.reason || 'The Data Quality result tables could not be read');
      }
      // Only tables read this time are replaced; one that failed keeps what it had. A table at the row cap is replaced
      // only from its oldest returned row, since older rows were not read.
      for (const source of (result.sources || []).filter(source => source.status === 'ok')) {
        const items = result.items.filter(item => item.key && item.tableId === source.tableId);
        const fromMs = source.truncated && items.length ? Math.min(...items.map(item => ms(item.executedAt) ?? clock)) : from;
        await this.store.replaceDqResults(projectId, source.tableId, items, { fromMs });
      }
      const fetchedAt = now();
      await this.store.setState(projectId, STATE.dqSnapshot, { fetchedAt, sources: result.sources || [], lastError: null });
      await this.store.setState(projectId, STATE.fetchDataQuality, { lastFetchAt: fetchedAt, cursorMs: newest(result.items.map(item => ms(item.executedAt)), state.cursorMs || 0) || clock, lastError: null, results: result.items.length, from: iso(from) });
      return { results: result.items.length };
    } catch (error) {
      await this.store.setState(projectId, STATE.fetchDataQuality, { ...state, lastFetchAt: now(), lastError: error.message });
      throw error;
    }
  }

  async #detectPipelines(projectId, config) {
    const snapshot = await this.store.getState(projectId, STATE.inventory);
    if (!snapshot?.fetchedAt) return { skipped: 'not fetched yet' };
    const armed = (await this.store.getState(projectId, STATE.armed)) || {};
    const clock = this.clock();
    const { items } = await this.store.listRuns(projectId, { fromMs: clock - 8 * DAY, limit: 50_000 });
    const byPipeline = new Map();
    for (const run of items) { const key = `${run.platform || 'unknown'}:${run.pipelineId}`; const list = byPipeline.get(key) || []; list.push(run); byPipeline.set(key, list); }
    const slots = {}; const coverageByKey = new Map(); const events = [];
    for (const pipeline of snapshot.pipelines || []) {
      const key = pipelineKey(pipeline); const runs = byPipeline.get(key) || [];
      const args = { pipelineId: pipeline.pipelineId, platform: pipeline.platform };
      const failed = triggerFor(config, 'pipelineFailed', args); const late = triggerFor(config, 'pipelineLate', args);
      // The page shows missed and late slots whether or not the trigger is on, judged from the first run on record.
      const coverage = slotCoverage({ schedule: pipeline.schedule, runs, now: clock, fromMs: clock - late.lookbackHours * HOUR, graceMs: late.graceMinutes * MINUTE });
      coverageByKey.set(key, coverage);
      const summary = slotSummary(coverage); if (summary.missed || summary.late) slots[key] = summary;
      events.push(...pipelineEvents({ pipeline, runs, failed, late, now: clock, armed }));
    }
    await this.store.setState(projectId, STATE.slots, { pipelines: slots, computedAt: now() });
    const handled = events.length ? await this.alerts.handle(projectId, events, config) : [];
    // Recovery is judged after this pass's occurrences are on the alerts, so a new failure is never closed by an older success.
    let resolved = 0;
    const open = (await this.store.listAlerts(projectId, { status: 'open', limit: 1000 })).items.filter(alert => alert.subject?.type === 'pipeline');
    for (const alert of open) {
      const key = `${alert.subject.platform}:${alert.subject.id}`;
      const recovery = pipelineRecovered(alert, { runs: byPipeline.get(key) || [], coverage: coverageByKey.get(key) || null });
      if (recovery) { await this.alerts.resolve(alert, recovery, { config }); resolved += 1; }
    }
    return { events: events.length, handled: handled.length, resolved };
  }

  async #detectDq(projectId, config, dq) {
    const snapshot = await this.store.getState(projectId, STATE.dqSnapshot);
    if (!snapshot?.fetchedAt) return { skipped: 'not fetched yet' };
    const armed = (await this.store.getState(projectId, STATE.armed)) || {};
    const clock = this.clock();
    const tables = (await dq.listTables()).filter(table => table.enabled !== false).map(table => table.id);
    const { items } = await this.store.listDqResults(projectId, { fromMs: clock - 2 * DAY, tableIds: tables, limit: 50_000 });
    const events = dqEvents({ items, configFor: item => triggerFor(config, 'dqFailed', { tableId: item.tableId }), now: clock, armed });
    const handled = events.length ? await this.alerts.handle(projectId, events, config) : [];
    let resolved = 0;
    const open = (await this.store.listAlerts(projectId, { status: 'open', trigger: 'dqFailed', limit: 1000 })).items;
    for (const alert of open) { const recovery = dqRecovered(alert, items); if (recovery) { await this.alerts.resolve(alert, recovery, { config }); resolved += 1; } }
    return { events: events.length, handled: handled.length, resolved };
  }

  async #prune(projectId, operations) {
    const state = await this.store.getState(projectId, STATE.prune);
    if (state?.at && this.clock() - (ms(state.at) ?? 0) < PRUNE_EVERY_MS) return;
    const before = this.clock() - retainDays(operations) * DAY;
    await this.store.pruneRuns(projectId, before); await this.store.pruneDq(projectId, before);
    await this.store.pruneOccurrences(projectId, this.clock() - 8 * DAY);
    await this.store.setState(projectId, STATE.prune, { at: now() });
  }

  /** What Settings and the pages show about the fetch: when each source last ran, when it runs next, and the last error. */
  async status(projectId) {
    const operations = await (await this.workspaces.for(projectId)).readOperations().catch(() => ({}));
    const config = effectiveAutomation(operations);
    const dq = this.dataQualityService ? await forProject(this.dataQualityService, projectId).catch(() => null) : null;
    const source = async (key, every, ledgerProject = projectId) => { const state = (await this.store.getState(ledgerProject, key)) || {}; const last = ms(state.lastFetchAt); return { everySeconds: every, lastFetchAt: state.lastFetchAt || null, nextFetchAt: last ? iso(last + every * 1000) : null, lastError: state.lastError || null }; };
    const open = await this.store.listAlerts(projectId, { status: 'open', limit: 1 });
    return {
      sources: { pipelines: await source(STATE.fetchPipelines, fetchSeconds(operations, 'pipelines')), dataQuality: { ...(await source(STATE.fetchDataQuality, fetchSeconds(operations, 'dataQuality'), dq?.ledgerProjectId || projectId)), ...(dq && dq.ledgerProjectId !== projectId ? { sharedWith: dq.ledgerProjectId } : {}) } },
      automation: { active: automationActive(config), legacy: config.legacy, watchedWhenIdle: automationActive(config), syncEnabled: syncEnabled(operations) },
      openAlerts: open.total,
    };
  }
}
