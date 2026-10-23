import { overviewQuery, overviewTickets, overviewPipelines, overviewWork, overviewAgent, overviewDataQuality } from '../app/overview-summary.mjs';
import http from 'node:http';
import { createRequire } from 'node:module';
import express from 'express';
import { config } from '../config.mjs';
import { readBody, sendJson, sendError } from '../lib/http.mjs';
import { requestUser } from '../app/identity.mjs';
import { ANY_USER, adminRouteKind, adminRoutePermission, assertAdmin, assertPermission, authorizeRoute, permissionsFor, projectUser, summarize as summarizeRbac } from '../app/rbac.mjs';
import { ROLE_DEFINITIONS } from '../app/rbac-store.mjs';
import { providerTemplates } from '../connections/connection-service.mjs';
import { taskRoutes } from './task-routes.mjs';
import { routineRoutes } from './routine-routes.mjs';
import { connectorRoutes } from './connector-routes.mjs';
import { libraryRoutes } from './library-routes.mjs';
import { boardRoutes } from './board-routes.mjs';
import { monitoringRoutes } from './monitoring-routes.mjs';
import { changeRoutes } from './change-routes.mjs';
import { assertRouteTable, dispatch, reply, route, scoped } from '../lib/router.mjs';
import { PROJECT_HEADER, SCOPE_CLASSES, assertVisitorMayRead, resolveScope, systemScope } from '../projects/project-access.mjs';
import { UNROUTED_ID } from '../projects/project-store.mjs';
import { projectRoutes } from '../projects/project-routes.mjs';
import { forProject } from '../projects/project-bound.mjs';
import { serveStatic } from '../lib/static.mjs';
import { stripBasePath } from '../lib/base-path.mjs';
import { httpError, actorOf, now } from '../lib/util.mjs';
import { errorText } from '../lib/errors.mjs';
import { decodeNotificationPosition } from '../app/notification-page.mjs';

const require = createRequire(import.meta.url);

function ticketPageQuery(params) {
  const integer = (name, fallback, max) => {
    const raw = params.get(name);
    if (raw === null) return fallback;
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < (name === 'limit' ? 1 : 0) || (max && value > max)) throw httpError(400, `${name} must be a valid ticket page number.`);
    return value;
  };
  const csv = name => {
    const raw = params.get(name);
    return raw && raw !== 'all' ? [...new Set(raw.split(',').map(value => value.trim().toLowerCase()).filter(Boolean))] : undefined;
  };
  const date = name => {
    const raw = params.get(name);
    if (!raw) return null;
    if (Number.isNaN(Date.parse(raw))) throw httpError(400, `${name} must be a valid date.`);
    return new Date(raw).toISOString();
  };
  const legacyStatus = params.get('status');
  const scope = params.get('scope') || (['active','closed','all'].includes(legacyStatus) ? legacyStatus : 'active');
  if (!['active','closed','all'].includes(scope)) throw httpError(400, 'Unknown ticket scope.');
  const sort = params.get('sort') || 'priority';
  if (!['priority','title','source','assignee','status','updated'].includes(sort)) throw httpError(400, 'Unknown ticket sort.');
  const dir = params.get('dir') || 'asc';
  if (!['asc','desc'].includes(dir)) throw httpError(400, 'Unknown ticket sort direction.');
  return { limit:integer('limit',10,100),offset:integer('offset',0),scope,from:date('from'),to:date('to'),q:(params.get('q')||'').trim(),
    priority:csv('priority'),status:csv('appStatus') || (!['active','closed','all'].includes(legacyStatus) ? csv('status') : undefined),assignee:csv('assignee'),source:csv('source'),kind:csv('kind'),category:csv('category'),
    resolved:['sonic','dobby'].includes(params.get('resolved')),sort,dir };
}
function packagePresent(name) { try { require.resolve(name); return true; } catch { return false; } }
function segments(url) { return url.pathname.split('/').filter(Boolean); }
const num = (value, fallback) => { const n = Number(value); return Number.isFinite(n) && n > 0 ? n : fallback; };

