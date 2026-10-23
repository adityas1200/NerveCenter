import { appStatus, decorateTicket, identityKeys, isClosedTicket, PRIORITY_WEIGHT, resolvedWithAgent } from './ticket-view.mjs';
import { httpError } from '../lib/util.mjs';
import type { TicketRecord } from './operations-store.mjs';

export type TicketPageQuery = {
  limit: number; offset: number; scope: 'active' | 'closed' | 'all'; from?: string | null; to?: string | null;
  q?: string; priority?: string[]; status?: string[]; assignee?: string[]; source?: string[];
  resolved?: boolean; kind?: string[]; category?: string[]; sort?: 'priority' | 'title' | 'source' | 'assignee' | 'status' | 'updated'; dir?: 'asc' | 'desc';
  access: TicketAccess;
};
export type TicketAccess = { all: boolean; userId: string; ownerProjects: string[]; approverIds: string[]; routing: Record<string, string> };
export type TicketPageMeta = { open: number; highOpen: number; waitingOnYou: number; closed: number; resolved: number; scoped: number; options: Record<'priority'|'status'|'assignee'|'source', string[]>; people: unknown[] };
export type TicketPageResult = { items: TicketRecord[]; total: number; meta: TicketPageMeta };

const sourceLabels: Record<string, string> = { servicenow: 'ServiceNow', jira: 'Jira', pipeline: 'Pipeline', 'data-quality': 'Data quality check', manual: 'Manual', other: 'Other' };
const sourceKey = (t: TicketRecord): string => {
  const source = String(t.source || (t.metadata as {source?: string})?.source || '').toLowerCase();
  const ext = t.externalReference;
  if (source === 'servicenow' || ext?.system === 'servicenow') return 'servicenow';
  if (source === 'jira' || ext?.system === 'jira') return 'jira';
  if (t.pipelineId || ['pipeline','databricks','snowflake'].includes(source)) return 'pipeline';
  if (['agentic-monitor','data-quality','dq','monitor'].includes(source) || (t.context as {businessCheckId?:string})?.businessCheckId || String(t.category || '').toLowerCase() === 'data_quality') return 'data-quality';
  if (!source || source === 'manual' || source === 'demo-manual') return 'manual';
  return 'other';
};
const assigneeName = (t: TicketRecord): string => typeof t.assignee === 'string' ? t.assignee : (t.assignee as {name?:string;id?:string})?.name || (t.assignee as {id?:string})?.id || '';
const closedForPage = (t: TicketRecord): boolean => isClosedTicket(t) || String(t.status||'').toLowerCase() === 'canceled';
const statusForPage = (t: TicketRecord): string => closedForPage(t) ? 'closed' : appStatus(t);
const matches = (values: string[] | undefined, value: string) => !values?.length || values.includes(value.toLowerCase());
const inWindow = (query: TicketPageQuery, t: TicketRecord): boolean => {
  const at = Date.parse(String(t.closedAt || t.updatedAt || t.createdAt || ''));
  return Number.isNaN(at) || ((!query.from || at >= Date.parse(query.from)) && (!query.to || at <= Date.parse(query.to)));
};
const priorityRank = (value: unknown) => ({critical:0,p1:0,high:1,p2:1,medium:2,p3:2,low:3,p4:3} as Record<string,number>)[String(value || '').toLowerCase()] ?? 9;
const statusRank = (t: TicketRecord) => ['waiting_on_you','open','in_progress','closed'].indexOf(statusForPage(t));
function compare(a: TicketRecord,b: TicketRecord,q: TicketPageQuery): number {
  const key = q.sort || 'priority'; let order = 0;
  if (key === 'priority') order = priorityRank(a.priority)-priorityRank(b.priority);
  else if (key === 'status') order = statusRank(a)-statusRank(b);
  else if (key === 'updated') order = Date.parse(String(b.updatedAt||b.createdAt||''))-Date.parse(String(a.updatedAt||a.createdAt||''));
  else {
    const value = (t: TicketRecord) => key === 'title' ? String(t.title||t.failureSummary||'') : key === 'source' ? sourceLabels[sourceKey(t)] : assigneeName(t);
    order = value(a).localeCompare(value(b), undefined, {sensitivity:'base',numeric:true});
  }
  return (q.dir === 'desc' ? -order : order) || a.ticketId.localeCompare(b.ticketId);
}
function collect(tickets: TicketRecord[], key: 'priority'|'status'|'assignee'|'source'): string[] {
  const values = [...new Set(tickets.map(t => key === 'priority' ? String(t.priority||'').toLowerCase() : key === 'status' ? statusForPage(t) : key === 'assignee' ? assigneeName(t) : sourceKey(t)).filter(Boolean))];
  return key === 'priority' ? values.sort((a,b) => priorityRank(a)-priorityRank(b)) : key === 'status' ? values.sort((a,b) => ['waiting_on_you','open','in_progress','closed'].indexOf(a)-['waiting_on_you','open','in_progress','closed'].indexOf(b)) : values.sort();
}
export function pageTicketRows(rows: TicketRecord[], query: TicketPageQuery): TicketPageResult {
  const open = rows.filter(t => !closedForPage(t));
  const closed = rows.filter(t => closedForPage(t) && inWindow(query,t));
  const scoped = query.scope === 'active' ? open : query.scope === 'closed' ? closed : [...open,...closed];
  const term = String(query.q||'').trim().toLowerCase();
  const filtered = scoped.filter(t => {
    const d = decorateTicket(t);
    if (query.resolved && !resolvedWithAgent(t)) return false;
    if (!matches(query.kind, d.kind)) return false;
    if (query.category?.length && !query.category.includes(String(t.category||'').toLowerCase()) && !(query.category.includes('data_quality') && (d.kind === 'data_quality' || sourceKey(t) === 'data-quality'))) return false;
    if (!matches(query.priority, String(t.priority||''))) return false;
    if (!matches(query.status, statusForPage(t))) return false;
    if (query.assignee?.length && !query.assignee.includes(assigneeName(t).toLowerCase()) && !(query.assignee.includes('__none') && !assigneeName(t))) return false;
    if (!matches(query.source, sourceKey(t))) return false;
    if (term && ![t.ticketId,t.externalReference?.number,t.title,t.description,t.pipelineName,t.failureSummary,assigneeName(t)].some(value => String(value||'').toLowerCase().includes(term))) return false;
    return true;
  });
  const people = new Map<string,unknown>();
  for (const t of rows) for (const person of [t.assignee,t.creator,...(Array.isArray(t.collaborators)?t.collaborators:[])]) if (person && typeof person === 'object' && 'id' in person && person.id && person.type !== 'system') people.set(String(person.id),person);
  return {items:filtered.sort((a,b)=>compare(a,b,query)).slice(query.offset,query.offset+query.limit),total:filtered.length,meta:{open:open.length,highOpen:open.filter(t=>['critical','high'].includes(String(t.priority||'').toLowerCase())).length,waitingOnYou:open.filter(t=>appStatus(t)==='waiting_on_you').length,closed:closed.length,resolved:closed.filter(resolvedWithAgent).length,scoped:scoped.length,options:{priority:collect(scoped,'priority'),status:collect(scoped,'status'),assignee:collect(scoped,'assignee'),source:collect(scoped,'source')},people:[...people.values()]}};
}

