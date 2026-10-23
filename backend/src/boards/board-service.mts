import { randomUUID } from 'node:crypto';
import { databricksFromConnection } from '../connectors/databricks/databricks-service.mjs';
import { SnowflakeService } from '../connectors/snowflake/snowflake-service.mjs';
import { resolveRole, ROLES } from '../app/rbac.mjs';
import { now, httpError } from '../lib/util.mjs';
import { errorText } from '../lib/errors.mjs';
import { assertRowInScope, assertScope, writeProjectId } from '../projects/project-access.mjs';
import { BOARD_LIST_MAX } from '../app/operations-store.mjs';
import { asRegistry } from '../workspace/workspace.mjs';
import { forProject } from '../projects/project-bound.mjs';

/**
 * Boards: dashboards people build with Sonic and publish for everyone else.
 *
 * A board is a saved spec, not code: title, filters (a reporting period and optional pick-lists),
 * and widgets. Each widget names a source and how to draw it:
 *   - `nervecenter` sources are the same numbers the app's pages show (pipeline health, tickets by
 *     priority, failing checks, runs over time), computed here from the operations services;
 *   - `sql` sources are one read-only SELECT on a connected platform, with filter values passed
 *     as bound parameters, never spliced into the statement;
 *   - `text` widgets are a markdown note.
 * Developers and admins build; everyone reads published boards; drafts are the builder's own.
 * Each board is its own record in the operations store (`ops_boards` in Postgres, ADR 0004), so a change
 * or a view touches only that board.
 */

const HOUR = 3_600_000; const DAY = 24 * HOUR;
const RANGE_MS = { today: null, '12h': 12 * HOUR, '24h': DAY, '7d': 7 * DAY, '30d': 30 * DAY };
export const RANGE_OPTIONS = ['today', '12h', '24h', '7d', '30d', 'custom'];
export const WIDGET_TYPES = ['metric', 'table', 'chart', 'text'];
export const WIDGET_SIZES = ['sm', 'md', 'lg'];
/**
 * How a chart widget draws its rows: columns over a category axis, horizontal bars, a line or area over time,
 * a share as a donut or pie, a number across two dimensions (heatmap), stages that lose volume (funnel), or
 * runs on a time axis (gantt).
 */
export const CHART_KINDS = ['column', 'bar', 'line', 'area', 'donut', 'pie', 'heatmap', 'funnel', 'gantt'];
export const HEAT_SCALES = ['high_is_bad', 'high_is_good', 'neutral'];
const MAX_WIDGETS = 16; const MAX_ROWS = 200; const CACHE_MS = 45_000; const FIX_MARK_DAYS = 14;
const CATALOG_CACHE_MS = 60_000; const MAX_CATALOG_TABLES = 50; const MAX_CATALOG_COLUMNS = 100;
const FAILED = new Set(['failed', 'failure', 'error', 'timedout', 'timed_out', 'canceled', 'cancelled']);
const HEALTHY = new Set(['healthy', 'success', 'succeeded', 'completed']);
const PRIORITY_ORDER = ['critical', 'high', 'medium', 'low', 'other'];

type Dict = Record<string, unknown>;
type BoardUser = { id?: string; name?: string; role?: string } | null | undefined;
type BoardScope = { projectId: string; projectIds: string[]; memberProjectIds?: string[]; all: boolean; admin: boolean; archived: boolean; system: boolean; projectRole?: string; access?: string };
type BoardFilter = { key: string; label: string; type: 'range'|'select'|'text'; default: string; options?: string[]; allLabel?: string; placeholder?: string };
type SqlSource = { kind: 'sql'; provider: 'databricks'|'snowflake'; statement: string; params: Record<string,string>; catalog?: string; schema?: string };
type NerveSource = { kind: 'nervecenter'; query: string; params: Record<string,string> };
type TextSource = { kind: 'text'; markdown: string };
type BoardSource = SqlSource | NerveSource | TextSource;
type BoardWidget = { id: string; type: 'metric'|'table'|'chart'|'text'; title: string; size: 'sm'|'md'|'lg'; note: string|null; source: BoardSource; markdown?: string; viz?: Dict };
type BoardRecord = { id: string; title: string; description: string; filters: BoardFilter[]; widgets: BoardWidget[]; projectId?: string; status: 'draft'|'published'; owner: { id: string; name: string }; createdAt: string; updatedAt: string; publishedAt: string|null; views: number; lastViewedAt?: string };
type BoardSpec = Pick<BoardRecord,'title'|'description'|'filters'|'widgets'>;
type BoardMap = Record<string,BoardRecord>;
type FilterValues = Record<string, string|{preset:string;from:string;to:string}> & {range:{preset:string;from:string;to:string}};
type WidgetResult = { columns?: string[]; rows?: unknown[][]; source?: string; markdown?: string; total?: number; links?: Record<string,string[]>; at?: string; error?: string };
type BoardStore = { listBoards(scope: BoardScope, options: {limit: number}): Promise<BoardRecord[]>; getBoard(id: string): Promise<BoardRecord | null>; putBoard(board: BoardRecord): Promise<BoardRecord>; deleteBoard(id: string): Promise<unknown>; noteBoardView(id: string, at: string): Promise<unknown> };
type QueryRowsService = { queryRows(args: Dict): Promise<Array<Record<string,unknown>>> };
type BoardResolvedConnection = { config?: Record<string,string>; credentials?: Record<string,string> };
type BoardConnectionService = { resolve(provider:string, projectId?:string): Promise<BoardResolvedConnection|null> };
type BoardDataPlatform = { getTable(args: Dict): Promise<{id:string;platform:string;kind:string;comment?:string;rowCount?:number|null;lastAlteredAt?:string|null;columns?:Array<{name:string;type:string;comment?:string|null}>}>; listTables(args: Dict): Promise<Array<{id:string;platform:string;kind:string;comment?:string;rowCount?:number|null}>> };
type PipelineRow = {name?:string;pipelineId?:string;health?:string;lastRunAt?:string;nextRunAt?:string;typicalDurationMs?:number;recentRuns:Array<{durationMs?:number}>;platform?:string};
type RunRow = {platform?:string;pipelineId?:string;runId?:string;name?:string;startTime?:string;endTime?:string;status?:string};
type TicketRow = {title?:string;externalReference?:{number?:string};ticketId:string;tags?:string[];status?:string;priority?:string;appStatus?:string;updatedAt?:string;createdAt?:string;closedAt?:string;assignee?:string|{name?:string;id?:string};resolvedWithAgent?:boolean;kind?:string};
type DqBoardItem = {checkId?:string;id?:string;executedAt?:string;name?:string;table?:string;dataset?:string;status?:string;severity?:string;failedRows?:number};
type TaskFix = {proposalId?:string;title?:string;status?:string;appliedAt?:string;widgets?:Array<{boardId?:string;widgetId?:string}>};
type TaskRow = {id?:string;status?:string;finishedAt?:string;updatedAt?:string;changes?:number;fixes?:TaskFix[]};
type BoardOperations = { monitor(args: Dict): Promise<{items?:PipelineRow[];recentRuns?:RunRow[]}>; listTickets(args: Dict): Promise<TicketRow[]> };
type BoardTaskStore = { listTasks(scope:BoardScope,args:Dict): Promise<TaskRow[]> };
type BoardDqService = { getConfig?():Promise<{warehouseId?:string;catalog?:string;schema?:string}|null>; monitor(args:Dict):Promise<{items?:DqBoardItem[]}> };
type BoardWorkspace = { for(scope:BoardScope):Promise<{getSection(name:string):Promise<Dict|null>}> };
type CacheValue<T> = {at:number;value:T};
type ProjectBound<T> = T | { for(scope:BoardScope):Promise<T> };
type BoardServiceOptions = {store:BoardStore;operationsService?:BoardOperations;dataQualityService?:ProjectBound<BoardDqService>;taskStore?:BoardTaskStore;workspace?:BoardWorkspace;connectionService?:BoardConnectionService;dataPlatform?:ProjectBound<BoardDataPlatform>;databricksFactory?:(resolved:BoardResolvedConnection)=>QueryRowsService;snowflakeFactory?:(resolved:BoardResolvedConnection)=>QueryRowsService;clock?:()=>number};

