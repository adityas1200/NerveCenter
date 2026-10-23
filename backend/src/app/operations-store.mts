import path from 'node:path';
import { isClosedTicket } from './ticket-view.mjs';
import { attentionTicketRows, attentionTicketsSql, overviewTicketRows, pageTicketRows, ticketOverviewParams, ticketOverviewResult, ticketOverviewSql, ticketPageSql, ticketVisible, visibleOpenPipelinesSql, type AttentionQuery, type OverviewTicketQuery, type OverviewTicketSummary, type TicketAccess, type TicketPageQuery, type TicketPageResult } from './ticket-page.mjs';
export interface TicketActivity {
  id?: string;
  type: string;
  status?: string;
  title?: string;
  detail?: string | null;
  at?: string;
  ticketId?: string;
  seq?: number;
  [field: string]: unknown;
}

export interface TicketRecord {
  ticketId: string;
  projectId: string;
  title: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  activity?: TicketActivity[];
  source?: string;
  sourceKey?: string | null;
  sourceRef?: string;
  connectionId?: string;
  pipelineId?: string;
  runId?: string;
  signature?: string;
  creator?: unknown;
  assignee?: unknown;
  externalReference?: { system?: string; sysId?: string; number?: string; [field: string]: unknown };
  closedAt?: string | null;
  taskId?: string | null;
  [field: string]: unknown;
}

export type TicketPatch = Partial<TicketRecord> & Record<string, unknown>;

export interface ApplicationSetting<T = unknown> {
  key: string;
  value: T;
}

export interface OperationsFileState {
  ticketCounter: number;
  tickets: Record<string, TicketRecord>;
  boards: Record<string, BoardRecord>;
  dataQuality: Record<string, unknown>;
}

export interface BoardRecord { id: string; projectId: string; updatedAt?: string; views?: number; lastViewedAt?: string; [key: string]: unknown; }

export interface OperationsStore {
  init(): Promise<void>;
  nextTicketId(prefix?: string): Promise<string>;
  findTicketBySourceKey(key: string | null | undefined, connectionId?: string): Promise<TicketRecord | null>;
  findTicketBySourceRef(ref: string | null | undefined): Promise<TicketRecord | null>;
  createTicket(ticket: TicketRecord): Promise<TicketRecord>;
  getTicket(id: string): Promise<TicketRecord | null>;
  listTickets(scope: ProjectScope): Promise<TicketRecord[]>;
  listTicketPage(scope: ProjectScope, query: TicketPageQuery): Promise<TicketPageResult>;
  ticketOverview(scope: ProjectScope, access: TicketAccess, query: OverviewTicketQuery): Promise<OverviewTicketSummary>;
  attentionTickets(scope: ProjectScope, access: TicketAccess, query: AttentionQuery): Promise<TicketRecord[]>;
  visibleOpenPipelineIds(scope: ProjectScope, access: TicketAccess, pipelineIds: string[]): Promise<string[]>;
  findTicketsBySignature(signature: string | null | undefined, scope: ProjectScope): Promise<TicketRecord[]>;
  updateTicket(id: string, patch: TicketPatch, options?: { touch?: boolean }): Promise<TicketRecord>;
  setTicketProject(id: string, projectId: string): Promise<TicketRecord>;
  backfillConnection(source: string, connectionId: string): Promise<number>;
  appendActivity(id: string, events: TicketActivity[]): Promise<TicketRecord>;
  listActivity(ticketIds: string[], options?: {types?: string[]; since?: string; limit?: number}): Promise<TicketActivity[]>;
  listBoards(scope: ProjectScope, options?: {limit?: number}): Promise<BoardRecord[]>;
  getBoard(id: string): Promise<BoardRecord | null>;
  putBoard(board: BoardRecord): Promise<BoardRecord>;
  deleteBoard(id: string): Promise<boolean>;
  noteBoardView(id: string, at: string): Promise<void>;
  getDataQualityConfig(projectId: string): Promise<unknown | null>;
  setDataQualityConfig(configuration: unknown, projectId: string): Promise<unknown>;
}

export interface ProjectScope {
  all: boolean;
  projectIds: readonly string[];
}

interface PgPoolLike {
  query<Row = Record<string, unknown>>(text: string, values?: unknown[]): Promise<{ rows: Row[]; rowCount: number | null }>;
}