// SPEC-projects-02 FR-20..FR-23, the file-store twin of VISIBLE_TICKETS_SQL. Every ticket reader shares both, so they cannot drift.
export function ticketVisible(ticket: TicketRecord, access: TicketAccess): boolean {
  if (access.all || access.ownerProjects.includes(ticket.projectId) || ['project','operators'].includes(String(ticket.visibility||''))) return true;
  const idOf = (value: unknown): string => typeof value === 'string' ? value : value && typeof value === 'object' && 'id' in value ? String(value.id||'') : '';
  if ([ticket.creator,ticket.requester,ticket.assignee,...(Array.isArray(ticket.collaborators)?ticket.collaborators:[])].some(actor => idOf(actor) === access.userId)) return true;
  const routed = [ticket.category,ticket.type,ticket.pipelineId ? 'pipeline_failure' : null].map(value => String(value||'').toLowerCase().trim().replace(/[\s-]+/g,'_')).find(key => access.routing[key]);
  const approver = ticket.approver ? idOf(ticket.approver) : access.routing[routed || 'default'] || access.routing.default || '';
  return Boolean(approver) && access.approverIds.includes(approver);
}

// The project scope ($1) and access check ($2->'access') as the `input` and `visible` CTEs; later CTEs read `visible`.
export const VISIBLE_TICKETS_SQL = `
    WITH input AS (SELECT $2::jsonb AS q),
    visible AS (
      SELECT t.*, t.data || jsonb_build_object('projectId',t.project_id) AS ticket
      FROM ops_tickets t CROSS JOIN input i
      WHERE ($1::text[] IS NULL OR t.project_id = ANY($1::text[]))
        AND (
          (i.q->'access'->>'all')::boolean
          OR t.project_id = ANY(SELECT jsonb_array_elements_text(i.q->'access'->'ownerProjects'))
          OR t.data->>'visibility' IN ('project','operators')
          OR EXISTS (
            SELECT 1 FROM jsonb_array_elements(jsonb_build_array(t.data->'creator',t.data->'requester',t.data->'assignee') || COALESCE(t.data->'collaborators','[]'::jsonb)) member
            WHERE COALESCE(member->>'id', member #>> '{}') = i.q->'access'->>'userId'
          )
          OR COALESCE(t.data->'approver'->>'id', t.data->>'approver',
              i.q->'access'->'routing'->>replace(replace(lower(t.data->>'category'),' ','_'),'-','_'),
              i.q->'access'->'routing'->>replace(replace(lower(t.data->>'type'),' ','_'),'-','_'),
              CASE WHEN t.data->>'pipelineId' IS NOT NULL THEN i.q->'access'->'routing'->>'pipeline_failure' END,
              i.q->'access'->'routing'->>'default') = ANY(SELECT jsonb_array_elements_text(i.q->'access'->'approverIds'))
        )
    )`;