/** What Sonic and the editor can pick from. Each entry says what columns come back and which filters it honours. */
export const NERVECENTER_SOURCES = [
  { id: 'pipelines.health', title: 'Pipelines by health', columns: ['Health', 'Count'], honours: ['range', 'match'], fits: ['metric', 'chart', 'table'], description: 'Succeeded, Failed, Missed, Paused pipelines in the period (running counts as succeeded; missed means a scheduled run did not start).' },
  { id: 'pipelines.list', title: 'Pipelines', columns: ['Pipeline', 'Status', 'Last run', 'Duration (min)', 'Next run'], honours: ['range', 'match'], fits: ['table'], description: 'One row per pipeline with its health and last run.' },
  { id: 'pipelines.runs_over_time', title: 'Pipeline runs over time', columns: ['Period', 'Succeeded', 'Failed'], honours: ['range', 'match'], fits: ['chart', 'table'], description: 'Succeeded and failed runs per day (per hour under two days).' },
  { id: 'pipelines.slow', title: 'Pipelines slower than usual', columns: ['Pipeline', 'Last run (min)', 'Usual (min)', 'Times slower'], honours: ['range', 'match'], fits: ['table', 'metric'], description: 'Pipelines whose last run took over 1.5x their usual duration.' },
  { id: 'tickets.open_by_priority', title: 'Open tickets by priority', columns: ['Priority', 'Count'], honours: ['match'], fits: ['metric', 'chart', 'table'], description: 'Open tickets grouped critical, high, medium, low.' },
  { id: 'tickets.open_by_status', title: 'Open tickets by status', columns: ['Status', 'Count'], honours: ['match'], fits: ['metric', 'chart', 'table'], description: 'Open, In progress, Waiting on you.' },
  { id: 'tickets.list', title: 'Tickets', columns: ['Ticket', 'Title', 'Priority', 'Status', 'Assignee', 'Updated'], honours: ['range', 'match', 'status'], fits: ['table'], description: 'Open tickets (status=all for every ticket), newest first.' },
  { id: 'tickets.over_time', title: 'Tickets raised and resolved over time', columns: ['Period', 'Raised', 'Resolved'], honours: ['range', 'match'], fits: ['chart', 'table'], description: 'Tickets raised and resolved per day in the period.' },
  { id: 'tickets.fixed_with_agent', title: 'Tickets fixed with Sonic', columns: ['Kind', 'Count'], honours: ['range'], fits: ['metric', 'chart', 'table'], description: 'Tickets closed after Sonic made a change, by kind, in the period.' },
  { id: 'dq.checks_by_status', title: 'Data quality checks by status', columns: ['Status', 'Count'], honours: ['range', 'match'], fits: ['metric', 'chart', 'table'], description: 'Passed, warning and failed checks at their latest run in the period.' },
  { id: 'dq.failing_checks', title: 'Failing data quality checks', columns: ['Check', 'Table', 'Severity', 'Status', 'Failed rows', 'Last run'], honours: ['range', 'match'], fits: ['table', 'metric'], description: 'Checks that failed or warned at their latest run.' },
  { id: 'pipelines.runs', title: 'Pipeline runs', columns: ['Pipeline', 'Run', 'Status', 'Started', 'Ended'], honours: ['range', 'match'], fits: ['chart', 'table'], description: 'One row per run in the period, newest first (up to 200). Draw it as a gantt chart to see when runs happened and which overlapped.' },
  { id: 'pipelines.failures_by_day', title: 'Failed runs by pipeline and period', columns: ['Pipeline', '<one column per day, per hour under two days>'], honours: ['range', 'match'], fits: ['chart', 'table'], description: 'Failed runs per pipeline per bucket, only pipelines that failed in the period (top 40). Draw it as a heatmap with scale high_is_bad.' },
  { id: 'tasks.agent_activity', title: 'Sonic activity over time', columns: ['Period', 'Finished', 'Changes'], honours: ['range'], fits: ['chart', 'table', 'metric'], description: 'Tasks Sonic finished per day and the changes it made.' },
];
const SOURCE_IDS = new Set(NERVECENTER_SOURCES.map(item => item.id));

const bad = (message: string, statusCode = 400) => httpError(statusCode, message);
const str = (value: unknown, max: number, fallback = '') => { const text = String(value ?? fallback).trim(); return text.length > max ? text.slice(0, max) : text; };
const slug = (value: unknown) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || `w_${randomUUID().slice(0, 6)}`;
const isBuilder = (user: BoardUser) => { const role = user?.role || resolveRole(user); return role === ROLES.ADMIN || role === ROLES.DEVELOPER; };
const isAdmin = (user: BoardUser) => (user?.role || resolveRole(user)) === ROLES.ADMIN;
const owns = (board: BoardRecord, user: BoardUser) => Boolean(user?.id) && String(board.owner?.id) === String(user?.id);

/* ------------------------------------------------------------------ spec */

function normaliseFilter(raw: Dict, index: number): BoardFilter {
  const type = ['range', 'select', 'text'].includes(raw?.type as string) ? raw.type as string : 'select';
  const key = slug(raw?.key || raw?.label || `filter_${index + 1}`);
  const filter = { key, label: str(raw?.label, 40, key), type: type as BoardFilter['type'] } as BoardFilter;
  if (type === 'range') { filter.key = 'range'; filter.label = str(raw?.label, 40, 'Period'); filter.default = RANGE_OPTIONS.includes(raw?.default as string) ? raw.default as string : '7d'; }
  else if (type === 'select') { filter.options = [...new Set((Array.isArray(raw?.options) ? raw.options as unknown[] : []).map(option => str(option, 60)).filter(Boolean))].slice(0, 30); filter.default = filter.options.includes(raw?.default as string) ? raw.default as string : 'all'; filter.allLabel = str(raw?.allLabel, 30, 'All'); }
  else { filter.default = str(raw?.default, 80); filter.placeholder = str(raw?.placeholder, 60); }
  return filter;
}

