import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { RUNTIME_DIR, config } from '../config.mjs';
import { ensureDir, exists, readJson, writeJson } from '../lib/fs.mjs';
import { getPgPool, ensureControlSchema } from '../storage/postgres.mjs';
import { now, clone, httpError } from '../lib/util.mjs';
import { assertScope, filterByScope, scopeIds } from '../projects/project-access.mjs';

// Tasks (one agent session each), their event stream, and the Inbox (approvals, questions,
// notifications). Files locally, Postgres when OPS_METADATA_STORE=postgres.

export interface ProjectScope {
  all: boolean;
  projectIds: readonly string[];
}

export interface TaskRecord {
  id: string;
  projectId: string;
  type: string;
  status: string;
  createdAt?: string;
  updatedAt?: string;
  archived?: boolean;
  [key: string]: unknown;
}

export type TaskInput = TaskRecord;
export type TaskPatch = Partial<TaskRecord>;

export interface TaskEvent {
  type: string;
  id?: string;
  at?: string;
  taskId?: string;
  seq?: number;
  [key: string]: unknown;
}

export interface StoredTaskEvent extends TaskEvent {
  id: string;
  at: string;
  taskId: string;
  seq: number;
}

export interface InboxItem {
  id: string;
  projectId: string;
  status: string;
  kind: string;
  taskId?: string | null;
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
}

export interface InboxItemInput {
  projectId: string;
  kind: string;
  taskId?: string | null;
  id?: string;
  createdAt?: string;
  updatedAt?: string;
  status?: string;
  [key: string]: unknown;
}
export type InboxItemPatch = Partial<InboxItem>;
export type ArchiveFilter = 'all' | 'true' | 'false';

export interface TaskListFilters {
  type?: string;
  status?: string;
  archived?: ArchiveFilter;
  limit?: number;
  offset?: number;
  q?: string;
}

export interface InboxListFilters {
  status?: string;
  kind?: string;
  taskId?: string;
  limit?: number;
  offset?: number;
  view?: 'all' | 'needs_action' | 'done';
}

export interface TaskPage { items: TaskRecord[]; total: number; active: number; waiting: number }
export interface InboxPage { items: InboxItem[]; total: number; pending: number; approvals: number; unread: number }

export interface EventListFilters {
  afterSeq?: number;
  limit?: number;
}

export interface TaskInboxStore {
  init(): Promise<void>;
  nextTaskId(): Promise<string>;
  createTask(task: TaskInput): Promise<TaskRecord>;
  createScheduledTask(task: TaskInput, scheduledJobKey: string): Promise<{ task: TaskRecord; created: boolean }>;
  createTicketTriageTask(task: TaskInput, autoTriageKey: string): Promise<{ task: TaskRecord; created: boolean }>;
  findTicketTriageTask(projectId: string, autoTriageKey: string): Promise<TaskRecord | null>;
  getTask(id: string): Promise<TaskRecord | null>;
  updateTask(id: string, patch: TaskPatch): Promise<TaskRecord>;
  appendPendingMessage(id: string, message: Record<string, unknown>): Promise<TaskRecord>;
  claimRun(id: string, messageId: string | null, startedAt: string): Promise<TaskRecord | null>;
  deleteTask(id: string): Promise<boolean>;
  listTasks(scope: ProjectScope, filters?: TaskListFilters): Promise<TaskRecord[]>;
  pageTasks(scope: ProjectScope, filters?: TaskListFilters): Promise<TaskPage>;
  appendEvent(taskId: string, event: TaskEvent): Promise<StoredTaskEvent>;
  listEvents(taskId: string, filters?: EventListFilters): Promise<StoredTaskEvent[]>;
  truncateEvents(taskId: string, fromSeq: number): Promise<number>;
  createInboxItem(item: InboxItemInput): Promise<InboxItem>;
  getInboxItem(id: string): Promise<InboxItem | null>;
  updateInboxItem(id: string, patch: InboxItemPatch): Promise<InboxItem>;
  listInbox(scope: ProjectScope, filters?: InboxListFilters): Promise<InboxItem[]>;
  pageInbox(scope: ProjectScope, filters?: InboxListFilters): Promise<InboxPage>;
  readAllInbox(scope: ProjectScope, readBy: Record<string, unknown>): Promise<number>;
}

interface FileTaskIndex {
  counter: number;
  tasks: Record<string, TaskRecord>;
}

interface FileInboxIndex {
  items: Record<string, InboxItem>;
}

interface DataRow<T> {
  data: T;
}

interface SequenceRow {
  n: string | number;
}

interface TaskCountRow { total: number; active: number; waiting: number }
interface InboxCountRow { total?: number; pending: number; approvals: number; unread: number }

interface EventSequenceRow {
  seq: string | number;
}

interface QueryResult<T> {
  rows: T[];
  rowCount: number | null;
}

interface TaskPgPool {
  query<T = Record<string, unknown>>(text: string, values?: readonly unknown[]): Promise<QueryResult<T>>;
}