// Every filter, the access check, and the order run before LIMIT/OFFSET in Postgres.
// Only fixed SQL fragments are interpolated; all request values are in $2::jsonb.
export function ticketPageSql(query: TicketPageQuery) {
  const sort = {
    priority: 'priority_rank', title: 'lower(coalesce(data->>\'title\',data->>\'failureSummary\',\'\'))',
    source: 'source_label', assignee: 'lower(assignee_name)', status: 'status_rank', updated: 'coalesce(data->>\'updatedAt\',data->>\'createdAt\',\'\')',
  }[query.sort || 'priority'];
  const direction = query.dir === 'desc' ? 'DESC' : 'ASC';
  // The updated column has newest-first semantics when the UI says ascending.
  const order = query.sort === 'updated' && query.dir !== 'desc' ? 'DESC' : query.sort === 'updated' ? 'ASC' : direction;
  const cte = `${VISIBLE_TICKETS_SQL},
    computed AS (
      SELECT v.*, lower(coalesce(v.data->>'priority','')) AS priority_value,
        COALESCE(v.data->'assignee'->>'name',v.data->'assignee'->>'id',v.data->>'assignee','') AS assignee_name,
        lower(coalesce(v.data->>'source',v.data->'metadata'->>'source','')) AS raw_source,
        lower(coalesce(v.data->>'status',v.status)) IN ('closed','resolved','cancelled','canceled','archived') AS closed,
        CASE WHEN lower(coalesce(v.data->>'status',v.status)) IN ('closed','resolved','cancelled','canceled','archived') THEN 'closed'
             WHEN v.data->>'taskStatus' = 'waiting' THEN 'waiting_on_you'
             WHEN v.data->>'taskStatus' IN ('running','queued') OR coalesce(v.data->'assignee'->>'id',v.data->'assignee'->>'name',v.data->>'assignee','') <> ''
               OR lower(coalesce(v.data->>'status',v.status)) IN ('in_progress','waiting','awaiting_approval') THEN 'in_progress'
             ELSE 'open' END AS app_status,
        CASE WHEN v.data->>'pipelineId' IS NOT NULL OR lower(concat_ws(' ',v.data->>'category',v.data->>'type',v.data->>'title',v.data->>'tags')) ~ 'pipeline|job fail|load failed|run failed' THEN 'pipeline'
             WHEN lower(concat_ws(' ',v.data->>'category',v.data->>'type',v.data->>'title',v.data->>'tags')) ~ '(^|[^a-z])dq([^a-z]|$)|data.?quality|quality check' THEN 'data_quality'
             WHEN lower(concat_ws(' ',v.data->>'category',v.data->>'type',v.data->>'title',v.data->>'tags')) ~ 'access|offboard|entitlement|permission' THEN 'access'
             ELSE 'other' END AS kind_value,
        CASE WHEN lower(v.data->>'source') = 'servicenow' OR v.data->'externalReference'->>'system' = 'servicenow' THEN 'servicenow'
             WHEN lower(v.data->>'source') = 'jira' OR v.data->'externalReference'->>'system' = 'jira' THEN 'jira'
             WHEN v.data->>'pipelineId' IS NOT NULL OR lower(coalesce(v.data->>'source',v.data->'metadata'->>'source','')) IN ('pipeline','databricks','snowflake') THEN 'pipeline'
             WHEN lower(coalesce(v.data->>'source',v.data->'metadata'->>'source','')) IN ('agentic-monitor','data-quality','dq','monitor') OR v.data->'context'->>'businessCheckId' IS NOT NULL OR lower(v.data->>'category') = 'data_quality' THEN 'data-quality'
             WHEN lower(coalesce(v.data->>'source',v.data->'metadata'->>'source','')) IN ('','manual','demo-manual') THEN 'manual'
             ELSE 'other' END AS source_value,
        (lower(coalesce(v.data->>'status',v.status)) IN ('closed','resolved','cancelled','archived') AND v.data->>'taskId' IS NOT NULL AND COALESCE((v.data->>'taskChanges')::numeric,0) > 0) AS agent_fixed
      FROM visible v
    ),
    ranked AS (
      SELECT c.*,
        CASE c.priority_value WHEN 'critical' THEN 0 WHEN 'p1' THEN 0 WHEN 'high' THEN 1 WHEN 'p2' THEN 1 WHEN 'medium' THEN 2 WHEN 'p3' THEN 2 WHEN 'low' THEN 3 WHEN 'p4' THEN 3 ELSE 9 END AS priority_rank,
        CASE c.app_status WHEN 'waiting_on_you' THEN 0 WHEN 'open' THEN 1 WHEN 'in_progress' THEN 2 ELSE 3 END AS status_rank,
        CASE c.source_value WHEN 'servicenow' THEN 'ServiceNow' WHEN 'jira' THEN 'Jira' WHEN 'pipeline' THEN 'Pipeline' WHEN 'data-quality' THEN 'Data quality check' WHEN 'manual' THEN 'Manual' ELSE 'Other' END AS source_label
      FROM computed c
    ),
    scoped AS (
      SELECT r.* FROM ranked r CROSS JOIN input i
      WHERE (NOT r.closed AND i.q->>'scope' IN ('active','all')) OR (
        r.closed AND i.q->>'scope' IN ('closed','all')
        AND (i.q->>'from' IS NULL OR COALESCE(r.data->>'closedAt',r.data->>'updatedAt',r.data->>'createdAt','') >= i.q->>'from')
        AND (i.q->>'to' IS NULL OR COALESCE(r.data->>'closedAt',r.data->>'updatedAt',r.data->>'createdAt','') <= i.q->>'to')
      )
    ),
    filtered AS (
      SELECT s.* FROM scoped s CROSS JOIN input i WHERE
        (COALESCE((i.q->>'resolved')::boolean,false) = false OR (s.closed AND s.agent_fixed))
        AND (i.q->'priority' IS NULL OR s.priority_value = ANY(SELECT jsonb_array_elements_text(i.q->'priority')))
        AND (i.q->'status' IS NULL OR s.app_status = ANY(SELECT jsonb_array_elements_text(i.q->'status')))
        AND (i.q->'assignee' IS NULL OR lower(s.assignee_name) = ANY(SELECT jsonb_array_elements_text(i.q->'assignee')) OR (s.assignee_name = '' AND '__none' = ANY(SELECT jsonb_array_elements_text(i.q->'assignee'))))
        AND (i.q->'source' IS NULL OR s.source_value = ANY(SELECT jsonb_array_elements_text(i.q->'source')))
        AND (i.q->'kind' IS NULL OR s.kind_value = ANY(SELECT jsonb_array_elements_text(i.q->'kind')))
        AND (i.q->'category' IS NULL OR lower(coalesce(s.data->>'category','')) = ANY(SELECT jsonb_array_elements_text(i.q->'category')) OR ('data_quality' = ANY(SELECT jsonb_array_elements_text(i.q->'category')) AND (s.kind_value = 'data_quality' OR s.source_value = 'data-quality')))
        AND (COALESCE(i.q->>'q','') = '' OR EXISTS (SELECT 1 FROM unnest(ARRAY[s.ticket_id,s.data->'externalReference'->>'number',s.data->>'title',s.data->>'description',s.data->>'pipelineName',s.data->>'failureSummary',s.assignee_name]) term WHERE strpos(lower(coalesce(term,'')), lower(i.q->>'q')) > 0))
    )`;
  return {
    page: `${cte} SELECT ticket AS data FROM filtered ORDER BY ${sort} ${order}, ticket_id ASC LIMIT $3 OFFSET $4`,
    total: `${cte} SELECT count(*)::integer AS total FROM filtered`,
    meta: `${cte} SELECT
      (SELECT count(*)::integer FROM ranked WHERE NOT closed) AS open,
      (SELECT count(*)::integer FROM ranked WHERE NOT closed AND priority_value IN ('critical','high')) AS "highOpen",
      (SELECT count(*)::integer FROM ranked WHERE NOT closed AND app_status = 'waiting_on_you') AS "waitingOnYou",
      (SELECT count(*)::integer FROM ranked r CROSS JOIN input i WHERE r.closed AND (i.q->>'from' IS NULL OR COALESCE(r.data->>'closedAt',r.data->>'updatedAt',r.data->>'createdAt','') >= i.q->>'from') AND (i.q->>'to' IS NULL OR COALESCE(r.data->>'closedAt',r.data->>'updatedAt',r.data->>'createdAt','') <= i.q->>'to')) AS closed,
      (SELECT count(*)::integer FROM ranked r CROSS JOIN input i WHERE r.closed AND r.agent_fixed AND (i.q->>'from' IS NULL OR COALESCE(r.data->>'closedAt',r.data->>'updatedAt',r.data->>'createdAt','') >= i.q->>'from') AND (i.q->>'to' IS NULL OR COALESCE(r.data->>'closedAt',r.data->>'updatedAt',r.data->>'createdAt','') <= i.q->>'to')) AS resolved,
      (SELECT count(*)::integer FROM scoped) AS scoped,
      (SELECT COALESCE(jsonb_agg(DISTINCT priority_value) FILTER (WHERE priority_value <> ''),'[]'::jsonb) FROM scoped) AS priority,
      (SELECT COALESCE(jsonb_agg(DISTINCT app_status),'[]'::jsonb) FROM scoped) AS status,
      (SELECT COALESCE(jsonb_agg(DISTINCT assignee_name) FILTER (WHERE assignee_name <> ''),'[]'::jsonb) FROM scoped) AS assignee,
      (SELECT COALESCE(jsonb_agg(DISTINCT source_value),'[]'::jsonb) FROM scoped) AS source,
      (SELECT COALESCE(jsonb_agg(DISTINCT person) FILTER (WHERE person IS NOT NULL),'[]'::jsonb) FROM visible v CROSS JOIN LATERAL jsonb_array_elements(jsonb_build_array(v.data->'assignee',v.data->'creator') || COALESCE(v.data->'collaborators','[]'::jsonb)) person WHERE person->>'id' IS NOT NULL AND person->>'type' IS DISTINCT FROM 'system') AS people`,
  };
}