function normaliseWidget(raw: Dict, index: number): BoardWidget {
  if (!raw || typeof raw !== 'object') throw bad(`Widget ${index + 1} is not an object`);
  const type = (WIDGET_TYPES.includes(raw.type as string) ? raw.type : 'table') as BoardWidget['type'];
  const widget = { id: slug(raw.id || raw.title || `widget_${index + 1}`), type, title: str(raw.title, 80, `Widget ${index + 1}`), size: (WIDGET_SIZES.includes(raw.size as string) ? raw.size : (type === 'metric' ? 'sm' : type === 'chart' ? 'md' : 'lg')) as BoardWidget['size'], note: str(raw.note, 200) || null } as BoardWidget;
  const source = (raw.source || {}) as Dict;
  if (type === 'text') { widget.source = { kind: 'text', markdown: str(raw.markdown ?? source.markdown, 4000) }; return widget; }
  if (source.kind === 'sql') {
    const statement = str(source.statement, 4000);
    if (!/^\s*select\b/i.test(statement) || statement.includes(';')) throw bad(`Widget "${widget.title}": SQL widgets take one read-only SELECT statement`);
    if (/\b(insert|update|delete|merge|drop|alter|create|truncate|grant|call|exec)\b/i.test(statement)) throw bad(`Widget "${widget.title}": SQL widgets take one read-only SELECT statement`);
    const provider = (['databricks', 'snowflake'].includes(source.provider as string) ? source.provider : 'databricks') as SqlSource['provider'];
    const params: Record<string,string> = {}; for (const [name, value] of Object.entries((source.params || {}) as Dict)) { if (/^[a-z_][a-z0-9_]*$/i.test(name)) params[name] = str(value, 200); }
    widget.source = { kind: 'sql', provider, statement, params, ...(source.catalog ? { catalog: str(source.catalog, 80) } : {}), ...(source.schema ? { schema: str(source.schema, 80) } : {}) };
  } else {
    const query = String(source.query || source.id || '');
    if (!SOURCE_IDS.has(query)) throw bad(`Widget "${widget.title}": unknown NerveCenter source "${query}". Pick one of: ${[...SOURCE_IDS].join(', ')}`);
    const params: Record<string,string> = {}; const sourceParams=(source.params||{}) as Dict; for (const key of ['match', 'status', 'limit']) if (sourceParams[key] !== undefined) params[key] = str(sourceParams[key], 120);
    widget.source = { kind: 'nervecenter', query, params };
  }
  const viz = (raw.viz || {}) as Dict;
  widget.viz = {
    ...(type === 'metric' ? { valueColumn: str(viz.valueColumn, 60) || null, labelColumn: str(viz.labelColumn, 60) || null, suffix: str(viz.suffix, 20) || null, tone: ['neutral', 'good', 'bad', 'warning', 'auto'].includes(viz.tone as string) ? viz.tone : 'auto' } : {}),
    ...(type === 'chart' ? chartViz(viz) : {}),
    ...(type === 'metric' && viz.sparkline === true ? { sparkline: true } : {}),
    ...(type === 'metric' && gaugeOf(viz.gauge) ? { gauge: gaugeOf(viz.gauge) } : {}),
    ...(type === 'table' ? { columns: Array.isArray(viz.columns) ? (viz.columns as unknown[]).map(column => str(column, 60)).filter(Boolean).slice(0, 12) : [], statusColumn: str(viz.statusColumn, 60) || null, limit: Math.max(1, Math.min(MAX_ROWS, Number(viz.limit) || 50)) } : {}),
  };
  return widget;
}

const columnName = (value: unknown) => str(value, 60) || null;
const columnList = (value: unknown, most: number) => (Array.isArray(value) ? value.map(column => str(column, 60)).filter(Boolean).slice(0, most) : []);

// Each kind keeps only the fields it draws with, so a saved spec says what the chart uses.
function chartViz(viz: Dict): Dict {
  const chart = CHART_KINDS.includes(viz.chart as string) ? viz.chart as string : 'column';
  const out: Dict = { chart, xColumn: columnName(viz.xColumn), seriesColumns: columnList(viz.seriesColumns, chart === 'heatmap' ? 62 : 6), layout: viz.layout === 'grouped' ? 'grouped' : 'stacked', showValues: viz.showValues === true };
  if (str(viz.unit, 20)) out.unit = str(viz.unit, 20);
  if (chart === 'heatmap') { out.scale = HEAT_SCALES.includes(viz.scale as string) ? viz.scale : 'neutral'; if (columnName(viz.pivotColumn)) out.pivotColumn = columnName(viz.pivotColumn); }
  if (chart === 'gantt') for (const key of ['startColumn', 'endColumn', 'stateColumn', 'labelColumn']) if (columnName(viz[key])) out[key] = columnName(viz[key]);
  return out;
}

/** A metric's ring: needs a positive max; anything else draws the plain number. */
function gaugeOf(raw: unknown) {
  if (!raw || typeof raw !== 'object') return null;
  const gauge = raw as Dict;
  const max = Number(gauge.max);
  if (!Number.isFinite(max) || max <= 0) return null;
  const target = gauge.target === undefined || gauge.target === null || gauge.target === '' ? null : Number(gauge.target);
  return { max, target: Number.isFinite(target) ? target : null, higherIsBetter: gauge.higherIsBetter !== false };
}

/** A full board spec from whatever a person or Sonic sent. Throws a 400 with a plain sentence on anything unusable. */
export function normaliseBoard(input: Dict = {}, existing: BoardRecord | null = null): BoardSpec {
  const title = str(input.title ?? existing?.title, 80); if (!title) throw bad('A board needs a title');
  const rawFilters: Dict[] = Array.isArray(input.filters) ? input.filters as Dict[] : existing?.filters || [{ type: 'range', key: 'range', label: 'Period', default: '7d' }];
  const filters = rawFilters.slice(0, 6).map(normaliseFilter);
  if (!filters.some(filter => filter.type === 'range')) filters.unshift({ key: 'range', label: 'Period', type: 'range', default: '7d' });
  const keys = new Set(); for (const filter of filters) { if (keys.has(filter.key)) throw bad(`Two filters share the key "${filter.key}"`); keys.add(filter.key); }
  const rawWidgets: Dict[] = Array.isArray(input.widgets) ? input.widgets as Dict[] : existing?.widgets || [];
  if (rawWidgets.length > MAX_WIDGETS) throw bad(`A board holds at most ${MAX_WIDGETS} widgets`);
  const widgets = rawWidgets.map(normaliseWidget);
  const ids = new Set(); for (const widget of widgets) { while (ids.has(widget.id)) widget.id = `${widget.id}_${ids.size + 1}`; ids.add(widget.id); }
  return { title, description: str(input.description ?? existing?.description, 400), filters, widgets };
}

