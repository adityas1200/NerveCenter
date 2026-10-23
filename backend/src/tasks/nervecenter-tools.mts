import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { assertPermission, projectPermissionsFor, projectUser, resolveRole } from '../app/rbac.mjs';
import { projectRoleOf } from '../projects/project-access.mjs';
import { APP_STATUS_LABELS, LINK_RELATIONS, decorateTicket, isClosedTicket } from '../app/ticket-view.mjs';
import { TOOL_CATEGORIES, toolPermission } from './nervecenter-tool-categories.mjs';
import { inScope, systemScope } from '../projects/project-access.mjs';
import { forProject } from '../projects/project-bound.mjs';
import { COMPONENT_TOOLS, catalogTools } from './ui-catalog.mjs';
import { MAX_GUIDE_QUESTIONS, guideQuestionShape, guideSummary, upsertGuide } from '../knowledge/knowledge-setup.mjs';
import { LINK_FIELDS, SCALAR_FIELDS } from '../knowledge/knowledge-links.mjs';
import { PASS_ROUTINE } from '../knowledge/knowledge-pass.mjs';
import type { OperationsService } from '../app/operations-service.mjs';
import type { FileTaskStore, TaskRecord, TaskEvent, InboxItem } from './task-store.mjs';
import type { BoardService } from '../boards/board-service.mjs';
import type { FixService } from './fix-service.mjs';

type Member = string | { id?: string; name?: string; email?:string; type?:string; via?:string; groups?:string[]; roles?:string[] } | null | undefined;
type ToolUser = { id?: string; name?: string; type?: string; role?: string; roles?: string[]; groups?: string[]; [key: string]: unknown };
type ToolTask = Partial<TaskRecord> & { id?: string; projectId?: string; title?:string;permission?:string;summary?:string;cost?:{totalUsd?:number};createdBy?: {id?:string;name?:string}|null; context?: {ticket?:{ticketId?:string};sharedBase?:boolean;knowledgeBase?:string;knowledgeSetup?:boolean;routine?:{name?:string;test?:boolean}} };
type ToolEvent = TaskEvent & { type: string; parentToolUseId?:string; name?:string; input?:Record<string,unknown>; text?:string; title?:string };
type LogEvent = ToolEvent & { toolUseId?:string; isError?:boolean; content?:unknown; reason?:string; detail?:string; decision?:string; status?:string; actor?:{id?:string;name?:string}|null; questions?:unknown; answers?:unknown; subtype?:string; turns?:number; costUsd?:number; model?:string };
type ToolRoutine = {name:string;title?:string;objective?:string;scheduleText?:string;enabled?:boolean;nextRunAt?:string;permission?:string;lastRun?:{taskId:string;status:string;summary?:string}};
type ToolRoutines = {list?():Promise<ToolRoutine[]>;run(name:string,input:{user:ToolUser;test:boolean;scope:ToolScope}):Promise<{id:string;status:string}>};
type ToolConnections = {list():Promise<Array<Record<string,unknown>>>;test(id:string):Promise<unknown>};
type ToolRbacStore = {overlay?(user: ToolUser): ToolUser & {storedName?:string};list?():Array<{id:string;name?:string;role?:string;blocked?:boolean}>};
type ToolScope = ReturnType<typeof systemScope>;
type ToolSdk = { tool(name: string, description: string, shape: z.ZodRawShape, handler: (args: unknown) => unknown, options: Record<string, unknown>): unknown; createSdkMcpServer(options: { name: string; version: string; tools: unknown[] }): unknown };
type ToolFactory = <S extends z.ZodRawShape>(name: string, description: string, shape: S, handler: (args: z.infer<z.ZodObject<S>>) => unknown, options?: {alwaysLoad?:boolean}) => unknown;
type AppToolOptions = {
  operationsService: OperationsService;
  dataQualityService?: { monitor?(input: Record<string, unknown>): Promise<{items?: Array<Record<string, unknown>>; summary?: unknown; reason?: string}>; reconcile(input: Record<string, unknown>): Promise<Record<string, unknown>> } | null;
  taskStore: FileTaskStore;
  routines: ToolRoutines;
  rbacStore?: ToolRbacStore | null;
  boards?: BoardService | null;
  fixes?: FixService | null;
  connectors?: ToolConnections | null;
  knowledge?: unknown;
  knowledgeDir?: string | null;
  knowledgeDrafts?: unknown;
  workspaces?: unknown;
  projects?: { listMembers?(projectId:string): Promise<Array<{userId:string}>> } | null;
  agentName?: string;
};

/** Tools nearly every task uses, so they are always in the session; the others load through tool search. */
// get_task_log reads at most the store's event cap and returns pages bounded by entries and size.
const TASK_LOG_MAX_EVENTS = 10_000;
const TASK_LOG_PAGE_ENTRIES = 300;
const TASK_LOG_PAGE_CHARS = 60_000;
const COMPONENTS = new Set(Object.keys(COMPONENT_TOOLS));
const shortTool = (name: unknown) => String(name || '').replace(/^mcp__nervecenter__/, '');
const ALWAYS_LOADED = new Set(['app_overview', 'list_tickets', 'get_ticket', 'find_similar_tickets', 'list_pipelines', 'get_pipeline_runs', 'data_quality_results', 'search_knowledge', 'query_data']);

// NerveCenter's own data as tools for the agent, served in-process through the SDK's MCP support.
// The agent sees what the person sees: tickets with its own earlier findings, pipelines, data quality
// results, tasks, approvals, routines and people, and can act on NerveCenter tickets. Writes go
// through the same permission gate as every other tool (see permission-policy.mjs), and each call
// runs as the person who started the task, with their ticket permissions.

const nameOf = (member: Member): string | null => (typeof member === 'string' ? member : member?.name || member?.id || null);
const lower = (value: unknown): string => String(value || '').toLowerCase();
const clip = (value: unknown, max = 400): string => { const text = String(value || ''); return text.length > max ? `${text.slice(0, max - 1)}…` : text; };

function ticketRow(raw: Parameters<typeof decorateTicket>[0]) {
  const ticket = decorateTicket(raw);
  return {
    ticketId: ticket.ticketId, number: ticket.externalReference?.number || null, title: ticket.title, priority: ticket.priority, status: APP_STATUS_LABELS[ticket.appStatus as keyof typeof APP_STATUS_LABELS], sourceStatus: ticket.sourceStatus, source: ticket.source, category: ticket.category, tags: ticket.tags || [],
    assignee: nameOf(ticket.assignee), requester: nameOf(ticket.requester), agent: ticket.agent.label, agentFinding: ticket.agent.summary, taskId: ticket.taskId || null, resolvedWithAgent: ticket.resolvedWithAgent,
    pipelineId: ticket.pipelineId || null, createdAt: ticket.createdAt, updatedAt: ticket.updatedAt, link: `/tickets/${encodeURIComponent(ticket.ticketId)}`,
  };
}

/** Every write the agent makes carries a one-sentence reason, shown next to the change in NerveCenter. */
const reasonField = { reason: z.string().min(3).max(240).describe('One plain sentence on why you are making this change; the person sees it next to the change') };

/**
 * A small word search over the knowledge folder: every .md page scored by how many query words it
 * contains, title matches counting double. Enough to route the agent to the right page to Read.
 */