const boundedLimit = (value: number | undefined, fallback = 100, max = 1000): number => Math.max(1, Math.min(max, Number(value) || fallback));
// The project lives in a column; the record carries it too, so a row always reads back with projectId.
const PROJECT_DATA = "data || jsonb_build_object('projectId', project_id) AS data";
const requireProject = (record: { projectId?: string }, what: string): void => { if (!record?.projectId) throw httpError(500, `A ${what} needs a project.`); };
const matches = <T extends Record<string, unknown>>(item: T, filters: Record<string, string | undefined>): boolean => Object.entries(filters).every(([key, value]) => value === undefined || value === 'all' || item[key] === value);
const field = (value: unknown, ...keys: string[]): string => {
  let current = value;
  for (const key of keys) current = current && typeof current === 'object' ? (current as Record<string, unknown>)[key] : undefined;
  return typeof current === 'string' ? current : '';
};
const taskSearchText = (task: TaskRecord): string => {
  const number = field(task, 'context', 'ticket', 'externalReference', 'number') || field(task, 'context', 'ticket', 'ticketId');
  const page = field(task, 'context', 'page', 'name');
  const routine = field(task, 'context', 'routine', 'name');
  const trigger = field(task, 'context', 'alert', 'trigger');
  const hasAlert = Boolean((task.context as { alert?: unknown } | undefined)?.alert);
  const typeDetail = task.type === 'ticket' ? number : task.type === 'routine' ? routine : task.type === 'alert' ? field(task, 'context', 'alert', 'subject', 'name') : page;
  const person = field(task, 'createdBy', 'name') || field(task, 'createdBy', 'id');
  const system = !field(task, 'createdBy', 'id') || field(task, 'createdBy', 'id') === 'system';
  const startedBy = task.type === 'routine' ? `Routine · ${field(task, 'context', 'routine', 'title') || routine || field(task, 'title')}`
    : task.type === 'alert' || hasAlert ? `Automation · ${{ pipelineFailed: 'pipeline failed', pipelineLate: 'pipeline late', dqFailed: 'check failed' }[trigger as 'pipelineFailed' | 'pipelineLate' | 'dqFailed'] || 'alert'}`
    : task.type === 'ticket' ? `${system ? 'Automatic triage' : person}${number ? ` · ${system ? '' : 'from ticket '}${number}` : ''}`
    : system ? 'NerveCenter' : `${person}${page ? ` · ${page}` : ''}`;
  return [field(task, 'title'), field(task, 'summary'), task.id, typeDetail, startedBy].join(' ').toLowerCase();
};
const taskGroup = (status: string): number => status === 'waiting' ? 0 : status === 'running' || status === 'queued' ? 1 : 2;
const byTaskPage = (a: TaskRecord, b: TaskRecord): number => taskGroup(a.status) - taskGroup(b.status) || String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')) || a.id.localeCompare(b.id);
const needsAction = (item: InboxItem): boolean => item.status === 'pending' && (item.kind === 'approval' || item.kind === 'question');
const inboxView = (item: InboxItem, view?: InboxListFilters['view']): boolean => !view || view === 'all' || (view === 'needs_action' ? needsAction(item) : !needsAction(item));
const byInboxPage = (a: InboxItem, b: InboxItem): number => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id);
const inboxCounts = (items: InboxItem[]) => ({ pending: items.filter(needsAction).length, approvals: items.filter(item => item.kind === 'approval' && item.status === 'pending').length, unread: items.filter(item => item.kind === 'notification' && item.status === 'pending').length });
const collapseNotifications = (items: InboxItem[]): InboxItem[] => { const seen = new Set<string>(); return items.filter(item => { if (item.kind !== 'notification') return true; const key = item.taskId || item.id; if (seen.has(key)) return false; seen.add(key); return true; }); };
const TASK_NUMBER_SQL = "COALESCE(data #>> '{context,ticket,externalReference,number}', data #>> '{context,ticket,ticketId}', '')";
const TASK_PAGE_SQL = "COALESCE(data #>> '{context,page,name}', '')";
const TASK_PERSON_SQL = "COALESCE(data #>> '{createdBy,name}', data #>> '{createdBy,id}', '')";
const TASK_TYPE_DETAIL_SQL = `CASE type WHEN 'ticket' THEN ${TASK_NUMBER_SQL} WHEN 'routine' THEN COALESCE(data #>> '{context,routine,name}', '') WHEN 'alert' THEN COALESCE(data #>> '{context,alert,subject,name}', '') ELSE ${TASK_PAGE_SQL} END`;
const TASK_STARTED_BY_SQL = `CASE
  WHEN type='routine' THEN 'Routine · ' || COALESCE(data #>> '{context,routine,title}', data #>> '{context,routine,name}', data->>'title', '')
  WHEN type='alert' OR jsonb_typeof(data #> '{context,alert}')='object' THEN 'Automation · ' || CASE data #>> '{context,alert,trigger}' WHEN 'pipelineFailed' THEN 'pipeline failed' WHEN 'pipelineLate' THEN 'pipeline late' WHEN 'dqFailed' THEN 'check failed' ELSE 'alert' END
  WHEN type='ticket' THEN CASE WHEN COALESCE(data #>> '{createdBy,id}', 'system')='system' THEN 'Automatic triage' || CASE WHEN ${TASK_NUMBER_SQL}<>'' THEN ' · ' || ${TASK_NUMBER_SQL} ELSE '' END ELSE ${TASK_PERSON_SQL} || CASE WHEN ${TASK_NUMBER_SQL}<>'' THEN ' · from ticket ' || ${TASK_NUMBER_SQL} ELSE '' END END
  WHEN COALESCE(data #>> '{createdBy,id}', 'system')='system' THEN 'NerveCenter'
  ELSE ${TASK_PERSON_SQL} || CASE WHEN ${TASK_PAGE_SQL}<>'' THEN ' · ' || ${TASK_PAGE_SQL} ELSE '' END END`;