function notificationQuery(params) {
  const mode = params.get('mode');
  if (!mode) return { since: params.get('since') || null, limit: num(params.get('limit'), 50) };
  if (!['summary', 'updates', 'page'].includes(mode)) throw httpError(400, 'Unknown notification mode.');
  const view = params.get('view') || 'all';
  if (!['all', 'agent', 'operations'].includes(view)) throw httpError(400, 'Unknown notification view.');
  const rawLimit = params.get('limit');
  const limit = rawLimit === null ? 50 : Number(rawLimit);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw httpError(400, 'Notification limit must be from 1 to 200.');
  const rawSeenAt = params.get('seenAt');
  if (rawSeenAt && Number.isNaN(Date.parse(rawSeenAt))) throw httpError(400, 'seenAt must be a valid date.');
  return { mode, view, limit, seenAt: rawSeenAt ? new Date(rawSeenAt).toISOString() : null,
    after: decodeNotificationPosition(params.get('after')), cursor: decodeNotificationPosition(params.get('cursor')) };
}

function deploymentHealth({ databricks } = {}) {
  const databricksStatus = databricks || { configured: false, ready: false, verified: null, source: null };
  return {
    statusCode: 200,
    body: { ok: true, environment: config.environment, metadataStore: config.metadataStore, secretStore: config.secretStore, anthropicKeyPresent: config.anthropicApiKeyPresent, databricks: { ...databricksStatus, configurationRequired: !databricksStatus.ready }, claudeAgentSdkInstalled: packagePresent('@anthropic-ai/claude-agent-sdk') },
  };
}

