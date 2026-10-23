import { randomUUID } from 'node:crypto';
import { config } from '../config.mjs';
import { decorateTicket, LINK_RELATIONS, PRIORITY_WEIGHT, identityKeys as identityKeysOf, sameIdentity as sameIdentityOf } from './ticket-view.mjs';
import { failureSignature } from './ticket-signature.mjs';
import { bm25Ranker } from './ticket-similarity.mjs';
import { filterPipelines } from '../platform/pipeline-filter.mjs';
import { pipelineHealth } from '../platform/pipeline-health.mjs';
import { AGENT_NAME } from '../tasks/task-runtime.mjs';
import { now, CLOSED_STATUSES as CLOSED, httpError } from '../lib/util.mjs';
import { DEFAULT_PROJECT_ID, assertRowInScope, assertScope, systemScope, writeProjectId } from '../projects/project-access.mjs';
import { asRegistry } from '../workspace/workspace.mjs';
import { forProject } from '../projects/project-bound.mjs';
import { UNROUTED_ID } from '../projects/project-store.mjs';
import { STATE } from '../monitoring/monitor-store.mjs';
import { effectiveAutomation, triggerFor } from '../monitoring/automation-settings.mjs';
import { compareNotificationPosition, encodeNotificationPosition, isBellNotification, matchesNotificationView, pageNotifications, type NotificationPosition, type NotificationView } from './notification-page.mjs';
import type { OperationsStore, TicketRecord, ProjectScope } from './operations-store.mjs';

type Actor = string | {id?:string;name?:string;email?:string;type?:string;via?:string;groups?:string[];roles?:string[]}|null;
type ServiceUser = {id?:string;name?:string;email?:string;role?:string;roles?:string[];groups?:string[];projectOwnerIds?:string[];via?:string;type?:string};
type Scope = ProjectScope & {projectId:string;admin?:boolean;memberProjectIds?:readonly string[]};
type OpsTicket = Omit<TicketRecord,'creator'|'assignee'|'activity'|'externalReference'|'resolutionSummary'|'sourceKey'> & {description?:string;failureSummary?:string;priority?:string;kind?:string;type?:string;category?:string;visibility?:string;requester?:Actor;collaborators?:Actor[];approver?:Actor;pipelineId?:string;runId?:string;resolvedWithAgent?:boolean;resolutionSummary?:string|null;tags?:string[];links?:TicketLink[];recurrence?:{ofTicketId:string}|null;creator?:Actor;assignee?:Actor;externalReference?:{system?:string;sysId?:string;number?:string;name?:string;url?:string};source?:string;sourceRef?:string;sourceKey?:string|null;connectionId?:string;activity?:OpsActivity[];appStatus?:string;closedAt?:string|null;updatedAt:string;createdAt:string;taskId?:string|null;title:string;ticketId:string;projectId:string;status:string};
type OpsActivity = {id?:string;type:string;status?:string;title?:string;detail?:string|null;at?:string;actor?:Actor;relatedTicketId?:string;recurrenceOf?:string;ticketId?:string;[field:string]:unknown};
type TicketLink = {ticketId:string;relation?:string;direction?:string;title?:string;detail?:string|null;[field:string]:unknown};
type PlatformApi = {status():Promise<{providers?:Array<{ready?:boolean;provider:string}>}>;listPipelines(input:Record<string,unknown>):Promise<PipelineInventory|PipelineRecord[]>;listRuns(input:Record<string,unknown>):Promise<RunList|RunRecord[]>;getPipeline(input:Record<string,unknown>):Promise<PipelineRecord>;getRun(input:Record<string,unknown>):Promise<RunRecord>};
type PipelineRecord = {pipelineId:string;name:string;platform?:string;dagId?:string;dagName?:string;schedule?:unknown;status?:string;owner?:string;health?:string;[field:string]:unknown};
type RunRecord = {runId:string;pipelineId:string;platform?:string;status?:string;startTime?:string;endTime?:string;failureSummary?:string;failingTask?:string;durationMs?:number;rawState?:string;name?:string;ticket?:{ticketId?:string}|null;[field:string]:unknown};
type PipelineInventory = {pipelines?:PipelineRecord[];items?:PipelineRecord[];sources?:Array<Record<string,unknown>>};
type RunList = {items?:RunRecord[]};
type ImportedIncident = {sourceKey?:string|null;sourceRef?:string;number?:string;title?:string;description?:string;priority?:string;status?:string;assignee?:Actor;externalReference?:{system?:string;sysId?:string;number?:string;url?:string};metadata?:{serviceNow?:{state?:string;assignmentGroup?:string};jira?:{status?:string};[field:string]:unknown};createdAt?:string;updatedAt?:string;projectId?:string;ticketId?:string;activity?:OpsActivity[];[field:string]:unknown};
type IncidentListResult = {items?:ImportedIncident[];incidents:ImportedIncident[];total?:number;instance?:string;site?:string;source?:string;query?:string;[field:string]:unknown};
type ServiceNowApi = {status(input?:{verify?:boolean;scope?:Scope}):Promise<{mode?:string;configured?:boolean;ready?:boolean;reason?:string;assignmentGroups?:unknown[]}>;listIncidents(input:Record<string,unknown>):Promise<IncidentListResult>;getIncident?(ref:string):Promise<ImportedIncident|null>;updateIncident(input:{sysId?:string;fields:Record<string,unknown>}):Promise<unknown>;findByCorrelation?(key:string):Promise<ImportedIncident|null>;createIncident?(input:Record<string,unknown>):Promise<ImportedIncident>};
type JiraApi = {status?(input?:{verify?:boolean;scope?:Scope}):Promise<{mode?:string;configured?:boolean;ready?:boolean;reason?:string}>;searchIssues(input:Record<string,unknown>):Promise<IncidentListResult>;addComment(ref:string|undefined,body:string):Promise<unknown>;assign(ref:string|undefined,user:unknown):Promise<unknown>;updateFields(ref:string|undefined,fields:Record<string,unknown>):Promise<unknown>;transitionTo(ref:string|undefined,category:string,status?:string):Promise<unknown>;findByLabel?(key:string):Promise<ImportedIncident|null>;createIssue?(input:Record<string,unknown>):Promise<ImportedIncident>};
type DataQualityApi = {getConfig?():Promise<Record<string,unknown>|null>};
type ProjectBound<T> = T | {for(project:Scope|string):Promise<T>;whenAll?:()=>Promise<T>};
type ConnectionApi = {getDefault?(provider:string,projectId?:string):Promise<{id?:string}|null>;projects?:unknown;forProject?(projectId:string):ConnectionApi;providerStatuses?():Promise<Array<{provider?:string;id?:string;ready?:boolean;configured?:boolean;reason?:string}>>};
type OpsStore = Omit<OperationsStore,'getTicket'|'listTickets'|'createTicket'|'updateTicket'|'appendActivity'|'setTicketProject'|'findTicketsBySignature'> & {getTicket(id:string):Promise<OpsTicket|null>;listTickets(scope:Scope):Promise<OpsTicket[]>;createTicket(ticket:OpsTicket):Promise<OpsTicket>;updateTicket(id:string,patch:Record<string,unknown>,options?:{touch?:boolean}):Promise<OpsTicket>;appendActivity(id:string,events:OpsActivity[]):Promise<OpsTicket>;setTicketProject(id:string,projectId:string):Promise<OpsTicket>;findTicketsBySignature(signature:string,scope:Scope):Promise<OpsTicket[]>;findTicketBySourceKey?(key:string|null|undefined,connectionId?:string):Promise<OpsTicket|null>;findTicketBySourceRef?(ref:string):Promise<OpsTicket|null>};
type GrantsService={route(connectionId:string,provider:string,incident:ImportedIncident):Promise<{projectId:string}>};
type MonitorAlert = {id:string;subject?:{type?:string;platform?:string;id?:string};status:string;trigger?:string;openedAt?:string;ticketId?:string;investigation?:{taskId?:string;status?:string};occurrences?:Array<{runId?:string;slot?:string}>};
type MonitorSnapshot = {fetchedAt?:string;pipelines?:PipelineRecord[];providers?:string[];sources?:Array<Record<string,unknown>>;providerDiagnostics?:Inventory['providerDiagnostics']};
type MonitorStoreApi = {getState(projectId:string,key:string):Promise<MonitorSnapshot|null>;listRuns(projectId:string,options?:{fromMs?:number;pipelineId?:string;platform?:string;limit?:number;offset?:number}):Promise<{items:RunRecord[];total:number}>;listAlerts(projectId:string,options:{limit:number}):Promise<{items:MonitorAlert[]}>};
type MonitorExtras = {slots:Map<string,{missed?:number;late?:number;slots?:Array<{at:string;[key:string]:unknown}>}>;openAlerts:Map<string,Record<string,unknown>>;taskByRun:Map<string,{taskId?:string|null;alertId?:string|null;ticketId?:string|null}>;taskBySlot:Map<string,{taskId?:string|null;alertId?:string|null;ticketId?:string|null}>;automation:Record<string,unknown>|null};
type OpsServiceOptions = {store:OperationsStore;dataPlatform?:ProjectBound<PlatformApi>;dataQualityService?:ProjectBound<DataQualityApi>;serviceNow?:ProjectBound<ServiceNowApi>;jira?:ProjectBound<JiraApi>;connectionService?:ConnectionApi;projects?:ProjectService|null;grants?:GrantsService|null;pinned?:PinnedClients|null;audit?:AuditFn|null;monitorStore?:MonitorStoreApi|null;taskStore?:{listInbox?(scope:Scope,options?:Record<string,unknown>):Promise<InboxItem[]>};onTicketChange?:(...args:unknown[])=>unknown|Promise<unknown>;onChangeHint?:(hint:{resource:'ticket';id:string;projectId:string})=>unknown|Promise<unknown>};
type InboxItem = {id:string;projectId:string;kind:string;status:string;title:string;detail?:string|null;categoryLabel?:string;createdAt:string;taskId?:string; tone?:string};
type MonitorArgs = {limit?:number;runLimit?:number;range?:string;from?:string|null;to?:string|null;scope:Scope;pageLimit?:number;offset?:number;status?:string;platform?:string;q?:string;pipelineId?:string;includeIdle?:boolean;sort?:string;dir?:string};
type MonitorPipeline = PipelineRecord & {summary?:string;recentRuns?:RunRecord[];lastRunId?:string|null;lastRunAt?:string|null;health?:string;ticket?:{ticketId?:string}|null;ticketAction?:unknown};
type MonitorResult = {items:MonitorPipeline[];total?:number;workspaceTotal:number;summary?:{succeeded:number;failed:number;missed:number;paused:number;idle:number;matchingIdle:number;platforms:string[];statuses:string[]};recentRuns:RunRecord[];range?:string;from?:string|null;to?:string|null;fetchedAt?:string;diagnostics:Record<string,unknown>;unavailable?:string};
type Inventory = {pipelines:PipelineRecord[];runs:RunRecord[];providers:string[];sources:Array<Record<string,unknown>>;providerDiagnostics:Array<{provider:string;jobsFetched:number;runsFetched:number;maxRuns:number|null;error?:string}>;ledger?:{fetchedAt:string}};
type TicketCreateInput = {scope:Scope;pipelineId?:string;runId?:string;creator?:ServiceUser;assignee?:Actor;priority?:string;visibility?:string;platform?:string;connectionId?:string;title?:string;description?:string;requester?:Actor;context?:Record<string,unknown>;metadata?:Record<string,unknown>;collaborators?:Actor[];source?:string;sourceRef?:string;category?:string;type?:string;tags?:string[]};
type TicketListInput = {status?:string;source?:string;user?:ServiceUser;scope:Scope};
type TicketPageInput = {user:ServiceUser;scope:Scope;query:Omit<import('./ticket-page.mjs').TicketPageQuery,'access'>};
type TicketAccess = import('./ticket-page.mjs').TicketAccess;
type OverviewTicketQuery = import('./ticket-page.mjs').OverviewTicketQuery;
type ConnectionOptions={scope:Scope;verify?:boolean};
type LinkRelation='recurrence_of'|'amends_fix_of'|'duplicate_of'|'related_to';
type TicketWriteChange={status?:string;resolution?:string|null;assignee?:Actor;priority?:string;title?:string;description?:string;comment?:string};
type ExternalSystem='servicenow'|'jira';
type ServiceNowFilters={limit:number;assignmentGroup?:string;states:string[];priorities:string[];tag?:string;updatedSinceHours?:number};
type IncidentSyncOptions={scope:Scope;connectionId?:string;provider?:string;routing?:string};
type ServiceNowInput=ServiceNowFilters & {scope:Scope;connectionId?:string;routing?:string;startTriage?:boolean};
type JiraInput={scope:Scope;connectionId?:string;routing?:string;jql?:string;project?:string;limit?:number;updatedSinceHours?:number;keys?:string[]};
type TicketUpdateResult=OpsTicket & {sourceWrite?:unknown};
type TemplateSourceWrite={system:string;name?:string;number?:string;written:string[]};
type TicketPatchInput=Partial<Pick<OpsTicket,'assignee'|'collaborators'|'status'|'visibility'|'priority'|'category'|'type'|'title'|'description'|'sourceRef'|'context'|'metadata'|'resolutionSummary'|'waitingReason'>> & Record<string,unknown>;
type SimilarTicketsInput={ticketId?:string;text?:string;status?:string[];limit?:number;user:ServiceUser;scope:Scope};
type LinkInput={relation?:LinkRelation;comment?:string;user?:ServiceUser;scope?:Scope};
type OperationsConfig={tickets?:{recurrenceWindowDays?:number};ticketing?:{app?:{sources?:Array<{platform?:string;filters?:{jql?:string}}>} };platforms?:unknown[]};
type ServiceNowFilterInput=Partial<ServiceNowFilters>;
type ImportedTicketResult={tickets:OpsTicket[];skipped:number;unrouted:number;byProject:Record<string,OpsTicket[]>};
type ProjectService = {list():Promise<Array<{id:string;kind?:string;archivedAt?:string|null;name?:string}>>;require(id:string):Promise<{id:string;kind:string;archivedAt?:string|null;name:string}>};
type PinnedClients = {dataPlatform?:(connectionId:string)=>PlatformApi;serviceNow?:(connectionId:string)=>ServiceNowApi;jira?:(connectionId:string)=>JiraApi};
type AuditFn = (user:ServiceUser,action:string,subject:string,details:Record<string,unknown>)=>unknown|Promise<unknown>;

// Reads and simple writes behind the Overview, Tickets, Pipelines and Data Quality pages.
// No agent logic lives here: investigation, RCA and fixes belong to Tasks (the plugin session).

const FAILED = new Set(['failed', 'error', 'timedout', 'canceled', 'cancelled', 'internal_error']);
const RANGE_MS = { 'Last hour': 3_600_000, 'Last 6 hours': 6 * 3_600_000, 'Last 12 hours': 12 * 3_600_000, 'Last 24 hours': 24 * 3_600_000, 'Last 7 days': 7 * 86_400_000, 'Last 30 days': 30 * 86_400_000, '1h': 3_600_000, '6h': 6 * 3_600_000, '12h': 12 * 3_600_000, '24h': 24 * 3_600_000, '7d': 7 * 86_400_000, '30d': 30 * 86_400_000 };
const parseMs = (value:unknown):number|undefined => { const at = Date.parse(String(value || '')); return Number.isFinite(at) ? at : undefined; };
const monitorRangeStart = (range:unknown):number|undefined => { if (String(range) === 'Today') { const start = new Date(); start.setHours(0, 0, 0, 0); return start.getTime(); } const windowMs = RANGE_MS[String(range) as keyof typeof RANGE_MS] || 0; return windowMs ? Date.now() - windowMs : undefined; };
// An explicit from/to window wins over a range label so the UI can offer exact custom periods.
const resolveMonitorWindow = ({ range, from, to }: {range?:unknown;from?:unknown;to?:unknown} = {}) => { const startMs = parseMs(from); const endMs = parseMs(to); if (startMs !== undefined || endMs !== undefined) return { startMs, endMs }; return { startMs: monitorRangeStart(range), endMs: undefined }; };