/* ------------------------------------------------- Overview ticket numbers (ADR 0021) */

export type OverviewTicketQuery = { from: string | null; to: string | null; buckets: Array<[number, number]> };
export type OverviewTicketSummary = {
  ticketSummary: { open: number; closed: number; raised: number; openFromWindow: number; closedInWindow: number; byPriority: Record<'p1'|'p2'|'p3'|'p4'|'other', number>; resolvedWithAgent: number };
  agentResolved: { total: number; inWindow: number; pipelines: number; dataQuality: number };
  dqOpen: number;
  chart: { raised: number[]; resolved: number[]; dqResolved: number[] };
};

// The chart and dqOpen have always also treated `canceled` as closed; the summary has not (SPEC-overview-01 Known gaps).
const CHART_CLOSED = ['closed', 'cancelled', 'canceled', 'resolved', 'archived'];
const PRIORITY_KEY: Record<string, 'p1'|'p2'|'p3'|'p4'> = { critical: 'p1', high: 'p2', medium: 'p3', low: 'p4' };
const DQ_SOURCES = ['agentic-monitor', 'data-quality', 'dq', 'monitor'];
const parseMs = (value: unknown): number | undefined => { const at = Date.parse(String(value || '')); return Number.isFinite(at) ? at : undefined; };