/* ------------------------------------------------------------------ filters */

export function resolveRange(value: unknown, { from, to }: {from?:string;to?:string} = {}, clock = Date.now()) {
  const preset = (RANGE_OPTIONS.includes(value as string) ? value : '7d') as string;
  if (preset === 'custom') { const start = Date.parse(from || ''); const end = Date.parse(to || ''); return { preset, from: Number.isFinite(start) ? new Date(start).toISOString() : new Date(clock - 7 * DAY).toISOString(), to: Number.isFinite(end) ? new Date(end).toISOString() : new Date(clock).toISOString() }; }
  if (preset === 'today') { const start = new Date(clock); start.setHours(0, 0, 0, 0); return { preset, from: start.toISOString(), to: new Date(clock).toISOString() }; }
  return { preset, from: new Date(clock - (RANGE_MS as Record<string,number|null>)[preset]!).toISOString(), to: new Date(clock).toISOString() };
}

/** Effective filter values for a run: defaults, overridden by what the reader picked, unknown keys dropped. */
export function resolveFilters(board: Pick<BoardRecord,'filters'>, picked: Dict = {}, clock = Date.now()): FilterValues {
  const values = {} as FilterValues;
  for (const filter of board.filters) {
    const raw = picked[filter.key];
    if (filter.type === 'range') values.range = resolveRange(raw ?? filter.default, { from: picked.from as string|undefined, to: picked.to as string|undefined }, clock);
    else if (filter.type === 'select') values[filter.key] = raw && raw !== 'all' && filter.options!.includes(String(raw)) ? String(raw) : 'all';
    else values[filter.key] = str(raw ?? filter.default, 120);
  }
  if (!values.range) values.range = resolveRange('7d', {}, clock);
  return values;
}

/** Substitute `{{key}}`, `{{range.from}}`, `{{range.to}}` inside a param value. Unknown keys become empty strings. */
export function fillTemplate(template: unknown, values: FilterValues) {
  return String(template ?? '').replace(/\{\{\s*([a-z0-9_.]+)\s*\}\}/gi, (_match, key) => {
    if (key === 'range.from') return values.range?.from || '';
    if (key === 'range.to') return values.range?.to || '';
    if (key === 'range') return values.range?.preset || '';
    const value = values[key]; return value === undefined || value === 'all' ? '' : String(value);
  });
}

/* ------------------------------------------------------------------ time buckets */

function buckets(range: {from:string;to:string}) {
  const from = Date.parse(range.from); const to = Date.parse(range.to);
  const hourly = to - from <= 2 * DAY;
  const list = [];
  const start = new Date(from); if (hourly) start.setMinutes(0, 0, 0); else start.setHours(0, 0, 0, 0);
  const two = (value: number) => String(value).padStart(2, '0');
  for (let at = start.getTime(); at <= to && list.length < 62; at += hourly ? HOUR : DAY) { const date = new Date(at); list.push({ at, label: hourly ? `${two(date.getHours())}:${two(date.getMinutes())}` : `${two(date.getMonth() + 1)}/${two(date.getDate())}` }); }
  const indexOf = (iso: string|undefined) => { const t = Date.parse(iso || ''); if (!Number.isFinite(t) || t < start.getTime()) return -1; const index = Math.floor((t - start.getTime()) / (hourly ? HOUR : DAY)); return index < list.length ? index : -1; };
  return { list, indexOf };
}
const matches = (text: unknown, needle: unknown) => !needle || needle === 'all' || String(text || '').toLowerCase().includes(String(needle).toLowerCase());
const minutes = (ms: unknown) => (typeof ms === 'number' && Number.isFinite(ms) ? Math.round(ms / 6000) / 10 : null);

/* ------------------------------------------------------------------ service */

export class BoardService {
  store!: BoardStore; operationsService?: BoardOperations; dataQualityService?: ProjectBound<BoardDqService>; taskStore?: BoardTaskStore; workspace?: BoardWorkspace; connectionService?: BoardConnectionService; dataPlatform?: ProjectBound<BoardDataPlatform>; databricksFactory!: (resolved: BoardResolvedConnection) => QueryRowsService; snowflakeFactory!: (resolved: BoardResolvedConnection) => QueryRowsService; clock!: () => number; cache!: Map<string,CacheValue<WidgetResult>>; catalogCache!: Map<string,CacheValue<Dict>>;
  constructor({ store, operationsService, dataQualityService, taskStore, workspace, connectionService, dataPlatform, databricksFactory, snowflakeFactory, clock = () => Date.now() }: Partial<BoardServiceOptions> = {}) {
    Object.assign(this, { store, operationsService, dataQualityService, taskStore, workspace, connectionService, dataPlatform, clock });
    this.databricksFactory = databricksFactory || (resolved => databricksFromConnection(resolved));
    this.snowflakeFactory = snowflakeFactory || (resolved => new SnowflakeService({ ...resolved.config, ...resolved.credentials }));
    this.cache = new Map();
    this.catalogCache = new Map();
  }

  /**
   * What data a SQL widget could read: tables in a schema, or one table's columns. Sonic calls this before
   * writing SQL so it works from the real schema instead of guessing. Answers are kept small and cached for a
   * minute, because building one board asks the same thing several times.
   */
  async describeData({ provider, table, search, catalog, schema }: {provider?:string;table?:string;search?:string;catalog?:string;schema?:string} = {}, user: BoardUser, scope?: BoardScope) {
    if (!isBuilder(user)) throw bad('Viewers can open boards but not build them, so table lookups for boards are not available', 403);
    if (!this.dataPlatform) throw bad('No data platform is connected, so there are no tables to describe');
    const platform = await forProject(this.dataPlatform, scope) as BoardDataPlatform;
    const key = JSON.stringify({ projectId: scope?.projectId || null, provider: provider || null, table: table || null, search: search || null, catalog: catalog || null, schema: schema || null });
    const cached = this.catalogCache.get(key);
    if (cached && this.clock() - cached.at < CATALOG_CACHE_MS) return cached.value;
    let value;
    if (table) {
      const found = await platform.getTable({ provider, objectId: table });
      const columns = found.columns || [];
      value = { table: { id: found.id, platform: found.platform, kind: found.kind, comment: found.comment || null, rowCount: found.rowCount ?? null, lastAlteredAt: found.lastAlteredAt || null, columns: columns.slice(0, MAX_CATALOG_COLUMNS).map(column => ({ name: column.name, type: column.type, comment: column.comment || null })), ...(columns.length > MAX_CATALOG_COLUMNS ? { moreColumns: columns.length - MAX_CATALOG_COLUMNS } : {}) } };
    } else {
      const tables = await platform.listTables({ provider, catalog, schema, search: search || '', limit: MAX_CATALOG_TABLES + 1 });
      value = { tables: tables.slice(0, MAX_CATALOG_TABLES).map(item => ({ id: item.id, platform: item.platform, kind: item.kind, comment: item.comment || null, rowCount: item.rowCount ?? null })), ...(tables.length > MAX_CATALOG_TABLES ? { more: true, hint: 'More tables match; narrow the search.' } : {}) };
    }
    this.catalogCache.set(key, { at: this.clock(), value });
    return value;
  }