const TICKET_STATUSES = new Set(['open', 'in_progress', 'waiting', 'resolved', 'closed', 'cancelled']);
const TICKET_PRIORITIES = new Set(['critical', 'high', 'medium', 'low']);
const PRIORITY_LABEL:Record<string,string> = { critical: 'P1 · Critical', high: 'P2 · High', medium: 'P3 · Medium', low: 'P4 · Low' };
// How a NerveCenter change is written to the source system.
const SN_STATE:Record<string,string> = { open: 'New', in_progress: 'In Progress', waiting: 'On Hold', resolved: 'Resolved', closed: 'Closed', cancelled: 'Canceled' };
const SN_PRIORITY:Record<string,string> = { critical: '1 - Critical', high: '2 - High', medium: '3 - Moderate', low: '4 - Low' };
const JIRA_CATEGORY:Record<string,string> = { open: 'new', in_progress: 'indeterminate', waiting: 'indeterminate', resolved: 'done', closed: 'done', cancelled: 'done' };
const SOURCE_NAME:Record<string,string> = { servicenow: 'ServiceNow', jira: 'Jira' };
const JIRA_PRIORITY:Record<string,string> = { critical: 'Highest', high: 'High', medium: 'Medium', low: 'Low' };
// Who opens and notes tickets for an automation: the app, signed as the agent ("Sonic via NerveCenter").
const AUTOMATION_ACTOR = { type: 'system', id: 'nervecenter-automation', name: 'NerveCenter automation' };
const AUTOMATION_SIGNER = { type: 'agent', id: 'nervecenter-automation', name: AGENT_NAME, via: AGENT_NAME };
// How tickets can relate. Each link is stored on both tickets: `out` on the one that made it, `in` on the other.
const LINK_TITLE = { out: { recurrence_of: 'Recurrence of', amends_fix_of: 'Amends the fix of', duplicate_of: 'Duplicate of', related_to: 'Related to' }, in: { recurrence_of: 'Recurred as', amends_fix_of: 'Fix amended in', duplicate_of: 'Duplicated by', related_to: 'Related to' } };
const DEFAULT_RECURRENCE_DAYS = 30;
const LEDGER_INVENTORY = STATE.inventory;
const LEDGER_SLOTS = STATE.slots;
// The most runs one monitor read takes from the ledger (60 days of a busy project fit); the fetch takes at most this many per provider per pass.
const LEDGER_READ_CAP = 50_000;
const FETCH_MAX_RUNS = 10_000;
const MAX_SIMILAR = 10;
const ticketPriority = (ticket:Partial<OpsTicket>|null|undefined):string => String(ticket?.priority || 'other').toLowerCase();
const priorityWeight = (ticket:Partial<OpsTicket>):number => PRIORITY_WEIGHT[ticketPriority(ticket) as keyof typeof PRIORITY_WEIGHT] ?? 4;
const normalizePriority = (value:unknown):string => TICKET_PRIORITIES.has(String(value || '').toLowerCase()) ? String(value).toLowerCase() : 'medium';
const isClosed = (ticket:Partial<OpsTicket>|null|undefined):boolean => CLOSED.has(String(ticket?.status || '').toLowerCase());
const actorName = (actor:Actor|undefined):string|null => typeof actor === 'string' ? actor : actor?.name || actor?.id || null;
// Signs what NerveCenter writes to a source system. The agent's tools pass the person with `via` set to the agent's name, so its writes read "Sonic for Asha via NerveCenter".
const sourceSignature = (user:ServiceUser|null|undefined):string => { const by = actorName(user || null) || 'NerveCenter'; if (!user?.via) return `${by} via NerveCenter`; return user.type === 'agent' || by === user.via ? `${user.via} via NerveCenter` : `${user.via} for ${by} via NerveCenter`; };
const memberId = (member:Actor|undefined):string|undefined => typeof member === 'string' ? member : member?.id;
const identityKeys = (member:Actor|undefined):string[] => identityKeysOf(member);
const sameIdentity = (left:Actor|undefined, right:Actor|undefined):boolean => sameIdentityOf(left, right);
const isSingleUser = (user:ServiceUser|undefined):boolean => config.identityMode === 'single-user' && user?.id === config.defaultUserId;
const isAdmin = (user:ServiceUser|undefined):boolean => Boolean(user?.id && (user?.role === 'admin' || config.adminUserIds.includes(user.id) || (user.roles || []).includes(config.adminRole)));
const ticketMembers = (ticket:OpsTicket):string[] => [ticket.creator, ticket.requester, ticket.assignee, ...(ticket.collaborators || [])].map(memberId).filter((value):value is string => Boolean(value));
const isOwner = (ticket:OpsTicket, user:ServiceUser|undefined):boolean => Boolean(user?.id && [ticket.creator, ticket.assignee].some(member => sameIdentity(member, user)));
// Who signs off on agent actions for a ticket. Routed from config by ticket type, then category.
const approverFor = (ticket:Partial<OpsTicket>):Actor => {
  const routing = config.approverRouting || {};
  const keys = [ticket?.category, ticket?.type, ticket?.pipelineId ? 'pipeline_failure' : null].map(value => String(value || '').toLowerCase().trim().replace(/[\s-]+/g, '_')).filter(Boolean);
  const match = keys.map(key => routing[key]).find(Boolean) || routing.default || null;
  return match ? { type: 'user', id: String(match.id || match.name), name: String(match.name || match.id) } : null;
};
const routedApprover = (ticket:Partial<OpsTicket>):Actor => ticket?.approver || approverFor(ticket);
const isApprover = (ticket:OpsTicket, user:ServiceUser|undefined):boolean => { const approver = routedApprover(ticket); if (!approver || !user?.id) return false; const id = String(memberId(approver) || ''); return Boolean(id) && (id === String(user.id) || (user.groups || []).includes(id) || (user.roles || []).includes(id)); };
const validMember = (value:unknown):Actor => { if (value === null) return null; if (typeof value === 'string' && value.trim()) return value.trim(); if (value && typeof value === 'object' && String((value as {id?:unknown}).id || '').trim()) return { type: 'user', ...value, id: String((value as {id:unknown}).id).trim(), name: String((value as {name?:unknown;id:unknown}).name || (value as {id:unknown}).id).trim() }; throw httpError(400, 'assignee must be a user id or an object with an id'); };
// SPEC-projects-02 FR-20..FR-23: `project` tickets are open to the project (scope already limits rows to it); `private`
// ones to their people, the routed approver and the project's owners (SPEC-projects-03). `operators` reads as `project`.
// A visitor to an open project sees `project` tickets only: being in none of a private ticket's lists, they never pass.
const projectVisible = (ticket:OpsTicket):boolean => ticket.visibility === 'project' || ticket.visibility === 'operators';
const isProjectAdminOf = (ticket:OpsTicket, user:ServiceUser|undefined):boolean => Boolean(ticket?.projectId) && (user?.projectOwnerIds || []).includes(ticket.projectId);
function canAccess(ticket:OpsTicket, user:ServiceUser|undefined):boolean {
  if (!user?.id) return false;
  if (isSingleUser(user) || isAdmin(user)) return true;
  return ticketMembers(ticket).includes(user.id) || projectVisible(ticket) || isApprover(ticket, user) || isProjectAdminOf(ticket, user);
}
function assertCanAccess(ticket:OpsTicket, user:ServiceUser|undefined):void { if (!canAccess(ticket, user)) throw httpError(403, 'You do not have access to this ticket'); }
type TicketPermission='view'|'comment'|'assign'|'approve'|'executeAction'|'close';
function permissionFor(ticket:OpsTicket, user:ServiceUser|undefined, permission:TicketPermission):boolean {
  if (isSingleUser(user) || isAdmin(user)) return true;
  const owner = isOwner(ticket, user); const assigned = sameIdentity(ticket.assignee, user); const member = canAccess(ticket, user);
  const approve = routedApprover(ticket) ? isApprover(ticket, user) : owner;
  const manage = owner || isProjectAdminOf(ticket, user);
  return ({ view: member, comment: member, assign: manage, approve, executeAction: assigned, close: manage })[permission] === true;
}
function assertPermission(ticket:OpsTicket, user:ServiceUser|undefined, permission:TicketPermission):void { if (!permissionFor(ticket, user, permission)) throw httpError(403, `You do not have permission to ${permission} this ticket`); }
// Who moved the ticket to resolved or closed, from its timeline; the assignee when the timeline does not say.
// GET /api/tickets/:id/activity returns this many of the latest events (ADR 0005).
const TICKET_ACTIVITY_LIMIT = 1000;
// `statusEvents` are the ticket's ticket.status events, newest first (store.listActivity).
const resolvedByOf = (ticket:OpsTicket, statusEvents:OpsActivity[] = []):string|null => actorName(statusEvents.find(event => /resolved|closed/i.test(event.title || '') && event.actor)?.actor as Actor) || actorName(ticket.assignee) || null;
const groupByTicket = (events:OpsActivity[]):Map<string,OpsActivity[]> => { const groups = new Map<string,OpsActivity[]>(); for (const event of events) { const ticketId = event.ticketId; if (!ticketId) continue; const list = groups.get(ticketId); if (list) list.push(event); else groups.set(ticketId, [event]); } return groups; };
function activityEvent({ type, status = 'completed', title, detail, actor = null }: {type:string;status?:string;title:string;detail?:string|null;actor?:Actor}) { return { id: randomUUID(), type, status, title, detail: detail || null, at: now(), ...(actor && typeof actor === 'object' && actor.id ? { actor: { id: String(actor.id), name: actorName(actor) || String(actor.id) } } : {}) }; }

// A link or recurrence event names another ticket. When the person cannot open that ticket, the event keeps its place on the timeline but loses the id and title (FR-49).
const hiddenEvent = (event:OpsActivity, hidden:Set<string>):OpsActivity => { const related = event.relatedTicketId || event.recurrenceOf; if (!related || !hidden.has(related)) return event; const { relatedTicketId: _a, recurrenceOf: _b, ...rest } = event; return { ...rest, title: 'Linked to a ticket you cannot access', detail: null }; };

// SPEC-overview-01 FR-6: what "Your work" lists. One shape for the legacy overview and the grouped endpoint.
const ATTENTION_LIMIT = 8;
const isFailingPipeline = (pipeline:MonitorPipeline):boolean => /failed|error|delayed|degraded/i.test(String(pipeline.status || ''));
const pipelineFailure = (pipeline:MonitorPipeline, ticket?:OpsTicket) => ({ pipelineId: pipeline.pipelineId, name: pipeline.name, platform: pipeline.platform || null, status: pipeline.status, summary: pipeline.summary || pipeline.recentRuns?.[0]?.failureSummary || null, owner: actorName(ticket?.assignee) || pipeline.owner || null, lastRunAt: pipeline.lastRunAt || null, runId: pipeline.lastRunId || null, ticketId: ticket?.ticketId || null, taskId: ticket?.taskId || null, investigationStatus: !ticket ? 'unassigned' : ticket.taskId ? 'investigating' : ticket.assignee ? 'assigned' : 'unassigned', updatedAt: ticket?.updatedAt || pipeline.lastRunAt || null });
const ticketAttentionItem = (ticket:OpsTicket) => ({ id: `ticket:${ticket.ticketId}`, kind: 'ticket', title: ticket.title || ticket.failureSummary || 'Ticket needs triage', detail: `${ticket.ticketId} · ${actorName(ticket.assignee) || 'Unassigned'}`, status: ticket.status, priority: ticketPriority(ticket), owner: actorName(ticket.assignee), updatedAt: ticket.updatedAt || ticket.createdAt, href: `/tickets/${encodeURIComponent(ticket.ticketId)}`, ticketId: ticket.ticketId, rank: priorityWeight(ticket) * 10 + 2 });
const pipelineAttentionItem = (pipeline:ReturnType<typeof pipelineFailure>) => ({ id: `pipeline:${pipeline.pipelineId}`, kind: 'pipeline', title: pipeline.name, detail: pipeline.summary || 'Pipeline requires investigation', status: pipeline.status, priority: 'operational', owner: pipeline.owner, updatedAt: pipeline.updatedAt, href: `/monitor?pipeline=${encodeURIComponent(pipeline.pipelineId)}`, ticketId: pipeline.ticketId, pipelineId: pipeline.pipelineId, runId: pipeline.runId, rank: 20 });
const byAttention = (left:{rank:number;updatedAt?:string|null}, right:{rank:number;updatedAt?:string|null}):number => left.rank - right.rank || String(right.updatedAt || '').localeCompare(String(left.updatedAt || ''));

export class OperationsService {
  declare store:OpsStore;
  declare dataPlatform:OpsServiceOptions['dataPlatform'];
  declare dataQualityService:OpsServiceOptions['dataQualityService'];
  declare serviceNow:OpsServiceOptions['serviceNow'];
  declare jira:OpsServiceOptions['jira'];
  declare connectionService:ConnectionApi|undefined;
  declare monitorStore:MonitorStoreApi|null;
  declare projects:ProjectService|null;
  declare grants:GrantsService|null;
  declare pinned:PinnedClients|null;
  declare audit:AuditFn|null;
  declare workspace:{for(project:Scope|string):Promise<{readOperations():Promise<Record<string,unknown>>}>}|null|undefined;
  declare taskStore:OpsServiceOptions['taskStore'];
  declare onTicketChange:OpsServiceOptions['onTicketChange'];
  declare onChangeHint:OpsServiceOptions['onChangeHint'];
  declare similarityRanker:typeof bm25Ranker;
  // `projects` (the project store) lets startup passes sweep every project; without one only PILOT is swept.
  // `dataPlatform`, `dataQualityService`, `serviceNow` and `jira` are per-project registries in the app (each one reads only the
  // connections granted to its project, FR-33) and plain instances in a unit test. `grants` routes imported items to projects
  // (FR-26) and `pinned` builds a client for one connection (a ticket is written back through the connection it came from).
  // `monitorStore` is the ledger the background fetch writes (ADR-0002): with a snapshot for the project, pipeline reads come
  // from it instead of the platform. Without one (a unit test, a project not fetched yet) reads go to the platform as before.
  constructor({ store, dataPlatform, dataQualityService, serviceNow, jira, connectionService, projects = null, grants = null, pinned = null, monitorStore = null }:OpsServiceOptions) { Object.assign(this, { store, dataPlatform, dataQualityService, serviceNow, jira, connectionService, projects, grants, pinned, monitorStore }); this.similarityRanker = bm25Ranker; }