/** SPEC-overview-01 FR-3/FR-4/FR-8 over tickets the reader may see: the file-store twin of ticketOverviewSql. */
export function overviewTicketRows(rows: TicketRecord[], query: OverviewTicketQuery): OverviewTicketSummary {
  const tickets = rows.map(decorateTicket);
  const from = parseMs(query.from) ?? null, to = parseMs(query.to) ?? null;
  const inWindow = (value: unknown) => { if (from === null && to === null) return true; const at = parseMs(value); return at !== undefined && (from === null || at >= from) && (to === null || at <= to); };
  const doneAt = (t: TicketRecord) => t.closedAt || t.updatedAt;
  const chartClosed = (t: TicketRecord) => CHART_CLOSED.includes(String(t.status).toLowerCase());
  const counts = (list: TicketRecord[], at: (t: TicketRecord) => unknown) => query.buckets.map(([start, end]) => list.filter(t => { const ms = Date.parse(String(at(t))); return ms >= start && ms < end; }).length);
  const open = tickets.filter(t => !isClosedTicket(t));
  const raised = tickets.filter(t => inWindow(t.createdAt));
  const byPriority = { p1: 0, p2: 0, p3: 0, p4: 0, other: 0 };
  for (const t of open) byPriority[PRIORITY_KEY[String(t.priority || 'other').toLowerCase()] || 'other'] += 1;
  const agent = tickets.filter(t => t.resolvedWithAgent);
  const agentInWindow = agent.filter(t => inWindow(doneAt(t)));
  const dqOpen = tickets.filter(t => !chartClosed(t) && (t.kind === 'data_quality' || String(t.category || '').toLowerCase() === 'data_quality'
    || DQ_SOURCES.includes(String(t.source || (t.metadata as {source?: string})?.source || '').toLowerCase()) || (t.context as {businessCheckId?: string})?.businessCheckId)).length;
  return {
    ticketSummary: { open: open.length, closed: tickets.length - open.length, raised: raised.length, openFromWindow: raised.filter(t => !isClosedTicket(t)).length,
      closedInWindow: tickets.filter(t => isClosedTicket(t) && inWindow(doneAt(t))).length, byPriority, resolvedWithAgent: agentInWindow.length },
    agentResolved: { total: agent.length, inWindow: agentInWindow.length, pipelines: agentInWindow.filter(t => t.kind === 'pipeline').length, dataQuality: agentInWindow.filter(t => t.kind === 'data_quality').length },
    dqOpen,
    chart: { raised: counts(tickets, t => t.createdAt), resolved: counts(tickets.filter(chartClosed), doneAt), dqResolved: counts(tickets.filter(t => t.resolvedWithAgent && t.kind === 'data_quality'), doneAt) },
  };
}