type SourceKeyTicket = Pick<TicketRecord, 'source'> & Partial<Pick<TicketRecord, 'sourceKey' | 'sourceRef' | 'pipelineId' | 'runId' | 'externalReference'>>;
type TicketEvent = TicketActivity & { at?: string; id?: string; ticketId?: string; seq?: number };
type FileState = OperationsFileState;
type PgJsonRow = { data: Record<string, unknown> };


import { randomUUID } from 'node:crypto';
import { RUNTIME_DIR, config } from '../config.mjs';
import { ensureDir, readJson, writeJson, exists } from '../lib/fs.mjs';
import { getPgPool, ensureControlSchema } from '../storage/postgres.mjs';
import { now, clone, httpError } from '../lib/util.mjs';
import { assertScope, filterByScope, scopeIds } from '../projects/project-access.mjs';

// A source key is an idempotency boundary, not a required ticket attribute.
// Two manual requests without a source reference must remain separate tickets.
const sourceKey = (ticket: SourceKeyTicket): string | null => {
  if (ticket.sourceKey) return ticket.sourceKey;
  if (ticket.externalReference?.system && ticket.externalReference?.sysId) return `${ticket.externalReference.system}:${ticket.externalReference.sysId}`;
  if (ticket.source && ticket.sourceRef) return `${ticket.source}:${ticket.sourceRef}`;
  if (ticket.source === 'databricks' && ticket.pipelineId && ticket.runId) return `databricks:${ticket.pipelineId}:${ticket.runId}`;
  return null;
};
// Boards and data quality configs are per project (ADR 0004): a board per row, a config per project.
// A store without a project (a unit test of one service) means PILOT, as the old shared keys did.
const projectOf = (projectId?: string | null): string => projectId || 'pilot';
export const BOARD_LIST_MAX = 500;
const boardLimit = (limit?: number): number => Math.max(1, Math.min(BOARD_LIST_MAX, Number(limit) || 200));
const byUpdatedDesc = (a: BoardRecord, b: BoardRecord): number => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')) || String(a.id).localeCompare(String(b.id));
const connectionOf = (ticket: Partial<TicketRecord> | null | undefined): string => (typeof ticket?.connectionId === 'string' ? ticket.connectionId : '');
// Activity is one record per event (ADR 0005), not part of the ticket record. Every ticket read carries its latest 500, oldest first.
const TICKET_ACTIVITY = 500;
const boundedLimit = (value: number | undefined, fallback: number, max: number): number => Math.max(1, Math.min(max, Number(value) || fallback));
const withoutActivity = (ticket: TicketRecord): TicketRecord => { const { activity: _activity, ...rest } = clone(ticket); return rest; };
const rejectActivity = (patch: TicketPatch): void => { if (Object.hasOwn(patch, 'activity')) throw httpError(500, 'Ticket activity is appended with appendActivity, not set through updateTicket.'); };
const newestFirst = (a: TicketEvent, b: TicketEvent): number => String(b.at).localeCompare(String(a.at)) || (b.seq || 0) - (a.seq || 0);
const afterMs = (event: TicketEvent, since: string): boolean => { const cut = Date.parse(since); return Number.isNaN(cut) || Date.parse(event.at || '') > cut; };
// Re-importing a ticket refreshes the remote fields but never loses what happened here.
const mergeExisting = (ticket: TicketRecord, next: TicketRecord): TicketRecord => {
  const { activity: _activity, ...existing } = ticket;
  return ({
  ...existing, ...next,
  ticketId: existing.ticketId, createdAt: existing.createdAt, creator: existing.creator, connectionId: connectionOf(existing),
  // A ticket never changes project through a re-import (SPEC-projects-01 FR-26).
  projectId: existing.projectId,
  // The source owns imported fields (NerveCenter writes changes through to it), so its assignee wins when it sends one.
  assignee: next.assignee !== undefined ? next.assignee : existing.assignee || null,
  closedAt: existing.closedAt, taskId: existing.taskId || null,
  sourceKey: sourceKey(next), updatedAt: next.updatedAt || now(),
  });
};