// The whole route table, every route with its scope class (FR-11). Exported so a test can walk it.
export function buildRoutes({ grants, connectionService, dataPlatform, dataQualityService, operationsService, rbacStore, secretStore, workspace, taskStore, runtime, ticketTasks, presence, routines, connectors, skills, templates, knowledge, boards, projectStore, projectApiKeys = null, monitoring = null, monitorStore = null, alerts = null, changeFeed = null }) {
  // The project-bound integrations: the registry's instance for the request's project (the All view gets its empty stand-in).
  const dq = scope => forProject(dataQualityService, scope);
  const dp = scope => forProject(dataPlatform, scope);
  return [
    ...changeRoutes({ changeFeed }),
    ...scoped('global', [
    route('GET', '/api/me', ({ user }) => ({ user: { id: user.id, name: user.name, ...(user.email ? { email: user.email } : {}), groups: user.groups, roles: user.roles }, ...summarizeRbac(user) })),
    route('POST', '/api/presence', () => presence?.status() || { active: true }, '*'),
    ]),
    // Who the caller is in the request's project (SPEC-projects-03 FR-6): what the UI shows and enables there.
    ...scoped('project', [
    route('GET', '/api/me/access', ({ user, scope }) => ({ projectId: scope.all ? null : scope.projectId, access: scope.access || null, appRole: user.appRole || user.role, projectRole: user.projectRole || (scope.all ? 'admin' : null), role: user.role, permissions: user.permissions || permissionsFor(user.role) })),
    ]),
    ...projectRoutes({ projectStore, grants, workspaces: workspace, users: rbacStore, apiKeys: projectApiKeys, unroutedCount: async () => (await operationsService.store.listTickets(systemScope(UNROUTED_ID))).length }),

    /* ---------------------------------------------------------- users and roles */
    ...scoped('global', rbacStore ? [
      route('GET', '/api/admin/rbac/roles', () => ({ items: ROLE_DEFINITIONS })),
      // The admin console's People tab: each person with the projects they are in and their role there (SPEC-projects-03 FR-20).
      route('GET', '/api/admin/rbac/users', async () => ({ items: await Promise.all(rbacStore.list().map(async item => ({ ...item, projects: projectStore ? await projectStore.membershipsOf(item.id) : [] }))) })),
      route('POST', '/api/admin/rbac/users', async ({ body, user }) => reply(201, await rbacStore.upsert(await body(), user)), 'admin'),
      route('GET', '/api/admin/rbac/users/$id', ({ params: { id } }) => rbacStore.get(id) || reply(404, { error: 'User not found' })),
      route('PATCH|PUT', '/api/admin/rbac/users/$id', async ({ params: { id }, body, user }) => rbacStore.upsert({ ...await body(), id }, user), 'admin'),
      route('DELETE', '/api/admin/rbac/users/$id', async ({ params: { id }, user }) => { if (id === user.id) throw httpError(400, 'You cannot remove your own account'); return { id, deleted: await rbacStore.remove(id, user) }; }, 'admin'),
      route('POST', '/api/admin/rbac/users/$id/role', async ({ params: { id }, body, user }) => { const b = await body(); if (id === user.id && b.role && b.role !== 'admin') throw httpError(400, 'You cannot demote your own admin role'); return rbacStore.setRole(id, b.role, user); }, 'admin'),
      route('POST', '/api/admin/rbac/users/$id/block', async ({ params: { id }, body, user }) => { if (id === user.id) throw httpError(400, 'You cannot block your own account'); return rbacStore.setBlocked(id, true, user, (await body()).reason); }, 'admin'),
      route('POST', '/api/admin/rbac/users/$id/unblock', ({ params: { id }, user }) => rbacStore.setBlocked(id, false, user), 'admin'),
    ] : []),

    /* --------------------------------------------------- overview and pipelines */
    ...scoped('project', [
    route('GET', '/api/overview/tickets', ({ url, user, scope }) => overviewTickets(operationsService, user, scope, overviewQuery(url.searchParams))),
    route('GET', '/api/overview/pipelines', ({ url, scope }) => overviewPipelines(operationsService, scope, overviewQuery(url.searchParams))),
    route('GET', '/api/overview/work', ({ user, scope }) => overviewWork(operationsService, user, scope)),
    route('GET', '/api/overview/agent', ({ url, scope }) => { assertVisitorMayRead(scope, '/api/tasks'); return overviewAgent(taskStore, scope, overviewQuery(url.searchParams)); }),
    route('GET', '/api/overview/data-quality', async ({ url, scope }) => overviewDataQuality(dataQualityService ? await dq(scope) : null, overviewQuery(url.searchParams))),
    route('GET', '/api/overview', ({ url: { searchParams: q }, user, scope }) => operationsService.overview(user, { from: q.get('from') || null, to: q.get('to') || null, scope })),
    route('GET', '/api/notifications', ({ url: { searchParams: q }, user, scope }) => operationsService.notifications(user, { ...notificationQuery(q), scope })),
    route('GET', '/api/monitor', ({ url: { searchParams: q }, scope }) => {
      const rawLimit = q.get('limit'); const parsedLimit = rawLimit === null ? 10 : Number(rawLimit);
      const rawOffset = q.get('offset'); const parsedOffset = rawOffset === null ? 0 : Number(rawOffset);
      if (!Number.isSafeInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 100) throw httpError(400, 'Monitor limit must be from 1 to 100.');
      if (!Number.isSafeInteger(parsedOffset) || parsedOffset < 0) throw httpError(400, 'Monitor offset must be a nonnegative integer.');
      const sort = q.get('sort') || 'status'; const dir = q.get('dir') || 'asc';
      const pipelineId = q.get('pipelineId') || undefined;
      if (pipelineId && pipelineId.length > 256) throw httpError(400, 'Monitor pipelineId must be 256 characters or fewer.');
      if (!['status', 'name', 'lastRun', 'nextRun'].includes(sort)) throw httpError(400, 'Monitor sort must be status, name, lastRun or nextRun.');
      if (!['asc', 'desc'].includes(dir)) throw httpError(400, 'Monitor dir must be asc or desc.');
      return operationsService.monitor({ scope, limit: 5000, pageLimit: parsedLimit, offset: parsedOffset, runLimit: num(q.get('runLimit'), 10), range: q.get('range') || 'All time', from: q.get('from') || undefined, to: q.get('to') || undefined, status: q.get('status') || undefined, platform: q.get('platform') || undefined, q: q.get('q') || undefined, pipelineId, includeIdle: q.get('showIdle') === '1', sort, dir });
    }),
    ]),
    ...scoped('project-read', [
    route('POST', '/api/monitor/reconcile', async ({ body, scope }) => { const b = await body(); return operationsService.reconcileMonitor({ scope, limit: num(b.limit, 1000), runLimit: num(b.runLimit, 10), range: b.range || 'All time', from: b.from || undefined, to: b.to || undefined }); }, '*'),
    ]),
    ...scoped('project', [
    route('GET', '/api/pipelines', async ({ url: { searchParams: q }, scope }) => ({ items: await operationsService.pipelines({ limit: num(q.get('limit'), 1000), provider: q.get('provider') || undefined, scope }) })),
    route('GET', '/api/pipelines/:id', ({ params: { id }, url: { searchParams: q }, scope }) => operationsService.pipeline(id, { provider: q.get('provider') || undefined, scope })),
    // One page of the run history from the ledger, with missed and late slots (SPEC-pipelines-01 FR-15, FR-16).
    route('GET', '/api/pipelines/:id/runs', async ({ params: { id }, url: { searchParams: q }, scope }) => operationsService.pipelineRunHistory(id, { limit: num(q.get('limit'), 20), offset: Math.max(0, Number(q.get('offset')) || 0), provider: q.get('provider') || undefined, scope })),
    ]),

    /* -------------------------------------------------------------- data quality */
    // Every provider-backed read resolves its client with the request's project (FR-33): a project with no grant gets the "not configured" state.
    ...scoped('project', dataQualityService ? [
      route('GET', '/api/data-quality/providers', async ({ scope }) => ({ items: await (await dq(scope)).providers() })),
      route('GET', '/api/data-quality/config', async ({ scope }) => { const service = await dq(scope); return { configuration: await service.getConfig(), tables: await service.listTables() }; }),
      // A project's data-quality setup is its owner's (SPEC-projects-03 FR-6); `project.settings` is checked through the route gate.
      // The mapping agent bills to the project's own key and has none to fall back on (SPEC-projects-04 FR-7).
      route('POST', '/api/data-quality/analyze', async ({ body, scope }) => {
        const input = await body();
        if (typeof input?.ddl !== 'string' || !input.ddl.trim()) throw httpError(400, 'Paste the result table DDL before analyzing.');
        return (await dq(scope)).analyzeConfig(input, projectApiKeys ? { apiKey: await projectApiKeys.key(scope.projectId) } : {});
      }, 'project.settings'),
      route('PUT|POST', '/api/data-quality/config', async ({ body, scope }) => (await dq(scope)).saveConfig(await body()), 'project.settings'),
      route('DELETE', '/api/data-quality/config/:id', async ({ params: { id }, scope }) => (await dq(scope)).deleteConfig(id), 'project.settings'),
      route('GET', '/api/data-quality/monitor', async ({ url: { searchParams: q }, scope }) => (await dq(scope)).monitor({ scope, range: q.get('range') || 'Last 24 hours', limit: num(q.get('limit'), 100), offset: Math.max(0, Number(q.get('offset')) || 0), status: q.get('status') || undefined, severity: q.get('severity') || undefined, tableId: q.get('table') || undefined, q: q.get('q') || undefined, from: q.get('from') || undefined, to: q.get('to') || undefined })),
    ] : []),
    ...scoped('project-read', dataQualityService ? [
      route('POST', '/api/data-quality/monitor/reconcile', async ({ body, scope }) => { const b = await body(); return (await dq(scope)).reconcile({ scope, range: b.range || 'Last 24 hours', limit: num(b.limit, 100), offset: Math.max(0, Number(b.offset) || 0), status: b.status || undefined, severity: b.severity || undefined, tableId: b.table || undefined, q: b.q || undefined, from: b.from || undefined, to: b.to || undefined }); }, '*'),
    ] : []),

    /* -------------------------------------------------------------------- tickets */
    // `assignee: null` means nobody; only an absent field defaults to the creator. The project is the request's, never the body's (FR-15).
    ...scoped('project', [
    route('POST', '/api/tickets', async ({ body, user, scope }) => { const { startTriage, projectId: _p, project_id: _q, scope: _s, ...b } = await body(); const assignee = Object.prototype.hasOwnProperty.call(b, 'assignee') ? b.assignee : user; return reply(201, await operationsService.createTicket({ ...b, creator: user, assignee, scope })); }, 'tickets.manage'),
    route('GET', '/api/integrations/servicenow/status', ({ url, scope }) => operationsService.serviceNowStatus({ verify: url.searchParams.get('verify') === '1', scope })),
    route('POST', '/api/integrations/servicenow/sync', async ({ body, scope }) => operationsService.syncServiceNow({ ...await body(), scope }), 'admin'),
    route('GET', '/api/integrations/jira/status', ({ url, scope }) => operationsService.jiraStatus({ verify: url.searchParams.get('verify') === '1', scope })),
    route('POST', '/api/integrations/jira/sync', async ({ body, scope }) => operationsService.syncJira({ ...await body(), scope }), 'admin'),
    route('GET', '/api/tickets/dashboard', ({ user, scope }) => operationsService.ticketDashboard(user, { scope })),
    route('GET', '/api/tickets', async ({ url, user, scope }) => operationsService.listTicketPage({ user, scope, query: ticketPageQuery(url.searchParams) })),
    route('GET', '/api/tickets/:id', ({ params: { id }, user, scope }) => operationsService.ticket(id, user, scope)),
    route('PATCH|PUT', '/api/tickets/:id', async ({ params: { id }, body, user, scope }) => operationsService.updateTicket(id, await body(), user, scope), 'tickets.manage'),
    route('POST', '/api/tickets/:id/comments', async ({ params: { id }, body, user, scope }) => reply(201, await operationsService.commentTicket(id, user, { ...await body(), scope })), 'tickets.manage'),
    route('GET', '/api/tickets/:id/activity', ({ params: { id }, user, scope }) => operationsService.ticketActivity(id, user, scope)),
    ...(ticketTasks ? [
      // Start (or continue) the agent task for a ticket. A person's request follows the workspace policy unless they pick otherwise.
      route('POST', '/api/tickets/:id/investigate', async ({ params: { id }, body, user, scope }) => { await operationsService.authorizeTicket(id, user, 'view', scope); const b = await body(); const result = await ticketTasks.ensureTask(id, { user, permission: ['read-only', 'policy', 'ask', 'allow'].includes(b.permission) ? b.permission : 'policy', ...(b.prompt ? { prompt: String(b.prompt) } : {}) }); return reply(result.created ? 201 : 200, result); }, 'tasks.manage'),
      route('POST', '/api/tickets/poll', () => ticketTasks.poll({ force: true }), 'admin'),
    ] : []),
    ]),
    // Previews only read; they arrive as POSTs.
    ...scoped('project-read', [
    route('POST', '/api/integrations/servicenow/preview', async ({ body, scope }) => operationsService.previewServiceNow({ ...await body(), scope }), 'connectors.use'),
    route('POST', '/api/integrations/jira/preview', async ({ body, scope }) => operationsService.previewJira({ ...await body(), scope }), 'connectors.use'),
    ]),

    /* ---------------------------------------------------------- tasks and inbox */
    ...taskRoutes({ runtime, taskStore }),
    ...routineRoutes({ routines }),
    ...connectorRoutes({ connectors }),
    ...libraryRoutes({ skills, templates, knowledge, routines }),
    ...boardRoutes({ boards }),
    ...monitoringRoutes({ monitoring, monitorStore, alerts, workspace }),

    /* ------------------------------------------------------ settings (operations.yaml) */
    ...scoped('project', workspace ? [
      // The settings of the request's project: its own operations.yaml (FR-19).
      route('GET', '/api/settings', async ({ scope }) => { const ws = await forProject(workspace, scope); const operations = await ws.readOperations(); const validation = await ws.validate(); return { operations, validation, mcp: await ws.readMcp() }; }),
      // Automations act for the owner who saved them last (their project role caps what Sonic may do), so the save is stamped.
      route('PUT', '/api/settings/$section', async ({ params: { section }, req, user, scope }) => { const ws = await forProject(workspace, scope); let b = await readBody(req); if (section === 'automation' && b && typeof b === 'object' && !Array.isArray(b)) b = { ...b, updatedBy: actorOf(user), updatedAt: now() }; return { section, value: await ws.setSection(section, b === undefined ? null : b), validation: await ws.validate() }; }, 'project.settings'),
    ] : []),

    /* ---------------------------------------------------------------- connections */
    ...scoped('global', connectionService ? [
      route('GET', '/api/connection-templates', () => ({ items: providerTemplates() })),
    ] : []),
    // A project reads the profiles granted to it (with its grant); the admin All view reads the library. Adding a profile is an
    // admin action; until the Projects tab manages grants (phase 3) a profile added from a project is granted to that project
    // (TEMPORARY, SPEC-projects-01 Known gaps), unless the body says `library: true`.
    ...scoped('project', connectionService ? [
      route('GET', '/api/connection-provider-status', async ({ scope }) => ({ items: scope.all ? providerTemplates().map(template => ({ ...template, configured: false, ready: false, verified: false, source: null, reason: `Configure a ${template.name} connection` })) : await connectionService.providerStatuses(scope.projectId) })),
      route('GET', '/api/connections', async ({ scope }) => ({ items: await connectionService.list(scope.all ? undefined : scope.projectId) })),
      route('GET', '/api/connections/$id', async ({ params: { id }, scope }) => (await connectionService.get(id, scope.all ? undefined : scope.projectId)) || reply(404, { error: 'Connection not found' })),
      route('POST', '/api/connections', async ({ body, scope, user }) => {
        const { library, ...input } = await body(); const existed = input.id ? await connectionService.getRaw(input.id) : null;
        if (existed) await grants?.checkConnection(existed.id, String(input.provider || '').toLowerCase() || existed.provider);
        const saved = await connectionService.save(input, user);
        if (grants && !library && !existed) await grants.put(scope.projectId, { resourceType: 'connection', resourceId: saved.id, scope: {} }, user);
        return reply(201, saved);
      }, 'admin'),
      route('POST', '/api/connections/$id/set-default', ({ params: { id }, scope }) => connectionService.setDefault(id, scope.projectId), 'admin'),
    ] : []),
    ...scoped('admin-global', connectionService ? [
      route('PUT', '/api/connections/$id', async ({ params: { id }, body, user }) => { const input = await body(); const current = await connectionService.getRaw(id); if (current) await grants?.checkConnection(id, String(input.provider || '').toLowerCase() || current.provider); return connectionService.save({ ...input, id }, user); }, 'admin'),
      route('PATCH', '/api/connections/$id', async ({ params: { id }, body, user }) => connectionService.setProjectAdminsMayGrant(id, (await body()).projectAdminsMayGrant, user), 'admin'),
      route('DELETE', '/api/connections/$id', async ({ params: { id } }) => ({ id, deleted: await connectionService.delete(id) }), 'admin'),
      route('POST', '/api/connections/$id/test', ({ params: { id } }) => connectionService.test(id), 'connections.manage'),
    ] : []),

    // Data platform browsing: one shape for Snowflake and Databricks. `provider`
    // is optional; without it the catalog uses the first ready connection.
    ...scoped('project', dataPlatform ? [
      route('GET', '/api/data-platform/status', async ({ scope }) => (await dp(scope)).status()),
      route('GET', '/api/data-platform/pipelines', async ({ url: { searchParams: q }, scope }) => (await dp(scope)).listPipelines({ provider: q.get('provider') || undefined, limit: num(q.get('limit'), 200) })),
      route('GET', '/api/data-platform/pipelines/:id', async ({ params: { id }, url: { searchParams: q }, scope }) => (await dp(scope)).getPipeline({ provider: q.get('provider') || undefined, pipelineId: id })),
      route('GET', '/api/data-platform/pipelines/:id/runs', async ({ params: { id }, url: { searchParams: q }, scope }) => ({ items: await (await dp(scope)).listRuns({ provider: q.get('provider') || undefined, pipelineId: id, limit: num(q.get('limit'), 50) }) })),
      route('GET', '/api/data-platform/runs', async ({ url: { searchParams: q }, scope }) => ({ items: await (await dp(scope)).listRuns({ provider: q.get('provider') || undefined, limit: num(q.get('limit'), 50) }) })),
      route('GET', '/api/data-platform/tables', async ({ url: { searchParams: q }, scope }) => ({ items: await (await dp(scope)).listTables({ provider: q.get('provider') || undefined, schema: q.get('schema') || undefined, catalog: q.get('catalog') || undefined, search: q.get('search') || '', limit: num(q.get('limit'), 500) }) })),
      route('GET', '/api/data-platform/tables/:id', async ({ params: { id }, url: { searchParams: q }, scope }) => (await dp(scope)).getTable({ provider: q.get('provider') || undefined, objectId: id })),
      route('GET', '/api/data-platform/tables/:id/ddl', async ({ params: { id }, url: { searchParams: q }, scope }) => (await dp(scope)).getDdl({ provider: q.get('provider') || undefined, objectId: id })),
    ] : []),

    ...scoped('admin-global', secretStore ? [
      route('GET', '/api/secrets/:ref/status', ({ params: { ref } }) => secretStore.status(ref), 'secrets.manage'),
      route('POST|PUT', '/api/secrets/:ref', async ({ params: { ref }, req }) => { const b = await readBody(req); await secretStore.set(ref, b?.value); return reply(201, await secretStore.status(ref)); }, 'admin'),
      route('DELETE', '/api/secrets/:ref', async ({ params: { ref } }) => ({ ref, deleted: await secretStore.delete(ref), present: false }), 'admin'),
    ] : []),
  ];
}