const TASK_SEARCH_SQL = `concat_ws(' ', data->>'title', data->>'summary', id, ${TASK_TYPE_DETAIL_SQL}, ${TASK_STARTED_BY_SQL})`;
// The file store retains the existing on-disk records; migrations own their shape.
const readTaskIndex = (file: string): Promise<FileTaskIndex> => readJson(file);
const readInboxIndex = (file: string): Promise<FileInboxIndex> => readJson(file);
const readStoredEvents = (file: string): Promise<StoredTaskEvent[]> => readJson(file);

export class FileTaskStore implements TaskInboxStore {
  root: string;
  indexFile: string;
  inboxFile: string;
  private queue: Promise<void> = Promise.resolve();

  constructor(root = path.join(RUNTIME_DIR, 'tasks')) { this.root = root; this.indexFile = path.join(root, 'index.json'); this.inboxFile = path.join(root, 'inbox.json'); }
  async init(): Promise<void> { await ensureDir(path.join(this.root, 'events')); if (!(await exists(this.indexFile))) await writeJson(this.indexFile, { counter: 1000, tasks: {} }); if (!(await exists(this.inboxFile))) await writeJson(this.inboxFile, { items: {} }); }
  private async exclusive<T>(task: () => Promise<T>): Promise<T> { const prior = this.queue; let release!: () => void; this.queue = new Promise<void>(resolve => { release = resolve; }); await prior; try { return await task(); } finally { release(); } }
  private eventsFile(taskId: string): string { return path.join(this.root, 'events', `${String(taskId).replace(/[^A-Za-z0-9._-]/g, '_')}.json`); }