  /** Boards this person may see: every published board, plus their own drafts (admins see every draft). */
  async list(user: BoardUser, scope: BoardScope) {
    return (await this.store.listBoards(scope, { limit: BOARD_LIST_MAX })).filter(board => board.status === 'published' || owns(board, user) || isAdmin(user)).sort((a, b) => (a.status === b.status ? String(b.updatedAt).localeCompare(String(a.updatedAt)) : a.status === 'published' ? -1 : 1)).map(board => this.#summary(board, user));
  }
  #summary(board: BoardRecord, user: BoardUser) { return { id: board.id, title: board.title, description: board.description, status: board.status, owner: board.owner, widgets: board.widgets.length, filters: board.filters.length, createdAt: board.createdAt, updatedAt: board.updatedAt, publishedAt: board.publishedAt || null, views: board.views || 0, canEdit: this.canEdit(board, user) }; }

  async get(id: string, user: BoardUser, scope: BoardScope) {
    const board = await this.store.getBoard(id); if (!board) throw bad('Board not found', 404);
    assertRowInScope(scope, board);
    if (board.status !== 'published' && !owns(board, user) && !isAdmin(user)) throw bad('This board is a draft that belongs to someone else', 403);
    return { ...board, canEdit: this.canEdit(board, user) };
  }
  async find(ref: string, user: BoardUser, scope: BoardScope) {
    const key = String(ref || '').trim().toLowerCase(); const all = await this.store.listBoards(scope, { limit: BOARD_LIST_MAX });
    const board = all.find(item => item.id === ref) || all.find(item => item.title.toLowerCase() === key) || all.find(item => item.title.toLowerCase().includes(key));
    if (!board) throw bad(`No board matches "${ref}"`, 404);
    return this.get(board.id, user, scope);
  }
  canEdit(board: BoardRecord, user: BoardUser) { return isBuilder(user) && (owns(board, user) || isAdmin(user)); }

  async create(input: Dict, user: BoardUser, scope: BoardScope) {
    if (!isBuilder(user)) throw bad('Viewers can open boards but not build them', 403);
    const projectId = writeProjectId(scope);
    const spec = normaliseBoard(input);
    const id = `B-${randomUUID().slice(0, 8)}`; const at = now();
    const board = await this.store.putBoard({ id, ...spec, projectId, status: 'draft', owner: { id: String(user?.id), name: user?.name || String(user?.id) }, createdAt: at, updatedAt: at, publishedAt: null, views: 0 });
    return { ...board, canEdit: true };
  }

  async update(id: string, input: Dict, user: BoardUser, scope: BoardScope) {
    const board = await this.store.getBoard(id); if (!board) throw bad('Board not found', 404);
    assertRowInScope(scope, board); writeProjectId(scope);
    if (!this.canEdit(board, user)) throw bad('Only the board owner or an admin can change it', 403);
    const spec = normaliseBoard({ ...input, title: input.title ?? board.title }, board);
    const saved = await this.store.putBoard({ ...board, ...spec, projectId: board.projectId, updatedAt: now() }); this.#forget(id);
    return { ...saved, canEdit: true };
  }

  async setPublished(id: string, published: boolean, user: BoardUser, scope: BoardScope) {
    const board = await this.store.getBoard(id); if (!board) throw bad('Board not found', 404);
    assertRowInScope(scope, board); writeProjectId(scope);
    if (!this.canEdit(board, user)) throw bad('Only the board owner or an admin can publish it', 403);
    if (published && !board.widgets.length) throw bad('Add at least one widget before publishing');
    const saved = await this.store.putBoard({ ...board, status: published ? 'published' : 'draft', publishedAt: published ? now() : null, updatedAt: now() });
    return { ...saved, canEdit: true };
  }

  async remove(id: string, user: BoardUser, scope: BoardScope) {
    const board = await this.store.getBoard(id); if (!board) throw bad('Board not found', 404);
    assertRowInScope(scope, board); writeProjectId(scope);
    if (!this.canEdit(board, user)) throw bad('Only the board owner or an admin can delete it', 403);
    await this.store.deleteBoard(id); this.#forget(id);
    return { id, deleted: true };
  }

  async noteView(id: string) { await this.store.noteBoardView(id, now()); }

  /* --------------------------------------------------------------- running */

  #forget(id: string) { for (const key of this.cache.keys()) if (key.startsWith(`${id}:`)) this.cache.delete(key); }

  /** Run every widget of a board for the reader's filters. Errors are per widget, so one bad query never blanks the page. */
  async run(id: string, picked: Dict, user: BoardUser, scope: BoardScope) {
    const board = await this.get(id, user, scope);
    const values = resolveFilters(board, picked || {}, this.clock());
    const results: Record<string,WidgetResult> = {};
    await Promise.all(board.widgets.map(async widget => {
      // The project and the reader are in the key: the same board can show different data to different people (FR-17).
      const key = `${id}:${scope.projectId}:${user?.id}:${widget.id}:${JSON.stringify(values)}:${board.updatedAt}`;
      const cached = this.cache.get(key); if (cached && this.clock() - cached.at < CACHE_MS) { results[widget.id] = cached.value; return; }
      try { const value = { ...(await this.runWidget(widget, values, user, scope)), at: now() }; this.cache.set(key, { at: this.clock(), value }); results[widget.id] = value; }
      catch (error) { results[widget.id] = { error: plainError(error), at: now() }; }
    }));
    return { boardId: id, filters: values, widgets: results, fixes: await this.#fixesFor(id, scope) };
  }

  /** One widget, unsaved: what Sonic and the editor use to preview before adding. */
  async preview(rawWidget: Dict, picked: Dict, user: BoardUser, boardLike: Pick<BoardRecord,'filters'> | null = null, scope: BoardScope) {
    assertScope(scope);
    // A preview runs any widget, including SQL, with the platform connection's rights: building is for builders.
    if (!isBuilder(user)) throw bad('Viewers can open boards but not build them', 403);
    const widget = normaliseWidget(rawWidget, 0);
    const values = resolveFilters(boardLike || { filters: [{ key: 'range', type: 'range', default: '7d',label:'Period' }] } as Pick<BoardRecord,'filters'>, picked || {}, this.clock());
    return { widget, filters: values, ...(await this.runWidget(widget, values, user, scope)) };
  }

  async runWidget(widget: BoardWidget, values: FilterValues, user: BoardUser, scope: BoardScope): Promise<WidgetResult> {
    assertScope(scope);
    if (widget.source.kind === 'text') return { columns: [], rows: [], markdown: widget.source.markdown };
    if (widget.source.kind === 'sql') return this.#runSql(widget as BoardWidget & {source:SqlSource}, values, scope);
    return this.#runNerveCenter(widget as BoardWidget & {source:NerveSource}, values, user, scope);
  }

  /** A section of the scope's project's operations.yaml (null for the All view, which has no workspace). */
  async #section(scope: BoardScope, name: string): Promise<Dict|null> {
    const registry = asRegistry(this.workspace); if (!registry) return null;
    try { return (await (await registry.for(scope)).getSection(name)) ?? null; } catch { return null; }
  }
  async #runSql(widget: BoardWidget & {source:SqlSource}, values: FilterValues, scope: BoardScope): Promise<WidgetResult> {
    const { provider, statement, params, catalog, schema } = widget.source;
    const filled: Array<[string,string]> = Object.entries(params || {}).map(([name, template]) => [name, fillTemplate(template, values)]);
    const { columns, rows } = await this.sql({ provider, statement, params: filled, catalog, schema, scope });
    return { columns, rows, source: `${provider} SQL` };
  }