export class FileOperationsStore implements OperationsStore {
  private readonly file: string;
  private readonly eventsDir: string;
  private queue: Promise<void> = Promise.resolve();
  // Events sit beside the state file (the 010 file migration's layout); a state file under another name gets its own folder so two stores in one directory never share events.
  constructor(file = path.join(RUNTIME_DIR, 'application-state.json')) { this.file = file; this.eventsDir = path.basename(file) === 'application-state.json' ? path.join(path.dirname(file), 'ticket-events') : `${file}.ticket-events`; this.queue = Promise.resolve(); }
  async init() { await ensureDir(path.dirname(this.file)); if (!(await exists(this.file))) await writeJson(this.file, { ticketCounter: 1000, tickets: {}, boards: {}, dataQuality: {} }); }
  async #read(): Promise<FileState> { return readJson(this.file); }
  async #write(s: FileState): Promise<void> { return writeJson(this.file, s); }
  #eventsFile(ticketId: string): string { return path.join(this.eventsDir, `${String(ticketId).replace(/[^A-Za-z0-9._-]/g, '_')}.json`); }
  async #events(ticketId: string): Promise<TicketEvent[]> { const file = this.#eventsFile(ticketId); return (await exists(file)) ? readJson(file) : []; }
  // One path for every read: each listed ticket's own events file (local-only, so one read per ticket is fine).
  async #withActivityMany(tickets: TicketRecord[]): Promise<TicketRecord[]> { return Promise.all(tickets.map(async ticket => ({ ...withoutActivity(ticket), activity: (await this.#events(ticket.ticketId)).slice(-TICKET_ACTIVITY) }))); }
  async #withActivity(ticket: TicketRecord): Promise<TicketRecord> { return (await this.#withActivityMany([ticket]))[0]; }
  // seq is the position in the ticket's own file; callers hold #exclusive, so two appends cannot take the same one.
  async #addEvents(ticketId: string, events: TicketEvent[]): Promise<void> {
    const stored = await this.#events(ticketId); let seq = stored.reduce((max, event) => Math.max(max, event.seq || 0), 0);
    for (const event of events) stored.push({ ...clone(event), id: event.id || randomUUID(), at: event.at || now(), ticketId, seq: (seq += 1) });
    if (events.length) { await ensureDir(this.eventsDir); await writeJson(this.#eventsFile(ticketId), stored); }
  }
  async #exclusive<T>(task: () => Promise<T>): Promise<T> { const prior = this.queue; let release!: () => void; this.queue = new Promise<void>(resolve => { release = resolve; }); await prior; try { return await task(); } finally { release(); } }
  async nextTicketId(prefix = config.ticketPrefix) { return this.#exclusive(async () => { const s = await this.#read(); s.ticketCounter = Number(s.ticketCounter || 1000) + 1; await this.#write(s); return `${prefix}-${s.ticketCounter}`; }); }
  // A source key is unique per connection (SPEC-projects-01 FR-25); manual tickets and anything without one use ''.
  async findTicketBySourceKey(key: string | null | undefined, connectionId = ''): Promise<TicketRecord | null> { if (!key) return null; const s = await this.#read(); const ticket = Object.values(s.tickets || {}).find(item => sourceKey(item) === key && connectionOf(item) === connectionId); return ticket ? this.#withActivity(ticket) : null; }
  async findTicketBySourceRef(ref: string | null | undefined): Promise<TicketRecord | null> { if (!ref) return null; const s = await this.#read(); const ticket = Object.values(s.tickets || {}).filter(item => item.sourceRef === ref).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]; return ticket ? this.#withActivity(ticket) : null; }
  async createTicket(ticket: TicketRecord): Promise<TicketRecord> {
    requireProject(ticket);
    return this.#exclusive(async () => {
      const s = await this.#read(); const key = sourceKey(ticket); const { activity = [], ...record } = clone(ticket);
      const existing = key ? Object.values(s.tickets || {}).find(t => sourceKey(t) === key && connectionOf(t) === connectionOf(ticket)) : null;
      if (existing) { const next = mergeExisting(existing, record); s.tickets[existing.ticketId] = next; await this.#write(s); return this.#withActivity(next); }
      s.tickets[ticket.ticketId] = { ...record, connectionId: connectionOf(ticket), ...(key ? { sourceKey: key } : {}) };
      await this.#addEvents(ticket.ticketId, activity); await this.#write(s); return this.#withActivity(s.tickets[ticket.ticketId]);
    });
  }
  async getTicket(id: string): Promise<TicketRecord | null> { const s = await this.#read(); return s.tickets?.[id] ? this.#withActivity(s.tickets[id]) : null; }
  async listTickets(scope: ProjectScope): Promise<TicketRecord[]> { assertScope(scope); const s = await this.#read(); return this.#withActivityMany(filterByScope(scope, Object.values(s.tickets || {})).sort((a: TicketRecord, b: TicketRecord) => b.createdAt.localeCompare(a.createdAt))); }
  async listTicketPage(scope: ProjectScope, query: TicketPageQuery): Promise<TicketPageResult> {
    assertScope(scope); const state = await this.#read();
    const rows = filterByScope(scope, Object.values(state.tickets || {})).filter((ticket: TicketRecord) => ticketVisible(ticket, query.access));
    const result = pageTicketRows(rows, query);
    return { ...result, items: await this.#withActivityMany(result.items) };
  }
  // Counts need no activity, so no per-ticket events file is opened.
  async ticketOverview(scope: ProjectScope, access: TicketAccess, query: OverviewTicketQuery): Promise<OverviewTicketSummary> {
    assertScope(scope); const state = await this.#read();
    return overviewTicketRows(filterByScope(scope, Object.values(state.tickets || {})).filter((ticket: TicketRecord) => ticketVisible(ticket, access)), query);
  }
  async attentionTickets(scope: ProjectScope, access: TicketAccess, query: AttentionQuery): Promise<TicketRecord[]> {
    assertScope(scope); const state = await this.#read();
    return attentionTicketRows(filterByScope(scope, Object.values(state.tickets || {})).filter((ticket: TicketRecord) => ticketVisible(ticket, access)), query).map(withoutActivity);
  }
  async visibleOpenPipelineIds(scope: ProjectScope, access: TicketAccess, pipelineIds: string[]): Promise<string[]> {
    assertScope(scope); const state = await this.#read(); const wanted = new Set(pipelineIds);
    const open = filterByScope(scope, Object.values(state.tickets || {})).filter((ticket: TicketRecord) => ticketVisible(ticket, access) && !isClosedTicket(ticket));
    const ids: string[] = open.map((ticket: TicketRecord) => String(ticket.pipelineId || '')).filter((id: string) => id && wanted.has(id));
    return [...new Set(ids)];
  }
  async findTicketsBySignature(signature: string | null | undefined, scope: ProjectScope): Promise<TicketRecord[]> { assertScope(scope); if (!signature) return []; const s = await this.#read(); return this.#withActivityMany(filterByScope(scope, Object.values(s.tickets || {})).filter((item: TicketRecord) => item.signature === signature)); }
  // `touch: false` changes the record without moving updatedAt (bookkeeping such as the signature backfill).
  async updateTicket(id: string, patch: TicketPatch, { touch = true }: { touch?: boolean } = {}): Promise<TicketRecord> { rejectActivity(patch); return this.#exclusive(async () => { const s = await this.#read(); if (!s.tickets?.[id]) throw new Error(`Ticket not found: ${id}`); s.tickets[id] = { ...s.tickets[id], ...clone(patch), projectId: s.tickets[id].projectId, updatedAt: touch ? now() : s.tickets[id].updatedAt }; await this.#write(s); return this.#withActivity(s.tickets[id]); }); }
  // The one place a ticket changes project: the admin routing of an Unrouted ticket (FR-26). updateTicket never does.
  async setTicketProject(id: string, projectId: string): Promise<TicketRecord> { return this.#exclusive(async () => { const s = await this.#read(); if (!s.tickets?.[id]) throw new Error(`Ticket not found: ${id}`); s.tickets[id] = { ...s.tickets[id], projectId }; await this.#write(s); return this.#withActivity(s.tickets[id]); }); }
  // Tickets imported before a connection existed for their source (deployment credentials imported as a profile): stamp it once.
  async backfillConnection(source: string, connectionId: string): Promise<number> { return this.#exclusive(async () => { const s = await this.#read(); let n = 0; for (const t of Object.values(s.tickets || {})) if (t.source === source && !connectionOf(t)) { t.connectionId = connectionId; n += 1; } if (n) await this.#write(s); return n; }); }
  async appendActivity(id: string, events: TicketActivity[]): Promise<TicketRecord> { return this.#exclusive(async () => { const s = await this.#read(); if (!s.tickets?.[id]) throw new Error(`Ticket not found: ${id}`); const t = s.tickets[id]; await this.#addEvents(id, events); t.updatedAt = now(); await this.#write(s); return this.#withActivity(t); }); }
  // Events across tickets, newest first: for the readers that span tickets (feed, similar tickets, resolved-by).
  async listActivity(ticketIds: string[], { types, since, limit }: { types?: string[]; since?: string; limit?: number } = {}): Promise<TicketActivity[]> { if (!ticketIds?.length) return []; const lists = await Promise.all([...new Set(ticketIds)].map(id => this.#events(id))); return lists.flat().filter(event => (!types?.length || types.includes(event.type)) && (!since || afterMs(event, since))).sort(newestFirst).slice(0, boundedLimit(limit, 2000, 10000)); }
  async listBoards(scope: ProjectScope, { limit }: { limit?: number } = {}): Promise<BoardRecord[]> { const ids = scopeIds(scope); const s = await this.#read(); return Object.values(s.boards || {}).filter(board => !ids || ids.includes(board.projectId)).sort(byUpdatedDesc).slice(0, boardLimit(limit)).map(clone); }
  async getBoard(id: string): Promise<BoardRecord | null> { const s = await this.#read(); return s.boards?.[id] ? clone(s.boards[id]) : null; }
  // Only noteBoardView counts views, so a save never puts back a count read before views it did not see.
  async putBoard(board: BoardRecord): Promise<BoardRecord> { return this.#exclusive(async () => { const s = await this.#read(); s.boards ||= {}; const stored = s.boards[board.id]; const next = { ...clone(board), ...(stored ? { views: stored.views || 0, lastViewedAt: stored.lastViewedAt } : {}) }; if (next.lastViewedAt === undefined) delete next.lastViewedAt; s.boards[board.id] = next; await this.#write(s); return clone(next); }); }
  async deleteBoard(id: string): Promise<boolean> { return this.#exclusive(async () => { const s = await this.#read(); if (!s.boards?.[id]) return false; delete s.boards[id]; await this.#write(s); return true; }); }
  // A view is bookkeeping, not an edit: updatedAt stays.
  async noteBoardView(id: string, at: string): Promise<void> { return this.#exclusive(async () => { const s = await this.#read(); const board = s.boards?.[id]; if (!board) return; board.views = (board.views || 0) + 1; board.lastViewedAt = at; await this.#write(s); }); }
  async getDataQualityConfig(projectId: string): Promise<unknown | null> { const s = await this.#read(); const saved = s.dataQuality?.[projectOf(projectId)]; return saved ? clone(saved) : null; }
  async setDataQualityConfig(configuration: unknown, projectId: string): Promise<unknown> { return this.#exclusive(async () => { const s = await this.#read(); s.dataQuality ||= {}; s.dataQuality[projectOf(projectId)] = clone(configuration); await this.#write(s); return clone(configuration); }); }
}

// As for tickets, the project lives in a column and the record carries it too.
const BOARD_DATA = "data || jsonb_build_object('projectId', project_id) AS data";

// The project lives in a column; the record carries it too, so a row always reads back with projectId.
// An event reads back as it was written; the columns fill what a backfilled legacy entry lacked.
const EVENT_DATA = `jsonb_build_object('id', id, 'at', to_char(at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), 'type', type, 'ticketId', ticket_id) || data || jsonb_build_object('seq', seq) AS data`;
const TICKET_DATA = "data || jsonb_build_object('projectId', project_id) AS data";
function requireProject(ticket: TicketRecord): void { if (!ticket?.projectId) throw httpError(500, 'A ticket needs a project.'); }

export class PostgresOperationsStore implements OperationsStore {
  private pool: PgPoolLike;
  constructor(pool: PgPoolLike | null = null) { this.pool = pool as PgPoolLike; }
  async init(): Promise<void> { this.pool ||= await getPgPool() as unknown as PgPoolLike; await ensureControlSchema(this.pool); }
  async nextTicketId(prefix = config.ticketPrefix) { const { rows } = await this.pool.query("SELECT nextval('ops_ticket_seq') AS n"); return `${prefix}-${rows[0].n}`; }
  async findTicketBySourceKey(key: string | null | undefined, connectionId = ''): Promise<TicketRecord | null> { if (!key) return null; const { rows } = await this.pool.query<PgJsonRow>(`SELECT ${TICKET_DATA} FROM ops_tickets WHERE source_key=$1 AND connection_id=$2`, [key, connectionId]); return rows[0] ? this.#withActivity(rows[0].data as TicketRecord) : null; }
  async findTicketBySourceRef(ref: string | null | undefined): Promise<TicketRecord | null> { if (!ref) return null; const { rows } = await this.pool.query<PgJsonRow>(`SELECT ${TICKET_DATA} FROM ops_tickets WHERE data->>'sourceRef'=$1 ORDER BY created_at DESC LIMIT 1`, [ref]); return rows[0] ? this.#withActivity(rows[0].data as TicketRecord) : null; }
  async createTicket(ticket: TicketRecord): Promise<TicketRecord> {
    requireProject(ticket);
    const key = sourceKey(ticket); const connectionId = connectionOf(ticket); const { activity = [], ...record } = ticket; const next = { ...record, connectionId, ...(key ? { sourceKey: key } : {}) };
    const inserted = await this.pool.query<PgJsonRow>(`INSERT INTO ops_tickets(ticket_id,pipeline_id,run_id,status,data,source_key,created_at,updated_at,project_id,connection_id) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$7,$8,$9) ON CONFLICT DO NOTHING RETURNING ${TICKET_DATA}`, [next.ticketId, next.pipelineId || null, next.runId || null, next.status, JSON.stringify(next), key, next.createdAt, next.projectId, connectionId]);
    if (inserted.rows[0]) { for (const event of activity) await this.#insertEvent(next.ticketId, event); return this.#withActivity(inserted.rows[0].data as TicketRecord); }
    const existing = key ? await this.findTicketBySourceKey(key, connectionId) : await this.getTicket(next.ticketId);
    if (!existing) throw new Error('Ticket could not be created because its identity conflicts with an existing record');
    const merged = mergeExisting(existing, next);
    const { rows } = await this.pool.query<PgJsonRow>(`UPDATE ops_tickets SET status=$2,data=$3::jsonb,source_key=$4,updated_at=now() WHERE ticket_id=$1 RETURNING ${TICKET_DATA}`, [existing.ticketId, merged.status, JSON.stringify(merged), key]);
    return this.#withActivity(rows[0].data as TicketRecord);
  }
  async #row(id: string): Promise<TicketRecord | null> { const { rows } = await this.pool.query<PgJsonRow>(`SELECT ${TICKET_DATA} FROM ops_tickets WHERE ticket_id=$1`, [id]); return rows[0]?.data as TicketRecord || null; }
  // One query for the whole list: the latest 500 events of each listed ticket, grouped back into its ticket oldest first.
  async #withActivityMany(tickets: TicketRecord[]): Promise<TicketRecord[]> {
    if (!tickets.length) return [];
    const { rows } = await this.pool.query<{ ticket_id: string; data: TicketActivity }>(`SELECT ticket_id, data FROM (SELECT ticket_id, seq, ${EVENT_DATA}, row_number() OVER (PARTITION BY ticket_id ORDER BY seq DESC) AS rn FROM ops_ticket_events WHERE ticket_id = ANY($1)) e WHERE rn <= $2 ORDER BY ticket_id, seq`, [tickets.map((ticket: TicketRecord) => ticket.ticketId), TICKET_ACTIVITY]);
    const byTicket = new Map(); for (const row of rows) { const list = byTicket.get(row.ticket_id); if (list) list.push(row.data); else byTicket.set(row.ticket_id, [row.data]); }
    return tickets.map(ticket => ({ ...ticket, activity: byTicket.get(ticket.ticketId) || [] }));
  }
  async #withActivity(ticket: TicketRecord): Promise<TicketRecord> { return (await this.#withActivityMany([ticket]))[0]; }
  /** As task events: seq is assigned by the insert itself (max+1 for the ticket); a writer that collides on the primary key retries. */
  async #insertEvent(ticketId: string, event: TicketActivity): Promise<void> {
    const stored = { ...event, id: event.id || randomUUID(), at: event.at || now(), type: event.type || 'ticket.event', ticketId };
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try { await this.pool.query('INSERT INTO ops_ticket_events(ticket_id,seq,id,at,type,data) SELECT $1, COALESCE(MAX(seq),0)+1, $2, $3, $4, $5::jsonb FROM ops_ticket_events WHERE ticket_id=$1', [ticketId, stored.id, stored.at, stored.type, JSON.stringify(stored)]); return; }
      catch (error) { if (!(error && typeof error === 'object' && 'code' in error && error.code === '23505') || attempt === 4) throw error; }
    }
  }
  async getTicket(id: string): Promise<TicketRecord | null> { const ticket = await this.#row(id); return ticket ? this.#withActivity(ticket) : null; }
  async listTickets(scope: ProjectScope): Promise<TicketRecord[]> { const ids = scopeIds(scope); const { rows } = await this.pool.query<PgJsonRow>(`SELECT ${TICKET_DATA} FROM ops_tickets ${ids ? 'WHERE project_id = ANY($1)' : ''} ORDER BY created_at DESC LIMIT 5000`, ids ? [ids] : []); return this.#withActivityMany(rows.map(r => r.data as TicketRecord)); }
  async listTicketPage(scope: ProjectScope, query: TicketPageQuery): Promise<TicketPageResult> {
    const ids = scopeIds(scope); const sql = ticketPageSql(query); const params = [ids, JSON.stringify(query)];
    const [page, count, meta] = await Promise.all([
      this.pool.query<PgJsonRow>(sql.page, [...params, query.limit, query.offset]),
      this.pool.query<{total:number}>(sql.total, params),
      this.pool.query<Record<string, unknown>>(sql.meta, params),
    ]);
    const m = meta.rows[0];
    return { items: await this.#withActivityMany(page.rows.map(row => row.data as TicketRecord)), total: Number(count.rows[0].total), meta: {
      open:Number(m.open),highOpen:Number(m.highOpen),waitingOnYou:Number(m.waitingOnYou),closed:Number(m.closed),resolved:Number(m.resolved),scoped:Number(m.scoped),
      options:{priority:m.priority as string[],status:m.status as string[],assignee:m.assignee as string[],source:m.source as string[]},people:m.people as unknown[],
    } };
  }
  async ticketOverview(scope: ProjectScope, access: TicketAccess, query: OverviewTicketQuery): Promise<OverviewTicketSummary> {
    const { rows } = await this.pool.query<Record<string, unknown>>(ticketOverviewSql(), [scopeIds(scope), JSON.stringify(ticketOverviewParams(access, query))]);
    return ticketOverviewResult(rows[0] || {});
  }
  async attentionTickets(scope: ProjectScope, access: TicketAccess, query: AttentionQuery): Promise<TicketRecord[]> {
    const { rows } = await this.pool.query<PgJsonRow>(attentionTicketsSql(), [scopeIds(scope), JSON.stringify({ access }), query.mineKeys, boundedLimit(query.limit, 8, 50)]);
    return rows.map(row => row.data as TicketRecord);
  }
  async visibleOpenPipelineIds(scope: ProjectScope, access: TicketAccess, pipelineIds: string[]): Promise<string[]> {
    if (!pipelineIds.length) return [];
    const { rows } = await this.pool.query<{ pid: string }>(visibleOpenPipelinesSql(), [scopeIds(scope), JSON.stringify({ access }), pipelineIds]);
    return rows.map(row => row.pid);
  }
  async findTicketsBySignature(signature: string | null | undefined, scope: ProjectScope): Promise<TicketRecord[]> { const ids = scopeIds(scope); if (!signature) return []; const { rows } = await this.pool.query<PgJsonRow>(`SELECT ${TICKET_DATA} FROM ops_tickets WHERE data->>'signature'=$1 ${ids ? 'AND project_id = ANY($2)' : ''} ORDER BY created_at DESC LIMIT 200`, ids ? [signature, ids] : [signature]); return this.#withActivityMany(rows.map(r => r.data as TicketRecord)); }
  async updateTicket(id: string, patch: TicketPatch, { touch = true }: { touch?: boolean } = {}): Promise<TicketRecord> { rejectActivity(patch); const current = await this.#row(id); if (!current) throw new Error(`Ticket not found: ${id}`); const next = { ...current, ...patch, projectId: current.projectId, updatedAt: touch ? now() : current.updatedAt }; const { rows } = await this.pool.query<PgJsonRow>(`UPDATE ops_tickets SET status=$2,data=$3::jsonb,source_key=COALESCE($4,source_key),updated_at=CASE WHEN $5 THEN now() ELSE updated_at END WHERE ticket_id=$1 RETURNING ${TICKET_DATA}`, [id, next.status, JSON.stringify(next), sourceKey(next), touch]); return this.#withActivity(rows[0].data as TicketRecord); }
  async setTicketProject(id: string, projectId: string): Promise<TicketRecord> { const current = await this.#row(id); if (!current) throw new Error(`Ticket not found: ${id}`); const { rows } = await this.pool.query<PgJsonRow>(`UPDATE ops_tickets SET project_id=$2,data=$3::jsonb WHERE ticket_id=$1 RETURNING ${TICKET_DATA}`, [id, projectId, JSON.stringify({ ...current, projectId })]); return this.#withActivity(rows[0].data as TicketRecord); }
  async backfillConnection(source: string, connectionId: string): Promise<number> { const { rowCount } = await this.pool.query(`UPDATE ops_tickets SET connection_id=$2,data=jsonb_set(data,'{connectionId}',to_jsonb($2::text)) WHERE data->>'source'=$1 AND connection_id=''`, [source, connectionId]); return rowCount ?? 0; }
  // Moves updatedAt as updateTicket does, but never rewrites the activity: one small update plus one insert per event.
  async appendActivity(id: string, events: TicketActivity[]): Promise<TicketRecord> {
    const touched = await this.pool.query("UPDATE ops_tickets SET updated_at=now(),data=jsonb_set(data,'{updatedAt}',to_jsonb($2::text)) WHERE ticket_id=$1", [id, now()]);
    if (!touched.rowCount) throw new Error(`Ticket not found: ${id}`);
    for (const event of events) await this.#insertEvent(id, event);
    const ticket = await this.getTicket(id);
    if (!ticket) throw new Error(`Ticket not found: ${id}`);
    return ticket;
  }
  // Events across tickets, newest first: for the readers that span tickets (feed, similar tickets, resolved-by).
  async listActivity(ticketIds: string[], { types, since, limit }: { types?: string[]; since?: string; limit?: number } = {}): Promise<TicketActivity[]> {
    if (!ticketIds?.length) return []; const params: unknown[] = [[...new Set(ticketIds)]]; const clauses = ['ticket_id = ANY($1)'];
    if (types?.length) { params.push(types); clauses.push(`type = ANY($${params.length})`); }
    if (since) { params.push(since); clauses.push(`at > $${params.length}`); }
    params.push(boundedLimit(limit, 2000, 10000));
    const { rows } = await this.pool.query<{ data: TicketActivity }>(`SELECT ${EVENT_DATA} FROM ops_ticket_events WHERE ${clauses.join(' AND ')} ORDER BY at DESC, seq DESC LIMIT $${params.length}`, params);
    return rows.map(row => row.data);
  }
  async listBoards(scope: ProjectScope, { limit }: { limit?: number } = {}): Promise<BoardRecord[]> { const ids = scopeIds(scope); const { rows } = await this.pool.query<{ data: BoardRecord }>(`SELECT ${BOARD_DATA} FROM ops_boards ${ids ? 'WHERE project_id = ANY($2)' : ''} ORDER BY updated_at DESC, id LIMIT $1`, ids ? [boardLimit(limit), ids] : [boardLimit(limit)]); return rows.map(row => row.data); }
  async getBoard(id: string): Promise<BoardRecord | null> { const { rows } = await this.pool.query<{ data: BoardRecord }>(`SELECT ${BOARD_DATA} FROM ops_boards WHERE id=$1`, [id]); return rows[0]?.data || null; }
  // A board never changes project, so an update leaves project_id as it was. Only noteBoardView counts views, so an
  // update keeps the stored count rather than one read before views it did not see.
  async putBoard(board: BoardRecord): Promise<BoardRecord> { const { rows } = await this.pool.query<{ data: BoardRecord }>(`INSERT INTO ops_boards(id,project_id,data,updated_at) VALUES($1,$2,$3::jsonb,now()) ON CONFLICT(id) DO UPDATE SET data=EXCLUDED.data || jsonb_strip_nulls(jsonb_build_object('views', ops_boards.data->'views', 'lastViewedAt', ops_boards.data->'lastViewedAt')),updated_at=now() RETURNING ${BOARD_DATA}`, [board.id, projectOf(board.projectId), JSON.stringify(board)]); return rows[0].data; }
  async deleteBoard(id: string): Promise<boolean> { const { rowCount } = await this.pool.query('DELETE FROM ops_boards WHERE id=$1', [id]); return (rowCount ?? 0) > 0; }
  // One atomic UPDATE, so a view never rewrites an edit made at the same time; updated_at stays (a view is not an edit).
  async noteBoardView(id: string, at: string): Promise<void> { await this.pool.query("UPDATE ops_boards SET data = jsonb_set(jsonb_set(data, '{views}', to_jsonb(COALESCE((data->>'views')::int, 0) + 1)), '{lastViewedAt}', to_jsonb($2::text)) WHERE id=$1", [id, at]); }
  async getDataQualityConfig(projectId: string): Promise<unknown | null> { const { rows } = await this.pool.query<{ data: unknown }>('SELECT data FROM ops_data_quality_configs WHERE project_id=$1', [projectOf(projectId)]); return rows[0]?.data || null; }
  async setDataQualityConfig(configuration: unknown, projectId: string): Promise<unknown> { const { rows } = await this.pool.query<{ data: unknown }>('INSERT INTO ops_data_quality_configs(project_id,data,updated_at) VALUES($1,$2::jsonb,now()) ON CONFLICT(project_id) DO UPDATE SET data=EXCLUDED.data,updated_at=now() RETURNING data', [projectOf(projectId), JSON.stringify(configuration)]); return rows[0].data; }
}

export async function createOperationsStore() { const s = config.metadataStore === 'postgres' ? new PostgresOperationsStore() : new FileOperationsStore(); await s.init(); return s; }