  async nextTaskId(): Promise<string> { return this.exclusive(async () => { const s = await readTaskIndex(this.indexFile); s.counter = Number(s.counter || 1000) + 1; await writeJson(this.indexFile, s); return `T-${s.counter}`; }); }
  async createTask(task: TaskInput): Promise<TaskRecord> { requireProject(task, 'task'); return this.exclusive(async () => { const s = await readTaskIndex(this.indexFile); s.tasks[task.id] = clone(task); await writeJson(this.indexFile, s); return clone(task); }); }
  async createScheduledTask(task: TaskInput, scheduledJobKey: string): Promise<{ task: TaskRecord; created: boolean }> {
    requireProject(task, 'task');
    if (field(task, 'context', 'routine', 'scheduledJobKey') !== scheduledJobKey) throw new TypeError('Scheduled task key must match its routine context');
    return this.exclusive(async () => {
      const s = await readTaskIndex(this.indexFile);
      const existing = Object.values(s.tasks || {}).find(item => item.projectId === task.projectId && field(item, 'context', 'routine', 'scheduledJobKey') === scheduledJobKey);
      if (existing) return { task: clone(existing), created: false };
      s.tasks[task.id] = clone(task); await writeJson(this.indexFile, s);
      return { task: clone(task), created: true };
    });
  }
  async createTicketTriageTask(task: TaskInput, autoTriageKey: string): Promise<{ task: TaskRecord; created: boolean }> {
    requireProject(task, 'task');
    if (field(task, 'context', 'ticket', 'autoTriageKey') !== autoTriageKey) throw new TypeError('Ticket triage key must match its task context');
    return this.exclusive(async () => {
      const s = await readTaskIndex(this.indexFile);
      const existing = Object.values(s.tasks || {}).find(item => item.projectId === task.projectId && field(item, 'context', 'ticket', 'autoTriageKey') === autoTriageKey);
      if (existing) return { task: clone(existing), created: false };
      s.tasks[task.id] = clone(task); await writeJson(this.indexFile, s);
      return { task: clone(task), created: true };
    });
  }
  async findTicketTriageTask(projectId: string, autoTriageKey: string): Promise<TaskRecord | null> {
    const s = await readTaskIndex(this.indexFile);
    const task = Object.values(s.tasks || {}).find(item => item.projectId === projectId && field(item, 'context', 'ticket', 'autoTriageKey') === autoTriageKey);
    return task ? clone(task) : null;
  }
  async getTask(id: string): Promise<TaskRecord | null> { const s = await readTaskIndex(this.indexFile); return s.tasks?.[id] ? clone(s.tasks[id]) : null; }
  async updateTask(id: string, patch: TaskPatch): Promise<TaskRecord> { return this.exclusive(async () => { const s = await readTaskIndex(this.indexFile); if (!s.tasks?.[id]) throw new Error(`Task not found: ${id}`); s.tasks[id] = { ...s.tasks[id], ...clone(patch), projectId: s.tasks[id].projectId, updatedAt: now() }; await writeJson(this.indexFile, s); return clone(s.tasks[id]); }); }
  async appendPendingMessage(id: string, message: Record<string, unknown>): Promise<TaskRecord> { return this.exclusive(async () => { const s = await readTaskIndex(this.indexFile); const task = s.tasks?.[id]; if (!task) throw new Error(`Task not found: ${id}`); task.pendingMessages = [...(Array.isArray(task.pendingMessages) ? task.pendingMessages : []), clone(message)]; task.updatedAt = now(); await writeJson(this.indexFile, s); return clone(task); }); }
  async claimRun(id: string, messageId: string | null, startedAt: string): Promise<TaskRecord | null> { return this.exclusive(async () => { const s = await readTaskIndex(this.indexFile); const task = s.tasks?.[id]; if (!task || task.status === 'cancelled') return null; const pending = Array.isArray(task.pendingMessages) ? task.pendingMessages as Array<{id?:string}> : []; if (messageId ? !pending.some(item => item.id === messageId) : !task.pendingStart) return null; task.status = 'running'; task.startedAt ||= startedAt; task.error = null; task.updatedAt = now(); if (messageId) task.pendingMessages = pending.filter(item => item.id !== messageId); else task.pendingStart = null; await writeJson(this.indexFile, s); return clone(task); }); }
  /** Remove a task, its events and its Inbox items. The caller makes sure it is not running. */
  async deleteTask(id: string): Promise<boolean> { return this.exclusive(async () => { const s = await readTaskIndex(this.indexFile); if (!s.tasks?.[id]) return false; delete s.tasks[id]; await writeJson(this.indexFile, s); await fs.rm(this.eventsFile(id), { force: true }); const inbox = await readInboxIndex(this.inboxFile); for (const [itemId, item] of Object.entries(inbox.items || {})) if (item.taskId === id) delete inbox.items[itemId]; await writeJson(this.inboxFile, inbox); return true; }); }
  // Archived tasks are hidden from the default list (same as gone, but recoverable); pass
  // archived=true to see only archived tasks, or archived=all to see both.
  async listTasks(scope: ProjectScope, { type, status, archived, limit }: TaskListFilters = {}): Promise<TaskRecord[]> { assertScope(scope); const s = await readTaskIndex(this.indexFile); const scoped: TaskRecord[] = filterByScope(scope, Object.values(s.tasks || {})); return scoped.filter(task => matches(task, { type, status })).filter(task => archived === 'all' ? true : archived === 'true' ? Boolean(task.archived) : !task.archived).sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt))).slice(0, boundedLimit(limit)).map(clone); }
  async pageTasks(scope: ProjectScope, { type, status, archived, q, limit, offset = 0 }: TaskListFilters = {}): Promise<TaskPage> {
    assertScope(scope);
    const s = await readTaskIndex(this.indexFile);
    const scoped: TaskRecord[] = filterByScope(scope, Object.values(s.tasks || {}));
    const base = scoped.filter(task => matches(task, { type, status })).filter(task => archived === 'all' ? true : archived === 'true' ? Boolean(task.archived) : !task.archived);
    const term = (q || '').trim().toLowerCase();
    const rows = (term ? base.filter(task => taskSearchText(task).includes(term)) : base).sort(byTaskPage);
    return { items: rows.slice(offset, offset + boundedLimit(limit)).map(clone), total: rows.length, active: base.filter(task => task.status === 'running' || task.status === 'queued').length, waiting: base.filter(task => task.status === 'waiting').length };
  }

  async appendEvent(taskId: string, event: TaskEvent): Promise<StoredTaskEvent> {
    return this.exclusive(async () => {
      const file = this.eventsFile(taskId);
      const events = (await exists(file)) ? await readStoredEvents(file) : [];
      const stored: StoredTaskEvent = { id: randomUUID(), at: now(), ...clone(event), taskId, seq: events.length + 1 };
      events.push(stored); await writeJson(file, events); return stored;
    });
  }
  async listEvents(taskId: string, { afterSeq = 0, limit = 2000 }: EventListFilters = {}): Promise<StoredTaskEvent[]> { const file = this.eventsFile(taskId); if (!(await exists(file))) return []; return (await readStoredEvents(file)).filter(event => event.seq > afterSeq).slice(0, boundedLimit(limit, 2000, 10000)); }
  /** Drop every event from `fromSeq` on, so a conversation can be rewound to an edited message. Returns how many went. */
  async truncateEvents(taskId: string, fromSeq: number): Promise<number> { return this.exclusive(async () => { const file = this.eventsFile(taskId); if (!(await exists(file))) return 0; const events = await readStoredEvents(file); const kept = events.filter(event => event.seq < fromSeq); await writeJson(file, kept); return events.length - kept.length; }); }

  async createInboxItem(item: InboxItemInput): Promise<InboxItem> { requireProject(item, 'inbox item'); return this.exclusive(async () => { const s = await readInboxIndex(this.inboxFile); const stored: InboxItem = { id: `I-${randomUUID().slice(0, 8)}`, createdAt: now(), updatedAt: now(), status: 'pending', ...clone(item) }; s.items[stored.id] = stored; await writeJson(this.inboxFile, s); return clone(stored); }); }
  async getInboxItem(id: string): Promise<InboxItem | null> { const s = await readInboxIndex(this.inboxFile); return s.items?.[id] ? clone(s.items[id]) : null; }
  async updateInboxItem(id: string, patch: InboxItemPatch): Promise<InboxItem> { return this.exclusive(async () => { const s = await readInboxIndex(this.inboxFile); if (!s.items?.[id]) throw new Error(`Inbox item not found: ${id}`); s.items[id] = { ...s.items[id], ...clone(patch), projectId: s.items[id].projectId, updatedAt: now() }; await writeJson(this.inboxFile, s); return clone(s.items[id]); }); }
  async listInbox(scope: ProjectScope, { status, kind, taskId, limit }: InboxListFilters = {}): Promise<InboxItem[]> { assertScope(scope); const s = await readInboxIndex(this.inboxFile); const scoped: InboxItem[] = filterByScope(scope, Object.values(s.items || {})); return scoped.filter(item => matches(item, { status, kind, taskId })).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, boundedLimit(limit, 200)).map(clone); }
  async pageInbox(scope: ProjectScope, { status, kind, taskId, view, limit, offset = 0 }: InboxListFilters = {}): Promise<InboxPage> {
    assertScope(scope);
    const s = await readInboxIndex(this.inboxFile);
    const scoped: InboxItem[] = filterByScope(scope, Object.values(s.items || {}));
    const rows = collapseNotifications(scoped.filter(item => matches(item, { status, kind, taskId }) && inboxView(item, view)).sort(byInboxPage));
    return { items: rows.slice(offset, offset + boundedLimit(limit, 200)).map(clone), total: rows.length, ...inboxCounts(scoped) };
  }
  async readAllInbox(scope: ProjectScope, readBy: Record<string, unknown>): Promise<number> { assertScope(scope); return this.exclusive(async () => {
    const s = await readInboxIndex(this.inboxFile);
    let updated = 0;
    for (const item of filterByScope(scope, Object.values(s.items || {}))) if (item.kind === 'notification' && item.status === 'pending') { s.items[item.id] = { ...item, status: 'read', readBy, updatedAt: now() }; updated += 1; }
    if (updated) await writeJson(this.inboxFile, s);
    return updated;
  }); }
}