const iso = (ms: number) => { const at = new Date(ms); if (Number.isNaN(at.getTime())) throw httpError(400, 'Invalid chart buckets.'); return at.toISOString(); };
/** $2 for ticketOverviewSql: dates normalised here so Postgres never parses a request string itself. */
export function ticketOverviewParams(access: TicketAccess, query: OverviewTicketQuery) {
  const edge = (value: string | null) => { const at = parseMs(value); return at === undefined ? null : iso(at); };
  return { access, from: edge(query.from), to: edge(query.to), buckets: query.buckets.map(([start, end]) => [iso(start), iso(end)]) };
}

// Stored dates are toISOString() output (connectors normalise imports). A bare date is UTC midnight, as Date.parse reads it.
// Anything else, including a zoneless time Date.parse would read in server-local time, reads as no date instead of failing the query.
const tsSql = (expr: string) => `CASE WHEN ${expr} ~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9](\\.[0-9]{1,6})?)?(Z|[+-][0-9]{2}:?[0-9]{2})$' THEN (${expr})::timestamptz
  WHEN ${expr} ~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$' THEN ((${expr}) || 'T00:00:00Z')::timestamptz END`;
const inWindowSql = (column: string) => `((w.w_from IS NULL AND w.w_to IS NULL) OR (${column} IS NOT NULL AND (w.w_from IS NULL OR ${column} >= w.w_from) AND (w.w_to IS NULL OR ${column} <= w.w_to)))`;