  /** operations.yaml of the scope's project, or null (the All view and a project with no workspace have none). */
  async #operations(project:Scope|string):Promise<OperationsConfig|null> {
    const registry = asRegistry(this.workspace); if (!registry) return null;
    try { return await (await registry.for(project as unknown as string)).readOperations() as OperationsConfig; } catch { return null; }
  }

  /** One of the project-bound integrations for the scope's project; the admin All view gets the registry's empty stand-in (FR-33). */
  #dep(name:'dataPlatform', scope:Scope):Promise<PlatformApi>;
  #dep(name:'dataQualityService', scope:Scope):Promise<DataQualityApi>;
  #dep(name:'serviceNow', scope:Scope):Promise<ServiceNowApi>;
  #dep(name:'jira', scope:Scope):Promise<JiraApi>;
  #dep(name:'dataPlatform'|'dataQualityService'|'serviceNow'|'jira', scope:Scope):Promise<PlatformApi|DataQualityApi|ServiceNowApi|JiraApi> { return forProject(this[name], scope) as unknown as Promise<PlatformApi|DataQualityApi|ServiceNowApi|JiraApi>; }
  /** The client for a connection: the pinned one when a ticket or a background job names it, else the scope project's. */
  #client(name:'serviceNow',scope:Scope,connectionId?:string):Promise<ServiceNowApi>;
  #client(name:'jira',scope:Scope,connectionId?:string):Promise<JiraApi>;
  #client(name:'dataPlatform',scope:Scope,connectionId?:string):Promise<PlatformApi>;
  async #client(name:'serviceNow'|'jira'|'dataPlatform', scope:Scope, connectionId = ''):Promise<ServiceNowApi|JiraApi|PlatformApi> { return connectionId && this.pinned?.[name] ? this.pinned[name](connectionId) as ServiceNowApi|JiraApi|PlatformApi : this.#dep(name as 'jira', scope) as unknown as ServiceNowApi|JiraApi|PlatformApi; }
  /** The id of the connection the project's reads go through for a provider ('' without one, as for a manual ticket). */
  async #connectionIdFor(provider:string, scope:Scope):Promise<string> {
    const service = this.connectionService; if (!service?.getDefault) return '';
    try { return (await service.getDefault(provider, service.projects ? assertScope(scope).projectId : undefined))?.id || ''; } catch { return ''; }
  }
  /** Publish a hint from the persisted row so callers cannot supply a stale or body-controlled project id. */
  async publishTicketChange(ticketId:string):Promise<void> {
    const ticket = await this.store.getTicket(ticketId);
    if (ticket?.projectId) await this.onChangeHint?.({ resource: 'ticket', id: ticket.ticketId, projectId: ticket.projectId });
  }
  /** The project's view of the connection service (provider statuses), or null for the All view. */
  #connections(scope:Scope):ConnectionApi|null {
    const service = this.connectionService; if (!service) return null;
    if (typeof service.forProject !== 'function') return service;
    return assertScope(scope).all ? null : service.forProject(scope.projectId);
  }
  async #dqConfig(scope:Scope):Promise<Record<string,unknown>|null> { try { return (await (await this.#dep('dataQualityService', scope) as DataQualityApi)?.getConfig?.()) ?? null; } catch { return null; } }

  // The one by-id load: a missing ticket is 404, one outside the scope is 403 (FR-13), then the person's own rights apply.
  async #load(ticketId:string, scope:Scope):Promise<OpsTicket> { const ticket = await this.store.getTicket(ticketId); if (!ticket && assertScope(scope).all) throw httpError(404, 'Ticket not found'); return assertRowInScope(scope, ticket) as OpsTicket; }
  async authorizeTicket(ticketId:string, user:ServiceUser|undefined, permission:TicketPermission = 'view', scope:Scope):Promise<OpsTicket|null> { const ticket = await this.#load(ticketId, scope); assertPermission(ticket, user, permission); return ticket; }
  /** A ticket by NerveCenter id or by its source number (INC0031201, CDO-118), inside the scope. The agent's tools use this instead of reading the store. */
  async findTicketByRef(ref:string, scope:Scope):Promise<OpsTicket> {
    const key = String(ref || '').trim(); if (!key) throw httpError(400, 'ticketId is required');
    const direct = await this.store.getTicket(key).catch(() => null); if (direct) return assertRowInScope(scope, direct);
    const match = (await this.store.listTickets(scope)).find(ticket => String(ticket.externalReference?.number || '').toLowerCase() === key.toLowerCase());
    if (!match) throw httpError(404, `No ticket ${key} in NerveCenter`);
    return match;
  }
  // Startup passes (signature backfill) walk every project, one scope at a time.
  /** Every project's scope and Unrouted's: where a connection-level import looks for tickets it made earlier. */
  async #allScopes():Promise<Scope[]> { return [...await this.#projectScopes(), systemScope(UNROUTED_ID) as Scope]; }

  /**
   * An admin moves a ticket out of the Unrouted queue into a project (FR-26). Only from Unrouted, only to an active project,
   * and the ticket keeps its connection, so later imports still find it.
   */
  async routeTicket(ticketId:string, projectId:string, user:ServiceUser):Promise<OpsTicket|null> {
    if (!this.projects) throw httpError(500, 'Routing needs the project store');
    const ticket = await this.store.getTicket(ticketId); if (!ticket) throw httpError(404, 'Ticket not found');
    if (ticket.projectId !== UNROUTED_ID) throw httpError(409, 'Only an Unrouted ticket can be moved to a project.');
    const target = await this.projects.require(String(projectId || '').trim());
    if (target.kind !== 'normal') throw httpError(400, 'Choose a project to route the ticket to.');
    if (target.archivedAt) throw httpError(409, 'This project is archived and read-only.');
    await this.store.setTicketProject(ticketId, target.id);
    await this.store.appendActivity(ticketId, [activityEvent({ type: 'ticket.routed', title: `Moved to ${target.name}`, detail: 'Routed by an administrator', actor: user })]);
    await this.onChangeHint?.({ resource: 'ticket', id: ticket.ticketId, projectId: ticket.projectId });
    await this.publishTicketChange(ticketId);
    return this.store.getTicket(ticketId);
  }

  async #projectScopes():Promise<Scope[]> { return (this.projects ? (await this.projects.list()).map((project:{id:string}) => project.id) : [DEFAULT_PROJECT_ID]).map(id => systemScope(id) as Scope); }
  // Ids of tickets this ticket points at (links, recurrence, timeline events) that `user` cannot open.
  async #hiddenRelated(ticket:OpsTicket, user:ServiceUser|undefined, scope:Scope):Promise<Set<string>> {
    const ids = new Set<string>([...(ticket.links || []).map(link => link.ticketId), ...(ticket.activity || []).flatMap(event => [event.relatedTicketId, event.recurrenceOf])].filter(Boolean) as string[]);
    const hidden = new Set<string>();
    for (const id of ids) { const other = await this.store.getTicket(id).catch(() => null); if (!other || other.projectId !== ticket.projectId || !canAccess(other, user)) hidden.add(id); }
    return hidden;
  }
  async #hideRelated(view:OpsTicket, user:ServiceUser|undefined, scope:Scope):Promise<OpsTicket> {
    const hidden = await this.#hiddenRelated(view, user, scope); if (!hidden.size) return view;
    const links = (view.links || []).filter(link => !hidden.has(link.ticketId));
    const recurrence = view.recurrence && hidden.has(view.recurrence.ofTicketId) ? null : view.recurrence;
    return { ...view, links, recurrence, activity: (view.activity || []).map(event => hiddenEvent(event, hidden)) };
  }
  sameUser(left:Actor|undefined, right:Actor|undefined):boolean { return config.identityMode === 'single-user' || sameIdentity(left, right); }

  /* ------------------------------------------------------------------ overview */

  async overview(user:ServiceUser, { from = null, to = null, scope }: {from?:string|null;to?:string|null;scope:Scope} = {} as {scope:Scope}) {
    assertScope(scope);
    const overviewAt = new Date();
    // Optional reporting window. Counts of raised/closed tickets respect it; the live
    // state (what is open right now, what is failing) never does, so nothing urgent hides.
    const windowFrom = parseMs(from) ?? null; const windowTo = parseMs(to) ?? null;
    const inWindow = (value:unknown) => { if (windowFrom === null && windowTo === null) return true; const at = parseMs(value); if (at === undefined) return false; return (windowFrom === null || at >= windowFrom) && (windowTo === null || at <= windowTo); };
    const [monitor, tickets, dqConfiguration] = await Promise.all([
      // A missing pipeline platform must not take the whole landing page down.
      this.monitor({ limit: 1000, runLimit: 5, range: 'All time', scope }).catch(error => ({ items: [], workspaceTotal: 0, recentRuns: [], diagnostics: { error: error.message }, unavailable: error.message || 'Pipeline monitoring is not configured' })),
      this.listTickets({ status: 'all', user, scope }),
      this.#dqConfig(scope),
    ]);
    const pipelines = monitor.items;
    const openTickets = tickets.filter(ticket => !isClosed(ticket));
    const ticketById = new Map(tickets.map(ticket => [ticket.ticketId, ticket]));
    const latestTicketByPipeline = new Map();
    for (const ticket of openTickets) if (ticket.pipelineId && !latestTicketByPipeline.has(String(ticket.pipelineId))) latestTicketByPipeline.set(String(ticket.pipelineId), ticket);
    const pipelineFailures = pipelines.filter(isFailingPipeline).map(pipeline => pipelineFailure(pipeline, latestTicketByPipeline.get(String(pipeline.pipelineId))));
    const represented = new Set(); const attention = [];
    for (const ticket of openTickets) { represented.add(ticket.ticketId); attention.push(ticketAttentionItem(ticket)); }
    for (const pipeline of pipelineFailures) { if (pipeline.ticketId && represented.has(pipeline.ticketId)) continue; attention.push(pipelineAttentionItem(pipeline)); }
    attention.sort(byAttention);
    // "Your work" is personal: tickets assigned to the caller or where they collaborate. When
    // nothing is assigned to them yet, fall back to the shared queue and say so via attentionScope.
    const isMine = (ticket:OpsTicket|undefined) => Boolean(ticket && (sameIdentity(ticket.assignee, user) || (ticket.collaborators || []).some((member:Actor) => sameIdentity(member, user))));
    const mineAttention = isSingleUser(user) ? attention : attention.filter(item => item.ticketId && isMine(ticketById.get(item.ticketId)));
    const attentionScope = mineAttention.length ? 'mine' : 'team';
    const attentionItems = (mineAttention.length ? mineAttention : attention).slice(0, 8);
    const raisedTickets = tickets.filter(ticket => inWindow(ticket.createdAt));
    const openFromWindow = raisedTickets.filter(ticket => !isClosed(ticket)).length;
    const closedInWindow = tickets.filter(ticket => isClosed(ticket) && inWindow(ticket.closedAt || ticket.updatedAt)).length;
    const byPriority:Record<string,number> = { p1: 0, p2: 0, p3: 0, p4: 0, other: 0 }; for (const ticket of openTickets) { const key = ({ critical: 'p1', high: 'p2', medium: 'p3', low: 'p4' } as Record<string,string>)[ticketPriority(ticket)] || 'other'; byPriority[key] += 1; }
    const criticalTicketRows = openTickets.filter(ticket => ['critical', 'high'].includes(ticketPriority(ticket))).sort((left, right) => priorityWeight(left) - priorityWeight(right) || String(right.updatedAt || right.createdAt || '').localeCompare(String(left.updatedAt || left.createdAt || '')));
    const dqAvailable = Boolean(dqConfiguration && dqConfiguration.enabled !== false);
    // What waits on people, and what the agent closed out (a real change, then the ticket closed).
    const pendingInbox = await (this.taskStore?.listInbox?.(scope, { status: 'pending' }).catch(() => []) || []);
    const waitingApprovals = pendingInbox.filter(item => item.kind === 'approval').length; const waitingQuestions = pendingInbox.filter(item => item.kind === 'question').length;
    const agentResolved = tickets.filter(ticket => ticket.resolvedWithAgent).map(ticket => ({ ticketId: ticket.ticketId, number: ticket.externalReference?.number || null, title: ticket.title, kind: ticket.kind, closedAt: ticket.closedAt || ticket.updatedAt }));
    const resolvedInWindow = agentResolved.filter(item => inWindow(item.closedAt));
    return {
      generatedAt: overviewAt.toISOString(),
      capabilities: {
        pipelineMonitoring: { available: !monitor.unavailable, reason: monitor.unavailable || 'Pipeline platform connected' },
      dqMonitoring: { available: dqAvailable, reason: dqAvailable ? `${String(dqConfiguration?.provider)} DQ result table configured` : 'Data-quality monitoring is not configured' },
        slaTracking: { available: false, reason: 'Ticket SLA policy integration is not configured' },
        upcomingSchedules: { available: false, reason: 'Routines are not configured yet' },
      },
      summary: { totalPipelines: monitor.workspaceTotal, latestRunsSucceeded: pipelines.filter(p => p.status === 'healthy').length, failedPipelines: pipelineFailures.length, failedMonitors: 0, runningPipelines: pipelines.filter(p => p.status === 'running').length, healthyPipelines: pipelines.filter(p => p.health === 'healthy' || p.health === 'running').length, overduePipelines: pipelines.filter(p => p.health === 'overdue').length, pausedPipelines: pipelines.filter(p => p.health === 'paused').length, criticalTickets: criticalTicketRows.length, pendingApprovals: waitingApprovals, openHumanTasks: waitingQuestions, activeWorkflows: 0, activeInvestigations: openTickets.filter(ticket => ticket.taskId).length, scheduledPrevious12Hours: 0, scheduledNext12Hours: 0 },
      attentionItems, attentionScope,
      window: { from: windowFrom === null ? null : new Date(windowFrom).toISOString(), to: windowTo === null ? null : new Date(windowTo).toISOString() },
      pipelineFailures,
      workflowSummary: { total: 0, queued: 0, running: 0, completed: 0, failed: 0, waitingApproval: 0, waitingHuman: 0 }, activeWorkflows: [],
      ticketSummary: { open: openTickets.length, closed: tickets.length - openTickets.length, raised: raisedTickets.length, openFromWindow, closedInWindow, byPriority, resolvedWithAgent: resolvedInWindow.length },
      agentResolved: { total: agentResolved.length, inWindow: resolvedInWindow.length, pipelines: resolvedInWindow.filter(item => item.kind === 'pipeline').length, dataQuality: resolvedInWindow.filter(item => item.kind === 'data_quality').length, items: agentResolved },
      criticalTickets: criticalTicketRows.slice(0, 8),
      investigations: { active: openTickets.filter(ticket => ticket.taskId).length, unassigned: pipelineFailures.filter(item => item.investigationStatus === 'unassigned').length, rcaRunning: 0, rcaComplete: 0 },
      scheduleWindow: null,
      monitors: null, pipelines, recentRuns: monitor.recentRuns.slice(0, 20), diagnostics: monitor.diagnostics,
    };
  }

  async ticketDashboard(user:ServiceUser, { scope }: {scope:Scope} = {} as {scope:Scope}) {
    const tickets = await this.listTickets({ status: 'all', user, scope });
    const openTickets = tickets.filter(ticket => !isClosed(ticket));
    const attention = openTickets.map(ticket => ({ id: `ticket:${ticket.ticketId}`, kind: 'ticket', title: ticket.title || ticket.failureSummary || 'Ticket needs triage', detail: `${ticket.ticketId} · ${actorName(ticket.assignee) || 'Unassigned'}`, status: ticket.status, priority: ticketPriority(ticket), owner: actorName(ticket.assignee), updatedAt: ticket.updatedAt || ticket.createdAt, href: `/tickets/${encodeURIComponent(ticket.ticketId)}`, ticketId: ticket.ticketId, rank: priorityWeight(ticket) * 10 + 2 }));
    attention.sort((left, right) => left.rank - right.rank || String(right.updatedAt || '').localeCompare(String(left.updatedAt || '')));
    return {
      generatedAt: now(),
      summary: { totalOpen: openTickets.length, priorityOpen: openTickets.filter(ticket => ['critical', 'high'].includes(ticketPriority(ticket))).length, waitingOnYou: openTickets.filter(ticket => ticket.appStatus === 'waiting_on_you').length, resolvedWithAgent: tickets.filter(ticket => ticket.resolvedWithAgent).length },
      attentionItems: attention.slice(0, 12).map(({ rank, ...item }) => item),
    };
  }

  /* ------------------------------------------------------------- notifications */

  // Everything a person would want to be told about, newest first: new and changed tickets
  // and failed runs. Read state lives in the client.
  async notifications(user:ServiceUser, { since = null, limit = 50, scope, mode, view = 'all', seenAt = null, after = null, cursor = null }: {since?:string|null;limit?:number;scope:Scope;mode?:string;view?:NotificationView;seenAt?:string|null;after?:NotificationPosition|null;cursor?:NotificationPosition|null} = {} as {scope:Scope}) {
    assertScope(scope);
    const sinceMs = parseMs(since);
    const [monitor, tickets] = await Promise.all([
      this.monitor({ limit: 1000, runLimit: 5, range: 'Last 24 hours', scope }).catch(() => ({ items: [], recentRuns: [] })),
      this.listTickets({ status: 'all', user, scope }),
    ]);
    // Ids carry the project so read state cannot collide across projects (FR-16). A related ticket the person cannot open is never named (FR-49).
    const visibleIds = new Set(tickets.map(ticket => ticket.ticketId));
    const events = groupByTicket(await this.store.listActivity([...visibleIds], { since: sinceMs !== undefined ? new Date(sinceMs).toISOString() : undefined, limit: 10000 }));
    const items:Array<Record<string,unknown> & {at:string}> = [];
    const push = (item:Record<string,unknown> & {at?:string}) => { const at = parseMs(item.at); if (at === undefined) return; if (sinceMs !== undefined && at <= sinceMs) return; items.push({ ...item, at: new Date(at).toISOString() }); };
    for (const ticket of tickets) {
      const priority = PRIORITY_LABEL[ticketPriority(ticket) as keyof typeof PRIORITY_LABEL];
      push({ id: `${ticket.projectId}:ticket.created:${ticket.ticketId}`, kind: 'ticket.created', title: ticket.title || ticket.failureSummary || `Ticket ${ticket.ticketId}`, detail: `${ticket.ticketId}${priority ? ` · ${priority}` : ''} · opened`, at: ticket.createdAt, href: `/tickets/${encodeURIComponent(ticket.ticketId)}`, tone: 'neutral', ticketId: ticket.ticketId });
      for (const event of [...(events.get(ticket.ticketId) || [])].reverse()) {
        const type = String(event.type || '');
        const kind = type === 'ticket.status' ? 'ticket.status' : type === 'ticket.assigned' ? 'ticket.assigned' : type === 'ticket.priority' ? 'ticket.priority' : type.startsWith('task.') ? 'automation' : type === 'ticket.recurrence' && event.recurrenceOf ? 'ticket.recurrence' : null;
        if (!kind) continue;
        const status = String(event.status || '').toLowerCase();
        const tone = status === 'failed' ? 'bad' : kind === 'ticket.recurrence' ? 'warning' : /waiting|approval|review/.test(`${type} ${status}`) ? 'warning' : status === 'completed' ? 'success' : 'neutral';
        const related = event.relatedTicketId || event.recurrenceOf; const hidden = Boolean(related) && !visibleIds.has(related as string);
        push({ id: `${ticket.projectId}:event:${ticket.ticketId}:${event.id}`, kind, title: hidden ? 'Related to a ticket you cannot access' : event.title || type.replace(/[_.]/g, ' '), detail: hidden ? ticket.ticketId : [ticket.ticketId, event.detail].filter(Boolean).join(' · '), at: event.at, href: `/tickets/${encodeURIComponent(ticket.ticketId)}`, tone, ticketId: ticket.ticketId });
      }
    }
    for (const run of monitor.recentRuns || []) {
      if (!FAILED.has(String(run.status || '').toLowerCase())) continue;
      const ticketId = (run as RunRecord & {ticket?:{ticketId?:string}|null}).ticket?.ticketId || null;
      push({ id: `${scope.projectId}:run:${run.platform || 'unknown'}:${run.runId}`, kind: 'pipeline.failed', title: `${run.name || run.pipelineId} failed`, detail: run.failureSummary || null, at: run.endTime || run.startTime, href: ticketId ? `/tickets/${encodeURIComponent(ticketId)}` : `/monitor?pipeline=${encodeURIComponent(run.pipelineId)}`, tone: 'bad', pipelineId: run.pipelineId, ticketId });
    }
    // What the agent did or needs: approvals and questions waiting, and work it finished or could not finish.
    for (const item of await (this.taskStore?.listInbox?.(scope, { limit: 200 }).catch(() => []) || [])) {
      const waiting = item.status === 'pending' && item.kind !== 'notification';
      if (item.kind !== 'notification' && !waiting) continue;
      const title = item.kind === 'approval' ? `${AGENT_NAME} needs your approval: ${String(item.title || '').replace(/^Waiting for approval: /, '')}` : item.kind === 'question' ? `${AGENT_NAME} asked: ${item.title}` : `${AGENT_NAME}: ${item.title}`;
      push({ id: `${item.projectId}:agent:${item.id}`, kind: item.kind === 'notification' ? 'agent.update' : `agent.${item.kind}`, title, detail: item.categoryLabel ? `${item.categoryLabel} · ${item.detail || ''}` : item.detail || null, at: item.createdAt, href: item.kind === 'notification' ? `/tasks/${encodeURIComponent(item.taskId as string)}` : '/inbox', tone: waiting ? 'warning' : item.tone || 'neutral', taskId: item.taskId });
    }
    items.sort((left, right) => compareNotificationPosition(right as {at:string;id:string}, left as {at:string;id:string}));
    const safeLimit = Math.max(1, Math.min(200, Number(limit) || 50));
    const system = await this._systemNotifications(scope);
    if (mode) {
      const visible = items.filter(item => isBellNotification(item as {at:string;id:string}));
      const unreadSince = seenAt ? Date.parse(seenAt) : 0;
      const unread = visible.filter(item => Date.parse(item.at) > unreadSince).length;
      const watermark = visible.length ? encodeNotificationPosition(visible[0] as {at:string;id:string}) : encodeNotificationPosition({ at: new Date(0).toISOString(), id: "0" });
      if (mode === 'summary') return { generatedAt: now(), unread, systemCount: system.length, watermark };
      if (mode === 'updates') {
        const fresh = after ? visible.filter(item => compareNotificationPosition(item as {at:string;id:string}, after) > 0) : [];
        const page = pageNotifications(fresh as Array<typeof fresh[number] & {id:string}>, { limit: safeLimit, cursor });
        return { generatedAt: now(), unread, system, watermark, total: fresh.length, ...page };
      }
      const selected = visible.filter(item => matchesNotificationView(item as {at:string;id:string}, view));
      const page = pageNotifications(selected as Array<typeof selected[number] & {id:string}>, { limit: safeLimit, cursor });
      return { generatedAt: now(), total: selected.length, system: cursor ? [] : system, ...page };
    }
    // Pinned setup items ride along in `items` for one-list clients and are repeated in `system`
    // so the UI can pin them and leave them out of the unread count.
    return { generatedAt: now(), since: sinceMs !== undefined ? new Date(sinceMs).toISOString() : null, total: items.length, items: [...(sinceMs === undefined ? system : []), ...items.slice(0, safeLimit)], system };
  }
  // Integrations that are not ready yet, phrased for an operator rather than an engineer.
  async _systemNotifications(scope:Scope):Promise<Array<Record<string,unknown>>> {
    const at = now(); const system:Array<Record<string,unknown>> = []; const plain = (reason:unknown) => String(reason || '').replace(/^Configure a /, 'Add a ').replace(/\s+/g, ' ').trim();
    const statuses = await (this.#connections(scope)?.providerStatuses?.().catch(() => []) || []);
    const databricks = statuses.find(item => item.provider === 'databricks' || item.id === 'databricks');
    if (databricks && !databricks.ready) system.push({ id: 'system.connection:databricks', kind: 'system.connection', tone: 'neutral', pinned: true, title: 'Databricks not connected', detail: databricks.configured ? `The Databricks connection is set up but not ready: ${plain(databricks.reason) || 'the last connection test did not pass'}.` : 'Pipeline monitoring needs a Databricks workspace connection.', at, href: '/connectors', provider: 'databricks' });
    const serviceNow = await this.serviceNowStatus({ scope }).catch(error => ({ mode: 'disabled', ready: false, reason: (error as Error).message }));
    if (!serviceNow.ready) system.push({ id: 'system.connection:servicenow', kind: 'system.connection', tone: 'neutral', pinned: true, title: 'ServiceNow not connected', detail: serviceNow.mode === 'disabled' || !(serviceNow as {configured?:boolean}).configured ? 'Connect a ServiceNow instance to import incidents as tickets.' : `The ServiceNow connection is set up but not ready: ${plain(serviceNow.reason) || 'credentials could not be verified'}.`, at, href: '/connectors', provider: 'servicenow' });
    const dq = await this.#dqConfig(scope);
    if (!dq || dq.enabled === false) system.push({ id: 'system.connection:data-quality', kind: 'system.connection', tone: 'neutral', pinned: true, title: 'Data quality result table not set up', detail: dq ? 'Data quality monitoring is turned off. Enable the configured result table to see check failures here.' : 'Point NerveCenter at a DQ result table to see check failures.', at, href: '/data-quality', provider: 'data-quality' });
    return system;
  }

  /* ------------------------------------------------------------------ pipelines */

  async _readyPlatformProviders(scope:Scope, via:PlatformApi|null = null):Promise<string[]> {
    const dataPlatform = via || await this.#dep('dataPlatform', scope) as PlatformApi;
    if (!dataPlatform) return [];
    const status = await dataPlatform.status();
    return (status.providers || []).filter(item => item.ready).map(item => item.provider);
  }
  // A workspace-wide run feed is one call, but on a busy shared workspace the jobs Settings >
  // Pipelines is not monitoring can crowd the top-N most-recent-runs window entirely, leaving a
  // filtered job with zero visible runs even though it ran fine. Below this many monitored jobs,
  // fetch each one's own run history instead so a rarely-run job cannot be starved by noisy
  // neighbors; above it, an unfiltered "everything" setup keeps the cheaper single call.
  static PER_JOB_RUN_FETCH_MAX_PIPELINES = 25;

  async _monitorInventory(args:{scope:Scope;limit?:number;maxRuns?:number;startTimeFrom?:number;provider?:string} = {} as {scope:Scope}):Promise<Inventory> {
    // The admin All view reads every project's own connections and merges them (each pipeline once); it has none of its own.
    if (!assertScope(args.scope).all) return this._projectInventory(args);
    const merged:Inventory = { pipelines: [], runs: [], providers: [], sources: [], providerDiagnostics: [] }; const seen = new Set<string>(); let failure:unknown = null;
    for (const projectScope of await this.#projectScopes()) {
      let part; try { part = await this._projectInventory({ ...args, scope: projectScope }); } catch (error) { failure ||= error; continue; }
      for (const pipeline of part.pipelines) { const key = `${pipeline.platform}:${pipeline.pipelineId}`; if (!seen.has(key)) { seen.add(key); merged.pipelines.push(pipeline); } }
      const runKeys = new Set(merged.runs.map(run => `${run.platform}:${run.pipelineId}:${run.runId}`));
      merged.runs.push(...part.runs.filter(run => !runKeys.has(`${run.platform}:${run.pipelineId}:${run.runId}`)));
      merged.providers = [...new Set([...merged.providers, ...part.providers])]; merged.sources.push(...part.sources); merged.providerDiagnostics.push(...part.providerDiagnostics);
    }
    if (!merged.providers.length) throw failure || httpError(400, 'No pipeline platform is connected. Add a Databricks or Snowflake connection in Connectors.');
    return merged;
  }
  async _projectInventory({ limit = 1000, maxRuns = 100, startTimeFrom, provider, scope, live = false }: {limit?:number;maxRuns?:number;startTimeFrom?:number;provider?:string;scope:Scope;live?:boolean}) {
    if (!live && this.monitorStore) { const ledger = await this.#ledgerInventory({ startTimeFrom, provider, scope }); if (ledger) return ledger; }
    const dataPlatform = await this.#dep('dataPlatform', scope);
    const readyProviders = await this._readyPlatformProviders(scope, dataPlatform); const providers = provider ? readyProviders.filter(item => item === provider) : readyProviders;
    if (provider && !providers.length) throw httpError(400, `Configure a ${provider} connection before reading its pipelines`);
    if (!providers.length) throw httpError(400, 'No pipeline platform is connected. Add a Databricks or Snowflake connection in Connectors.');
    // Job filters from Settings > Pipelines (operations.yaml platforms[].monitoring.jobs) narrow each platform.
    const operations = await this.#operations(scope);
    const settled = await Promise.all(providers.map(async provider => {
      try {
        const providerMaxRuns = provider === 'snowflake' ? 10000 : maxRuns;
        const inventory = await dataPlatform.listPipelines({ provider, limit, includeHealth: false });
        const rawPipelines = ((inventory as PipelineInventory).pipelines || (inventory as PipelineInventory).items || inventory as PipelineRecord[] || []).map((item:PipelineRecord) => ({ ...item, platform: item.platform || provider }));
        const pipelines = (operations ? filterPipelines(rawPipelines as unknown as Parameters<typeof filterPipelines>[0], operations) : rawPipelines) as unknown as PipelineRecord[];
        let normalizedRuns:RunRecord[];
        if (provider === 'databricks' && pipelines.length && pipelines.length <= OperationsService.PER_JOB_RUN_FETCH_MAX_PIPELINES) {
          const perJobLimit = Math.max(1, Math.min(providerMaxRuns, Math.ceil(providerMaxRuns / pipelines.length)));
          const perJob = await Promise.all(pipelines.map((pipeline:PipelineRecord) => dataPlatform.listRuns({ provider, pipelineId: pipeline.pipelineId, limit: perJobLimit, maxRuns: perJobLimit, startTimeFrom })));
          normalizedRuns = perJob.flatMap(runs => ((runs as RunList).items || runs as RunRecord[] || []).map((item:RunRecord) => ({ ...item, platform: item.platform || provider })));
        } else {
          const runs = await dataPlatform.listRuns({ provider, limit: providerMaxRuns, maxRuns: providerMaxRuns, startTimeFrom });
          normalizedRuns = ((runs as RunList).items || runs as RunRecord[] || []).map((item:RunRecord) => ({ ...item, platform: item.platform || provider }));
        }
        return { provider, pipelines, runs: normalizedRuns, sources: ((inventory as PipelineInventory).sources || []).map((source:Record<string,unknown>) => ({ ...source, provider })), maxRuns: providerMaxRuns };
      } catch (error) { return { provider, pipelines: [], runs: [], sources: [], error: String((error as Error)?.message || error) }; }
    }));
    const successful = settled.filter(item => !item.error);
    if (!successful.length) throw new Error(settled.map(item => `${item.provider}: ${item.error}`).join(' '));
    return {
      pipelines: successful.flatMap(item => item.pipelines),
      runs: successful.flatMap(item => item.runs),
      providers: successful.map(item => item.provider),
      sources: successful.flatMap(item => item.sources),
      providerDiagnostics: settled.map(item => ({ provider: item.provider, jobsFetched: item.pipelines.length, runsFetched: item.runs.length, maxRuns: item.maxRuns || maxRuns, ...(item.error ? { error: item.error } : {}) })),
    };
  }
  /** The project's last fetched inventory and its runs in the window, from the ledger; null until the first fetch finished. */
  async #ledgerInventory({ startTimeFrom, provider, scope }: {startTimeFrom?:number;provider?:string;scope:Scope}):Promise<Inventory|null> {
    const monitorStore = this.monitorStore; if (!monitorStore) return null;
    const projectId = assertScope(scope).projectId;
    const snapshot = await monitorStore.getState(projectId, LEDGER_INVENTORY).catch(() => null);
    if (!snapshot?.fetchedAt) return null;
    const providers = provider ? (snapshot.providers || []).filter(item => item === provider) : snapshot.providers || [];
    if (provider && !providers.length) throw new Error(`Configure a ${provider} connection before reading its pipelines`);
    const { items } = await monitorStore.listRuns(projectId, { fromMs: startTimeFrom, limit: LEDGER_READ_CAP });
    const runs = items.filter(run => run.platform !== undefined && providers.includes(run.platform));
    return {
      pipelines: (snapshot.pipelines || []).filter(pipeline => pipeline.platform !== undefined && providers.includes(pipeline.platform)), runs, providers, sources: snapshot.sources || [],
      providerDiagnostics: (snapshot.providerDiagnostics || []).filter(item => providers.includes(item.provider)).map(item => ({ ...item, runsFetched: runs.filter(run => run.platform === item.provider).length, maxRuns: null })),
      ledger: { fetchedAt: snapshot.fetchedAt },
    };
  }
  /**
   * Inventory and runs straight from the platforms, for the background fetch: no run cap, only the window (SPEC-pipelines-01
   * FR-4 as changed by ADR-0002). The fetch passes a cursor, so after the first pass the window is a few hours.
   */
  fetchPlatformSnapshot({ scope, startTimeFrom }: {scope:Scope;startTimeFrom?:number}):Promise<Inventory> { return this._projectInventory({ limit: 5000, maxRuns: FETCH_MAX_RUNS, startTimeFrom, scope, live: true }); }
  /** One pipeline's runs straight from its platform, for the background fetch to backfill a pipeline that has no history in the ledger yet. */
  async fetchPipelineRunHistory({ scope, provider, pipelineId, startTimeFrom }: {scope:Scope;provider:string;pipelineId:string;startTimeFrom?:number}):Promise<RunRecord[]> {
    const dataPlatform = await this.#dep('dataPlatform', scope);
    const runs = await dataPlatform.listRuns({ provider, pipelineId, limit: FETCH_MAX_RUNS, maxRuns: FETCH_MAX_RUNS, startTimeFrom });
    return (Array.isArray(runs) ? runs : runs.items || []).map(item => ({ ...item, platform: item.platform || provider }));
  }
  /** What the Pipelines page adds from the detector: missed and late slots, the open alert, and the task for each run or slot. */
  async #monitorExtras(scope:Scope):Promise<MonitorExtras> {
    const none:MonitorExtras = { slots: new Map(), openAlerts: new Map(), taskByRun: new Map(), taskBySlot: new Map(), automation: null };
    if (!this.monitorStore || assertScope(scope).all) return none;
    const projectId = scope.projectId;
    const monitorStore = this.monitorStore;
    if (!monitorStore) return none;
    const [slots, alerts, operations] = await Promise.all([
      monitorStore.getState(projectId, LEDGER_SLOTS).catch(() => null),
      monitorStore.listAlerts(projectId, { limit: 1000 }).catch(() => ({ items: [] as MonitorAlert[] })),
      this.#operations(scope),
    ]);
    const extras:MonitorExtras = { ...none, slots: new Map(Object.entries((slots as {pipelines?:Record<string,MonitorExtras['slots'] extends Map<string,infer V> ? V : never>}|null)?.pipelines || {})), automation: operations ? effectiveAutomation(operations) as Record<string,unknown> : null };
    for (const alert of alerts.items.filter(item => item.subject?.type === 'pipeline')) {
      const subject = alert.subject;
      if (!subject) continue;
      const key = `${subject.platform}:${subject.id}`;
      const link = { alertId: alert.id, taskId: alert.investigation?.taskId || null, ticketId: alert.ticketId || null, alertStatus: alert.status };
      if (alert.status === 'open' && !extras.openAlerts.has(key)) extras.openAlerts.set(key, { id: alert.id, trigger: alert.trigger, status: alert.status, openedAt: alert.openedAt, taskId: link.taskId, ticketId: link.ticketId, investigation: alert.investigation?.status || null });
      for (const occurrence of alert.occurrences || []) {
        if (occurrence.runId && !extras.taskByRun.has(`${key}:${occurrence.runId}`)) extras.taskByRun.set(`${key}:${occurrence.runId}`, link);
        if (occurrence.slot && !extras.taskBySlot.has(`${key}:${occurrence.slot}`)) extras.taskBySlot.set(`${key}:${occurrence.slot}`, link);
      }
    }
    return extras;
  }
  /** A run with the task that looked at it: the auto-investigation's, else its ticket's. */
  #withTask(run:RunRecord & {ticket?:{taskId?:string}|null}, extras:MonitorExtras):RunRecord & {taskId:string|null;alertId:string|null} {
    const link = extras.taskByRun.get(`${run.platform || 'unknown'}:${run.pipelineId}:${run.runId}`);
    return { ...run, taskId: link?.taskId || run.ticket?.taskId || null, alertId: link?.alertId || null };
  }
  async _providerFor(pipelineId:string, provider:string|undefined, scope:Scope, via:PlatformApi|null = null):Promise<string> {
    if (provider) return provider;
    if (String(pipelineId || '').match(/^(task|pipe|dynamic_table):/)) return 'snowflake';
    const ready = await this._readyPlatformProviders(scope, via);
    if (!ready.length) throw new Error('No pipeline platform is connected');
    return ready.includes('databricks') ? 'databricks' : ready[0];
  }
  // `via` is a platform catalog for one connection (an import or a ticket written back); otherwise the scope project's.
  async _getPlatformPipeline({ pipelineId, provider, scope, via }: {pipelineId?:string;provider?:string;scope:Scope;via?:PlatformApi|null}) { const dataPlatform = via || await this.#dep('dataPlatform', scope) as PlatformApi; return dataPlatform.getPipeline({ provider: await this._providerFor(pipelineId || '', provider, scope, via), pipelineId }); }
  async _getPlatformRun({ pipelineId, runId, provider, scope, via }: {pipelineId?:string;runId?:string;provider?:string;scope:Scope;via?:PlatformApi|null}) { const dataPlatform = via || await this.#dep('dataPlatform', scope) as PlatformApi; return dataPlatform.getRun({ provider: await this._providerFor(pipelineId || '', provider, scope, via), pipelineId, runId }); }
  async _listPlatformRuns({ pipelineId, limit = 20, provider, scope }: {pipelineId?:string;limit?:number;provider?:string;scope:Scope}) { const dataPlatform = await this.#dep('dataPlatform', scope) as PlatformApi; return dataPlatform.listRuns({ provider: await this._providerFor(pipelineId || '', provider, scope), pipelineId, limit }); }

  // Pipelines come from the workspace's one platform connection until grants arrive (phase 2); the tickets matched to them are the scope's.
  async monitor({ limit = 1000, runLimit = 10, range = 'All time', from, to, scope, pageLimit, offset = 0, status, platform, q, pipelineId, includeIdle = true, sort = 'status', dir = 'asc' }:MonitorArgs = {} as MonitorArgs):Promise<MonitorResult> {
    assertScope(scope);
    const { startMs: startTimeFrom, endMs: endTimeTo } = resolveMonitorWindow({ range, from, to });
    // Bound each provider refresh independently. Databricks and Snowflake both expose a
    // workspace/account-wide run feed, so monitoring never falls back to N+1 calls.
    const maxRunsPerProvider = 100;
    const inventory = await this._monitorInventory({ limit, maxRuns: maxRunsPerProvider, startTimeFrom, scope });
    const pipelines = inventory.pipelines;
    const rawRuns = inventory.runs.filter(run => { if (!run.startTime) return true; const at = new Date(run.startTime).getTime(); return (startTimeFrom === undefined || at >= startTimeFrom) && (endTimeTo === undefined || at <= endTimeTo); });
    const pipelineIds = new Set(pipelines.map(p => `${p.platform || 'unknown'}:${p.pipelineId}`)); const relevantRuns = rawRuns.filter(run => pipelineIds.has(`${run.platform || 'unknown'}:${run.pipelineId}`));
    const extras = await this.#monitorExtras(scope);
    const decorated = (await this._decorateRuns(relevantRuns, scope, extras)).map(run => this.#withTask(run, extras)).sort((left, right) => String(right.startTime || '').localeCompare(String(left.startTime || '')));
    const byPipeline = new Map(); const allByPipeline = new Map();
    for (const run of decorated) { const key = `${run.platform || 'unknown'}:${run.pipelineId}`; const list = byPipeline.get(key) || []; if (list.length < runLimit) list.push(run); byPipeline.set(key, list); const all = allByPipeline.get(key) || []; all.push(run); allByPipeline.set(key, all); }
    // The selected time range scopes run health, not inventory. A quiet pipeline remains
    // discoverable and explicitly has no runs in the selected range. Health (healthy, failed,
    // overdue, running, paused, no_runs) is judged from every run in the window, not the runLimit slice.
    const tickets = await this.store.listTickets(scope); const clock = Date.now();
    const rows = pipelines.map(pipeline => {
      const key = `${pipeline.platform || 'unknown'}:${pipeline.pipelineId}`; const recentRuns = byPipeline.get(key) || []; const latest = recentRuns[0];
      const health = pipelineHealth({ schedule: pipeline.schedule, runs: allByPipeline.get(key) || [], now: clock, windowStart: startTimeFrom });
      const row = { ...pipeline, dagId: String(pipeline.dagId || pipeline.pipelineId), dagName: pipeline.dagName || pipeline.name, schedule: pipeline.schedule || null, status: latest?.status || 'no_runs', ...health, lastRunId: latest?.runId || null, lastRunAt: latest?.startTime || null, lastSuccessAt: recentRuns.find((r:RunRecord) => r.status === 'healthy')?.endTime || null, recentRuns };
      // Missed and late slots come from the detector's last pass over its lookback (SPEC-automations-01 FR-41), not from this window.
      const slots = extras.slots.get(key);
      const automation = extras.automation ? { pipelineFailed: triggerFor(extras.automation, 'pipelineFailed', { pipelineId: pipeline.pipelineId, platform: pipeline.platform }).action, pipelineLate: triggerFor(extras.automation, 'pipelineLate', { pipelineId: pipeline.pipelineId, platform: pipeline.platform }).action } : null;
      return { ...row, ...this.#pipelineTicket(row, latest, tickets), missedCount: slots?.missed || 0, lateCount: slots?.late || 0, alert: extras.openAlerts.get(key) || null, automation };
    });
    const failedRuns = decorated.filter(r => r.status === 'failed').length;
    const unreported = decorated.filter(r => r.status === 'status_not_reported');
    const providerNames = inventory.providers.map(value => value[0].toUpperCase() + value.slice(1)); const maxRuns = inventory.ledger ? null : inventory.providerDiagnostics.reduce((total, item) => total + (item.maxRuns || maxRunsPerProvider), 0) || maxRunsPerProvider;
    const truncated = inventory.ledger ? false : inventory.providerDiagnostics.some(item => item.runsFetched >= (item.maxRuns || maxRunsPerProvider));
    const matchesStatus = (item:MonitorPipeline, filter:string) => {
      const health = String(item.health || '').toLowerCase();
      if (filter === 'Succeeded' || filter === 'Healthy') return health === 'healthy' || health === 'running';
      if (filter === 'Missed' || filter === 'Overdue') return health === 'overdue' || Number(item.missedCount || 0) > 0;
      if (filter === 'Failed') return health === 'failed';
      if (filter === 'Paused') return health === 'paused';
      return ({ running: 'Running', no_runs: 'No runs', unknown: 'Unknown' } as Record<string,string>)[health] === filter;
    };
    const summary = {
      succeeded: rows.filter(item => ['healthy','running'].includes(String(item.health || ''))).length,
      failed: rows.filter(item => item.health === 'failed').length,
      missed: rows.filter(item => item.health === 'overdue' || Number(item.missedCount || 0) > 0).length,
      paused: rows.filter(item => item.health === 'paused').length,
      idle: rows.filter(item => item.health === 'no_runs').length,
      matchingIdle: 0,
      platforms: [...new Set(rows.map(item => item.platform).filter((value):value is string => Boolean(value)))].sort(),
      statuses: [...new Set(rows.filter(item => item.health !== 'no_runs').map(item => ({ healthy: 'Succeeded', failed: 'Failed', overdue: 'Missed', running: 'Running', paused: 'Paused', unknown: 'Unknown' } as Record<string,string>)[String(item.health)] || 'Unknown'))].sort(),
    };
    const term = String(q || '').trim().toLowerCase();
    const matchesBase = (item:MonitorPipeline) => {
      if (pipelineId && item.pipelineId !== pipelineId) return false;
      if (status && status !== 'all' && !matchesStatus(item, status)) return false;
      if (platform && platform !== 'all' && item.platform !== platform) return false;
      if (!term) return true;
      return [item.pipelineId, item.name, item.dagName, item.owner, item.summary, ...(item.recentRuns || []).map(run => run.failureSummary)].filter(Boolean).some(value => String(value).toLowerCase().includes(term));
    };
    summary.matchingIdle = rows.filter(item => item.health === 'no_runs' && matchesBase(item)).length;
    const filtered = rows.filter(item => matchesBase(item) && (includeIdle || item.health !== 'no_runs'));
    const healthOrder:Record<string,number> = { failed: 0, overdue: 1, running: 2, unknown: 3, healthy: 4, no_runs: 5, paused: 6 };
    const compareText = (left:unknown, right:unknown) => String(left || '').localeCompare(String(right || ''), undefined, { sensitivity: 'base', numeric: true });
    const compare = (left:MonitorPipeline, right:MonitorPipeline) => {
      let result = 0;
      if (sort === 'name') result = compareText(left.dagName || left.name, right.dagName || right.name);
      else if (sort === 'lastRun') result = String(right.lastRunAt || '').localeCompare(String(left.lastRunAt || ''));
      else if (sort === 'nextRun') result = String(left.nextRunAt || '9999').localeCompare(String(right.nextRunAt || '9999'));
      else result = (healthOrder[String(left.health)] ?? 9) - (healthOrder[String(right.health)] ?? 9) || compareText(left.dagName || left.name, right.dagName || right.name);
      if (dir === 'desc') result *= -1;
      return result || compareText(left.pipelineId, right.pipelineId);
    };
    if (pageLimit !== undefined) filtered.sort(compare);
    const resultItems = pageLimit === undefined ? filtered : filtered.slice(Math.max(0, offset), Math.max(0, offset) + pageLimit);
    return { items: resultItems, total: filtered.length, workspaceTotal: pipelines.length, summary, recentRuns: decorated, range: String(range), from: startTimeFrom ? new Date(startTimeFrom).toISOString() : null, to: endTimeTo ? new Date(endTimeTo).toISOString() : null, fetchedAt: inventory.ledger?.fetchedAt || now(), diagnostics: { source: inventory.ledger ? 'ledger' : 'live', jobsFetched: pipelines.length, runsFetched: decorated.length, ignoredRuns: rawRuns.length - relevantRuns.length, failedRuns, unreportedRuns: unreported.length, unreportedStates: [...new Set(unreported.map(r => r.rawState).filter(Boolean))], truncated, maxRuns, pageSize: 25, providers: inventory.providerDiagnostics, sources: inventory.sources, pipelineAccessScope: `Pipelines visible to the configured ${providerNames.join(' and ') || 'platform'} service ${providerNames.length === 1 ? 'identity' : 'identities'}` } };
  }
  /**
   * The ticket that tracks a pipeline's latest failure, and whether one should be created.
   * A ticket counts when it was raised for that exact run, or when it is open and names the job
   * (its name with or without underscores, or "job <id>") - so an incident someone raised by hand in
   * ServiceNow links instead of being duplicated. "Create ticket" is offered only when the latest run
   * failed and nothing tracks it.
   */
  #pipelineTicket(pipeline:PipelineRecord, latest:RunRecord|undefined, tickets:OpsTicket[]) {
    const failed = latest && FAILED.has(String(latest.status || '').toLowerCase());
    const name = String(pipeline.name || '').toLowerCase(); const spaced = name.replace(/[_-]+/g, ' ').trim();
    const id = String(pipeline.pipelineId || '');
      const mentions = (ticket:OpsTicket) => {
      const text = [ticket.title, ticket.description, ticket.failureSummary, ...(ticket.tags || [])].join(' ').toLowerCase();
      const loose = text.replace(/[_-]+/g, ' ');
      return (name.length >= 6 && text.includes(name)) || (spaced.length >= 6 && loose.includes(spaced)) || (id && new RegExp(`\\bjob\\s*#?${id.replace(/[^\w-]/g, '')}\\b`).test(text)) || String(ticket.pipelineId || '') === id;
    };
    const exact = latest ? tickets.find(ticket => String(ticket.pipelineId || '') === id && String(ticket.runId || '') === String(latest.runId)) : null;
    const open = tickets.filter(ticket => !isClosed(ticket) && mentions(ticket)).sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))[0];
    const linked = exact || open || null;
    const view = linked ? decorateTicket(linked) : null;
    return { ticket: view ? { ticketId: view.ticketId, number: view.externalReference?.number || null, title: view.title, status: view.appStatus, source: view.source || null } : null, ticketAction: failed ? (linked ? 'view' : 'create') : null };
  }

  // Kept for the Pipelines page, which posts here. Reading never creates tickets any more;
  // "Investigate" on a failed run starts a Task instead.
  async reconcileMonitor(args:MonitorArgs) { return this.monitor(args); }
  async pipelines(args:{scope:Scope;limit?:number;provider?:string;startTimeFrom?:number} ) { return (await this._monitorInventory({ ...args, maxRuns: 1 })).pipelines; }
  pipeline(pipelineId:string, { provider, scope }: {provider?:string;scope:Scope}) { return this._getPlatformPipeline({ pipelineId, provider, scope }); }
  async pipelineRuns(pipelineId: string, { limit = 20, provider, scope }: { limit?: number; provider?: string; scope:Scope }) { return (await this.pipelineRunHistory(pipelineId, { limit, provider, scope })).items; }
  /**
   * One page of a pipeline's run history, newest first, with the task for each run and the missed or late slots the detector
   * found (SPEC-pipelines-01 FR-15, FR-16). From the ledger when the project has been fetched, so the history is as long as the
   * retention; from the platform otherwise.
   */
  async pipelineRunHistory(pipelineId:string, { limit = 20, offset = 0, provider, scope }: {limit?:number;offset?:number;provider?:string;scope:Scope}) {
    const projectId = this.monitorStore && !assertScope(scope).all ? scope.projectId : null;
    const monitorStore = this.monitorStore;
    const snapshot = projectId && monitorStore ? await monitorStore.getState(projectId, LEDGER_INVENTORY).catch(() => null) : null;
    const extras = await this.#monitorExtras(scope);
    if (!snapshot?.fetchedAt) { const items = (await this._decorateRuns(await this._listPlatformRuns({ pipelineId, limit, provider, scope }), scope, extras)).map(run => this.#withTask(run, extras)); return { items, total: items.length, slots: [], fetchedAt: null }; }
    const platform = provider || (snapshot.pipelines || []).find(item => String(item.pipelineId) === String(pipelineId))?.platform || await this._providerFor(pipelineId, undefined, scope);
    if (!monitorStore || !projectId) throw new Error('Monitor ledger is unavailable');
    const { items, total } = await monitorStore.listRuns(projectId, { pipelineId, platform, limit: Math.max(1, Math.min(500, Number(limit) || 20)), offset });
    const decorated = (await this._decorateRuns(items, scope, extras)).map(run => this.#withTask(run, extras));
    const key = `${platform}:${pipelineId}`;
    const slots = (extras.slots.get(key)?.slots || []).map(slot => { const link = extras.taskBySlot.get(`${key}:${slot.at}`); return { ...slot, taskId: link?.taskId || null, alertId: link?.alertId || null }; }).reverse();
    return { items: decorated, total, slots, fetchedAt: snapshot.fetchedAt };
  }
  // `extras` (from #monitorExtras) links every run an alert covers to the alert's ticket, which records only the run it opened on.
  // The ticket carries its source number so a row shows INC… or the Jira key, as the pipeline row does.
  async _decorateRuns(runs:RunRecord[]|RunList, scope:Scope, extras:MonitorExtras|null = null):Promise<Array<RunRecord & {ticket:Record<string,unknown>|null;ticketAction:string|null}>> {
    const runItems = Array.isArray(runs) ? runs : runs.items || [];
    const tickets = await this.store.listTickets(scope); const byRun = new Map(); const byId = new Map(tickets.map(ticket => [ticket.ticketId, ticket]));
    for (const ticket of tickets) { byRun.set(`${ticket.platform || ticket.source || 'databricks'}:${ticket.pipelineId}:${ticket.runId}`, ticket); if (!byRun.has(`${ticket.pipelineId}:${ticket.runId}`)) byRun.set(`${ticket.pipelineId}:${ticket.runId}`, ticket); }
    const viaAlert = (run:RunRecord) => { const ticketId = extras?.taskByRun?.get(`${run.platform || 'unknown'}:${run.pipelineId}:${run.runId}`)?.ticketId; return ticketId ? byId.get(ticketId) || null : null; };
    return runItems.map(run => { const ticket = byRun.get(`${run.platform || 'databricks'}:${run.pipelineId}:${run.runId}`) || byRun.get(`${run.pipelineId}:${run.runId}`) || viaAlert(run); const failed = FAILED.has(String(run.status || '').toLowerCase()); return { ...run, ticket: ticket ? { ticketId: ticket.ticketId, number: ticket.externalReference?.number || null, title: ticket.title || null, status: ticket.status, taskId: ticket.taskId || null } : null, ticketAction: failed ? (ticket ? 'view' : 'create') : null }; });
  }

  /* -------------------------------------------------------------------- tickets */

  // The project comes from `input.scope` only (FR-15); a projectId in the body is never read.
  async createTicket(input:TicketCreateInput = {} as TicketCreateInput):Promise<OpsTicket> {
    const { pipelineId, runId, creator, assignee } = input;
    const projectId = writeProjectId(input.scope);
    const priority = normalizePriority(input.priority);
      const base = { workflowIds: [], resolutionSummary: null, collaborators: Array.isArray(input.collaborators) ? input.collaborators : [], priority, status: 'open', closedAt: null, taskId: null, activity: [] as OpsActivity[] };
    if (pipelineId || runId) {
      if (!pipelineId || !runId) throw httpError(400, 'pipelineId and runId must be provided together');
      const hintedProvider = String(input.platform || '').toLowerCase() || undefined;
      // A background failure job names the connection it read; a person's request uses the project's default one (FR-25).
      const via = input.connectionId && this.pinned?.dataPlatform ? await this.pinned.dataPlatform(input.connectionId) : null;
      const run = await this._getPlatformRun({ pipelineId, runId, provider: hintedProvider, scope: input.scope, via: via as PlatformApi|null });
      if (!FAILED.has(String(run.status).toLowerCase())) throw httpError(409, 'Tickets can be created only for failed pipeline runs');
      const platform = String(run.platform || hintedProvider || await this._providerFor(pipelineId, undefined, input.scope, via)).toLowerCase();
      const pipeline = await this._getPlatformPipeline({ pipelineId, provider: platform, scope: input.scope, via: via as PlatformApi|null });
      const connectionId = input.connectionId ?? await this.#connectionIdFor(platform, input.scope);
      const id = await this.store.nextTicketId(); const createdAt = now();
      const ticket:OpsTicket = { ...base, ticketId: id, projectId, visibility: input.visibility === 'private' ? 'private' : 'project', source: platform, sourceRef: `${pipelineId}:${runId}`, sourceKey: `${platform}:${pipelineId}:${runId}`, connectionId, category: 'incident', type: 'pipeline_failure', title: input.title || `Failed pipeline: ${pipeline.name || run.name || pipelineId}`, description: input.description || run.failureSummary || 'Pipeline run failed', pipelineId: String(pipelineId), runId: String(runId), platform, pipelineName: pipeline.name || run.name || String(pipelineId), failureSummary: run.failureSummary || 'Pipeline run failed', failingTask: run.failingTask || undefined, creator: creator || { type: 'system', id: 'nervecenter', name: 'NerveCenter' }, requester: input.requester || creator || null, assignee: assignee === undefined ? (creator || null) : assignee, context: input.context || {}, metadata: { ...(input.metadata || {}), provider: platform, runStartTime: run.startTime, runEndTime: run.endTime, durationMs: run.durationMs, rawState: run.rawState }, createdAt, updatedAt: createdAt };
      ticket.activity = [activityEvent({ type: 'ticket.created', title: 'Ticket opened', detail: `From failed run ${runId}`, actor: creator })];
      return this.#storeNew(ticket, !await this.store.findTicketBySourceKey?.(ticket.sourceKey ?? undefined, connectionId));
    }
    const title = String(input.title || '').trim(); if (!title) throw httpError(400, 'title is required for a non-pipeline ticket');
    const source = String(input.source || 'manual').trim() || 'manual'; const sourceRef = input.sourceRef ? String(input.sourceRef).trim() : undefined;
    const existing = sourceRef ? await this.store.findTicketBySourceKey?.(`${source}:${sourceRef}`) || await this.store.findTicketBySourceRef?.(sourceRef) : null; if (existing) return assertRowInScope(input.scope, existing);
    const id = await this.store.nextTicketId(); const createdAt = now();
    const ticket:OpsTicket = { ...base, ticketId: id, projectId, visibility: input.visibility === 'private' ? 'private' : 'project', title, description: String(input.description || '').trim(), category: String(input.category || 'task').trim() || 'task', type: input.type ? String(input.type).trim() : undefined, tags: Array.isArray(input.tags) ? input.tags.map(String) : [], source, sourceRef, sourceKey: sourceRef ? `${source}:${sourceRef}` : undefined, creator: creator || null, requester: input.requester || creator || null, assignee: assignee === undefined ? (creator || null) : assignee, context: input.context && typeof input.context === 'object' ? input.context : {}, metadata: input.metadata && typeof input.metadata === 'object' ? input.metadata : {}, createdAt, updatedAt: createdAt };
    ticket.activity = [activityEvent({ type: 'ticket.created', title: 'Ticket opened', detail: actorName(creator) ? `by ${actorName(creator)}` : null, actor: creator })];
    return this.#storeNew(ticket, true);
  }

  /** The ticket already tracking a failed run, looked up the way createTicket keys it (the project's connection), or null. It may sit in another project that monitors the same job. */
  async runTicket({ pipelineId, runId, platform, scope }: {pipelineId:string;runId:string;platform?:string;scope:Scope}) {
    assertScope(scope);
    const provider = String(platform || 'databricks').toLowerCase(); const key = `${provider}:${pipelineId}:${runId}`;
    return await this.store.findTicketBySourceKey?.(key, await this.#connectionIdFor(provider, scope)) || await this.store.findTicketBySourceKey?.(key, '') || null;
  }

  /** Sign a ticket and store it; a ticket that is new here is checked for being an earlier fix coming back. */
  async #storeNew(ticket:OpsTicket, isNew:boolean):Promise<OpsTicket> {
    const signature = failureSignature(ticket); if (signature) ticket.signature = signature;
    const stored = await this.store.createTicket(ticket);
    const result = isNew ? await this.#flagRecurrence(stored) : stored;
    await this.publishTicketChange(result.ticketId);
    return result;
  }
  async #recurrenceWindowDays(projectId:string):Promise<number> {
    const raw = (await this.#operations(projectId))?.tickets?.recurrenceWindowDays;
    return raw === undefined || raw === null || !Number.isFinite(Number(raw)) || Number(raw) < 0 ? DEFAULT_RECURRENCE_DAYS : Number(raw);
  }
  /**
   * When a new ticket has the signature of one resolved or closed within `tickets.recurrenceWindowDays`
   * (default 30; 0 turns it off), the earlier fix did not hold: link both, log it on both, and the
   * new ticket's event shows in the notifications. Never blocks creating the ticket.
   */
  async #flagRecurrence(ticket:OpsTicket):Promise<OpsTicket> {
    try {
      const days = await this.#recurrenceWindowDays(ticket.projectId);
      if (!ticket.signature || days <= 0 || isClosed(ticket)) return ticket;
      const at = parseMs(ticket.createdAt) ?? Date.now(); const closedMs = (item:OpsTicket) => parseMs(item.closedAt || item.updatedAt) ?? 0;
      const earlier = (await this.store.findTicketsBySignature?.(ticket.signature as string, systemScope(ticket.projectId) as Scope) || []).filter(item => item.ticketId !== ticket.ticketId && ['resolved', 'closed'].includes(item.status) && closedMs(item) <= at && closedMs(item) >= at - days * 86_400_000).sort((a, b) => closedMs(b) - closedMs(a))[0];
      if (!earlier) return ticket;
      // Only same-project tickets reach here (FR-48): the signature lookup is scoped to the new ticket's project.
      const detail = `Same failure as ${earlier.ticketId}, closed ${new Date(closedMs(earlier)).toISOString().slice(0, 10)}${earlier.resolutionSummary ? `: ${String(earlier.resolutionSummary).slice(0, 200)}` : ''}`;
      return (await this.#writeLink(ticket.ticketId, earlier.ticketId, 'recurrence_of', { auto: true, detail })).from;
    } catch (error) { console.warn('[tickets] recurrence check failed:', (error as Error)?.message || error); return ticket; }
  }
  /** Store a link on both tickets and log it on both. Returns the two tickets as they are now. */
  async #writeLink(fromId:string, toId:string, relation:LinkRelation, { actor = null, auto = false, detail = null }: {actor?:ServiceUser|null;auto?:boolean;detail?:string|null} = {}) {
    const [from, to] = await Promise.all([this.store.getTicket(fromId), this.store.getTicket(toId)]);
    if (!from || !to || from.projectId !== to.projectId) throw httpError(403, 'Tickets in different projects cannot be linked.');
    const at = now(); const link = { relation, direction: 'out', ticketId: toId, at, ...(auto ? { auto: true } : {}), ...(actor?.id ? { by: actorName(actor) } : {}) };
    const recurrence = relation === 'recurrence_of'; const type = recurrence ? 'ticket.recurrence' : 'ticket.link';
    const by = actor?.id ? `by ${actorName(actor)}` : null;
    const fromEvent = { ...activityEvent({ type, status: recurrence ? 'warning' : 'completed', title: recurrence ? `Fix for ${toId} didn't hold` : `${LINK_TITLE.out[relation]} ${toId}`, detail: detail || by, actor }), relatedTicketId: toId, ...(recurrence ? { recurrenceOf: toId } : {}) };
    const toEvent = { ...activityEvent({ type, status: recurrence ? 'warning' : 'completed', title: `${LINK_TITLE.in[relation]} ${fromId}`, detail: detail || by, actor }), relatedTicketId: fromId };
    await this.store.updateTicket(fromId, { links: [...(from.links || []), link] });
    await this.store.updateTicket(toId, { links: [...(to.links || []), { ...link, direction: 'in', ticketId: fromId }] });
    await this.store.appendActivity(toId, [toEvent]);
    const finalFrom = await this.store.appendActivity(fromId, [fromEvent]);
    await this.publishTicketChange(fromId);
    await this.publishTicketChange(toId);
    for (const [id, event] of [[fromId, fromEvent], [toId, toEvent]] as Array<[string,OpsActivity]>) this.onTicketChange?.(id, { title: event.title, detail: event.detail });
    return { from: finalFrom, to: await this.store.getTicket(toId) };
  }

  /**
   * Link ticket `fromId` to `toId` (recurrence_of, amends_fix_of, duplicate_of, related_to) as `user`: stored on
   * both tickets, logged on both, and optionally a comment on `toId` (which reaches ServiceNow or Jira like any comment).
   */
  async linkTickets(fromId:string, toId:string, { relation, comment, user, scope }:LinkInput = {}):Promise<Record<string,unknown>> {
    // The All view is read-only, and both tickets must sit in the one project of the scope (FR-48).
    writeProjectId(scope as Scope);
    if (!LINK_RELATIONS.includes(relation as LinkRelation)) throw new Error(`relation must be one of ${LINK_RELATIONS.join(', ')}`);
    if (fromId === toId) throw new Error('A ticket cannot be linked to itself');
    const from = await this.authorizeTicket(fromId, user, 'comment', scope as Scope); await this.authorizeTicket(toId, user, 'comment', scope as Scope);
    if ((from!.links || []).some(link => link.direction === 'out' && link.relation === relation && link.ticketId === toId)) return { from: fromId, to: toId, relation, linked: false, note: 'Already linked' };
    const result:Record<string,unknown> = { from: fromId, to: toId, relation, linked: true };
    await this.#writeLink(fromId, toId, relation as LinkRelation, { actor: user });
    if (String(comment || '').trim()) {
      try { const posted = await this.commentTicket(toId, user as ServiceUser, { body: comment as string, scope: scope as Scope }); result.commented = true; result.sourceWrite = posted.sourceWrite || null; }
      catch (error) { result.commented = false; result.commentError = (error as Error).message; }
    }
    return result;
  }

  /**
   * Earlier tickets like this one, for the agent: same signature first, then the closest by words (the
   * `similarityRanker`), newest first on ties. Only tickets `user` can open; `status` filters (default resolved and closed).
   */
  async findSimilarTickets({ ticketId, text, status = ['resolved', 'closed'], limit = 5, user, scope }:SimilarTicketsInput = {} as SimilarTicketsInput) {
    const source = ticketId ? await this.ticket(ticketId, user, scope) : null;
    const query = [source && `${source.title || ''} ${source.failureSummary || source.description || ''}`, text].filter(Boolean).join(' ').trim();
    if (!query) throw new Error('Give a ticketId or some text to search for');
    const wanted = new Set(status); const signature = source ? source.signature || failureSignature(source) : null;
    // Same project only (FR-48): the scope's tickets, and when searching from a ticket, that ticket's project even in the All view.
    let rows = await this.store.listTickets(scope);
    if (source) rows = rows.filter(ticket => ticket.projectId === source.projectId);
    if (user?.id) rows = rows.filter(ticket => canAccess(ticket, user));
    rows = rows.filter(ticket => ticket.ticketId !== source?.ticketId && wanted.has(ticket.status));
    const commentsByTicket = groupByTicket(await this.store.listActivity(rows.map(ticket => ticket.ticketId), { types: ['ticket.comment'], limit: 10000 }));
    const comments = (ticket:OpsTicket) => [...(commentsByTicket.get(ticket.ticketId) || [])].reverse().map(event => event.detail || '').join(' ').slice(0, 3000);
    const documents = rows.map(ticket => ({ id: ticket.ticketId, text: [ticket.title, ticket.title, ticket.description, ticket.failureSummary, ticket.resolutionSummary, comments(ticket)].filter(Boolean).join(' ') }));
    const scores = new Map((await this.similarityRanker.rank({ query, documents })).map(hit => [hit.id, hit.score]));
    const recency = (ticket:OpsTicket) => parseMs(ticket.closedAt || ticket.updatedAt || ticket.createdAt) ?? 0;
    const same = (ticket:OpsTicket) => Boolean(signature) && (ticket.signature || failureSignature(ticket)) === signature;
    const hits = rows.filter(ticket => same(ticket) || scores.has(ticket.ticketId)).map(ticket => ({ ticket, same: same(ticket), score: Math.round((scores.get(ticket.ticketId) || 0) * 100) / 100 }));
    hits.sort((a, b) => Number(b.same) - Number(a.same) || (a.same ? 0 : b.score - a.score) || recency(b.ticket) - recency(a.ticket));
    const shown = hits.slice(0, Math.max(1, Math.min(MAX_SIMILAR, Number(limit) || 5)));
    const statusByTicket = groupByTicket(await this.store.listActivity(shown.map(hit => hit.ticket.ticketId), { types: ['ticket.status'], limit: 10000 }));
    return { ranker: this.similarityRanker.name || 'custom', hits: shown.map(({ ticket, same: exact, score }) => ({ ticket: decorateTicket(ticket), matchReason: exact ? 'same signature' : 'similar text', score, resolvedBy: resolvedByOf(ticket, statusByTicket.get(ticket.ticketId)) })) };
  }

  /** Sign tickets that have no signature yet (startup pass). Leaves updatedAt alone. */
  async backfillSignatures() {
    let signed = 0;
    for (const scope of await this.#projectScopes()) for (const ticket of await this.store.listTickets(scope)) { if (ticket.signature !== undefined) continue; await this.store.updateTicket(ticket.ticketId, { signature: failureSignature(ticket) || null }, { touch: false }); signed += 1; }
    return signed;
  }

  #jiraQuery(input:JiraInput):Record<string,unknown> { return { jql: input.jql, project: input.project, limit: Math.max(1, Math.min(2000, Number(input.limit) || 50)), updatedSinceHours: input.updatedSinceHours }; }
  async #countImported(incidents:ImportedIncident[], connectionId = ''):Promise<number> { let count = 0; for (const imported of incidents) if (await this.store.findTicketBySourceKey?.(imported.sourceKey, connectionId)) count += 1; return count; }
  /**
   * Create or refresh one ticket per imported incident, keeping what people already did to an existing one. Idempotency is per
   * connection (FR-25). Where the grants say which project an item belongs to (FR-26) the ticket goes there, or to Unrouted;
   * `routing: 'project'` (a request) imports only what belongs to the request's project and leaves the rest to the background job,
   * `routing: 'all'` (the job, one run per connection) imports everything where it belongs. A ticket that already has a project
   * never moves, except from Unrouted once a grant matches it.
   */
  async #importIncidents(incidents:ImportedIncident[], system:string, { scope, connectionId = '', provider = '', routing = 'project' }:IncidentSyncOptions = {} as IncidentSyncOptions):Promise<ImportedTicketResult> {
    const projectId = writeProjectId(scope);
    const tickets:OpsTicket[] = []; const result:ImportedTicketResult = { tickets, skipped: 0, unrouted: 0, byProject: {} };
    for (const imported of incidents) {
      const existing = await this.store.findTicketBySourceKey?.(imported.sourceKey, connectionId);
      let target = existing?.projectId || projectId;
      if (this.grants && connectionId && (!existing || existing.projectId === UNROUTED_ID)) {
        const routed = (await this.grants.route(connectionId, provider, imported)).projectId;
        if (routing === 'project' && routed !== projectId) { result.skipped += 1; if (routed === UNROUTED_ID) result.unrouted += 1; continue; }
        target = routed;
      }
      // A request never reads or touches another project's ticket (FR-13); only the background job refreshes every project's own.
      if (routing === 'project' && existing && existing.projectId !== projectId && target !== projectId) { result.skipped += 1; continue; }
      if (existing?.projectId === UNROUTED_ID && target !== UNROUTED_ID) {
        await this.store.setTicketProject(existing.ticketId, target);
        await this.store.appendActivity(existing.ticketId, [activityEvent({ type: 'ticket.routed', title: 'Routed to a project', detail: `A connection grant now matches this ticket` })]);
        await this.onChangeHint?.({ resource: 'ticket', id: existing.ticketId, projectId: existing.projectId });
      }
      if (target === UNROUTED_ID) result.unrouted += 1;
      const fresh = await this.#storeNew({ ...imported, title: imported.title || imported.number || 'Imported ticket', status: imported.status || 'open', ticketId: existing?.ticketId || await this.store.nextTicketId(), projectId: target, connectionId, workflowIds: existing?.workflowIds || [], resolutionSummary: String(existing?.resolutionSummary || '' ) || null, visibility: existing?.visibility === 'private' ? 'private' : 'project', priority: normalizePriority(imported.priority), createdAt: existing?.createdAt || imported.createdAt || now(), updatedAt: imported.updatedAt || now(), closedAt: existing?.closedAt || null, taskId: existing?.taskId || null, activity: [activityEvent({ type: 'ticket.created', title: `Imported from ${system}`, detail: imported.externalReference?.number || null })] }, !existing);
      tickets.push(fresh); (result.byProject[fresh.projectId] ||= []).push(fresh);
    }
    return result;
  }
  async serviceNowStatus({ verify = false, scope }:ConnectionOptions = {} as ConnectionOptions) { const status = await ((await this.#dep('serviceNow', scope) as ServiceNowApi)?.status({ verify }) || { mode: 'disabled', configured: false, ready: false, reason: 'ServiceNow is not connected' }); return { ...status, assignmentGroups: Array.isArray(status.assignmentGroups) ? status.assignmentGroups : [] }; }
  _serviceNowFilters(input:ServiceNowFilterInput = {}):ServiceNowFilters { const list = (value:unknown) => (Array.isArray(value) ? value : value === undefined || value === null || value === '' ? [] : [value]).map(String).map((item:string) => item.trim()).filter(Boolean); return { limit: Math.max(1, Math.min(2000, Number(input.limit) || 50)), assignmentGroup: String(input.assignmentGroup || '').trim() || undefined, states: list(input.states), priorities: list(input.priorities), tag: String(input.tag || '').trim() || undefined, updatedSinceHours: Number.isFinite(Number(input.updatedSinceHours)) && Number(input.updatedSinceHours) > 0 ? Number(input.updatedSinceHours) : undefined }; }
  // Same filters as sync, nothing written: lets the operator see what an import would pull in.
  async previewServiceNow(input:ServiceNowFilterInput&{scope:Scope} = {} as ServiceNowFilterInput&{scope:Scope}) {
    const { scope, ...rest } = input; const serviceNow = await this.#dep('serviceNow', scope);
    if (!serviceNow) throw new Error('ServiceNow is not connected'); const filters = this._serviceNowFilters(rest); const result = await serviceNow.listIncidents(filters);
    const alreadyImported = await this.#countImported(result.incidents, await this.#connectionIdFor('servicenow', scope));
    return { total: result.total, matched: result.incidents.length, alreadyImported, instance: result.instance, source: result.source, query: result.query || null, filters, sample: result.incidents.slice(0, 10).map(item => ({ number: (item.externalReference as NonNullable<ImportedIncident['externalReference']>).number, short_description: item.title, priority: item.priority, state: item.metadata?.serviceNow?.state || item.status, status: item.status, assignmentGroup: item.metadata?.serviceNow?.assignmentGroup || null, updatedAt: item.updatedAt, alreadyImported: false })) };
  }
  async syncServiceNow(input:ServiceNowInput = {} as ServiceNowInput) {
    const { startTriage, scope, connectionId: named, routing = 'project', ...rest } = input; writeProjectId(scope);
    const serviceNow = await this.#client('serviceNow', scope, named);
    if (!serviceNow) throw new Error('ServiceNow is not connected');
    const connectionId = named ?? await this.#connectionIdFor('servicenow', scope);
    const filters = this._serviceNowFilters(rest); const result = await serviceNow.listIncidents(filters);
    const imported = await this.#importIncidents(result.incidents, 'ServiceNow', { scope, connectionId, provider: 'servicenow', routing });
    const closed = await this.#refreshVanished('servicenow', result.incidents, routing === 'all' ? await this.#allScopes() : [scope], numbers => serviceNow.listIncidents({ numbers, limit: 100 }), connectionId);
    return { synced: imported.tickets.length, closed: closed.length, skipped: imported.skipped, unrouted: imported.unrouted, byProject: imported.byProject, total: result.total, instance: result.instance, source: result.source, startTriage: startTriage !== false, filters, tickets: imported.tickets };
  }

  /**
   * Tickets imported earlier that the scoped query no longer returns (the scope only lists active
   * work) are looked up by number. Closed or moved in the source means the same here, with an
   * activity entry, so a resolution made in ServiceNow or Jira is not invisible in NerveCenter.
   */
  async #refreshVanished(source:string, returned:ImportedIncident[], scopes:Scope[], fetchByRefs:(refs:string[])=>Promise<IncidentListResult>, connectionId = ''):Promise<string[]> {
    const CLOSED = ['closed', 'cancelled', 'resolved'];
    const keyOf = (ticket:OpsTicket) => ticket.sourceKey || (ticket.externalReference ? `${ticket.externalReference.system}:${ticket.externalReference.sysId}` : null);
    const seen = new Set(returned.map(item => item.sourceKey));
    const vanished = (await Promise.all(([] as Scope[]).concat(scopes).map(scope => this.store.listTickets(scope)))).flat().filter(ticket => ticket.source === source && (ticket.connectionId || '') === connectionId && ticket.externalReference?.number && keyOf(ticket) && !seen.has(keyOf(ticket)) && !CLOSED.includes(ticket.status));
    const closed = [];
    for (let i = 0; i < vanished.length; i += 50) {
      const batch = vanished.slice(i, i + 50);
      let result:IncidentListResult; try { result = await fetchByRefs(batch.map(ticket => ticket.externalReference?.number || '')); } catch { break; }
      for (const fresh of result.incidents || []) {
        const existing = batch.find(ticket => keyOf(ticket) === fresh.sourceKey);
        if (!existing || existing.status === fresh.status) continue;
        const at = new Date().toISOString(); const closing = CLOSED.includes(fresh.status || ''); const system = source === 'jira' ? 'Jira' : 'ServiceNow';
        await this.store.updateTicket(existing.ticketId, { status: fresh.status, updatedAt: fresh.updatedAt || at, closedAt: closing ? existing.closedAt || fresh.updatedAt || at : existing.closedAt || null, metadata: { ...(existing.metadata || {}), ...(fresh.metadata || {}) } });
        await this.store.appendActivity(existing.ticketId, [{ id: `sync-${existing.ticketId}-${Date.now()}`, type: 'ticket.synced', status: 'completed', title: closing ? `Closed in ${system}` : `Status changed in ${system}`, detail: fresh.metadata?.serviceNow?.state || fresh.metadata?.jira?.status || fresh.status, at }]);
        await this.publishTicketChange(existing.ticketId);
        if (closing) closed.push(existing.ticketId);
      }
      // The lookup worked but returned nothing for these: deleted in the source. Cancel them here
      // instead of leaving them open forever; the ticket and its history stay in NerveCenter.
      const found = new Set((result.incidents || []).flatMap(fresh => [fresh.sourceKey, fresh.externalReference?.number]).filter(Boolean));
      for (const existing of batch.filter(ticket => !found.has(keyOf(ticket)) && !found.has(ticket.externalReference?.number))) {
        const at = new Date().toISOString(); const system = source === 'jira' ? 'Jira' : 'ServiceNow';
        await this.store.updateTicket(existing.ticketId, { status: 'cancelled', updatedAt: at, closedAt: existing.closedAt || at });
        await this.store.appendActivity(existing.ticketId, [{ id: `sync-${existing.ticketId}-${Date.now()}`, type: 'ticket.synced', status: 'completed', title: `Deleted in ${system}`, detail: `${existing.externalReference?.number} no longer exists in ${system}`, at }]);
        await this.publishTicketChange(existing.ticketId);
        closed.push(existing.ticketId);
      }
    }
    return closed;
  }

  async jiraStatus({ verify = false, scope }:ConnectionOptions = {} as ConnectionOptions) {
    const jira = await this.#dep('jira', scope); const status = await jira?.status!({ verify }) || { mode: 'disabled', configured: false, ready: false, reason: 'Jira is not connected' };
    const operations = await this.#operations(scope);
    const sources = operations?.ticketing?.app?.sources;
    const jiraSource = Array.isArray(sources) ? sources.find(source => source?.platform === 'jira') : null;
    const defaultJql = jiraSource?.filters?.jql ? String(jiraSource.filters.jql) : undefined;
    return defaultJql ? { ...status, defaultJql } : status;
  }
  async previewJira(input:JiraInput = {} as JiraInput) {
    const jira = await this.#dep('jira', input.scope);
    if (!jira) throw new Error('Jira is not connected'); const result = await jira.searchIssues(this.#jiraQuery(input));
    const alreadyImported = await this.#countImported(result.incidents, await this.#connectionIdFor('jira', input.scope));
    return { total: result.total, matched: result.incidents.length, alreadyImported, site: result.site, source: 'jira', query: result.query, sample: result.incidents.slice(0, 10).map(item => ({ number: (item.externalReference as NonNullable<ImportedIncident['externalReference']>).number, short_description: item.title, priority: item.priority, state: item.metadata?.jira?.status || item.status, status: item.status, updatedAt: item.updatedAt })) };
  }
  async syncJira(input:JiraInput = {} as JiraInput) {
    const { scope, connectionId: named, routing = 'project' } = input; writeProjectId(scope);
    const jira = await this.#client('jira', scope, named);
    if (!jira) throw new Error('Jira is not connected');
    const connectionId = named ?? await this.#connectionIdFor('jira', scope);
    const result = await jira.searchIssues(this.#jiraQuery(input));
    const imported = await this.#importIncidents(result.incidents, 'Jira', { scope, connectionId, provider: 'jira', routing });
    const closed = await this.#refreshVanished('jira', result.incidents, routing === 'all' ? await this.#allScopes() : [scope], keys => jira.searchIssues({ keys, limit: 100 }), connectionId);
    return { synced: imported.tickets.length, closed: closed.length, skipped: imported.skipped, unrouted: imported.unrouted, byProject: imported.byProject, total: result.total, site: result.site, source: 'jira', query: result.query, tickets: imported.tickets };
  }
  async listTickets({ status = 'active', source = 'all', user, scope }:TicketListInput = {} as TicketListInput):Promise<OpsTicket[]> {
    let rows = await this.store.listTickets(scope);
    if (user?.id) rows = rows.filter(ticket => canAccess(ticket, user));
    if (source && source !== 'all') rows = rows.filter(t => (t.source || 'manual') === source);
    rows = rows.map(decorateTicket);
    if (status === 'all') return rows;
    if (status === 'closed') return rows.filter(t => ['closed', 'cancelled', 'resolved'].includes(t.status));
    return rows.filter(t => !['closed', 'cancelled', 'resolved'].includes(t.status));
  }
  async listTicketPage({ user, scope, query }:TicketPageInput) {
    if (!user?.id) throw httpError(403, 'Sign in to view tickets.');
    const result = await this.store.listTicketPage(scope, { ...query, access: this.ticketAccess(user) });
    return { ...result, items:result.items.map(decorateTicket) };
  }
  // The canAccess rule as data, for readers that filter in the store. No user reads everything, as listTickets does.
  ticketAccess(user:ServiceUser|undefined):TicketAccess {
    const routing:Record<string,string> = {};
    for (const [key, raw] of Object.entries(config.approverRouting || {})) { const value = raw as {id?:string;name?:string} | null; if (value) routing[key] = String(value.id || value.name || ''); }
    if (!user?.id) return { all:true, userId:'', ownerProjects:[], approverIds:[], routing };
    return {
      all:isSingleUser(user) || isAdmin(user),userId:user.id,ownerProjects:user.projectOwnerIds || [],
      approverIds:[user.id,...(user.groups || []),...(user.roles || [])],routing,
    };
  }
  // ADR 0021, SPEC-overview-01 FR-6: "Your work" without loading every ticket. The reader's own tickets come first and, when there
  // are any, pipelines cannot appear, so the pipeline monitor is not called. Otherwise the whole queue plus failing pipelines that
  // no visible open ticket covers, as the full overview lists them.
  async attentionWork(user:ServiceUser|undefined, { scope }:{scope:Scope}) {
    assertScope(scope);
    const access = this.ticketAccess(user); const single = isSingleUser(user);
    if (!single) {
      const mine = await this.store.attentionTickets(scope, access, { mineKeys: identityKeys(user), limit: ATTENTION_LIMIT });
      if (mine.length) return { items: mine.map(ticket => ticketAttentionItem(ticket as OpsTicket)), scope: 'mine' };
    }
    const [tickets, monitor] = await Promise.all([
      this.store.attentionTickets(scope, access, { mineKeys: null, limit: ATTENTION_LIMIT }),
      // A missing pipeline platform must not take the whole landing page down.
      this.monitor({ limit: 1000, runLimit: 5, range: 'All time', scope }).catch(() => ({ items: [] as MonitorPipeline[] })),
    ]);
    const failing = monitor.items.filter(isFailingPipeline);
    const covered = new Set(await this.store.visibleOpenPipelineIds(scope, access, failing.map(pipeline => String(pipeline.pipelineId))));
    const items = [...tickets.map(ticket => ticketAttentionItem(ticket as OpsTicket)), ...failing.filter(pipeline => !covered.has(String(pipeline.pipelineId))).map(pipeline => pipelineAttentionItem(pipelineFailure(pipeline)))]
      .sort(byAttention).slice(0, ATTENTION_LIMIT);
    return { items, scope: single && items.length ? 'mine' : 'team' };
  }
  // ADR 0021: the Overview ticket numbers, counted in the store over what this reader may see.
  async ticketOverview(user:ServiceUser|undefined, { scope, ...query }:OverviewTicketQuery & {scope:Scope}) {
    assertScope(scope);
    return this.store.ticketOverview(scope, this.ticketAccess(user), query);
  }
  async ticket(ticketId:string, user:ServiceUser, scope:Scope):Promise<OpsTicket & {approver:Actor;permissions:Record<string,boolean>}> {
    const t = await this.#load(ticketId, scope); assertCanAccess(t, user);
    return { ...(await this.#hideRelated(decorateTicket(t), user, scope)), approver: t.approver || approverFor(t), permissions: { canView: permissionFor(t, user, 'view'), canComment: permissionFor(t, user, 'comment'), canAssign: permissionFor(t, user, 'assign'), canApprove: permissionFor(t, user, 'approve'), canClose: permissionFor(t, user, 'close'), canExecuteAction: permissionFor(t, user, 'executeAction') } };
  }
  async updateTicket(ticketId:string, patch:TicketPatchInput = {} as TicketPatchInput, user:ServiceUser, scope:Scope) {
    const t = await this.#load(ticketId, scope); assertCanAccess(t, user);
    const safe:Record<string,unknown> = {};
    const assignee = patch.assignee !== undefined ? validMember(patch.assignee) : undefined;
    // Anyone who can see an unowned ticket may claim it; handing it to someone else still needs the owner.
    const claiming = assignee !== undefined && !memberId(t.assignee) && sameIdentity(assignee, user);
    const assignmentChange = (assignee !== undefined && !claiming) || patch.collaborators !== undefined;
    const terminalChange = patch.status !== undefined && ['closed', 'resolved', 'cancelled'].includes(patch.status);
    if (assignmentChange) assertPermission(t, user, 'assign');
    // FR-20: the creator, the assignee, a project admin or a global admin may switch a ticket between project and private.
    if (patch.visibility !== undefined) {
      if (!['project', 'private'].includes(patch.visibility)) throw httpError(400, 'visibility must be project or private.');
      if (!(isSingleUser(user) || isAdmin(user) || sameIdentity(t.creator, user) || sameIdentity(t.assignee, user) || isProjectAdminOf(t, user))) throw httpError(403, 'You do not have permission to change who can see this ticket');
      safe.visibility = patch.visibility;
    }
    if (terminalChange) assertPermission(t, user, 'close');
    const editableKeys = ['priority', 'category', 'type', 'title', 'description', 'sourceRef', 'context', 'metadata', 'resolutionSummary', 'waitingReason'];
    if (editableKeys.some(key => patch[key] !== undefined) || patch.status !== undefined && !terminalChange) assertPermission(t, user, 'assign');
    for (const key of editableKeys) if (patch[key] !== undefined) safe[key] = patch[key];
    if (patch.priority !== undefined) safe.priority = normalizePriority(patch.priority);
    if (patch.resolutionSummary !== undefined) safe.resolutionSummary = patch.resolutionSummary === null ? null : String(patch.resolutionSummary).trim();
    if (patch.status !== undefined) { if (!TICKET_STATUSES.has(patch.status)) throw httpError(400, 'Invalid ticket status'); safe.status = patch.status; }
    if (assignee !== undefined) safe.assignee = assignee;
    if (patch.collaborators !== undefined) { if (!Array.isArray(patch.collaborators)) throw httpError(400, 'collaborators must be an array'); safe.collaborators = patch.collaborators; }
    if (safe.title !== undefined || safe.description !== undefined) safe.signature = failureSignature({ ...t, ...safe }) || null;
    if (['closed', 'resolved', 'cancelled'].includes(safe.status as string)) safe.closedAt = now();
    if (['open', 'in_progress', 'waiting'].includes(safe.status as string)) safe.closedAt = null;
    // Imported tickets belong to their source: the change goes there first, and only a successful
    // write changes NerveCenter's copy (the next import would undo anything else).
    const sourceWrite = await this.#writeToSource(t, { status: safe.status !== t.status ? safe.status as string : undefined, resolution: safe.resolutionSummary as string|null|undefined, assignee: assignee !== undefined && memberId(assignee) !== memberId(t.assignee) ? assignee : undefined, priority: safe.priority !== undefined && safe.priority !== t.priority ? safe.priority as string : undefined, title: safe.title !== undefined && safe.title !== t.title ? safe.title as string : undefined, description: safe.description !== undefined && safe.description !== t.description ? safe.description as string : undefined }, user);
    const updated = await this.store.updateTicket(ticketId, safe);
    const recorded = await this._recordTicketChanges(t, updated, user, sourceWrite);
    await this.publishTicketChange(ticketId);
    return { ...decorateTicket(recorded), ...(sourceWrite ? { sourceWrite } : {}) };
  }

  /** Write a change to the ticket's source system. Returns what was written, or null for NerveCenter-only tickets. */
  async #writeToSource(ticket:OpsTicket, change:TicketWriteChange, user:ServiceUser):Promise<null|{system:string;name?:string;number?:string;written:string[]}> {
    const system = ticket.externalReference?.system || ticket.source;
    if ((system !== 'servicenow' && system !== 'jira') || !ticket.externalReference) return null;
    const externalSystem:ExternalSystem=system;
    const wants = Object.entries(change).filter(([, value]) => value !== undefined);
    if (!wants.length) return null;
    const signature = sourceSignature(user);
    const written:string[] = [];
    try {
      const scope = systemScope(ticket.projectId);
      if (system === 'servicenow') {
        const serviceNow = await this.#client('serviceNow', scope, ticket.connectionId);
        if (!serviceNow) throw new Error('ServiceNow is not connected');
        const fields:Record<string,unknown> = {};
        if (change.comment !== undefined) { fields.work_notes = `${change.comment}\n\n(${signature})`; written.push('work note'); }
        if (change.status !== undefined) { fields.state = SN_STATE[change.status] || change.status; written.push(`state ${fields.state}`); if (['resolved', 'closed'].includes(change.status)) { fields.close_code = 'Solved (Permanently)'; fields.close_notes = change.resolution || `Resolved by ${signature}`; } }
        if (change.assignee !== undefined) { const assignee = change.assignee as Exclude<Actor,string|null>; fields.assigned_to = change.assignee ? (assignee.email || assignee.name || assignee.id) : ''; written.push(change.assignee ? `assigned to ${assignee.name || assignee.id}` : 'unassigned'); }
        if (change.priority !== undefined) { fields.priority = SN_PRIORITY[change.priority]; written.push(`priority ${fields.priority}`); }
        if (change.title !== undefined) { fields.short_description = change.title; written.push('title'); }
        if (change.description !== undefined) { fields.description = change.description; written.push('description'); }
        await serviceNow.updateIncident({ sysId: ticket.externalReference.sysId, fields });
      } else {
        const jira = await this.#client('jira', scope, ticket.connectionId);
        if (!jira) throw new Error('Jira is not connected');
        const key = ticket.externalReference.number;
        if (change.comment !== undefined) { await jira.addComment(key, `${change.comment}\n\n${signature}`); written.push('comment'); }
        if (change.assignee !== undefined) { await jira.assign(key, change.assignee); const assignee = change.assignee as Exclude<Actor,string|null>; written.push(change.assignee ? `assigned to ${assignee.name || assignee.id}` : 'unassigned'); }
        if (change.title !== undefined || change.description !== undefined || change.priority !== undefined) { await jira.updateFields(key, { title: change.title, description: change.description, priority: change.priority }); written.push('fields'); }
        if (change.status !== undefined) { const to = await jira.transitionTo(key, JIRA_CATEGORY[change.status] || 'indeterminate', change.status); written.push(`moved to ${to}`); if (change.resolution && change.comment === undefined) await jira.addComment(key, `Resolution: ${change.resolution}\n\n${signature}`); }
      }
    } catch (error) {
      throw httpError(502, `Not saved. ${SOURCE_NAME[externalSystem]} did not accept the change: ${(error as Error).message}`);
    }
    return { system, name: SOURCE_NAME[system], number: ticket.externalReference.number, written };
  }
  async _recordTicketChanges(before:OpsTicket, after:OpsTicket, user:ServiceUser, sourceWrite:null|{system:string;name?:string;number?:string;written:string[]}=null):Promise<OpsTicket> {
    const actor = actorName(user) || 'someone'; const events = [];
    if (memberId(before.assignee) !== memberId(after.assignee)) events.push(activityEvent({ type: 'ticket.assigned', title: after.assignee ? `Assigned to ${actorName(after.assignee)}` : 'Unassigned', detail: sameIdentity(after.assignee, user) ? `${actor} took this ticket` : `by ${actor}`, actor: user }));
    if (before.status !== after.status) events.push(activityEvent({ type: 'ticket.status', title: `Status changed to ${String(after.status).replace(/_/g, ' ')}`, detail: after.status === 'waiting' && after.waitingReason ? `${after.waitingReason} · by ${actor}` : after.status === 'resolved' && after.resolutionSummary ? `${after.resolutionSummary} · by ${actor}` : `by ${actor}`, actor: user }));
    if (before.priority !== after.priority) events.push(activityEvent({ type: 'ticket.priority', title: `Priority set to ${PRIORITY_LABEL[ticketPriority(after)] || after.priority}`, detail: `by ${actor}`, actor: user }));
    if (!events.length) return after;
    if (sourceWrite) for (const event of events) event.detail = `${event.detail} · saved in ${sourceWrite.name} ${sourceWrite.number}`;
    for (const event of events) this.onTicketChange?.(after.ticketId, { title: event.title, detail: event.detail });
    return this.store.appendActivity(after.ticketId, events);
  }
  // A comment on the ticket timeline, written to the source as a ServiceNow work note or Jira comment.
  // The agent working the ticket sees it on its next turn. It never starts an agent turn by itself.
  async commentTicket(ticketId:string, user:ServiceUser, { body, scope }: {body:string;scope:Scope} = {} as {body:string;scope:Scope}) {
    const ticket = await this.#load(ticketId, scope); assertPermission(ticket, user, 'comment');
    const text = String(body || '').trim(); if (!text) throw httpError(400, 'body is required'); if (text.length > 10_000) throw httpError(400, 'body must be 10,000 characters or fewer');
    const sourceWrite = await this.#writeToSource(ticket, { comment: text }, user);
    const event = { ...activityEvent({ type: 'ticket.comment', title: `${actorName(user) || 'Someone'} commented`, detail: text, actor: user }), ...(sourceWrite ? { source: `Saved as a ${sourceWrite.system === 'servicenow' ? 'work note' : 'comment'} in ${sourceWrite.name} ${sourceWrite.number}` } : {}) };
    await this.store.appendActivity(ticketId, [event]);
    this.onTicketChange?.(ticketId, { title: event.title, detail: text });
    await this.publishTicketChange(ticketId);
    return { ticketId, event, sourceWrite };
  }
  /**
   * A NerveCenter ticket was filed in ServiceNow or Jira (by the agent or a person): point it at the
   * source record, so the next import updates this ticket instead of creating a second one.
   */
  async linkTicketToSource(ticketId:string, { system, sysId, number, url }: {system:string;sysId?:string;number?:string;url?:string} = {} as {system:string;sysId?:string;number?:string;url?:string}, user:ServiceUser, scope:Scope) {
    const ticket = await this.#load(ticketId, scope); assertCanAccess(ticket, user);
    if (!['servicenow', 'jira'].includes(system)) throw new Error('system must be servicenow or jira');
    if (!String(sysId || '').trim() || !String(number || '').trim()) throw new Error('sysId and number are required');
    if (ticket.externalReference?.system) throw new Error(`This ticket is already linked to ${ticket.externalReference.number}`);
    const clash = await this.store.findTicketBySourceKey?.(`${system}:${sysId}`); if (clash && clash.ticketId !== ticketId) throw new Error(`${number} is already tracked as ${clash.ticketId}`);
    const updated = await this.store.updateTicket(ticketId, { source: system, platform: system, sourceKey: `${system}:${sysId}`, externalReference: { system, sysId: String(sysId), number: String(number), ...(url ? { url: String(url) } : {}) } });
    await this.store.appendActivity(ticketId, [activityEvent({ type: 'ticket.synced', title: `Filed in ${SOURCE_NAME[system]} as ${number}`, detail: 'Changes are saved there from now on.', actor: user })]);
    await this.publishTicketChange(ticketId);
    return decorateTicket(updated);
  }

  /**
   * Open a ticket in ServiceNow or Jira for the scope's project and track it here (SPEC-tickets-07 FR-1..FR-4). The platform has
   * no idempotency key, so `correlationKey` goes in ServiceNow's correlation_id or a Jira label and is looked up first: a retry
   * after a crash links the incident opened the first time instead of opening a second one.
   */
  async createSourceTicket({ scope, system, title, description, priority = 'medium', assignmentGroup, projectKey, issueType, correlationKey, extra = {} }: {scope:Scope;system:ExternalSystem;title:string;description?:string;priority?:string;assignmentGroup?:string;projectKey?:string;issueType?:string;correlationKey:string;extra?:Record<string,unknown>}) {
    const projectId = writeProjectId(scope);
    if (!['servicenow', 'jira'].includes(system)) throw new Error('system must be servicenow or jira');
    const client = system === 'servicenow' ? await this.#dep('serviceNow', scope) as ServiceNowApi : await this.#dep('jira', scope) as JiraApi;
    if (!client) throw new Error(`${SOURCE_NAME[system]} is not connected`);
    const key = String(correlationKey || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80); if (!key) throw new Error('correlationKey is required');
    const level = normalizePriority(priority);
    let incident:ImportedIncident|null = system === 'servicenow' ? await (client as ServiceNowApi).findByCorrelation?.(key) || null : await (client as JiraApi).findByLabel?.(`nc-${key}`) || null;
    if (!incident) incident = system === 'servicenow' ? await (client as ServiceNowApi).createIncident?.({ title, description, priority: SN_PRIORITY[level], assignmentGroup: assignmentGroup || undefined, correlationId: key }) || null : await (client as JiraApi).createIssue?.({ projectKey: projectKey || undefined, issueType: issueType || 'Task', title, description, priority: JIRA_PRIORITY[level], label: `nc-${key}` }) || null;
    if (!incident?.sourceKey || !incident.externalReference?.number) throw new Error(`${SOURCE_NAME[system]} did not return a trackable ticket`);
    const connectionId = await this.#connectionIdFor(system, scope);
    const existing = await this.store.findTicketBySourceKey?.(incident.sourceKey, connectionId); if (existing) return existing;
    const at = now();
    const ticket:OpsTicket = { ...incident, ...extra, title: incident.title || incident.externalReference.number, status: incident.status || 'open', ticketId: await this.store.nextTicketId(), projectId, connectionId, visibility: 'project', priority: level, workflowIds: [], resolutionSummary: null, collaborators: [], closedAt: null, taskId: null, creator: AUTOMATION_ACTOR, requester: null, assignee: incident.assignee || null, createdAt: incident.createdAt || at, updatedAt: at, activity: [activityEvent({ type: 'ticket.created', title: `Opened in ${SOURCE_NAME[system]} as ${incident.externalReference.number}`, detail: 'Opened automatically by NerveCenter' })] };
    return this.#storeNew(ticket, true);
  }
  /**
   * A note NerveCenter itself writes on a ticket (an automation's progress, SPEC-tickets-07 FR-5): on the timeline, and as a work
   * note or comment in the source. Not a person's action, so no permission check; never exposed as a route. A source that refuses
   * leaves the note on the timeline marked as not saved there.
   */
  async systemNote(ticketId:string, text:string) {
    const ticket = await this.store.getTicket(ticketId); if (!ticket) throw httpError(404, 'Ticket not found');
    const body = String(text || '').trim().slice(0, 10_000); if (!body) return null;
    let sourceWrite = null; let failure = null;
    try { sourceWrite = await this.#writeToSource(ticket, { comment: body }, AUTOMATION_SIGNER); } catch (error) { failure = (error as Error).message; }
    const event = { ...activityEvent({ type: 'ticket.comment', status: failure ? 'failed' : 'completed', title: `${AGENT_NAME} noted`, detail: body }), actor: { id: AUTOMATION_ACTOR.id, name: AGENT_NAME }, ...(sourceWrite ? { source: `Saved as a ${sourceWrite.system === 'servicenow' ? 'work note' : 'comment'} in ${sourceWrite.name} ${sourceWrite.number}` } : {}), ...(failure ? { source: failure } : {}) };
    await this.store.appendActivity(ticketId, [event]);
    await this.publishTicketChange(ticketId);
    return { event, sourceWrite, error: failure };
  }
  /** Resolve a ticket because what it tracked recovered (SPEC-tickets-07 FR-6). The source first, then here, like a person's change. */
  async systemResolve(ticketId:string, resolution:string) {
    const ticket = await this.store.getTicket(ticketId); if (!ticket || isClosed(ticket)) return null;
    let sourceWrite = null;
    try { sourceWrite = await this.#writeToSource(ticket, { status: 'resolved', resolution }, AUTOMATION_SIGNER); }
    catch (error) { await this.store.appendActivity(ticketId, [{ ...activityEvent({ type: 'ticket.synced', status: 'failed', title: 'Not resolved automatically', detail: (error as Error).message }) }]); return null; }
    const updated = await this.store.updateTicket(ticketId, { status: 'resolved', resolutionSummary: resolution, closedAt: now() });
    const recorded = await this._recordTicketChanges(ticket, updated, AUTOMATION_SIGNER, sourceWrite);
    await this.publishTicketChange(ticketId);
    return recorded;
  }

  async ticketActivity(ticketId:string, user:ServiceUser, scope:Scope) {
    const ticket = await this.#load(ticketId, scope); assertPermission(ticket, user, 'view');
    const events = await this.store.listActivity([ticketId], { limit: TICKET_ACTIVITY_LIMIT });
    const hidden = await this.#hiddenRelated({ ...ticket, activity: events }, user, scope);
    const items = events.map(event => hiddenEvent(event, hidden)).sort((left, right) => String(right.at || '').localeCompare(String(left.at || '')));
    return { ticketId, items };
  }
  async ticketSummary(ticketId:string, scope:Scope) { if (!ticketId) return null; const ticket = await this.store.getTicket(ticketId).catch(() => null); if (ticket) assertRowInScope(scope, ticket); return ticket ? { ticketId: ticket.ticketId, title: ticket.title || ticket.failureSummary || null, priority: ticket.priority || null, status: ticket.status || null } : null; }
}