export class PostgresTaskStore implements TaskInboxStore {
  private pool?: TaskPgPool;
  constructor(pool?: TaskPgPool) { this.pool = pool; }
  async init(): Promise<void> { this.pool ||= await getPgPool(); await ensureControlSchema(this.pool); }
  private getPool(): TaskPgPool { return this.pool!; }
  async nextTaskId(): Promise<string> { const { rows } = await this.getPool().query<SequenceRow>("SELECT nextval('ops_task_seq') AS n"); return `T-${rows[0].n}`; }
  async createTask(task: TaskInput): Promise<TaskRecord> { requireProject(task, 'task'); const { rows } = await this.getPool().query<DataRow<TaskRecord>>(`INSERT INTO ops_tasks(id,type,status,data,created_at,updated_at,project_id) VALUES($1,$2,$3,$4::jsonb,$5,$5,$6) RETURNING ${PROJECT_DATA}`, [task.id, task.type, task.status, JSON.stringify(task), task.createdAt || now(), task.projectId]); return rows[0].data; }
  async createScheduledTask(task: TaskInput, scheduledJobKey: string): Promise<{ task: TaskRecord; created: boolean }> {
    requireProject(task, 'task');
    if (field(task, 'context', 'routine', 'scheduledJobKey') !== scheduledJobKey) throw new TypeError('Scheduled task key must match its routine context');
    const { rows } = await this.getPool().query<DataRow<TaskRecord>>(`INSERT INTO ops_tasks(id,type,status,data,created_at,updated_at,project_id) VALUES($1,$2,$3,$4::jsonb,$5,$5,$6) ON CONFLICT (project_id, ((data #>> '{context,routine,scheduledJobKey}'))) WHERE (data #>> '{context,routine,scheduledJobKey}') IS NOT NULL DO NOTHING RETURNING ${PROJECT_DATA}`, [task.id, task.type, task.status, JSON.stringify(task), task.createdAt || now(), task.projectId]);
    if (rows[0]) return { task: rows[0].data, created: true };
    const existing = await this.getPool().query<DataRow<TaskRecord>>(`SELECT ${PROJECT_DATA} FROM ops_tasks WHERE project_id=$1 AND data #>> '{context,routine,scheduledJobKey}'=$2 LIMIT 1`, [task.projectId, scheduledJobKey]);
    if (!existing.rows[0]) throw new Error('Scheduled task conflict could not be resolved');
    return { task: existing.rows[0].data, created: false };
  }
  async createTicketTriageTask(task: TaskInput, autoTriageKey: string): Promise<{ task: TaskRecord; created: boolean }> {
    requireProject(task, 'task');
    if (field(task, 'context', 'ticket', 'autoTriageKey') !== autoTriageKey) throw new TypeError('Ticket triage key must match its task context');
    const { rows } = await this.getPool().query<DataRow<TaskRecord>>(`INSERT INTO ops_tasks(id,type,status,data,created_at,updated_at,project_id) VALUES($1,$2,$3,$4::jsonb,$5,$5,$6) ON CONFLICT (project_id, ((data #>> '{context,ticket,autoTriageKey}'))) WHERE (data #>> '{context,ticket,autoTriageKey}') IS NOT NULL DO NOTHING RETURNING ${PROJECT_DATA}`, [task.id, task.type, task.status, JSON.stringify(task), task.createdAt || now(), task.projectId]);
    if (rows[0]) return { task: rows[0].data, created: true };
    const existing = await this.findTicketTriageTask(task.projectId, autoTriageKey);
    if (!existing) throw new Error('Ticket triage task conflict could not be resolved');
    return { task: existing, created: false };
  }
  async findTicketTriageTask(projectId: string, autoTriageKey: string): Promise<TaskRecord | null> {
    const { rows } = await this.getPool().query<DataRow<TaskRecord>>(`SELECT ${PROJECT_DATA} FROM ops_tasks WHERE project_id=$1 AND data #>> '{context,ticket,autoTriageKey}'=$2 LIMIT 1`, [projectId, autoTriageKey]);
    return rows[0]?.data || null;
  }
  async getTask(id: string): Promise<TaskRecord | null> { const { rows } = await this.getPool().query<DataRow<TaskRecord>>(`SELECT ${PROJECT_DATA} FROM ops_tasks WHERE id=$1`, [id]); return rows[0]?.data || null; }
  async updateTask(id: string, patch: TaskPatch): Promise<TaskRecord> { const { rows } = await this.getPool().query<DataRow<TaskRecord>>(`UPDATE ops_tasks SET type=COALESCE($2::jsonb->>'type',type),status=COALESCE($2::jsonb->>'status',status),data=data || ($2::jsonb - 'projectId') || jsonb_build_object('updatedAt',now()),updated_at=now() WHERE id=$1 RETURNING ${PROJECT_DATA}`, [id, JSON.stringify(patch)]); if (!rows[0]) throw new Error(`Task not found: ${id}`); return rows[0].data; }
  async appendPendingMessage(id: string, message: Record<string, unknown>): Promise<TaskRecord> { const { rows } = await this.getPool().query<DataRow<TaskRecord>>(`UPDATE ops_tasks SET data=jsonb_set(data,'{pendingMessages}',COALESCE(data->'pendingMessages','[]'::jsonb) || $2::jsonb) || jsonb_build_object('updatedAt',now()),updated_at=now() WHERE id=$1 RETURNING ${PROJECT_DATA}`, [id, JSON.stringify(message)]); if (!rows[0]) throw new Error(`Task not found: ${id}`); return rows[0].data; }
  async claimRun(id: string, messageId: string | null, startedAt: string): Promise<TaskRecord | null> { const { rows } = await this.getPool().query<DataRow<TaskRecord>>(`UPDATE ops_tasks SET status='running',data=data || jsonb_build_object('status','running','startedAt',COALESCE(data->>'startedAt',$3),'error',null,'updatedAt',now(),'pendingStart',CASE WHEN $2::text IS NULL THEN 'null'::jsonb ELSE COALESCE(data->'pendingStart','null'::jsonb) END,'pendingMessages',CASE WHEN $2::text IS NULL THEN COALESCE(data->'pendingMessages','[]'::jsonb) ELSE COALESCE((SELECT jsonb_agg(item ORDER BY ord) FROM jsonb_array_elements(COALESCE(data->'pendingMessages','[]'::jsonb)) WITH ORDINALITY AS queued(item,ord) WHERE item->>'id' <> $2),'[]'::jsonb) END),updated_at=now() WHERE id=$1 AND status<>'cancelled' AND (($2::text IS NULL AND jsonb_typeof(data->'pendingStart')='object') OR ($2::text IS NOT NULL AND EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(data->'pendingMessages','[]'::jsonb)) item WHERE item->>'id'=$2))) RETURNING ${PROJECT_DATA}`, [id, messageId, startedAt]); return rows[0]?.data || null; }
  async deleteTask(id: string): Promise<boolean> { await this.getPool().query("DELETE FROM ops_inbox WHERE data->>'taskId'=$1", [id]); await this.getPool().query('DELETE FROM ops_task_events WHERE task_id=$1', [id]); const { rowCount } = await this.getPool().query('DELETE FROM ops_tasks WHERE id=$1', [id]); return (rowCount ?? 0) > 0; }
  async listTasks(scope: ProjectScope, { type, status, archived, limit }: TaskListFilters = {}): Promise<TaskRecord[]> { const ids = scopeIds(scope); const clauses: string[] = []; const params: unknown[] = []; if (ids) { params.push(ids); clauses.push(`project_id = ANY($${params.length})`); } if (type && type !== 'all') { params.push(type); clauses.push(`type=$${params.length}`); } if (status && status !== 'all') { params.push(status); clauses.push(`status=$${params.length}`); } if (archived === 'true') clauses.push("COALESCE((data->>'archived')::boolean, false) = true"); else if (archived !== 'all') clauses.push("COALESCE((data->>'archived')::boolean, false) = false"); params.push(boundedLimit(limit)); const { rows } = await this.getPool().query<DataRow<TaskRecord>>(`SELECT ${PROJECT_DATA} FROM ops_tasks ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''} ORDER BY updated_at DESC LIMIT $${params.length}`, params); return rows.map(row => row.data); }
  async pageTasks(scope: ProjectScope, { type, status, archived, q, limit, offset = 0 }: TaskListFilters = {}): Promise<TaskPage> {
    const ids = scopeIds(scope);
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (ids) { params.push(ids); clauses.push(`project_id = ANY($${params.length})`); }
    if (type && type !== 'all') { params.push(type); clauses.push(`type=$${params.length}`); }
    if (status && status !== 'all') { params.push(status); clauses.push(`status=$${params.length}`); }
    if (archived === 'true') clauses.push("COALESCE((data->>'archived')::boolean, false) = true");
    else if (archived !== 'all') clauses.push("COALESCE((data->>'archived')::boolean, false) = false");
    const baseWhere = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const base = await this.getPool().query<TaskCountRow>(`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status IN ('running','queued'))::int AS active, COUNT(*) FILTER (WHERE status='waiting')::int AS waiting FROM ops_tasks ${baseWhere}`, params);
    const term = (q || '').trim();
    if (term) { params.push(term); clauses.push(`strpos(lower(${TASK_SEARCH_SQL}), lower($${params.length})) > 0`); }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const count = term ? await this.getPool().query<{ total: number }>(`SELECT COUNT(*)::int AS total FROM ops_tasks ${where}`, params) : base;
    params.push(boundedLimit(limit), offset);
    const rows = await this.getPool().query<DataRow<TaskRecord>>(`SELECT ${PROJECT_DATA} FROM ops_tasks ${where} ORDER BY CASE WHEN status='waiting' THEN 0 WHEN status IN ('running','queued') THEN 1 ELSE 2 END, updated_at DESC, id ASC LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
    return { items: rows.rows.map(row => row.data), total: count.rows[0]?.total || 0, active: base.rows[0]?.active || 0, waiting: base.rows[0]?.waiting || 0 };
  }
  /** The sequence number is assigned by the insert itself (max+1 for the task); a concurrent writer that collides on the primary key simply retries. */
  async appendEvent(taskId: string, event: TaskEvent): Promise<StoredTaskEvent> {
    const stored = { id: randomUUID(), at: now(), ...event, taskId };
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        const { rows } = await this.getPool().query<EventSequenceRow>('INSERT INTO ops_task_events(task_id,seq,id,at,type,data) SELECT $1, COALESCE(MAX(seq),0)+1, $2, $3, $4, $5::jsonb FROM ops_task_events WHERE task_id=$1 RETURNING seq', [taskId, stored.id, stored.at, stored.type, JSON.stringify(stored)]);
        return { ...stored, seq: Number(rows[0].seq) };
      } catch (error) { if (!(typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') || attempt === 4) throw error; }
    }
    throw new Error('Could not append task event');
  }
  async listEvents(taskId: string, { afterSeq = 0, limit = 2000 }: EventListFilters = {}): Promise<StoredTaskEvent[]> { const { rows } = await this.getPool().query<DataRow<StoredTaskEvent>>("SELECT data || jsonb_build_object('seq', seq) AS data FROM ops_task_events WHERE task_id=$1 AND seq>$2 ORDER BY seq LIMIT $3", [taskId, afterSeq, boundedLimit(limit, 2000, 10000)]); return rows.map(row => row.data); }
  async truncateEvents(taskId: string, fromSeq: number): Promise<number> { const { rowCount } = await this.getPool().query('DELETE FROM ops_task_events WHERE task_id=$1 AND seq>=$2', [taskId, fromSeq]); return rowCount ?? 0; }
  async createInboxItem(item: InboxItemInput): Promise<InboxItem> { requireProject(item, 'inbox item'); const stored: InboxItem = { id: `I-${randomUUID().slice(0, 8)}`, createdAt: now(), updatedAt: now(), status: 'pending', ...item }; const { rows } = await this.getPool().query<DataRow<InboxItem>>(`INSERT INTO ops_inbox(id,task_id,kind,status,data,created_at,updated_at,project_id) VALUES($1,$2,$3,$4,$5::jsonb,$6,$6,$7) RETURNING ${PROJECT_DATA}`, [stored.id, stored.taskId || null, stored.kind, stored.status, JSON.stringify(stored), stored.createdAt, stored.projectId]); return rows[0].data; }
  async getInboxItem(id: string): Promise<InboxItem | null> { const { rows } = await this.getPool().query<DataRow<InboxItem>>(`SELECT ${PROJECT_DATA} FROM ops_inbox WHERE id=$1`, [id]); return rows[0]?.data || null; }
  async updateInboxItem(id: string, patch: InboxItemPatch): Promise<InboxItem> { const current = await this.getInboxItem(id); if (!current) throw new Error(`Inbox item not found: ${id}`); const next: InboxItem = { ...current, ...patch, projectId: current.projectId, updatedAt: now() }; const { rows } = await this.getPool().query<DataRow<InboxItem>>(`UPDATE ops_inbox SET status=$2,data=$3::jsonb,updated_at=now() WHERE id=$1 RETURNING ${PROJECT_DATA}`, [id, next.status, JSON.stringify(next)]); return rows[0].data; }
  async listInbox(scope: ProjectScope, { status, kind, taskId, limit }: InboxListFilters = {}): Promise<InboxItem[]> { const ids = scopeIds(scope); const clauses: string[] = []; const params: unknown[] = []; if (ids) { params.push(ids); clauses.push(`project_id = ANY($${params.length})`); } for (const [column, value] of [['status', status], ['kind', kind], ['task_id', taskId]] as const) if (value && value !== 'all') { params.push(value); clauses.push(`${column}=$${params.length}`); } params.push(boundedLimit(limit, 200)); const { rows } = await this.getPool().query<DataRow<InboxItem>>(`SELECT ${PROJECT_DATA} FROM ops_inbox ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''} ORDER BY created_at DESC LIMIT $${params.length}`, params); return rows.map(row => row.data); }
  async pageInbox(scope: ProjectScope, { status, kind, taskId, view, limit, offset = 0 }: InboxListFilters = {}): Promise<InboxPage> {
    const ids = scopeIds(scope);
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (ids) { params.push(ids); clauses.push(`project_id = ANY($${params.length})`); }
    const scopeWhere = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const counts = await this.getPool().query<InboxCountRow>(`SELECT COUNT(*) FILTER (WHERE status='pending' AND kind IN ('approval','question'))::int AS pending, COUNT(*) FILTER (WHERE status='pending' AND kind='approval')::int AS approvals, COUNT(*) FILTER (WHERE status='pending' AND kind='notification')::int AS unread FROM ops_inbox ${scopeWhere}`, params);
    for (const [column, value] of [['status', status], ['kind', kind], ['task_id', taskId]] as const) if (value && value !== 'all') { params.push(value); clauses.push(`${column}=$${params.length}`); }
    if (view === 'needs_action') clauses.push("status='pending' AND kind IN ('approval','question')");
    else if (view === 'done') clauses.push("NOT (status='pending' AND kind IN ('approval','question'))");
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const visible = `WITH ranked AS (SELECT ${PROJECT_DATA}, created_at, id, ROW_NUMBER() OVER (PARTITION BY CASE WHEN kind='notification' THEN COALESCE(task_id,id) ELSE id END ORDER BY created_at DESC,id DESC) AS rank FROM ops_inbox ${where}) SELECT data,created_at,id FROM ranked WHERE rank=1`;
    const total = await this.getPool().query<{ total: number }>(`SELECT COUNT(*)::int AS total FROM (${visible}) AS visible`, params);
    params.push(boundedLimit(limit, 200), offset);
    const rows = await this.getPool().query<DataRow<InboxItem>>(`SELECT data FROM (${visible}) AS visible ORDER BY created_at DESC,id DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
    return { items: rows.rows.map(row => row.data), total: total.rows[0]?.total || 0, pending: counts.rows[0]?.pending || 0, approvals: counts.rows[0]?.approvals || 0, unread: counts.rows[0]?.unread || 0 };
  }
  async readAllInbox(scope: ProjectScope, readBy: Record<string, unknown>): Promise<number> {
    const ids = scopeIds(scope);
    const params: unknown[] = [JSON.stringify(readBy), now()];
    const scoped = ids ? `AND project_id = ANY($3)` : '';
    if (ids) params.push(ids);
    const result = await this.getPool().query(`UPDATE ops_inbox SET status='read', updated_at=now(), data=data || jsonb_build_object('status','read','readBy',$1::jsonb,'updatedAt',$2::text) WHERE status='pending' AND kind='notification' ${scoped}`, params);
    return result.rowCount ?? 0;
  }
}

export async function createTaskStore(): Promise<TaskInboxStore> { const store: TaskInboxStore = config.metadataStore === 'postgres' ? new PostgresTaskStore() : new FileTaskStore(); await store.init(); return store; }