/** One row of counts over VISIBLE_TICKETS_SQL; no ticket data or activity leaves Postgres. Mirrors overviewTicketRows. */
export function ticketOverviewSql(): string {
  return `${VISIBLE_TICKETS_SQL},
    win AS (SELECT (i.q->>'from')::timestamptz AS w_from, (i.q->>'to')::timestamptz AS w_to FROM input i),
    base AS (
      SELECT lower(coalesce(v.data->>'status','')) AS st,
        ${tsSql("v.data->>'createdAt'")} AS created_at,
        ${tsSql("coalesce(nullif(v.data->>'closedAt',''), v.data->>'updatedAt')")} AS done_at,
        CASE lower(coalesce(nullif(v.data->>'priority',''),'other')) WHEN 'critical' THEN 'p1' WHEN 'high' THEN 'p2' WHEN 'medium' THEN 'p3' WHEN 'low' THEN 'p4' ELSE 'other' END AS priority_key,
        (nullif(v.data->>'taskId','') IS NOT NULL AND CASE WHEN v.data->>'taskChanges' ~ '^\\s*-?[0-9]+(\\.[0-9]+)?\\s*$' THEN (v.data->>'taskChanges')::numeric ELSE 0 END > 0) AS has_changes,
        CASE WHEN nullif(v.data->>'pipelineId','') IS NOT NULL OR k.words ~ 'pipeline|job fail|load failed|run failed' THEN 'pipeline'
             WHEN k.words ~ '\\ydq\\y|data.?quality|quality check' THEN 'data_quality'
             WHEN k.words ~ 'access|offboard|entitlement|permission' THEN 'access'
             ELSE 'other' END AS kind,
        lower(coalesce(v.data->>'category','')) AS category,
        lower(coalesce(nullif(v.data->>'source',''), v.data->'metadata'->>'source','')) AS source,
        nullif(v.data->'context'->>'businessCheckId','') IS NOT NULL AS business_check
      FROM visible v
      CROSS JOIN LATERAL (SELECT lower(concat_ws(' ', v.data->>'category', v.data->>'type',
        (SELECT string_agg(tag, ' ') FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(v.data->'tags') = 'array' THEN v.data->'tags' ELSE '[]'::jsonb END) tag),
        v.data->>'title')) AS words) k
    ),
    marked AS (
      SELECT b.*, b.st IN ('closed','cancelled','resolved','archived') AS closed, b.st IN ('closed','cancelled','canceled','resolved','archived') AS chart_closed,
        b.st IN ('closed','cancelled','resolved','archived') AND b.has_changes AS agent
      FROM base b
    ),
    buckets AS (
      SELECT x.idx, (x.edge->>0)::timestamptz AS b_from, (x.edge->>1)::timestamptz AS b_to
      FROM input i CROSS JOIN LATERAL jsonb_array_elements(i.q->'buckets') WITH ORDINALITY x(edge, idx)
    )
    SELECT
      count(*) FILTER (WHERE NOT m.closed) AS open,
      count(*) FILTER (WHERE m.closed) AS closed,
      count(*) FILTER (WHERE ${inWindowSql('m.created_at')}) AS raised,
      count(*) FILTER (WHERE NOT m.closed AND ${inWindowSql('m.created_at')}) AS "openFromWindow",
      count(*) FILTER (WHERE m.closed AND ${inWindowSql('m.done_at')}) AS "closedInWindow",
      count(*) FILTER (WHERE NOT m.closed AND m.priority_key = 'p1') AS p1,
      count(*) FILTER (WHERE NOT m.closed AND m.priority_key = 'p2') AS p2,
      count(*) FILTER (WHERE NOT m.closed AND m.priority_key = 'p3') AS p3,
      count(*) FILTER (WHERE NOT m.closed AND m.priority_key = 'p4') AS p4,
      count(*) FILTER (WHERE NOT m.closed AND m.priority_key = 'other') AS other,
      count(*) FILTER (WHERE m.agent) AS "agentTotal",
      count(*) FILTER (WHERE m.agent AND ${inWindowSql('m.done_at')}) AS "agentInWindow",
      count(*) FILTER (WHERE m.agent AND m.kind = 'pipeline' AND ${inWindowSql('m.done_at')}) AS "agentPipelines",
      count(*) FILTER (WHERE m.agent AND m.kind = 'data_quality' AND ${inWindowSql('m.done_at')}) AS "agentDataQuality",
      count(*) FILTER (WHERE NOT m.chart_closed AND (m.kind = 'data_quality' OR m.category = 'data_quality' OR m.source IN ('agentic-monitor','data-quality','dq','monitor') OR m.business_check)) AS "dqOpen",
      (SELECT COALESCE(jsonb_agg(jsonb_build_array(
          (SELECT count(*) FROM marked c WHERE c.created_at >= b.b_from AND c.created_at < b.b_to),
          (SELECT count(*) FROM marked c WHERE c.chart_closed AND c.done_at >= b.b_from AND c.done_at < b.b_to),
          (SELECT count(*) FROM marked c WHERE c.agent AND c.kind = 'data_quality' AND c.done_at >= b.b_from AND c.done_at < b.b_to)
        ) ORDER BY b.idx), '[]'::jsonb) FROM buckets b) AS chart
    FROM marked m CROSS JOIN win w`;
}

/* ------------------------------------------------- Overview "Your work" tickets (ADR 0021) */

/** `mineKeys` is identityKeys(reader): only tickets whose assignee or a collaborator shares one of them. Null means the whole queue. */
export type AttentionQuery = { mineKeys: string[] | null; limit: number };

const priorityOf = (t: TicketRecord): string => String(t.priority || 'other').toLowerCase();
const attentionRank = (t: TicketRecord): number => ((PRIORITY_WEIGHT as Record<string, number>)[priorityOf(t)] ?? 4) * 10 + 2;
const attentionStamp = (t: TicketRecord): string => String(t.updatedAt || t.createdAt || '');

/** SPEC-overview-01 FR-6, tickets only: open, rank (priority x 10 + 2) then newest update, optionally the reader's own. File-store twin of attentionTicketsSql. */
export function attentionTicketRows(rows: TicketRecord[], query: AttentionQuery): TicketRecord[] {
  const mine = query.mineKeys && new Set(query.mineKeys);
  const isMine = (t: TicketRecord) => [t.assignee, ...(Array.isArray(t.collaborators) ? t.collaborators : [])].some(actor => identityKeys(actor).some(key => mine && mine.has(key)));
  return rows.filter(t => !isClosedTicket(t) && (!mine || isMine(t)))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .sort((a, b) => attentionRank(a) - attentionRank(b) || attentionStamp(b).localeCompare(attentionStamp(a)))
    .slice(0, query.limit);
}

