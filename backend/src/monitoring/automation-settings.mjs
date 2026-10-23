// How often each source is fetched (SPEC-platform-10) and what Sonic does when something breaks (SPEC-automations-01),
// read from a project's operations.yaml `sync` and `automation` sections. Validation lives here so Settings and the API
// reject the same things.

const UNIT_SECONDS = { seconds: 1, minutes: 60, hours: 3600 };
export const FETCH_SOURCES = ['pipelines', 'dataQuality', 'tickets', 'knowledge', 'github'];
// A source with no cadence of its own: pipelines and DQ every 5 and 15 minutes; tickets and knowledge keep the older shared interval.
export const DEFAULT_FETCH_SECONDS = { pipelines: 300, dataQuality: 900 };
export const MIN_FETCH_SECONDS = 30;
export const MAX_FETCH_SECONDS = 86_400;
export const DEFAULT_RETAIN_DAYS = 60;
const MAX_RETAIN_DAYS = 365;

export const TRIGGERS = ['pipelineFailed', 'pipelineLate', 'dqFailed'];
export const ACTIONS = ['off', 'ticket', 'task', 'task_and_ticket'];
export const AUTO_PERMISSIONS = ['read-only', 'policy'];
export const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'];
export const TICKET_PLATFORMS = ['auto', 'nervecenter', 'servicenow', 'jira'];
export const TICKET_PRIORITIES = ['auto', 'critical', 'high', 'medium', 'low'];
export const RECOVERY_ACTIONS = ['comment', 'resolve', 'none'];

export const DEFAULT_LIMITS = Object.freeze({ maxConcurrent: 3, maxPerDay: 50, cooldownMinutes: 30, reopenHours: 24 });
const DEFAULT_TICKET = Object.freeze({ platform: 'auto', priority: 'auto', assignmentGroup: '', projectKey: '', issueType: 'Task', onRecovery: 'comment' });
const DEFAULT_TRIGGERS = Object.freeze({
  pipelineFailed: { action: 'off', permission: 'read-only', playbook: '' },
  pipelineLate: { action: 'off', permission: 'read-only', playbook: '', graceMinutes: 15, lookbackHours: 24, notStarted: true, missedSlots: true, longRunning: false, longRunningFactor: 2 },
  dqFailed: { action: 'off', permission: 'read-only', playbook: '', minSeverity: 'high', includeWarnings: false, tables: [] },
});
const BOUNDS = { graceMinutes: [1, 240], lookbackHours: [1, 168], longRunningFactor: [1.2, 20], maxConcurrent: [1, 20], maxPerDay: [1, 1000], cooldownMinutes: [0, 1440], reopenHours: [0, 168] };
const TRIGGER_KEYS = { pipelineFailed: ['action', 'permission', 'playbook'], pipelineLate: ['action', 'permission', 'playbook', 'graceMinutes', 'lookbackHours', 'notStarted', 'missedSlots', 'longRunning', 'longRunningFactor'], dqFailed: ['action', 'permission', 'playbook', 'minSeverity', 'includeWarnings', 'tables'] };
const isObject = value => value && typeof value === 'object' && !Array.isArray(value);

/** Seconds between two fetches of `source` for this project. */
export function fetchSeconds(operations = {}, source) {
  const sync = operations?.sync || {};
  const own = sync[source];
  if (isObject(own)) { const value = Number(own.every); const unit = UNIT_SECONDS[own.unit]; if (unit && value > 0) return Math.min(MAX_FETCH_SECONDS, Math.max(MIN_FETCH_SECONDS, value * unit)); }
  if (DEFAULT_FETCH_SECONDS[source]) return DEFAULT_FETCH_SECONDS[source];
  return null; // tickets and knowledge fall back to the shared interval (sync-settings.mjs)
}
export const retainDays = (operations = {}) => { const value = Number(operations?.sync?.retainDays); return Number.isInteger(value) && value >= 1 ? Math.min(MAX_RETAIN_DAYS, value) : DEFAULT_RETAIN_DAYS; };
export const syncEnabled = (operations = {}) => operations?.sync?.enabled !== false;