  /**
   * One statement through the project's platform connection: a read (bounded to `rowLimit`, default 200) or,
   * with `write`, any statement the caller has already checked (the fix tools, SPEC-tasks-13). Boards only read.
   */
  async sql({ provider, statement, params = [], catalog, schema, scope, write = false, rowLimit = MAX_ROWS }: {provider:'databricks'|'snowflake';statement:string;params?:Array<[string,string]>;catalog?:string;schema?:string;scope:BoardScope;write?:boolean;rowLimit?:number}): Promise<{columns:string[];rows:unknown[][]}> {
    if (!this.connectionService) throw bad('No platform connection is available for SQL');
    const resolved = await this.connectionService.resolve(provider, scope.projectId); if (!resolved) throw bad(`No ${provider} connection is configured`);
    let rows: Array<Record<string,unknown>>;
    if (provider === 'databricks') {
      const connectors = await this.#section(scope, 'connectors');
      const dqService = this.dataQualityService ? await forProject(this.dataQualityService, scope) as BoardDqService : null;
      const dq = await dqService?.getConfig?.().catch(() => null);
      const warehouseId = (connectors as {databricks?:{settings?:{warehouseId?:string}}}|null)?.databricks?.settings?.warehouseId || dq?.warehouseId || resolved.config?.warehouseId;
      if (!warehouseId) throw bad('Set a Databricks SQL warehouse in Connectors before running SQL');
      const parameters = params.map(([name, value]) => ({ name, value, ...(/_time$|_at$|^from$|^to$/i.test(name) && /^\d{4}-\d{2}-\d{2}T/.test(value) ? { type: 'TIMESTAMP' } : {}) }));
      const client = this.databricksFactory(resolved) as QueryRowsService & {executeStatement?(args:Dict):Promise<unknown>};
      if (write) {
        if (!client.executeStatement) throw bad('This Databricks connection cannot run changes');
        return resultRows(await client.executeStatement({ statement, warehouseId, catalog: catalog || dq?.catalog, schema: schema || dq?.schema, parameters }), rowLimit);
      }
      rows = await client.queryRows({ statement, warehouseId, catalog: catalog || dq?.catalog, schema: schema || dq?.schema, parameters, rowLimit });
    } else {
      const bindings = Object.fromEntries(params.map(([, value], index) => [String(index + 1), { type: 'TEXT', value }]));
      const client = this.snowflakeFactory(resolved) as QueryRowsService & {executeStatement?(args:Dict):Promise<unknown>};
      const target = { warehouse: resolved.config?.warehouse, database: catalog || resolved.config?.database, schema: schema || resolved.config?.schema, bindings: params.length ? bindings : undefined };
      if (write) {
        if (!client.executeStatement) throw bad('This Snowflake connection cannot run changes');
        return resultRows(await client.executeStatement({ statement, ...target }), rowLimit);
      }
      // The driver returns an array only after fetching the whole result. Bound it in SQL first.
      rows = await client.queryRows({ statement: `SELECT * FROM (\n${statement}\n) AS board_rows LIMIT ${rowLimit}`, ...target });
    }
    const list = (rows || []).slice(0, rowLimit);
    const columns = list.length ? Object.keys(list[0]) : [];
    return { columns, rows: list.map(row => columns.map(column => row[column] ?? null)) };
  }

  /**
   * SQL widgets on boards this person can open that `reads(statement)` says read a table, at most `limit`
   * (SPEC-tasks-13 FR-7). Each comes with its board, so it can be run at the board's default filters.
   */
  async sqlWidgetsReading(reads: (statement: string, provider: 'databricks'|'snowflake') => boolean, user: BoardUser, scope: BoardScope, limit = 3) {
    const found: Array<{board: BoardRecord; widget: BoardWidget & {source:SqlSource}}> = [];
    for (const summary of (await this.list(user, scope)).slice(0, 40)) {
      const board = await this.store.getBoard(summary.id); if (!board) continue;
      for (const widget of board.widgets) if (widget.source.kind === 'sql' && reads(widget.source.statement, widget.source.provider)) { found.push({ board, widget: widget as BoardWidget & {source:SqlSource} }); if (found.length >= limit) return found; }
    }
    return found;
  }

  /** One widget at its board's default filters, optionally with another statement (a fix preview runs it on the sandbox). */
  async runAtDefaults(board: BoardRecord, widget: BoardWidget, user: BoardUser, scope: BoardScope, statement?: string) {
    const values = resolveFilters(board, {}, this.clock());
    const run = statement && widget.source.kind === 'sql' ? { ...widget, source: { ...widget.source, statement } } as BoardWidget : widget;
    return this.runWidget(run, values, user, scope);
  }