// Mirrors identityKeys(): id, email and name lowercased, plus the part before @ of an email or id; a plain string is its own key.
const actorKeysSql = (a: string) => `
    SELECT k FROM (
      SELECT lower(${a} #>> '{}') AS k WHERE jsonb_typeof(${a}) = 'string'
      UNION ALL SELECT lower(split_part(${a} #>> '{}', '@', 1)) WHERE jsonb_typeof(${a}) = 'string' AND strpos(${a} #>> '{}', '@') > 0
      UNION ALL SELECT lower(${a} ->> f) FROM unnest(ARRAY['id','email','name']) f WHERE jsonb_typeof(${a}) = 'object' AND coalesce(${a} ->> f, '') <> ''
      UNION ALL SELECT lower(split_part(${a} ->> f, '@', 1)) FROM unnest(ARRAY['email','id']) f WHERE jsonb_typeof(${a}) = 'object' AND strpos(coalesce(${a} ->> f, ''), '@') > 0
    ) keys WHERE k <> ''`;
const priorityRankSql = (prio: string) => `(CASE ${prio} ${Object.entries(PRIORITY_WEIGHT).map(([name, weight]) => `WHEN '${name}' THEN ${weight}`).join(' ')} ELSE 4 END) * 10 + 2`;
const OPEN_SQL = `lower(coalesce(v.data->>'status','')) NOT IN ('closed','cancelled','resolved','archived')`;

/** $1 scope, $2 {access}, $3 reader keys or null, $4 limit. Only the fields an attention item shows leave Postgres. */
export function attentionTicketsSql(): string {
  return `${VISIBLE_TICKETS_SQL},
    open_tickets AS (
      SELECT v.ticket_id, v.created_at, v.data,
        lower(coalesce(nullif(v.data->>'priority',''), 'other')) AS prio,
        coalesce(nullif(v.data->>'updatedAt',''), v.data->>'createdAt', '') AS stamp
      FROM visible v
      WHERE ${OPEN_SQL}
        AND ($3::text[] IS NULL OR EXISTS (
          SELECT 1 FROM jsonb_array_elements(jsonb_build_array(v.data->'assignee') || CASE WHEN jsonb_typeof(v.data->'collaborators') = 'array' THEN v.data->'collaborators' ELSE '[]'::jsonb END) a
          WHERE EXISTS (${actorKeysSql('a.value')} AND k = ANY($3::text[]))
        ))
    )
    SELECT jsonb_build_object('ticketId', o.ticket_id, 'projectId', o.data->>'projectId', 'title', o.data->>'title', 'failureSummary', o.data->>'failureSummary', 'status', o.data->>'status',
      'priority', o.data->>'priority', 'assignee', o.data->'assignee', 'createdAt', o.data->>'createdAt', 'updatedAt', o.data->>'updatedAt') AS data
    FROM open_tickets o
    ORDER BY ${priorityRankSql('o.prio')} ASC, o.stamp COLLATE "C" DESC, o.created_at DESC, o.ticket_id ASC
    LIMIT $4`;
}

/** $1 scope, $2 {access}, $3 pipeline ids: which of them already have an open ticket this reader can see. */
export function visibleOpenPipelinesSql(): string {
  return `${VISIBLE_TICKETS_SQL}
    SELECT DISTINCT v.data->>'pipelineId' AS pid FROM visible v
    WHERE ${OPEN_SQL} AND v.data->>'pipelineId' = ANY($3::text[])`;
}

/** Shapes the ticketOverviewSql row like overviewTicketRows; Postgres returns counts as strings. */
export function ticketOverviewResult(row: Record<string, unknown>): OverviewTicketSummary {
  const n = (key: string) => Number(row[key] || 0);
  const chart = (row.chart as Array<[number|string, number|string, number|string]>) || [];
  return {
    ticketSummary: { open: n('open'), closed: n('closed'), raised: n('raised'), openFromWindow: n('openFromWindow'), closedInWindow: n('closedInWindow'),
      byPriority: { p1: n('p1'), p2: n('p2'), p3: n('p3'), p4: n('p4'), other: n('other') }, resolvedWithAgent: n('agentInWindow') },
    agentResolved: { total: n('agentTotal'), inWindow: n('agentInWindow'), pipelines: n('agentPipelines'), dataQuality: n('agentDataQuality') },
    dqOpen: n('dqOpen'),
    chart: { raised: chart.map(b => Number(b[0])), resolved: chart.map(b => Number(b[1])), dqResolved: chart.map(b => Number(b[2])) },
  };
}