/** Problems with a `sync` section, as sentences naming the field. Empty when it is fine. */
export function validateSync(value) {
  if (value === null || value === undefined) return [];
  if (!isObject(value)) return ['sync must be a mapping'];
  const problems = [];
  for (const source of FETCH_SOURCES) {
    const entry = value[source]; if (entry === undefined || entry === null) continue;
    if (!isObject(entry)) { problems.push(`sync.${source} must have every and unit`); continue; }
    const every = Number(entry.every); const unit = UNIT_SECONDS[entry.unit];
    if (!unit) problems.push(`sync.${source}.unit must be seconds, minutes or hours`);
    else if (!(Number.isFinite(every) && every > 0) || every * unit < MIN_FETCH_SECONDS || every * unit > MAX_FETCH_SECONDS) problems.push(`sync.${source} must be between 30 seconds and 24 hours`);
  }
  if (value.retainDays !== undefined && value.retainDays !== null && !(Number.isInteger(value.retainDays) && value.retainDays >= 1 && value.retainDays <= MAX_RETAIN_DAYS)) problems.push('sync.retainDays must be a whole number of days from 1 to 365');
  return problems;
}

function checkTicket(ticket, at, problems) {
  if (ticket === undefined || ticket === null) return;
  if (!isObject(ticket)) { problems.push(`${at} must be a mapping`); return; }
  for (const key of Object.keys(ticket)) if (!Object.hasOwn(DEFAULT_TICKET, key)) problems.push(`${at}.${key} is not a known setting`);
  if (ticket.platform !== undefined && !TICKET_PLATFORMS.includes(ticket.platform)) problems.push(`${at}.platform must be one of ${TICKET_PLATFORMS.join(', ')}`);
  if (ticket.priority !== undefined && !TICKET_PRIORITIES.includes(ticket.priority)) problems.push(`${at}.priority must be one of ${TICKET_PRIORITIES.join(', ')}`);
  if (ticket.onRecovery !== undefined && !RECOVERY_ACTIONS.includes(ticket.onRecovery)) problems.push(`${at}.onRecovery must be one of ${RECOVERY_ACTIONS.join(', ')}`);
  for (const key of ['assignmentGroup', 'projectKey', 'issueType']) if (ticket[key] !== undefined && (typeof ticket[key] !== 'string' || ticket[key].length > 200)) problems.push(`${at}.${key} must be text of at most 200 characters`);
}
function checkTrigger(trigger, value, at, problems) {
  if (value === undefined || value === null) return;
  if (!isObject(value)) { problems.push(`${at} must be a mapping`); return; }
  for (const key of Object.keys(value)) if (!TRIGGER_KEYS[trigger].includes(key) && key !== 'ticket') problems.push(`${at}.${key} is not a known setting`);
  if (value.action !== undefined && !ACTIONS.includes(value.action)) problems.push(`${at}.action must be one of ${ACTIONS.join(', ')}`);
  if (value.permission !== undefined && !AUTO_PERMISSIONS.includes(value.permission)) problems.push(`${at}.permission must be read-only or policy`);
  if (value.playbook !== undefined && (typeof value.playbook !== 'string' || value.playbook.length > 300 || value.playbook.includes('..'))) problems.push(`${at}.playbook must be a knowledge page path`);
  for (const key of ['graceMinutes', 'lookbackHours', 'longRunningFactor']) {
    if (value[key] === undefined) continue;
    const [min, max] = BOUNDS[key]; const n = Number(value[key]);
    const whole = key !== 'longRunningFactor';
    if (typeof value[key] !== 'number' || !(n >= min && n <= max) || (whole && !Number.isInteger(n))) problems.push(`${at}.${key} must be ${whole ? 'a whole number' : 'a number'} from ${min} to ${max}`);
  }
  for (const key of ['notStarted', 'missedSlots', 'longRunning', 'includeWarnings']) if (value[key] !== undefined && typeof value[key] !== 'boolean') problems.push(`${at}.${key} must be true or false`);
  if (value.minSeverity !== undefined && !SEVERITIES.includes(value.minSeverity)) problems.push(`${at}.minSeverity must be one of ${SEVERITIES.join(', ')}`);
  if (value.tables !== undefined && !(Array.isArray(value.tables) && value.tables.every(item => typeof item === 'string'))) problems.push(`${at}.tables must be a list of result table ids`);
  checkTicket(value.ticket, `${at}.ticket`, problems);
}