  /** The latest applied fix per widget of this board, from the project's recent tasks (SPEC-tasks-13 FR-18). */
  async #fixesFor(boardId: string, scope: BoardScope) {
    if (!this.taskStore) return {};
    const since = this.clock() - FIX_MARK_DAYS * DAY;
    const out: Record<string,{taskId:string;proposalId:string;title:string;status:string;appliedAt:string}> = {};
    const tasks = await this.taskStore.listTasks(scope, { archived: 'all', limit: 200 }).catch(() => [] as TaskRow[]);
    for (const task of tasks) for (const fix of Array.isArray(task.fixes) ? task.fixes : []) {
      if (!fix?.appliedAt || Date.parse(fix.appliedAt) < since) continue;
      for (const mark of Array.isArray(fix.widgets) ? fix.widgets : []) {
        if (mark?.boardId !== boardId || !mark.widgetId) continue;
        const prior = out[mark.widgetId];
        if (!prior || String(fix.appliedAt) > prior.appliedAt) out[mark.widgetId] = { taskId: String(task.id), proposalId: String(fix.proposalId), title: String(fix.title || ''), status: String(fix.status || 'inconclusive'), appliedAt: String(fix.appliedAt) };
      }
    }
    return out;
  }

  async #runNerveCenter(widget: BoardWidget & {source:NerveSource}, values: FilterValues, user: BoardUser, scope: BoardScope): Promise<WidgetResult> {
    const { query, params = {} } = widget.source;
    const match = params.match || (values.match && values.match !== 'all' ? values.match : '');
    const range = values.range;
    if (query.startsWith('pipelines.')) {
      if (!this.operationsService) throw bad('Pipelines are not available');
      const monitor = await this.operationsService.monitor({ limit: 1000, runLimit: 200, from: range.from, to: range.to, scope });
      const items = (monitor.items || []).filter(item => matches(`${item.name} ${item.pipelineId}`, match));
      if (query === 'pipelines.health') {
        const count = (health: string) => items.filter(item => (health === 'healthy' ? ['healthy', 'running'].includes(item.health || '') : item.health === health)).length;
        return { columns: ['Health', 'Count'], rows: [['Succeeded', count('healthy')], ['Failed', count('failed')], ['Missed', count('overdue')], ['Paused', count('paused')]], source: 'Pipelines', total: items.length };
      }
      if (query === 'pipelines.list') return { columns: ['Pipeline', 'Status', 'Last run', 'Duration (min)', 'Next run'], rows: items.map(item => [item.name, label(item.health), item.lastRunAt || null, minutes(item.recentRuns?.[0]?.durationMs), item.nextRunAt || (item.health === 'paused' ? 'Paused' : null)]), source: 'Pipelines' };
      if (query === 'pipelines.slow') { const slow = items.filter(item => typeof item.typicalDurationMs === 'number' && item.typicalDurationMs > 0 && (item.recentRuns?.[0]?.durationMs || 0) > item.typicalDurationMs * 1.5); return { columns: ['Pipeline', 'Last run (min)', 'Usual (min)', 'Times slower'], rows: slow.map(item => [item.name, minutes(item.recentRuns![0].durationMs), minutes(item.typicalDurationMs), Math.round((item.recentRuns![0].durationMs! / item.typicalDurationMs!) * 10) / 10]), source: 'Pipelines', total: slow.length }; }
      if (query === 'pipelines.runs' || query === 'pipelines.failures_by_day') {
        const named = new Map(items.map(item => [`${item.platform || 'unknown'}:${item.pipelineId}`, item.name]));
        const runs = (monitor.recentRuns || []).filter(run => run.startTime && named.has(`${run.platform || 'unknown'}:${run.pipelineId}`));
        const nameOfRun = (run: RunRow) => named.get(`${run.platform || 'unknown'}:${run.pipelineId}`) || run.name || String(run.pipelineId);
        if (query === 'pipelines.runs') {
          const list = runs.sort((a, b) => String(b.startTime).localeCompare(String(a.startTime))).slice(0, MAX_ROWS);
          return { columns: ['Pipeline', 'Run', 'Status', 'Started', 'Ended'], rows: list.map(run => [nameOfRun(run), String(run.runId ?? ''), runState(run.status), run.startTime, run.endTime || null]), source: 'Pipelines', total: list.length };
        }
        const { list, indexOf } = buckets(range); const counts = new Map<string,number[]>();
        for (const run of runs) { if (!FAILED.has(String(run.status || '').toLowerCase())) continue; const index = indexOf(run.startTime as string); if (index < 0) continue; const name = nameOfRun(run); if (!counts.has(name)) counts.set(name, list.map(() => 0)); counts.get(name)![index] += 1; }
        const total = (values: number[]) => values.reduce((sum, value) => sum + value, 0);
        const rows = [...counts.entries()].sort((a, b) => total(b[1]) - total(a[1]) || a[0].localeCompare(b[0])).slice(0, 40).map(([name, values]) => [name, ...values]);
        return { columns: ['Pipeline', ...list.map(bucket => bucket.label)], rows, source: 'Pipelines', total: rows.length };
      }
      if (query === 'pipelines.runs_over_time') {
        const { list, indexOf } = buckets(range); const ok = list.map(() => 0); const failed = list.map(() => 0);
        const ids = new Set(items.map(item => `${item.platform || 'unknown'}:${item.pipelineId}`));
        for (const run of monitor.recentRuns || []) { if (match && !ids.has(`${run.platform || 'unknown'}:${run.pipelineId}`)) continue; const index = indexOf(run.startTime as string); if (index < 0) continue; const status = String(run.status || '').toLowerCase(); if (HEALTHY.has(status)) ok[index] += 1; else if (FAILED.has(status)) failed[index] += 1; }
        return { columns: ['Period', 'Succeeded', 'Failed'], rows: list.map((bucket, index) => [bucket.label, ok[index], failed[index]]), source: 'Pipelines' };
      }
    }
    if (query.startsWith('tickets.')) {
      if (!this.operationsService) throw bad('Tickets are not available');
      const status = query === 'tickets.list' ? (params.status === 'all' || values.status === 'all' ? 'all' : 'active') : 'all';
      const all = (await this.operationsService.listTickets({ status: 'all', user, scope })).filter(ticket => matches(`${ticket.title} ${ticket.externalReference?.number || ''} ${ticket.ticketId} ${(ticket.tags || []).join(' ')}`, match));
      const open = all.filter(ticket => !['closed', 'cancelled', 'resolved'].includes(String(ticket.status || '').toLowerCase()));
      const inRange = (at: unknown) => { const t = Date.parse(String(at || '')); return Number.isFinite(t) && t >= Date.parse(range.from) && t <= Date.parse(range.to); };
      if (query === 'tickets.open_by_priority') return { columns: ['Priority', 'Count'], rows: PRIORITY_ORDER.map(priority => [cap(priority), open.filter(ticket => (PRIORITY_ORDER.includes(String(ticket.priority || '').toLowerCase()) ? String(ticket.priority).toLowerCase() : 'other') === priority).length]).filter(([priority, count]) => priority !== 'Other' || count), source: 'Tickets', total: open.length };
      if (query === 'tickets.open_by_status') { const labels = { open: 'Open', in_progress: 'In progress', waiting_on_you: 'Waiting on you' }; return { columns: ['Status', 'Count'], rows: Object.entries(labels).map(([key, text]) => [text, open.filter(ticket => ticket.appStatus === key).length]), source: 'Tickets', total: open.length }; }
      if (query === 'tickets.list') { const rows = (status === 'all' ? all : open).filter(ticket => status === 'all' ? inRange(ticket.updatedAt || ticket.createdAt) : true).sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))).slice(0, Number(params.limit) || 50); return { columns: ['Ticket', 'Title', 'Priority', 'Status', 'Assignee', 'Updated'], rows: rows.map(ticket => [ticket.externalReference?.number || ticket.ticketId, ticket.title, cap(ticket.priority || ''), ticket.appStatus === 'closed' ? 'Closed' : ({ open: 'Open', in_progress: 'In progress', waiting_on_you: 'Waiting on you' } as Record<string,string>)[ticket.appStatus || ''] || cap(ticket.status || ''), nameOf(ticket.assignee) || 'Unassigned', ticket.updatedAt || ticket.createdAt || null]), source: 'Tickets', links: { Ticket: rows.map(ticket => `/tickets/${encodeURIComponent(ticket.ticketId)}`) } }; }
      if (query === 'tickets.over_time') { const { list, indexOf } = buckets(range); const raised = list.map(() => 0); const resolved = list.map(() => 0); for (const ticket of all) { const created = indexOf(ticket.createdAt); if (created >= 0) raised[created] += 1; if (['closed', 'cancelled', 'resolved'].includes(String(ticket.status || '').toLowerCase())) { const closed = indexOf(ticket.closedAt || ticket.updatedAt); if (closed >= 0) resolved[closed] += 1; } } return { columns: ['Period', 'Raised', 'Resolved'], rows: list.map((bucket, index) => [bucket.label, raised[index], resolved[index]]), source: 'Tickets' }; }
      if (query === 'tickets.fixed_with_agent') { const fixed = all.filter(ticket => ticket.resolvedWithAgent && inRange(ticket.closedAt || ticket.updatedAt)); const kinds: Record<string,number> = {}; for (const ticket of fixed) kinds[ticket.kind || 'other'] = (kinds[ticket.kind || 'other'] || 0) + 1; return { columns: ['Kind', 'Count'], rows: Object.entries(kinds).map(([kind, count]) => [cap(kind.replace(/_/g, ' ')), count]), source: 'Tickets', total: fixed.length }; }
    }
    if (query.startsWith('dq.')) {
      if (!this.dataQualityService) throw bad('Data quality is not set up');
      const dqService = await forProject(this.dataQualityService, scope) as BoardDqService;
      const response = await dqService.monitor({ from: range.from, to: range.to, limit: 100, scope });
      const latest = new Map<string,DqBoardItem>(); for (const item of response.items || []) { const key = item.checkId || item.id || ''; const prior = latest.get(key); if (!prior || String(item.executedAt) > String(prior.executedAt)) latest.set(key, item); }
      const items = [...latest.values()].filter(item => matches(`${item.name} ${item.table} ${item.dataset} ${item.checkId}`, match));
      if (query === 'dq.checks_by_status') { const count = (status: string) => items.filter(item => item.status === status).length; return { columns: ['Status', 'Count'], rows: [['Passed', count('passed')], ['Warning', count('warning')], ['Failed', count('failed')]], source: 'Data quality', total: items.length }; }
      if (query === 'dq.failing_checks') { const failing = items.filter(item => item.status === 'failed' || item.status === 'warning').sort((a, b) => (a.status === b.status ? 0 : a.status === 'failed' ? -1 : 1)); return { columns: ['Check', 'Table', 'Severity', 'Status', 'Failed rows', 'Last run'], rows: failing.map(item => [item.name, item.dataset || item.table, cap(item.severity || ''), cap(item.status), item.failedRows ?? null, item.executedAt || null]), source: 'Data quality', total: failing.length }; }
    }
    if (query === 'tasks.agent_activity') {
      if (!this.taskStore) throw bad('Tasks are not available');
      const tasks = await this.taskStore.listTasks(scope, { archived: 'all', limit: 1000 }); const { list, indexOf } = buckets(range); const finished = list.map(() => 0); const changes = list.map(() => 0);
      for (const task of tasks) { if (task.status !== 'done') continue; const index = indexOf(task.finishedAt || task.updatedAt); if (index < 0) continue; finished[index] += 1; changes[index] += Number(task.changes || 0); }
      return { columns: ['Period', 'Finished', 'Changes'], rows: list.map((bucket, index) => [bucket.label, finished[index], changes[index]]), source: 'Tasks' };
    }
    throw bad(`Unknown NerveCenter source "${query}"`);
  }
}