export async function searchKnowledge(dir: string | null | undefined, query: string, limit = 5) {
  if (!dir) return { query, results: [], note: 'No knowledge folder is configured' };
  const terms = [...new Set(String(query).toLowerCase().split(/[^a-z0-9_]+/).filter(term => term.length >= 2))];
  if (!terms.length) return { query, results: [] };
  const files: string[] = [];
  const walk = async (folder: string, depth: number): Promise<void> => {
    if (depth > 8) return;
    let entries = []; try { entries = await fs.readdir(folder, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const full = path.join(folder, entry.name);
      if (entry.isDirectory()) await walk(full, depth + 1);
      else if (/\.(md|markdown|txt)$/i.test(entry.name)) files.push(full);
      if (files.length > 2000) return;
    }
  };
  await walk(dir, 0);
  const scored: Array<{path:string;title:string;score:number;snippet:string;type?:string;draft?:boolean;stale?:boolean;staleAfter?:string}> = [];
  for (const file of files) {
    let text; try { text = await fs.readFile(file, 'utf8'); } catch { continue; }
    if (text.length > 400_000) text = text.slice(0, 400_000);
    const lower = text.toLowerCase();
    const title = (/^#\s+(.+)$/m.exec(text)?.[1] || /^title:\s*(.+)$/m.exec(text)?.[1] || path.basename(file, path.extname(file))).trim();
    const titleLower = title.toLowerCase();
    let score = 0; let firstHit = -1;
    for (const term of terms) {
      const count = lower.split(term).length - 1;
      if (!count) continue;
      score += Math.min(count, 5) + (titleLower.includes(term) ? 4 : 0);
      const at = lower.indexOf(term); if (firstHit === -1 || at < firstHit) firstHit = at;
    }
    if (!score) continue;
    const start = Math.max(0, firstHit - 80); const snippet = text.slice(start, start + 240).replace(/\s+/g, ' ').trim();
    // Drafts are leads, not approved knowledge, until a person keeps them; a page past its OKF
    // stale_after date is flagged so the answer says so. Reviewed pages rank above drafts.
    const head = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text.slice(0, 4000))?.[1] || '';
    const draft = /^status:\s*draft\s*$/m.test(head) || /<!--\s*draft\b/.test(text);
    const staleAfter = /^stale_after:\s*["']?(\d{4}-\d{2}-\d{2})/m.exec(head)?.[1];
    const stale = Boolean(staleAfter && Date.parse(staleAfter) < Date.now());
    const type = /^type:\s*["']?([^"'\r\n]+)/m.exec(head)?.[1]?.trim();
    if (draft) score *= 0.6;
    scored.push({ path: path.relative(dir, file).replaceAll('\\', '/'), title, score, snippet: `${start ? '…' : ''}${snippet}${start + 240 < text.length ? '…' : ''}`, ...(type ? { type } : {}), ...(draft ? { draft: true } : {}), ...(stale ? { stale: true, staleAfter } : {}) });
  }
  scored.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  return { query, results: scored.slice(0, limit).map(({ score: _score, ...item }) => ({ ...item, readPath: `knowledge/${item.path}` })), searched: files.length };
}

const widgetShape = {
  id: z.string().max(40).optional().describe('Stable id (letters, digits, underscores); omit to derive from the title'),
  type: z.enum(['metric', 'table', 'chart', 'text']),
  title: z.string().min(1).max(80),
  size: z.enum(['sm', 'md', 'lg']).optional().describe('sm = quarter width, md = half, lg = full'),
  note: z.string().max(200).optional().describe('One line under the widget: source, caveat, what to notice'),
  markdown: z.string().max(4000).optional().describe('text widgets only'),
  source: z.object({
    kind: z.enum(['nervecenter', 'sql', 'text']),
    query: z.string().max(60).optional().describe('nervecenter source id, e.g. pipelines.health (see list_board_sources)'),
    params: z.record(z.string(), z.string()).optional().describe('nervecenter: match, status, limit. sql: named parameters whose values may use {{range.from}}, {{range.to}} or {{<filter key>}}'),
    provider: z.enum(['databricks', 'snowflake']).optional(),
    statement: z.string().max(4000).optional().describe('sql: one read-only SELECT; bind values with :name (Databricks) or ? (Snowflake) and list them in params'),
    catalog: z.string().max(80).optional(), schema: z.string().max(80).optional(),
  }).optional(),
  viz: z.object({
    valueColumn: z.string().max(60).optional(), labelColumn: z.string().max(60).optional(), suffix: z.string().max(20).optional(), tone: z.enum(['neutral', 'good', 'bad', 'warning', 'auto']).optional(),
    chart: z.enum(['column', 'bar', 'line', 'area', 'donut', 'pie', 'heatmap', 'funnel', 'gantt']).optional().describe('chart widgets: column (default) or bar for categories, line or area for time series, donut or pie for a share of a whole (one series, up to 8 slices), heatmap for a number across two dimensions, funnel for stages that lose volume, gantt for runs on a time axis'), xColumn: z.string().max(60).optional().describe('the category, period, heatmap row label, funnel stage or gantt lane'), seriesColumns: z.array(z.string().max(60)).max(62).optional().describe('value columns: up to 6, or up to 62 heatmap columns'),
    unit: z.string().max(20).optional().describe('chart: the unit of the values, e.g. runs'), scale: z.enum(['high_is_bad', 'high_is_good', 'neutral']).optional().describe('heatmap: which way is worse'), pivotColumn: z.string().max(60).optional().describe('heatmap from long rows: the column whose values become the heatmap columns; the first series is the value'),
    startColumn: z.string().max(60).optional(), endColumn: z.string().max(60).optional(), stateColumn: z.string().max(60).optional().describe('gantt: ISO start and end columns and the run state; default Started, Ended, Status. labelColumn names a bar'),
    gauge: z.object({ max: z.number().positive(), target: z.number().optional(), higherIsBetter: z.boolean().optional() }).optional().describe('metric: draw the value as a ring against a target, e.g. SLA met % with max 100 and target 95'), layout: z.enum(['stacked', 'grouped']).optional(), showValues: z.boolean().optional().describe('print the value on each column, bar or slice'), sparkline: z.boolean().optional().describe('metric widgets over a time series: draw a small trend line under the number'),
    columns: z.array(z.string().max(60)).max(12).optional(), statusColumn: z.string().max(60).optional(), limit: z.number().int().min(1).max(200).optional(),
  }).optional(),
};
const filterShape = z.object({ key: z.string().max(40).optional(), label: z.string().max(40).optional(), type: z.enum(['range', 'select', 'text']), options: z.array(z.string().max(60)).max(30).optional(), default: z.string().max(80).optional(), allLabel: z.string().max(30).optional(), placeholder: z.string().max(60).optional() });

function boardTools({ tool, boards, user, scope, agentName }: {tool: ToolFactory;boards: BoardService;user: ToolUser;scope: ToolScope;agentName: string}) {
  type BoardView = {id:string;title:string;description:string;status:string;owner?:{name?:string};filters:unknown[];widgets:Array<{id:string;type:string;title:string;size:string;source:unknown;viz?:unknown}>;canEdit?:boolean};
  const view = (board: BoardView) => ({ id: board.id, title: board.title, description: board.description, status: board.status, owner: board.owner?.name || null, filters: board.filters, widgets: board.widgets.map(widget => ({ id: widget.id, type: widget.type, title: widget.title, size: widget.size, source: widget.source, viz: widget.viz })), link: `/boards/${encodeURIComponent(board.id)}`, canEdit: board.canEdit });
  return [
    tool('list_boards', 'Boards (dashboards) this person can open: every published board plus their own drafts. Each has widgets over NerveCenter data or SQL. Use it when someone asks what boards exist or where a number is shown.', {}, async () => ({ boards: await boards.list(user, scope) })),
    tool('get_board', 'One board by id or title: its filters and every widget with its source and drawing settings. Read it before changing a board so you edit, not overwrite.', { board: z.string().min(1).describe('Board id (B-…) or title') }, async ({ board }) => view(await boards.find(board, user, scope))),
    tool('list_board_sources', 'The NerveCenter sources a board widget can use (id, columns, which filters it honours, which widget types fit) and the widget types and sizes. Read it before you build a board.', {}, async () => ({ sources: (await import('../boards/board-service.mjs')).NERVECENTER_SOURCES, widgetTypes: ['metric', 'table', 'chart', 'text'], sizes: { sm: 'quarter width', md: 'half width', lg: 'full width' }, charts: { column: 'categories or periods, several series stack or group', bar: 'horizontal, best for long labels or a ranking', line: 'trend over time', area: 'trend over time with volume', donut: 'share of a whole, one series, up to 8 slices', pie: 'same as donut', heatmap: 'a number across two dimensions: xColumn is the row, seriesColumns the columns (or pivotColumn over long rows); set scale', funnel: 'stages in row order, xColumn the stage and the first series the count', gantt: 'runs on a UTC axis: xColumn the lane, startColumn/endColumn ISO times, stateColumn the run state' }, gauges: 'a metric with gauge { max, target, higherIsBetter } draws a ring against its target', filters: 'Every board has a range filter (today, 12h, 24h, 7d, 30d, custom). Add select filters whose values reach nervecenter sources as "match" and SQL params as {{key}}.', sqlRules: 'One read-only SELECT per widget. Never splice filter values into the statement: bind them with :name (Databricks) or ? (Snowflake) and map them in params, e.g. { from_time: "{{range.from}}" }. Keep results under 200 rows.' })),
    tool('get_board_widget_data', 'What one board widget shows right now: its spec (source, SQL, drawing settings) and the columns and rows the board page draws for those filters (the board\'s defaults when you give none). Call it first when the person asks about a widget, a chart point or a row on a board; then look at the data behind it with query_data for SQL widgets or the matching nervecenter tool.', {
      board: z.string().min(1).describe('Board id (B-…) or title'),
      widget: z.string().min(1).max(80).describe('Widget id, or its title'),
      filters: z.record(z.string(), z.string()).optional().describe('The filter values on screen, e.g. { range: "7d", brand: "veltrix" }'),
    }, async ({ board, widget, filters }) => {
      const found = await boards.find(board, user, scope);
      const key = widget.trim().toLowerCase();
      const item = found.widgets.find(entry => entry.id === widget) || found.widgets.find(entry => entry.title.toLowerCase() === key);
      if (!item) throw new Error(`No widget ${widget} on board ${found.title}`);
      const data = await boards.run(found.id, filters || {}, user, scope);
      const result = data.widgets[item.id] || {};
      const rows = (result.rows || []) as unknown[][];
      return { board: { id: found.id, title: found.title, link: `/boards/${encodeURIComponent(found.id)}` }, widget: { id: item.id, title: item.title, type: item.type, note: item.note, source: item.source, viz: item.viz }, filters: data.filters, ...(result.error ? { error: result.error } : { columns: result.columns || [], rows: rows.slice(0, 50), rowCount: rows.length }), fix: data.fixes?.[item.id] || null };
    }),
    tool('describe_board_data', 'The tables a SQL widget could read on Databricks or Snowflake, or one table\'s columns with types and comments. Call it before writing SQL for a widget so you use real table and column names. Without `table` it lists tables in a schema (narrow with `search`); with `table` it returns that table\'s columns.', {
      provider: z.enum(['databricks', 'snowflake']).optional().describe('Leave out to use the first connected platform'),
      table: z.string().max(200).optional().describe('Full table name, e.g. commercial.gold.veltrix_sales_daily (Databricks needs catalog.schema.table)'),
      search: z.string().max(80).optional().describe('Part of a table name to look for'),
      catalog: z.string().max(80).optional().describe('Databricks catalog; defaults to the connection\'s'),
      schema: z.string().max(80).optional().describe('Schema to list; defaults to the connection\'s'),
    }, async args => boards.describeData(args as Record<string, unknown>, user, scope)),
    tool('preview_board_widget', 'Run one widget without saving it and see its columns and first rows, so you can check a source or SQL before adding it to a board. Give the same widget object you would pass to create_board or update_board.', { widget: z.object(widgetShape), filters: z.record(z.string(), z.string()).optional().describe('Filter values to try, e.g. { range: "24h", match: "veltrix" }') }, async ({ widget, filters }) => { const result = await boards.preview(widget as never, filters || {}, user, null, scope); const rows = result.rows as unknown[][]; return { widget: result.widget, filters: result.filters, columns: result.columns, rows: rows.slice(0, 20), rowCount: rows.length, markdown: result.markdown || undefined }; }),
    tool('create_board', `Create a board as a draft for this person. Give a title, optional description, filters (a range filter is added if missing) and widgets. Preview each widget first. The person publishes it from the board page, or ask them and call publish_board. Say the board link in your reply.`, { title: z.string().min(1).max(80), description: z.string().max(400).optional(), filters: z.array(filterShape).max(6).optional(), widgets: z.array(z.object(widgetShape)).max(16), ...reasonField }, async ({ reason: _reason, ...input }) => view(await boards.create(input, user, scope))),
    tool('update_board', 'Change a board this person owns (admins may change any): send the full new widgets list and/or filters and/or title. Read it with get_board first and send everything back with your changes, because the list you send replaces the old one.', { board: z.string().min(1), title: z.string().min(1).max(80).optional(), description: z.string().max(400).optional(), filters: z.array(filterShape).max(6).optional(), widgets: z.array(z.object(widgetShape)).max(16).optional(), ...reasonField }, async ({ board, reason: _reason, ...input }) => { const found = await boards.find(board, user, scope); return view(await boards.update(found.id, input, user, scope)); }),
    tool('publish_board', 'Publish a board so everyone can open it, or unpublish it back to a draft. Only after the person asked for it.', { board: z.string().min(1), published: z.boolean().default(true), ...reasonField }, async ({ board, published }) => { const found = await boards.find(board, user, scope); return view(await boards.setPublished(found.id, published, user, scope)); }),
    tool('delete_board', 'Delete a board this person owns. Only when they asked.', { board: z.string().min(1), ...reasonField }, async ({ board }) => { const found = await boards.find(board, user, scope); return boards.remove(found.id, user, scope); }),
  ].map(item => item);
}

const providerField = { provider: z.enum(['databricks', 'snowflake']).optional().describe('Leave out to use the platform that has a sandbox set') };

function fixTools({ tool, fixes, task, user, scope }: {tool: ToolFactory;fixes: FixService;task: {id:string;projectId?:string};user: ToolUser;scope: ToolScope}) {
  const ctx = { task, user, scope };
  return [
    tool('create_fix_sandbox', 'Copy a table into the sandbox schema (a shallow or zero-copy clone, cheap and separate from the original) so you can change and test a data fix there. Use it before any data fix; never test on the original. Returns the copy\'s name.', { ...providerField, table: z.string().min(5).max(200).describe('The original table in full: catalog.schema.table (database.schema.table on Snowflake)'), ...reasonField }, async ({ provider, table }) => fixes.createSandbox({ provider, table }, ctx)),
    tool('run_in_sandbox', 'Run one SQL statement on a sandbox copy: the change you are testing (UPDATE, DELETE, MERGE, INSERT, CREATE OR REPLACE, ALTER) or a SELECT to test the result. A write is refused unless its target is in the sandbox schema, so the original tables cannot change through this tool. Reading other tables (to join or insert from) is fine.', { ...providerField, statement: z.string().min(6).max(8000), purpose: z.string().min(3).max(200).describe('One line: what this statement does or checks'), ...reasonField }, async ({ provider, statement }) => fixes.runInSandbox({ provider, statement }, ctx)),
    tool('drop_fix_sandbox', 'Drop a sandbox copy you no longer need (apply_fix drops it itself when the fix verifies). Only tables in the sandbox schema.', { ...providerField, sandbox: z.string().min(5).max(200), ...reasonField }, async ({ provider, sandbox }) => fixes.dropSandbox({ provider, sandbox }, ctx)),
    tool('propose_fix', 'Propose a data fix you tested on a sandbox copy. Give the original table (target), the copy (sandbox), the one statement that applies the same change to the target, the tests you ran and their results, and checks: SELECTs on the target with the value they should return once fixed (for example the count of bad rows, expect eq 0). NerveCenter then works out what the fix changes: rows before and after, sample rows that differ, each check run on the copy, and the board widgets that read the table shown now and after the fix. The person sees all of it. Then call explain_action and apply_fix with the proposalId.', {
      ...providerField,
      title: z.string().min(3).max(120).describe('The fix as a short imperative: "Map COMM payer type to Commercial"'),
      summary: z.string().max(400).optional(),
      target: z.string().min(5).max(200).describe('The original table in full'),
      sandbox: z.string().min(5).max(200).describe('The sandbox copy you changed and tested'),
      apply: z.object({ statement: z.string().min(6).max(4000).describe('One INSERT, UPDATE, DELETE, MERGE, CREATE OR REPLACE or ALTER TABLE statement on the target: the same change you made to the copy') }),
      tests: z.array(z.object({ name: z.string().min(3).max(120), result: z.enum(['passed', 'failed', 'skipped']), command: z.string().max(1000).optional(), detail: z.string().max(300).optional() })).min(1).max(12),
      checks: z.array(z.object({ label: z.string().min(3).max(120), statement: z.string().min(8).max(2000).describe('A SELECT on the target whose first value is the measure'), expect: z.object({ op: z.enum(['eq', 'ne', 'gt', 'gte', 'lt', 'lte']), value: z.union([z.string().max(80), z.number()]) }) })).max(8).optional(),
      key: z.array(z.string().max(60)).max(4).optional().describe('Columns that identify a row, so NerveCenter can say which columns changed'),
      files: z.array(z.object({ path: z.string().min(1).max(300), diff: z.string().max(8000), language: z.string().max(20).optional() })).max(5).optional().describe('Optional: the SQL or code as unified diffs'),
    }, async input => fixes.propose(input as never, ctx)),
    tool('apply_fix', 'Apply a fix you proposed with propose_fix: NerveCenter runs exactly the proposal\'s statement on the target, after checking the table has not changed since you tested, then re-runs the checks and the board widgets and reports expected against actual. Give only the proposalId. Call explain_action right before it.', { proposalId: z.string().regex(/^FP-[0-9a-f]{8}$/, 'Give the proposalId propose_fix returned, e.g. FP-1a2b3c4d'), ...reasonField }, async ({ proposalId }) => fixes.apply({ proposalId }, ctx)),
  ];
}

/** Table names a SELECT reads (FROM and JOIN targets), for the query card. */
export function tablesIn(statement: unknown): string[] {
  const names = new Set<string>();
  for (const match of String(statement || '').replace(/--[^\n]*|\/\*[\s\S]*?\*\//g, ' ').matchAll(/\b(?:FROM|JOIN)\s+([`"[]?[\w$-]+[`"\]]?(?:\.[`"[]?[\w$-]+[`"\]]?){0,2})/gi)) {
    const name = match[1].replace(/[`"[\]]/g, '');
    if (!/^(?:select|lateral|unnest|values)$/i.test(name)) names.add(name);
  }
  return [...names];
}

// `routines`, `connectors`, `knowledge`, `knowledgeDrafts` and `workspaces` may be per-project registries: each call uses the task's own
// project's instance (FR-40). A plain instance (a test, a single fixed workspace) is used as it is. `knowledgeDir` is that
// single workspace's folder. `projects` (the project store) narrows list_people to the project's members.
export function createAppTools({ operationsService, dataQualityService, taskStore, routines, rbacStore, boards = null, fixes = null, connectors = null, knowledge = null, knowledgeDir = null, knowledgeDrafts = null, workspaces = null, projects = null, agentName = 'Sonic' }: AppToolOptions) {
  const userFor = (task?: ToolTask): ToolUser => {
    const creator = task?.createdBy;
    // Work nobody started (automatic ticket triage, a routine without an owner) acts with developer rights, never admin.
    if (!creator?.id || creator.id === 'system') return { type: 'agent', id: 'nervecenter-agent', name: agentName, role: 'developer', roles: ['developer'], groups: [], via: agentName, projectRole: 'developer', permissions: projectPermissionsFor('developer') };
    const base: ToolUser = { type: 'user', id: String(creator.id), name: creator.name || String(creator.id), groups: [], roles: [] };
    const overlaid = rbacStore?.overlay?.(base) || base;
    return { ...overlaid, name: (overlaid.storedName || overlaid.name) as string, role: resolveRole(overlaid), via: agentName };
  };

  return (task: ToolTask | undefined, sdk: ToolSdk) => {
    const base = userFor(task); const user = { ...base };
    // SPEC-projects-03 FR-22: the creator acts with their role in the task's project, re-read before every call so a change
    // applies at once. System work keeps developer rights, never owner (set in userFor).
    const loadRoles = async () => {
      if (base.type !== 'user') return;
      // Without a project store (one fixed workspace) the app role stands in for the project role.
      const role = projects ? await projectRoleOf({ store: projects, user: base, projectId: task?.projectId }) : base.role;
      for (const key of Object.keys(user)) delete user[key];
      Object.assign(user, projectUser({ ...base }, { projectId: task?.projectId, projectRole: role }));
    };
    // Every read and write below goes through this one project, the task's own (FR-40). A task with no project gets no tools.
    const scope = systemScope(task?.projectId);
    const routinesOf = () => forProject(routines, scope);
    const connectorsOf = () => forProject(connectors, scope);
    const knowledgeOf = () => forProject(knowledge, scope);
    const draftsOf = () => forProject(knowledgeDrafts, scope);
    const taskDirOf = async () => (workspaces && task?.id ? (await forProject(workspaces, scope) as {taskDir(id:string):Promise<string>}).taskDir(task.id) : null);
    const knowledgeDirOf = async () => (workspaces ? (await forProject(workspaces, scope)).knowledgeDir : knowledgeDir);
    const ok = (data: unknown) => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 1) }] });
    // Every tool's permission category lives in nervecenter-tool-categories.mjs; a tool without one is a mistake caught here.
    // The tools a session uses in almost every task stay loaded; the rest are found through tool search when needed.
    const tool: ToolFactory = (name, description, shape, handler, options = {}) => {
      const category = TOOL_CATEGORIES[name as keyof typeof TOOL_CATEGORIES]; if (!category) throw new Error(`nervecenter tool ${name} has no permission category`);
      return sdk.tool(name, description, shape, async args => {
        try { await loadRoles(); const needs = toolPermission(name); if (needs) assertPermission(user, needs); return ok(await handler((args || {}) as never)); } catch (error) { const caught = error as Error & {statusCode?:number}; return { content: [{ type: 'text', text: `Error: ${caught?.message || error}` }], isError: true }; }
      }, { alwaysLoad: options.alwaysLoad ?? ALWAYS_LOADED.has(name), annotations: { readOnlyHint: category === 'read', destructiveHint: ['delete_board'].includes(name) } });
    };

    // Through operationsService, never the store. An id from another project reads as missing, so nothing about the row leaks.
    const findTicket = async (ref: unknown) => {
      const key = String(ref || '').trim(); if (!key) throw new Error('ticketId is required');
      try { return await operationsService.findTicketByRef(key, scope); }
      catch (error) { if ([403, 404].includes((error as {statusCode?:number})?.statusCode || 0)) throw new Error(`No ticket ${key} in this project`); throw error; }
    };
    const taskOf = async (id: string): Promise<ToolTask | null> => { const found = await taskStore.getTask(id) as ToolTask | null; return found && inScope(scope, found.projectId) ? found : null; };

    // What an earlier task concluded: its root cause, fix and verification findings, from the record_finding calls it made.
    const findingsOf = async (taskId: string) => (await taskStore.listEvents(taskId).catch(() => []) as ToolEvent[]).filter(event => event.type === 'tool.use' && !event.parentToolUseId && /(^|__)record_finding$/.test(String(event.name)) && ['root_cause', 'fix', 'verification'].includes(String(event.input?.kind))).map(event => ({ kind: event.input?.kind, text: clip(event.input?.text, 600) }));

    // One task's conversation as compact entries, for reviewing how it went (SPEC-tasks-04 FR-13). Signals count the
    // whole task; entries come a page at a time so a long task never floods the reviewer's context.
    const taskLog = async (taskId: string, afterSeq: number) => {
      const item = await taskOf(taskId); if (!item) throw new Error(`No task ${taskId} in this project`);
      const events = await taskStore.listEvents(taskId, { limit: TASK_LOG_MAX_EVENTS }) as LogEvent[];
      const toolNames = new Map<string, string>();
      const signals = { personMessages: 0, agentReplies: 0, toolCalls: 0, toolErrors: 0, findings: 0, approvalsAsked: 0, approved: 0, rejected: 0, blocked: 0, questionsAsked: 0, questionsAnswered: 0, interruptions: 0, cancelled: 0, errors: 0, subagentSteps: 0, edits: Number(item.historyVersion) || 0 };
      const entryOf = (event: LogEvent): Record<string, unknown> | null => {
        const at = { seq: event.seq, at: event.at };
        const by = event.actor?.name || event.actor?.id || null;
        if (event.parentToolUseId) { signals.subagentSteps += 1; return null; }
        switch (event.type) {
          case 'user.message': signals.personMessages += 1; return { ...at, kind: 'person', by, text: clip(event.text, 2000) };
          case 'assistant.text': signals.agentReplies += 1; return { ...at, kind: 'agent', text: clip(event.text, 2000) };
          case 'tool.use': {
            const name = shortTool(event.name); if (event.toolUseId) toolNames.set(event.toolUseId, name);
            if (name === 'record_finding') { signals.findings += 1; return { ...at, kind: 'finding', finding: event.input?.kind, text: clip(event.input?.text, 600), confidence: event.input?.confidence ?? null }; }
            signals.toolCalls += 1; return { ...at, kind: 'tool', tool: name, title: clip(event.title, 200), input: clip(JSON.stringify(event.input || {}), COMPONENTS.has(name) ? 1500 : 600) };
          }
          case 'tool.result': {
            const name = toolNames.get(String(event.toolUseId)) || null;
            if (event.isError) signals.toolErrors += 1;
            // A display tool only echoes its input, which the tool entry already shows.
            if (!event.isError && (name === 'record_finding' || COMPONENTS.has(name || ''))) return null;
            return { ...at, kind: event.isError ? 'tool_error' : 'tool_result', tool: name, text: clip(event.content, 600) };
          }
          case 'approval.requested': signals.approvalsAsked += 1; return { ...at, kind: 'approval_asked', title: clip(event.title, 300), reason: clip(event.reason, 300) || null };
          case 'approval.decided': if (event.decision === 'approved') signals.approved += 1; else signals.rejected += 1; return { ...at, kind: 'approval_decided', decision: event.decision, title: clip(event.title, 300), by };
          case 'approval.denied': signals.blocked += 1; return { ...at, kind: 'blocked', title: clip(event.title, 300), detail: clip(event.detail, 300) || null };
          case 'question.asked': signals.questionsAsked += 1; return { ...at, kind: 'question', title: clip(event.title, 300), questions: clip(JSON.stringify(event.questions || []), 800) };
          case 'question.answered': signals.questionsAnswered += 1; return { ...at, kind: 'answer', by, answers: clip(JSON.stringify(event.answers || {}), 800) };
          case 'status':
            if (event.title === 'Interrupted') signals.interruptions += 1;
            if (event.status === 'cancelled') signals.cancelled += 1;
            return { ...at, kind: 'status', title: clip(event.title, 200), detail: clip(event.detail, 300) || null };
          case 'error': signals.errors += 1; return { ...at, kind: 'error', title: clip(event.title, 200), detail: clip(event.detail, 600) || null };
          case 'session.init': return { ...at, kind: 'run_start', model: event.model || null };
          case 'result': return { ...at, kind: 'run_end', outcome: event.subtype || null, isError: Boolean(event.isError), turns: event.turns ?? null, costUsd: event.costUsd ?? null };
          default: return null;
        }
      };
      const entries: Array<Record<string, unknown>> = []; let chars = 0; let nextAfterSeq: number | null = null;
      for (const event of events) {
        const entry = entryOf(event);
        if (!entry || Number(event.seq) <= afterSeq || nextAfterSeq !== null) continue;
        const size = JSON.stringify(entry).length;
        if (entries.length && (entries.length >= TASK_LOG_PAGE_ENTRIES || chars + size > TASK_LOG_PAGE_CHARS)) { nextAfterSeq = Number(entries.at(-1)?.seq); continue; }
        entries.push(entry); chars += size;
      }
      return {
        task: { taskId: item.id, title: item.title, type: item.type, status: item.status, permission: item.permission, startedBy: item.createdBy?.name || null, createdAt: item.createdAt, finishedAt: item.finishedAt || null, costUsd: item.cost?.totalUsd ?? null, turns: (item.cost as {turns?:number}|undefined)?.turns ?? null, ticketId: item.context?.ticket?.ticketId || null, link: `/tasks/${item.id}` },
        signals, entries, nextAfterSeq,
        ...(events.length >= TASK_LOG_MAX_EVENTS ? { note: `Only the first ${TASK_LOG_MAX_EVENTS} events were read` } : {}),
      };
    };

    const tools = [
      tool('app_overview', 'One snapshot of NerveCenter right now: open tickets by status and priority, pipelines failing or running, data quality failures, and what is waiting on a person. Use it for "what is going on", "anything I should look at", morning summaries.', {}, async () => {
        const [tickets, inbox, tasks] = await Promise.all([operationsService.listTickets({ status: 'all', user, scope }), taskStore.listInbox(scope, { status: 'pending' }), taskStore.listTasks(scope, { limit: 200 })]);
        const open = tickets.filter(ticket => !isClosedTicket(ticket));
        const count = (rows: Array<Record<string, unknown>>, key: string) => rows.reduce<Record<string, number>>((acc, row) => { const value = row[key] as string; acc[value] = (acc[value] || 0) + 1; return acc; }, {});
        const monitor = await operationsService.monitor({ limit: 1000, runLimit: 3, range: 'Last 24 hours', scope }).catch(error => ({ items: [], error: (error as Error).message }));
        const dqService = dataQualityService ? await forProject(dataQualityService, scope) as NonNullable<AppToolOptions['dataQualityService']> : null;
        const dq = await dqService?.monitor?.({ range: 'Last 24 hours', limit: 100, scope }).catch(error => ({ items: [], summary: null, reason: (error as Error).message }));
        return {
          tickets: { open: open.length, byStatus: Object.fromEntries(Object.entries(count(open, 'appStatus')).map(([key, value]) => [APP_STATUS_LABELS[key as keyof typeof APP_STATUS_LABELS] || key, value])), byPriority: count(open, 'priority'), mine: open.filter(ticket => lower(nameOf(ticket.assignee)) === lower(user.name)).length, unassigned: open.filter(ticket => !ticket.assignee).length, resolvedWithAgent: tickets.filter(ticket => ticket.resolvedWithAgent).length },
          pipelines: ('error' in monitor && monitor.error) ? { unavailable: monitor.error } : { total: monitor.items.length, failed: monitor.items.filter(item => item.status === 'failed').map(item => ({ pipelineId: item.pipelineId, name: item.name, lastRunAt: item.lastRunAt, failure: clip(item.recentRuns?.[0]?.failureSummary, 200) })), running: monitor.items.filter(item => item.status === 'running').map(item => item.name) },
          dataQuality: dq?.summary ? { summary: dq.summary, failing: (dq.items || []).filter(item => item.status === 'failed').map(item => ({ checkId: item.checkId, name: item.name, dataset: item.dataset, message: clip(item.message, 200) })) } : { unavailable: dq?.reason || 'not configured' },
          waitingOnPeople: inbox.filter(item => item.kind !== 'notification').map(item => ({ kind: item.kind, title: item.title, taskId: item.taskId, category: item.categoryLabel || null })),
          agentTasksRunning: tasks.filter(item => ['running', 'queued'].includes(item.status)).map(item => ({ taskId: item.id, title: item.title })),
        };
      }),

      tool('list_tickets', 'Tickets in NerveCenter (imported from ServiceNow and Jira, or raised here), with the agent\'s one-line finding for each. Filter by status, priority, source, assignee ("me", "unassigned" or a name), topic words (matched against title, description, category and tags, e.g. "dq", "access", "pipeline").', {
        status: z.enum(['active', 'open', 'in_progress', 'waiting_on_you', 'closed', 'all']).optional().describe('active = everything not closed (default)'),
        priority: z.array(z.enum(['critical', 'high', 'medium', 'low'])).optional(),
        source: z.enum(['servicenow', 'jira', 'manual', 'all']).optional(),
        assignee: z.string().optional(),
        text: z.string().optional().describe('Words to match; all must appear'),
        limit: z.number().int().min(1).max(200).optional(),
      }, async ({ status = 'active', priority, source = 'all', assignee, text, limit = 50 }) => {
        let rows = await operationsService.listTickets({ status: 'all', source, user, scope });
        if (status === 'active') rows = rows.filter(ticket => ticket.appStatus !== 'closed'); else if (status !== 'all') rows = rows.filter(ticket => ticket.appStatus === status);
        if (priority?.length) rows = rows.filter(ticket => priority.includes(lower(ticket.priority) as typeof priority[number]));
        if (assignee) { const who = lower(assignee); rows = rows.filter(ticket => who === 'unassigned' ? !ticket.assignee : who === 'me' ? [lower(user.name), lower(user.id)].includes(lower(nameOf(ticket.assignee))) || lower(typeof ticket.assignee === 'string' ? undefined : ticket.assignee?.id).split('@')[0] === lower(user.id) : lower(nameOf(ticket.assignee)).includes(who)); }
        if (text) { const words = lower(text).split(/\s+/).filter(Boolean).map(word => (word === 'dq' ? 'dq|quality' : word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))); rows = rows.filter(ticket => { const hay = lower([ticket.title, ticket.description, ticket.category, ticket.type, ...(ticket.tags || []), ticket.externalReference?.number].join(' ')); return words.every(word => new RegExp(word).test(hay)); }); }
        const priorityRank: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
        rows.sort((a, b) => (priorityRank[a.priority || ''] ?? 4) - (priorityRank[b.priority || ''] ?? 4) || String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
        return { total: rows.length, tickets: rows.slice(0, limit).map(ticketRow) };
      }),

      tool('get_ticket', 'One ticket in full: description, people, source system details and link, the agent\'s finding, and the activity timeline (comments, status changes, what the agent did). Accepts the NerveCenter id (OPS-1001) or the source number (INC0031201, CDO-118).', { ticketId: z.string() }, async ({ ticketId }) => {
        const found = await findTicket(ticketId); const ticket = await operationsService.ticket(found.ticketId, user, scope);
        const agentTask = ticket.taskId ? await taskOf(ticket.taskId) : null;
        // A recurrence means an earlier fix did not hold: show what that fix was so it is checked, not repeated.
        const earlier = ticket.recurrence ? await operationsService.ticket(ticket.recurrence.ofTicketId, user, scope).catch(() => null) : null;
        const recurrence = ticket.recurrence ? { ...ticket.recurrence, ofTitle: earlier?.title || null, ofResolvedAt: earlier?.closedAt || null, ofResolutionSummary: clip(earlier?.resolutionSummary, 600) || null, ofTaskId: earlier?.taskId || null, note: 'The earlier fix did not hold. Verify what it changed against the current evidence before reusing it.' } : null;
        const metadata = ticket.metadata as {serviceNow?:unknown;jira?:unknown}|undefined;
        return { ...ticketRow(ticket), links: ticket.links, recurrence, description: clip(ticket.description, 4000), sourceLink: ticket.externalReference?.url || null, sourceDetails: metadata?.serviceNow || metadata?.jira || null, resolution: ticket.resolutionSummary || null, agentTask: agentTask ? { taskId: agentTask.id, status: agentTask.status, summary: agentTask.summary, permission: agentTask.permission } : null, activity: (ticket.activity || []).slice(-25).map(event => ({ at: event.at, title: event.title, detail: clip(event.detail, 500), by: (event.actor as {name?:string}|undefined)?.name || null })) };
      }),

      tool('find_similar_tickets', 'Find earlier tickets like this one and how they were fixed. Give a ticketId (a pipeline failure, an incident) or free text such as an error message. Same failure signature first, then the closest by words, newest first on ties. By default only resolved and closed tickets. Each hit has its resolution, who resolved it and, when an agent task worked it, that task\'s root_cause, fix and verification findings. A past fix is a hypothesis: check it against the evidence in front of you before you apply it.', {
        ticketId: z.string().optional().describe('NerveCenter id or source number of the ticket to find look-alikes for'),
        text: z.string().min(3).max(2000).optional().describe('Free text to search for instead of, or as well as, a ticket'),
        status: z.array(z.enum(['open', 'in_progress', 'waiting', 'resolved', 'closed', 'cancelled'])).max(6).optional().describe('Ticket statuses to search; default resolved and closed'),
        limit: z.number().int().min(1).max(10).optional().describe('Default 5'),
      }, async ({ ticketId, text, status, limit = 5 }) => {
        if (!ticketId && !text) throw new Error('Give a ticketId or some text to search for');
        const found = ticketId ? await findTicket(ticketId) : null;
        const { ranker, hits } = await operationsService.findSimilarTickets({ ticketId: found?.ticketId, text, status: status?.length ? status : undefined, limit, user, scope });
        const tickets = await Promise.all(hits.map(async ({ ticket, matchReason, score, resolvedBy }) => ({
          ticketId: ticket.ticketId, number: ticket.externalReference?.number || null, title: ticket.title, status: ticket.status, resolvedAt: ticket.closedAt || null, resolutionSummary: clip(ticket.resolutionSummary, 600) || null, resolvedBy,
          matchReason, score, link: `/tickets/${encodeURIComponent(ticket.ticketId)}`,
          ...(ticket.taskId ? { taskId: ticket.taskId, findings: await findingsOf(ticket.taskId) } : {}),
        })));
        return { ranker, total: tickets.length, tickets, ...(tickets.length ? {} : { note: 'Nothing similar found' }) };
      }),

      tool('list_pipelines', 'Pipelines (Databricks jobs and other platforms) with their latest run status, health (healthy, failed, overdue = a scheduled run did not happen, running, paused), next scheduled run, usual duration, last failure reason and linked ticket. Filter by status or name.', {
        status: z.enum(['failed', 'running', 'healthy', 'overdue', 'paused', 'idle', 'all']).optional(),
        text: z.string().optional(),
        range: z.enum(['Today', 'Last 24 hours', 'Last 7 days', 'Last 30 days']).optional(),
        limit: z.number().int().min(1).max(200).optional().describe('Most pipelines to return (default 60); total says how many matched'),
      }, async ({ status = 'all', text, range = 'Last 7 days', limit = 60 }) => {
        const monitor = await operationsService.monitor({ limit: 1000, runLimit: 5, range, scope });
        let rows = monitor.items;
        if (status === 'idle') rows = rows.filter(item => item.status === 'no_runs'); else if (status === 'overdue' || status === 'paused') rows = rows.filter(item => item.health === status); else if (status !== 'all') rows = rows.filter(item => item.status === status);
        if (text) rows = rows.filter(item => lower(`${item.name} ${item.pipelineId}`).includes(lower(text)));
        return { range, total: rows.length, ...(rows.length > limit ? { note: `First ${limit} of ${rows.length}; narrow with status or text` } : {}), pipelines: rows.slice(0, limit).map(item => ({ pipelineId: item.pipelineId, name: item.name, platform: item.platform, status: item.status === 'no_runs' ? 'idle' : item.status, health: item.health || null, nextRunAt: item.nextRunAt || null, missedRunAt: item.dueAt || null, usualDurationMs: item.typicalDurationMs ?? null, schedule: (item.schedule as {text?:string}|undefined)?.text || item.schedule || null, lastRunAt: item.lastRunAt, lastRunId: item.lastRunId, lastSuccessAt: item.lastSuccessAt, lastFailure: clip(item.recentRuns?.find(run => run.status === 'failed')?.failureSummary, 300) || null, ticket: item.recentRuns?.find(run => run.ticket)?.ticket?.ticketId || null, runsInRange: item.recentRuns?.length || 0 })) };
      }),

      tool('get_pipeline_runs', 'Recent runs of one pipeline with status, times, duration and failure reason.', { pipelineId: z.string(), limit: z.number().int().min(1).max(50).optional() }, async ({ pipelineId, limit = 10 }) => {
        const runs = await operationsService.pipelineRuns(pipelineId, { limit, scope });
        return { pipelineId, runs: runs.map((run: {runId:string;status?:string;startTime?:string;endTime?:string;durationMs?:number;failureSummary?:string;ticket?:{ticketId?:string}|null;taskId?:string|null}) => ({ runId: run.runId, status: run.status, startTime: run.startTime, endTime: run.endTime, durationMs: run.durationMs, failure: clip(run.failureSummary, 500) || null, ticket: run.ticket?.ticketId || null, task: run.taskId || null })) };
      }),

      tool('data_quality_results', 'Data quality check results from the configured result table: pass, warning and fail counts and the checks that are failing or warning, each with the ticket that tracks it if one exists.', {
        range: z.enum(['Today', 'Last 24 hours', 'Last 7 days']).optional(),
        status: z.enum(['failed', 'warning', 'passed', 'all']).optional(),
      }, async ({ range = 'Last 24 hours', status }) => {
        if (!dataQualityService) throw new Error('Data quality monitoring is not set up');
        const result = await (await forProject(dataQualityService, scope)).reconcile({ range, limit: 100, scope });
        const dqResult = result as {configured:boolean;source?:{reason?:string};reason?:string;tables?:Array<{name?:string;resultTable:string;catalog:string;schema:string;enabled?:boolean}>;configuration?:{name?:string;resultTable:string;catalog:string;schema:string;enabled?:boolean};summary?:unknown;items:Array<{status:string;checkId:string;name:string;table?:string;severity?:string;dataset?:string;executedAt?:string;failedRows?:number;message?:string;ticket?:{ticketId?:string}}>};
        if (!dqResult.configured) return { configured: false, reason: dqResult.source?.reason || dqResult.reason || 'Data quality monitoring is not set up' };
        const want = status && status !== 'all' ? [status] : ['failed', 'warning'];
        const tables = (dqResult.tables || [dqResult.configuration]).filter((table): table is NonNullable<typeof table> => Boolean(table)).map(table => ({ name: table.name || table.resultTable, path: `${table.catalog}.${table.schema}.${table.resultTable}`, enabled: table.enabled !== false }));
        return { range, tables, summary: dqResult.summary, checks: dqResult.items.filter(item => want.includes(item.status)).map(item => ({ checkId: item.checkId, name: item.name, table: item.table || null, status: item.status, severity: item.severity, dataset: item.dataset, executedAt: item.executedAt, failedRows: item.failedRows, message: clip(item.message, 300), ticket: item.ticket?.ticketId || null })) };
      }),

      tool('list_tasks', 'Agent tasks in NerveCenter (chats, ticket work, routine runs) with status and one-line outcome, most recently updated first. Give `since` to keep only tasks updated since then, for a review of the last few days; read one task\'s whole conversation with get_task_log.', {
        status: z.enum(['queued', 'running', 'waiting', 'done', 'failed', 'cancelled', 'all']).optional(),
        type: z.enum(['ticket', 'routine', 'alert', 'adhoc', 'all']).optional(),
        limit: z.number().int().min(1).max(100).optional(),
        since: z.string().optional().describe('ISO date or time, e.g. 2026-10-13: only tasks updated at or after it'),
      }, async ({ status = 'all', type = 'all', limit = 20, since }) => {
        const from = since === undefined ? null : Date.parse(since);
        if (from !== null && !Number.isFinite(from)) throw new Error(`since must be a date such as 2026-10-13, not "${since}"`);
        const tasks = await taskStore.listTasks(scope, { type: type === 'all' ? undefined : type, status: status === 'all' ? undefined : status, limit }) as ToolTask[];
        // Newest-updated first, so the tasks since a date are the head of this bounded read (SPEC-tasks-04 FR-12).
        const rows = from === null ? tasks : tasks.filter(item => Date.parse(String(item.updatedAt || item.createdAt)) >= from);
        const more = from !== null && tasks.length === limit && rows.length === tasks.length;
        return { tasks: rows.map(item => ({ taskId: item.id, title: item.title, type: item.type, status: item.status, outcome: item.summary || null, startedBy: item.createdBy?.name, createdAt: item.createdAt, updatedAt: item.updatedAt, finishedAt: item.finishedAt || null, ticketId: item.context?.ticket?.ticketId || null, link: `/tasks/${item.id}` })), ...(more ? { note: `First ${limit}; more may match. Raise limit (max 100) or narrow by type or status` } : {}) };
      }),

      tool('get_task', 'One agent task: status, permission, outcome, cost and the last things it said.', { taskId: z.string() }, async ({ taskId }) => {
        const item = await taskOf(taskId); if (!item) throw new Error(`No task ${taskId} in this project`);
        const events = await taskStore.listEvents(taskId) as ToolEvent[];
        return { taskId: item.id, title: item.title, status: item.status, permission: item.permission, outcome: item.summary, costUsd: item.cost?.totalUsd, lastReply: clip(events.filter(event => event.type === 'result').at(-1)?.text, 3000), approvals: events.filter(event => String(event.type).startsWith('approval.')).map(event => event.title) };
      }),

      tool('get_task_log', 'One agent task\'s conversation, for reviewing how it went: what the person said, the agent\'s replies, each tool it called with a short result, findings, approvals and denials, questions, edits, stops and errors, plus counts of those signals. Use it to evaluate or audit a task; for only its status and last reply use get_task. Long tasks come in pages: pass nextAfterSeq back as afterSeq. Steps inside subagents are counted, not listed.', {
        taskId: z.string(),
        afterSeq: z.number().int().min(0).optional().describe('Continue after this event: the nextAfterSeq of the previous page'),
      }, async ({ taskId, afterSeq = 0 }) => taskLog(taskId, afterSeq)),

      tool('list_approvals', 'What is waiting on a person: approvals the agent asked for and questions it asked, with the task and category.', {}, async () => {
        const items = await taskStore.listInbox(scope, { status: 'pending' });
        return { items: items.filter(item => item.kind !== 'notification').map(item => ({ id: item.id, kind: item.kind, category: item.categoryLabel || null, title: item.title, taskId: item.taskId, createdAt: item.createdAt })) };
      }),

      tool('list_routines', 'Routines (scheduled agent work): what each does, its schedule, next run and last outcome.', {}, async () => {
        const items = await (await routinesOf() as ToolRoutines)?.list?.() || [];
        return { routines: items.map((item:ToolRoutine) => ({ name: item.name, title: item.title, objective: clip(item.objective, 300), schedule: item.scheduleText, enabled: item.enabled, nextRunAt: item.nextRunAt, lastRun: item.lastRun ? { taskId: item.lastRun.taskId, status: item.lastRun.status, outcome: item.lastRun.summary || null, link: `/tasks/${item.lastRun.taskId}` } : null, permission: item.permission, link: `/routines/${encodeURIComponent(item.name)}` })) };
      }),

      // The members of this project, and the admins (who see every project).
      tool('list_people', 'People who use NerveCenter, for assigning tickets.', {}, async () => {
        const members = projects?.listMembers ? new Set((await projects.listMembers(scope.projectId)).map(member => String(member.userId).toLowerCase())) : null;
        return { people: (rbacStore?.list?.() || []).filter(item => !item.blocked && (!members || members.has(String(item.id).toLowerCase()) || item.role === 'admin')).map(item => ({ id: item.id, name: item.name || item.id, role: item.role })) };
      }),

      tool('comment_on_ticket', 'Add a comment to a NerveCenter ticket. It appears on the ticket timeline and is written to the source system (ServiceNow work note or Jira comment) when the ticket came from one.', { ticketId: z.string(), text: z.string().min(1).max(10000), ...reasonField }, async ({ ticketId, text }) => {
        const found = await findTicket(ticketId); const result = await operationsService.commentTicket(found.ticketId, user, { body: text, scope });
        return { ticketId: found.ticketId, commented: true, sourceWrite: result.sourceWrite || null };
      }),

      tool('assign_ticket', 'Assign a ticket to a person (their name or id) or to "me" (the person who started this task). Use "unassigned" to clear.', { ticketId: z.string(), assignee: z.string(), ...reasonField }, async ({ ticketId, assignee }) => {
        const found = await findTicket(ticketId); const who = lower(assignee);
        const person = who === 'unassigned' ? null : who === 'me' ? { type: 'user', id: user.id, name: user.name } : (() => { const match = (rbacStore?.list?.() || []).find(item => lower(item.id) === who || lower(item.name) === who); return match ? { type: 'user', id: match.id, name: match.name || match.id } : { type: 'user', id: assignee, name: assignee }; })();
        const updated = await operationsService.updateTicket(found.ticketId, { assignee: person }, user, scope);
        return { ticketId: found.ticketId, assignee: nameOf(updated.assignee), sourceWrite: updated.sourceWrite || null };
      }),

      tool('set_ticket_status', 'Move a ticket to in progress, waiting, resolved, closed or back to open. Resolving needs a resolution summary. Only resolve when the work is verified.', { ticketId: z.string(), status: z.enum(['open', 'in_progress', 'waiting', 'resolved', 'closed', 'cancelled']), resolution: z.string().optional(), ...reasonField }, async ({ ticketId, status, resolution }) => {
        const found = await findTicket(ticketId);
        if (['resolved', 'closed'].includes(status) && !String(resolution || '').trim()) throw new Error('Give a resolution summary when resolving or closing');
        const updated = await operationsService.updateTicket(found.ticketId, { status, ...(resolution ? { resolutionSummary: resolution } : {}) }, user, scope);
        const closed = ['resolved', 'closed'].includes(status);
        return {
          ticketId: found.ticketId, status: APP_STATUS_LABELS[decorateTicket(updated).appStatus as keyof typeof APP_STATUS_LABELS], sourceStatus: updated.status, sourceWrite: updated.sourceWrite || null,
          // After a close, the lesson check runs on its own: the skill decides whether anything is worth keeping.
          ...(closed && knowledgeDrafts ? { next: 'If the outcome was verified, run lesson capture now: load the knowledge skill (operations-fleet:knowledge) and follow "Capture a lesson from completed work": knowledge_catalog, search_knowledge, Read the closest pages, then call update_knowledge once with create, append or skip. Skip when knowledge already covers the same symptom, cause and fix, including an entry that is still an unreviewed draft. Do not mention this step in your reply; it shows in the task.' } : {}),
        };
      }),

      tool('link_related_ticket', 'Link a ticket to another with a relation: recurrence_of (the same problem came back after the other was resolved), amends_fix_of (this ticket\'s fix corrects or completes the fix of the other), duplicate_of, or related_to. The link shows on both tickets. With `comment`, also posts it on the other ticket (saved to ServiceNow or Jira when it came from there), for example to summarise how the earlier fix was amended. To reopen a ticket use set_ticket_status.', { ticketId: z.string().describe('The ticket the link starts from, usually the one you are working'), relatedTicketId: z.string().describe('The other ticket'), relation: z.enum(LINK_RELATIONS), comment: z.string().min(1).max(10000).optional().describe('Comment to post on the other ticket'), ...reasonField }, async ({ ticketId, relatedTicketId, relation, comment }) => {
        const from = await findTicket(ticketId); const to = await findTicket(relatedTicketId);
        return operationsService.linkTickets(from.ticketId, to.ticketId, { relation: relation as never, comment, user, scope });
      }),

      tool('link_ticket_to_source', 'After you file a NerveCenter ticket in ServiceNow or Jira, link it to the new record (its sys_id or issue id, and its number) so NerveCenter keeps one ticket and saves later changes there.', { ticketId: z.string(), system: z.enum(['servicenow', 'jira']), sysId: z.string().describe('ServiceNow sys_id or Jira issue id'), number: z.string().describe('INC number or issue key'), url: z.string().optional(), ...reasonField }, async ({ ticketId, system, sysId, number, url }) => {
        const found = await findTicket(ticketId); const linked = await operationsService.linkTicketToSource(found.ticketId, { system, sysId, number, url }, user, scope);
        return { ticketId: linked.ticketId, linkedTo: number };
      }),

      tool('create_ticket', 'Raise a NerveCenter ticket, for example for a failed pipeline run (give pipelineId and runId) or a failing data quality check. Check list_tickets first so you do not create a duplicate.', { title: z.string().min(3), description: z.string().optional(), priority: z.enum(['critical', 'high', 'medium', 'low']).optional(), category: z.string().optional(), pipelineId: z.string().optional(), runId: z.string().optional(), tags: z.array(z.string()).optional(), ...reasonField }, async input => {
        const { reason: _reason, ...fields } = input;
        const ticket = await operationsService.createTicket({ ...fields, creator: { type: user.type, id: user.id, name: user.name }, assignee: null, visibility: 'project', scope });
        return { ticketId: ticket.ticketId, title: ticket.title, link: `/tickets/${encodeURIComponent(ticket.ticketId)}` };
      }),

      tool('update_ticket', 'Change a ticket\'s title, description, priority or category, the way a person edits it on the ticket page. The change is written to ServiceNow or Jira when the ticket came from there. To assign, change status or comment, use those tools.', { ticketId: z.string(), title: z.string().min(3).max(200).optional(), description: z.string().max(10000).optional(), priority: z.enum(['critical', 'high', 'medium', 'low']).optional(), category: z.string().max(80).optional(), ...reasonField }, async ({ ticketId, reason: _reason, ...fields }) => {
        const patch = Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
        if (!Object.keys(patch).length) throw new Error('Give at least one of title, description, priority or category');
        const found = await findTicket(ticketId); const updated = await operationsService.updateTicket(found.ticketId, patch, user, scope);
        return { ticketId: found.ticketId, changed: Object.keys(patch), sourceWrite: updated.sourceWrite || null, link: `/tickets/${encodeURIComponent(found.ticketId)}` };
      }),

      /* ---------------------------------------------------------------- routines
       * Scheduled or on-demand work, the same as the Routines page: Sonic sets one up when a person asks
       * for something to happen every day, runs one now, or pauses it. */
      ...(routines ? [
        tool('save_routine', 'Create a routine, or change one, the way the Routines page does: a name, what should happen (objective, in plain words, as the instruction the run will follow), when (a schedule, or none for run-on-demand), how far the run may go (permission) and who is told. Read list_routines first so you change rather than duplicate. Say the routine link in your reply.', {
          name: z.string().min(2).max(60).describe('Short id such as weekday-dq-review; an existing name changes that routine'),
          title: z.string().max(80).optional(),
          objective: z.string().min(10).max(4000),
          schedule: z.object({ kind: z.enum(['daily', 'weekday', 'weekly', 'monthly', 'hours']).optional().describe('weekday = Monday to Friday; hours = every everyHours hours'), time: z.string().regex(/^\d{1,2}:\d{2}$/).optional().describe('24-hour HH:MM'), weekday: z.number().int().min(0).max(6).optional().describe('0 = Sunday, for weekly'), dayOfMonth: z.number().int().min(1).max(28).optional(), everyHours: z.number().int().min(1).max(23).optional(), timezone: z.string().max(60).optional(), cron: z.string().max(60).optional().describe('Five-field cron instead of kind/time') }).optional(),
          permission: z.enum(['read-only', 'policy', 'ask', 'allow']).optional().describe('What each run may do; read-only unless the person asked for changes'),
          notify: z.enum(['on_complete', 'on_failure', 'never']).optional(),
          connections: z.array(z.string().max(60)).max(10).optional().describe('Connections the routine relies on, from list_connections'),
          ...reasonField,
        }, async ({ reason: _reason, ...input }) => { const saved = await (await routinesOf()).save({ ...input, user }); return { name: saved.name, title: saved.title, schedule: saved.scheduleText, nextRunAt: saved.nextRunAt, permission: saved.permission, link: `/routines/${encodeURIComponent(saved.name)}` }; }),
        tool('set_routine_enabled', 'Pause a routine (enabled false) so its schedule stops, or resume it.', { name: z.string().min(1), enabled: z.boolean(), ...reasonField }, async ({ name, enabled }) => { const saved = await (await routinesOf()).setEnabled(name, enabled); return { name: saved.name, enabled: saved.enabled, nextRunAt: saved.nextRunAt, link: `/routines/${encodeURIComponent(saved.name)}` }; }),
        tool('run_routine', 'Run a routine now as its own task, or as a read-only test run that changes nothing. Returns the task link.', { name: z.string().min(1), test: z.boolean().optional(), ...reasonField }, async ({ name, test = false }) => { const run = await (await routinesOf()).run(name, { user, test, scope }); return { taskId: run.id, status: run.status, link: `/tasks/${run.id}` }; }),
      ] : []),

      /* ------------------------------------------------------------- connections */
      ...(connectors ? [
        tool('list_connections', 'The systems NerveCenter is connected to (Databricks, Snowflake, ServiceNow, Jira, GitHub, SharePoint, email and custom MCP servers): each one\'s state (connected, error, not connected), the last test and what uses it.', {}, async () => ({ connections: (await (await connectorsOf() as ToolConnections).list()).map((card:Record<string,unknown>) => ({ id: card.id, title: card.title || card.name || card.id, kind: card.connectionKind || card.kind, state: card.state, reason: card.reason || null, lastTest: card.lastTest || null, usedFor: card.usedFor || [] })), link: '/connectors' })),
        tool('test_connection', 'Test one connection now and report whether it answers. Admins only, the same as the Test button.', { id: z.string().min(1).max(60) }, async ({ id }) => { if (user.role !== 'admin') throw new Error('Only an admin can test a connection; list_connections shows the last test'); return (await connectorsOf()).test(id); }),
      ] : []),

      /* -------------------------------------------------------------------- data */
      ...(boards ? [
        tool('query_data', 'Run one read-only SELECT on Databricks or Snowflake through NerveCenter\'s connection and get the columns and first rows. Use it to look at data during an investigation, check a count, or answer a data question; NerveCenter shows each query in the task with the tables it read. Call describe_board_data first for real table and column names. Bind values with :name (Databricks) or ? (Snowflake) and pass them in params; keep results small (aggregate, LIMIT).', {
          statement: z.string().min(8).max(8000), provider: z.enum(['databricks', 'snowflake']).optional().describe('Leave out to use the first connected platform'),
          params: z.record(z.string(), z.string()).optional(), catalog: z.string().max(80).optional(), schema: z.string().max(80).optional(),
          purpose: z.string().max(200).optional().describe('One line: what this query checks, shown above it'),
        }, async ({ statement, provider, params, catalog, schema, purpose }) => {
          const started = Date.now();
          const result = await boards.preview({ type: 'table', title: purpose || 'Query', source: { kind: 'sql', statement, ...(provider ? { provider } : {}), ...(params ? { params } : {}), ...(catalog ? { catalog } : {}), ...(schema ? { schema } : {}) }, viz: { limit: 200 } }, {}, user, null, scope) as {widget?:{source?:{provider?:string}};columns?:string[];rows:unknown[][]};
          return { purpose: purpose || null, provider: result.widget?.source?.provider || provider || null, tables: tablesIn(statement), columns: result.columns, rows: result.rows.slice(0, 50), rowCount: result.rows.length, ...(result.rows.length > 50 ? { note: `First 50 of ${result.rows.length} rows` } : {}), durationMs: Date.now() - started };
        }),
      ] : []),

      ...(knowledge ? [
        tool('sync_knowledge_base', 'Pull the latest from a Git knowledge base (after its pull requests were merged), the same as Sync on the Knowledge page. Admins only.', { base: z.string().min(1).max(64), ...reasonField }, async ({ base }) => { if (user.role !== 'admin') throw new Error('Only an admin can sync a knowledge base'); const synced = await (await knowledgeOf()).sync(base); return { base: synced?.name || base, lastCommit: synced?.lastCommit || null, lastSyncAt: synced?.lastSyncAt || null }; }),
      ] : []),

      /* ---------------------------------------------------------- showing work
       * Sonic's component catalog (ui-catalog.mjs): plans, findings, cards, views, actions and forms.
       * These tools only draw; data-bound components read through operationsService in this project. */
      ...catalogTools({ tool, task: task as never, readTicket: async (ref: unknown) => {
        const found = await findTicket(ref);
        try { return ticketRow(await operationsService.ticket(found.ticketId, user, scope)); }
        catch (error) { if ([403, 404].includes((error as {statusCode?:number})?.statusCode || 0)) throw new Error(`No ticket ${String(ref).trim()} in this project`); throw error; }
      }, readRuns: async (pipelineId: string, limit: number) => {
        const runs = await operationsService.pipelineRuns(pipelineId, { limit, scope });
        if (!runs.length) throw new Error(`No runs of pipeline ${pipelineId} in this project`);
        return runs.map(run => ({ runId: run.runId, status: run.status, startTime: run.startTime, endTime: run.endTime, durationMs: run.durationMs, failure: clip(run.failureSummary, 300) || null, ticket: run.ticket?.ticketId || null }));
      } }),

      tool('search_knowledge', 'Search the team knowledge base (the knowledge/ folder: runbooks, definitions, decisions) by words. Returns the best matching pages with a snippet and their path so you can Read the ones that matter and cite them. Use it before answering a "how do we", "what counts as", or "who owns" question.', {
        query: z.string().min(2).max(200), limit: z.number().int().min(1).max(10).optional(),
      }, async ({ query, limit = 5 }) => searchKnowledge(await knowledgeDirOf(), query, limit)),

      /* --------------------------------------------------------- lesson capture
       * After verified work the agent decides, on its own, whether a lesson is worth keeping, whether
       * knowledge already has it, and where it belongs (the knowledge skill's lesson capture). Saves are
       * drafts a person keeps or discards on the Knowledge page. */
      ...(knowledgeDrafts ? [
        tool('knowledge_catalog', 'The knowledge map: every knowledge base with its description, and every page with its title, description, type, status, tags, section headings, typed links (brands, upstream, stakeholders, vendor, ...), scalar fields (sla, tier, journey, stale_after, ...) and backlinks (no page bodies). Read it to decide where a lesson belongs; then Read the closest pages before deciding. Filter it to answer "which pipelines feed brand X", "who asked for this" or "what is stale": by type, by a field with a value, by linksTo (pages that link to a page) or by stale.', {
          base: z.string().max(64).optional().describe('One base only, when the full map is too long'),
          type: z.string().max(40).optional().describe('Only pages of this type, e.g. Pipeline, Brand, Stakeholder, Eval Case'),
          field: z.enum([...LINK_FIELDS, ...SCALAR_FIELDS] as [string, ...string[]]).optional().describe('Only pages whose field has `value`, e.g. field brands with value business/brands/brand-x'),
          value: z.string().max(200).optional().describe('The value for `field`: a page path (with or without .md) or plain text'),
          linksTo: z.string().max(300).optional().describe('Only pages with any link to this page, e.g. business/stakeholders/jane-doe'),
          stale: z.boolean().optional().describe('Only pages past their stale_after date'),
        }, async input => (await draftsOf()).catalog(input)),

        tool('update_knowledge', 'Record the outcome of the lesson capture after verified work. decision "skip" writes nothing (already covered, one-off, not verified, or nothing reusable); "append" adds a section to an existing page, under `section` when given; "create" writes a new page. Saves are drafts: the page gets status draft (or the section draft markers) and a person keeps or discards it on the Knowledge page. Additive only; never repeat what the page already says. Skip when a page (or an unreviewed draft on it) already has the same symptom, cause and fix: another occurrence is not a new lesson. A different cause behind the same symptom is a new entry. Give the content without draft markers, and leave the step out of your reply. To record relationships (the brands a pipeline serves, its upstream feeds, a stakeholder\'s tier, an SLA), give `fields`; an append may give only fields. When a person corrects you or teaches you something in the chat, save it with origin "correction" and taughtBy their name.', {
          decision: z.enum(['create', 'append', 'skip']),
          base: z.string().max(64).optional().describe('Knowledge base short name from knowledge_catalog; omit only when there is no base yet'),
          path: z.string().max(300).optional().describe('Page inside the base, e.g. known-issues/pipelines.md'),
          section: z.string().max(200).optional().describe('For append: the heading to add under; omit to add at the end of the page'),
          title: z.string().max(120).optional().describe('Title of the new page, or of the added section'),
          description: z.string().max(300).optional().describe('For create: one sentence on what the page covers, used by the index'),
          type: z.string().max(40).optional().describe('For create: the same type as neighbouring pages, e.g. Playbook, Concept'),
          tags: z.array(z.string().max(40)).max(8).optional(),
          owner: z.string().max(80).optional().describe('Owner who reviews it, when known'),
          content: z.string().max(12000).optional().describe('The lesson in markdown, following the target page\'s structure'),
          placementReason: z.string().min(3).max(600).describe('One sentence: why here (quote the description it matched), or why skipped'),
          checked: z.array(z.string().max(300)).max(12).describe('Knowledge paths you read and compared against'),
          sourceTicket: z.string().max(80).optional().describe('Ticket id the lesson came from (required when it came from a ticket); the task id otherwise'),
          fields: z.record(z.string(), z.union([z.string().max(200), z.array(z.string().max(200)).max(20)])).optional().describe(`Typed frontmatter. Link fields take page paths or names: ${LINK_FIELDS.join(', ')}. Scalar fields take one value: ${SCALAR_FIELDS.join(', ')}. On append, lists are merged and scalars set`),
          origin: z.enum(['lesson', 'correction', 'interview', 'document', 'pass', 'eval']).optional().describe('Where it came from: lesson (default, after verified work), correction (a person corrected or taught you in this chat), interview, document, pass (the weekly knowledge pass) or eval (an eval case)'),
          taughtBy: z.string().max(80).optional().describe('With origin correction or interview: the name of the person who said it'),
          ...reasonField,
        }, async ({ reason: _reason, ...input }) => (await draftsOf()).write(input, { taskId: task?.id || null, actor: user, allowShared: Boolean(task?.context?.sharedBase) && String(input.base || '').toLowerCase() === task?.context?.knowledgeBase })),
      ] : []),

      /* ------------------------------------------------- knowledge evals and pass
       * SPEC-knowledge-06 and 07: an eval run and the weekly digest are files in the task's own folder, indexed per
       * project so the Knowledge page can show scores over time. NerveCenter computes the score, never the model. */
      ...(knowledge ? [
        tool('record_eval_run', 'Record one eval run of a journey, after grading each kept eval case with the knowledge-eval skill. Give every case you ran with pass, partial or fail, a short note on what was wrong, and the pages the answer should have used. NerveCenter computes the score and keeps the history; say the score and its change in your reply. Not for drafting eval cases: those are update_knowledge with origin eval.', {
          journey: z.string().min(1).max(60).describe('The journey of the cases, from their journey field, e.g. late-pipeline'),
          cases: z.array(z.object({
            path: z.string().max(300).describe('The case page, e.g. evals/late-pipeline/inc-1234.md'),
            result: z.enum(['pass', 'partial', 'fail']),
            note: z.string().max(300).optional().describe('What the answer got wrong or missed, in one sentence'),
            missing: z.array(z.string().max(300)).max(5).optional().describe('Pages the answer should have read'),
          })).min(1).max(60),
          ...reasonField,
        }, async ({ reason: _reason, journey, cases }) => {
          if (!task?.id) throw new Error('An eval run is recorded from a task');
          return (await knowledgeOf()).journeys.recordRun({ journey, cases }, { taskId: task.id, taskDir: await taskDirOf() });
        }),
        tool('record_knowledge_digest', 'Record the weekly knowledge digest, once, at the end of the knowledge-pass routine: drafts waiting, stale pages, typed fields that drifted from the live systems, changed source documents, gaps found in the week\'s work, eval movements and a summary. Only works in a run of the knowledge-pass routine.', {
          drafts: z.object({ waiting: z.number().int().min(0), fromCorrections: z.number().int().min(0).optional(), fromLessons: z.number().int().min(0).optional(), merged: z.number().int().min(0).optional() }),
          stale: z.array(z.object({ path: z.string().max(300), staleAfter: z.string().max(20).optional() })).max(20).optional(),
          drift: z.array(z.object({ path: z.string().max(300), field: z.string().max(60), page: z.string().max(200), live: z.string().max(200) })).max(20).optional().describe('A typed field whose value on the page differs from the live system'),
          changedDocs: z.array(z.object({ path: z.string().max(300), source: z.string().max(300) })).max(20).optional().describe('Pages whose cited source document changed after the page was updated'),
          gaps: z.array(z.object({ text: z.string().max(300), journey: z.string().max(60).optional(), tasks: z.array(z.string().max(40)).max(10).optional() })).max(10).optional().describe('Where Sonic got stuck or was corrected this week, with the task ids'),
          evals: z.array(z.object({ journey: z.string().max(60), score: z.number().min(0).max(100), previous: z.number().min(0).max(100).optional() })).max(40).optional(),
          weakest: z.string().max(60).optional().describe('The journey with the lowest score'),
          summary: z.string().min(1).max(400).describe('One paragraph: what to keep, what is stale, where accuracy moved'),
          ...reasonField,
        }, async ({ reason: _reason, ...input }) => {
          const routine = task?.context?.routine;
          if (!task?.id || routine?.name !== PASS_ROUTINE) throw new Error('The digest belongs to the weekly knowledge pass');
          if (routine.test) throw new Error('A test run of the weekly knowledge pass records no digest; say what it would record');
          return (await knowledgeOf()).journeys.recordDigest(input, { taskId: task.id, taskDir: await taskDirOf() });
        }),
      ] : []),

      /* --------------------------------------------------------- knowledge setup
       * The interview guide of a knowledge setup task (SPEC-knowledge-03 FR-6): a file in the task's own folder,
       * so it runs like other task files. Other tasks get a plain error rather than a guide nobody reads. */
      tool('update_interview_guide', 'Add questions to, or update, the interview guide of this knowledge setup task. The build lead downloads it, asks the questions in group interviews with the team and uploads the transcript here. Leave out id for a new question (it gets the next G-<n>); give the id of an existing question to change only the fields you send, for example its status, answer, cites and pages after a transcript. Only works in a knowledge setup task.', {
        questions: z.array(z.object(guideQuestionShape)).min(1).max(MAX_GUIDE_QUESTIONS),
      }, async ({ questions }) => {
        if (!task?.context?.knowledgeSetup || !task.id) throw new Error('The interview guide belongs to a knowledge setup task');
        if (!workspaces) throw new Error('Task files are not available here');
        const dir = await (await forProject(workspaces, scope) as {taskDir(id:string):Promise<string>}).taskDir(task.id);
        return guideSummary(await upsertGuide(dir, questions));
      }),

      /* ------------------------------------------------------------------ boards
       * Dashboards people build with the agent and publish for the team. A board is a saved spec:
       * filters plus widgets over NerveCenter sources or one read-only SQL statement. */
      ...(boards ? boardTools({ tool, boards, user, scope, agentName }) : []),

      /* ------------------------------------------------------------ tested fixes
       * SPEC-tasks-13: copy, change and test a table in the sandbox schema, propose the fix with what it changes
       * (NerveCenter computes the diff and the board previews), then apply exactly that after approval. */
      ...(fixes && task?.id ? fixTools({ tool, fixes, task: task as {id:string;projectId?:string}, user, scope }) : []),
    ];

    return sdk.createSdkMcpServer({ name: 'nervecenter', version: '1.0.0', tools });
  };
}