/** Problems with an `automation` section. Empty when it is fine. */
export function validateAutomation(value) {
  if (value === null || value === undefined) return [];
  if (!isObject(value)) return ['automation must be a mapping'];
  const problems = [];
  const known = ['enabled', 'limits', 'ticket', 'overrides', 'updatedBy', 'updatedAt', ...TRIGGERS];
  for (const key of Object.keys(value)) if (!known.includes(key)) problems.push(`automation.${key} is not a known setting`);
  if (value.enabled !== undefined && typeof value.enabled !== 'boolean') problems.push('automation.enabled must be true or false');
  if (value.limits !== undefined) {
    if (!isObject(value.limits)) problems.push('automation.limits must be a mapping');
    else for (const [key, raw] of Object.entries(value.limits)) {
      if (!BOUNDS[key] || !Object.hasOwn(DEFAULT_LIMITS, key)) { problems.push(`automation.limits.${key} is not a known setting`); continue; }
      const [min, max] = BOUNDS[key]; if (!(Number.isInteger(raw) && raw >= min && raw <= max)) problems.push(`automation.limits.${key} must be a whole number from ${min} to ${max}`);
    }
  }
  checkTicket(value.ticket, 'automation.ticket', problems);
  for (const trigger of TRIGGERS) checkTrigger(trigger, value[trigger], `automation.${trigger}`, problems);
  if (value.overrides !== undefined) {
    if (!isObject(value.overrides)) problems.push('automation.overrides must be a mapping');
    else {
      for (const key of Object.keys(value.overrides)) if (!['pipelines', 'tables'].includes(key)) problems.push(`automation.overrides.${key} is not a known setting`);
      for (const [group, triggers] of [['pipelines', ['pipelineFailed', 'pipelineLate']], ['tables', ['dqFailed']]]) {
        const entries = value.overrides[group]; if (entries === undefined) continue;
        if (!isObject(entries)) { problems.push(`automation.overrides.${group} must be a mapping`); continue; }
        if (Object.keys(entries).length > 2000) problems.push(`automation.overrides.${group} has too many entries`);
        for (const [id, override] of Object.entries(entries)) {
          if (!isObject(override)) { problems.push(`automation.overrides.${group}.${id} must be a mapping`); continue; }
          for (const key of Object.keys(override)) if (!triggers.includes(key)) problems.push(`automation.overrides.${group}.${id}.${key} is not a known setting`);
          for (const trigger of triggers) checkTrigger(trigger, override[trigger], `automation.overrides.${group}.${id}.${trigger}`, problems);
        }
      }
    }
  }
  return problems;
}

/**
 * The automation a project runs, with every default filled in. A project that never saved the section keeps what the app did
 * before automations existed: a NerveCenter ticket for each failed Databricks run (decision D4), marked `legacy`.
 */
export function effectiveAutomation(operations = {}) {
  const raw = operations?.automation;
  if (!isObject(raw)) {
    return { enabled: true, legacy: true, limits: { ...DEFAULT_LIMITS }, ticket: { ...DEFAULT_TICKET }, pipelineFailed: { ...DEFAULT_TRIGGERS.pipelineFailed, action: 'ticket', platforms: ['databricks'] }, pipelineLate: { ...DEFAULT_TRIGGERS.pipelineLate }, dqFailed: { ...DEFAULT_TRIGGERS.dqFailed }, overrides: { pipelines: {}, tables: {} }, updatedBy: null };
  }
  const config = { enabled: raw.enabled !== false, legacy: false, limits: { ...DEFAULT_LIMITS, ...(isObject(raw.limits) ? raw.limits : {}) }, ticket: { ...DEFAULT_TICKET, ...(isObject(raw.ticket) ? raw.ticket : {}) }, overrides: { pipelines: isObject(raw.overrides?.pipelines) ? raw.overrides.pipelines : {}, tables: isObject(raw.overrides?.tables) ? raw.overrides.tables : {} }, updatedBy: isObject(raw.updatedBy) ? raw.updatedBy : null, updatedAt: raw.updatedAt || null };
  for (const trigger of TRIGGERS) config[trigger] = { ...DEFAULT_TRIGGERS[trigger], ...(isObject(raw[trigger]) ? raw[trigger] : {}) };
  return config;
}

/** One trigger's settings for one pipeline or result table: the project's, with that item's override on top. */
export function triggerFor(config, trigger, { pipelineId, tableId, platform } = {}) {
  const base = config[trigger];
  const override = trigger === 'dqFailed' ? config.overrides?.tables?.[tableId]?.[trigger] : config.overrides?.pipelines?.[pipelineId]?.[trigger];
  const merged = { ...base, ...(isObject(override) ? override : {}) };
  merged.ticket = { ...config.ticket, ...(isObject(base.ticket) ? base.ticket : {}), ...(isObject(override?.ticket) ? override.ticket : {}) };
  if (!config.enabled) merged.action = 'off';
  if (base.platforms && platform && !base.platforms.includes(platform)) merged.action = 'off';
  return merged;
}

/** Whether any trigger (or any override) does something: such a project is watched even when nobody has the app open (D2). */
export function automationActive(config) {
  if (!config.enabled) return false;
  if (TRIGGERS.some(trigger => config[trigger]?.action && config[trigger].action !== 'off')) return true;
  return Object.values(config.overrides || {}).some(group => Object.values(group || {}).some(override => Object.values(override || {}).some(item => item?.action && item.action !== 'off')));
}