/** Rows of a statement that is not a plain read: Databricks returns its statement payload, Snowflake a list of records. */
function resultRows(raw: unknown, limit: number): {columns:string[];rows:unknown[][]} {
  if (Array.isArray(raw)) { const list = (raw as Array<Record<string,unknown>>).slice(0, limit); const columns = list.length ? Object.keys(list[0]) : []; return { columns, rows: list.map(row => columns.map(column => row[column] ?? null)) }; }
  const payload = (raw || {}) as {manifest?:{schema?:{columns?:Array<{name:string}>}};result?:{data_array?:unknown[][]}};
  return { columns: (payload.manifest?.schema?.columns || []).map(column => column.name), rows: (payload.result?.data_array || []).slice(0, limit) };
}

const cap = (text: unknown) => { const value = String(text || ''); return value ? value.charAt(0).toUpperCase() + value.slice(1) : ''; };
const nameOf = (member: TicketRow['assignee']) => (typeof member === 'string' ? member : member?.name || member?.id || null);
const runState = (status: unknown) => { const text = String(status || '').toLowerCase(); return HEALTHY.has(text) ? 'Succeeded' : FAILED.has(text) ? 'Failed' : cap(text.replace(/_/g, ' ')) || 'Unknown'; };
const label = (health: string|undefined) => ({ healthy: 'Succeeded', failed: 'Failed', overdue: 'Missed', running: 'Running', paused: 'Paused', no_runs: 'No runs' } as Record<string,string>)[health || ''] || 'Unknown';
/** One sentence a reader can act on, from whatever the platform threw. */
export function plainError(error: unknown) {
  const text = errorText(error, 'The widget could not load');
  if (/TABLE_OR_VIEW_NOT_FOUND|cannot be found|does not exist/i.test(text)) return `The table this widget reads does not exist: ${(/`([^`]+)`/.exec(text) || [])[1] || 'check the query'}.`;
  if (/PARSE_SYNTAX_ERROR|Syntax error/i.test(text)) return 'The SQL in this widget has a syntax error.';
  if (/403|Invalid access token|unauthori[sz]ed/i.test(text)) return 'The platform rejected the connection. Check Connectors.';
  if (/No (databricks|snowflake) connection|warehouse/i.test(text)) return text;
  return text.length > 200 ? `${text.slice(0, 197)}…` : text;
}