export function createApiServer(deps) {
  const { connectionService, presence, projectStore } = deps;
  if (!projectStore) throw new Error('The API server needs the project store: every project route resolves its scope there');
  const routes = buildRoutes(deps);
  // FR-11: a route with no scope class is a bug, so the server does not start.
  assertRouteTable(routes, SCOPE_CLASSES);

  const app = express();
  // Keep the old response surface: this adapter owns parsing, routing, and headers.
  app.disable('x-powered-by');
  app.use(async (req, res) => {
    try {
      if (req.method === 'OPTIONS') return sendJson(res, 200, { ok: true });
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`); url.pathname = stripBasePath(url.pathname, config.publicBasePath); const p = segments(url); const m = req.method;

      if (m === 'GET' && url.pathname === '/health') { const databricks = await connectionService?.status?.('databricks'); const health = deploymentHealth({ databricks }); return sendJson(res, health.statusCode, health.body); }
      // The UI itself, when this process serves it (a Databricks App). The platform has already signed the user in.
      if (config.frontendDir && ['GET', 'HEAD'].includes(m) && p[0] !== 'api') return serveStatic(req, res, url, config.frontendDir);
      if (m === 'GET' && url.pathname === '/api/meta') return sendJson(res, 200, { environment: config.environment, identityMode: config.identityMode, storage: { metadata: config.metadataStore, secrets: config.secretStore }, application: { ticketPrefix: config.ticketPrefix, maxUploadBytes: config.maxUploadBytes }, adminContacts: config.adminContacts });

      const user = await requestUser(req);
      presence?.touch();
      // Checked on the normalised path, so `/api//secrets/x` or a trailing slash cannot slip past the admin patterns.
      const normalised = `/${p.join('/')}`;
      if (adminRouteKind(m, normalised) === 'global') assertAdmin(user);
      // A gated project route needs its permission inside the request's project, from the person's project role (SPEC-projects-03 FR-9).
      const gated = adminRoutePermission(m, normalised);
      const authorize = (needs, method, actor, scope) => {
        assertVisitorMayRead(scope, normalised);
        if (gated) { if (!scope || scope.all || scope.system || !scope.projectId) assertAdmin(actor); else assertPermission(actor, gated); }
        authorizeRoute(actor, method, gated && !needs ? ANY_USER : needs, scope);
      };
      if (await dispatch(routes, { req, res, url, p, m, user, authorize, scopeUser: scope => projectUser(user, scope), resolveScope: entry => resolveScope({ store: projectStore, user, header: req.headers[PROJECT_HEADER] ?? (entry.linkable ? url.searchParams.get('project') : undefined), scopeClass: entry.scope, method: m }) })) return;
      return sendJson(res, 404, { error: 'Route not found' });
    } catch (error) { if (!error?.statusCode || error.statusCode >= 500) console.error(errorText(error)); return sendError(res, error?.statusCode || 500, error); }
  });
  app.use((error, _req, res, next) => {
    if (res.headersSent) return next(error);
    if (!error?.statusCode || error.statusCode >= 500) console.error(errorText(error));
    return sendError(res, error?.statusCode || 500, error);
  });
  return http.createServer(app);
}
