import { httpError } from '../lib/util.mjs';
import { ROLES, resolveRole, projectPermissionsFor } from '../app/rbac.mjs';
import { PILOT_ID, PROJECT_ID_PATTERN } from './project-store.mjs';

// The one place that decides which project a request or a task may touch (SPEC-projects-01 FR-9..FR-13).
// Deny by default: anything missing, malformed or unknown is a 403, never "no filter". Handlers and stores
// never read the header or look up membership themselves; they take the `scope` this module hands out.

export const PROJECT_HEADER = 'x-nervecenter-project';
export const ALL_PROJECTS = '*';
// Every route in the table declares one of these (FR-11). `project-read` is a project route that reads even
// though it is not a GET (a POST that only carries filters), so the admin All view may use it.
export const SCOPE_CLASSES = Object.freeze(['project', 'project-read', 'global', 'admin-global']);
export const DEFAULT_PROJECT_ID = PILOT_ID;

const DENIED = 'You do not have access to this project.';
const issued = new WeakSet();
const READ_METHODS = new Set(['GET', 'HEAD']);

function issue(fields) { const scope = Object.freeze({ ...fields, projectIds: Object.freeze([...fields.projectIds]), memberProjectIds: Object.freeze([...(fields.memberProjectIds || [])]) }); issued.add(scope); return scope; }

/**
 * A scope for work nobody is signed in for: a background job or an agent task, bound to ONE project (a
 * system never reads across projects in one call). It cannot carry ALL.
 */
export function systemScope(projectId) {
  const id = String(projectId || '');
  if (!PROJECT_ID_PATTERN.test(id)) throw httpError(403, 'This work has no project.');
  return issue({ projectId: id, projectIds: [id], all: false, admin: false, archived: false, system: true });
}

export const isScope = value => issued.has(value);
/** Stores and services call this first: an undefined or hand-built scope is a bug and never means "everything". */
export function assertScope(scope) {
  if (!issued.has(scope)) throw httpError(500, 'A project scope is required here.');
  return scope;
}
export const inScope = (scope, projectId) => assertScope(scope).all || (typeof projectId === 'string' && scope.projectIds.includes(projectId));

/** The project ids a list query may match: null means every project (the admin All view), otherwise an explicit list. */
export const scopeIds = scope => (assertScope(scope).all ? null : [...scope.projectIds]);
export const filterByScope = (scope, rows) => (assertScope(scope).all ? rows : rows.filter(row => scope.projectIds.includes(row?.projectId)));

/** FR-13: the one by-id check. A row outside the scope is a 403 for every route, so existence is not told apart. */
export function assertRowInScope(scope, row) {
  assertScope(scope);
  // A row that does not exist answers like one in another project, so an id's existence is never told apart (FR-13).
  if (!row && scope.all) throw httpError(404, 'Not found');
  if (scope.all || (row && typeof row.projectId === 'string' && scope.projectIds.includes(row.projectId))) return row;
  // FR-14: only a project the caller already belongs to is named; anyone else learns nothing.
  throw Object.assign(httpError(403, DENIED), row && scope.memberProjectIds?.includes(row.projectId) ? { projectId: row.projectId } : {});
}

/** The single project a create or write goes to. The All view is read-only (FR-9). */
export function writeProjectId(scope) {
  assertScope(scope);
  if (scope.all) throw httpError(403, 'Project required');
  if (scope.archived) throw httpError(409, 'This project is archived and read-only.');
  return scope.projectId;
}

const isAdmin = user => (user?.role || resolveRole(user)) === ROLES.ADMIN;

/**
 * Resolve the scope for one request. `header` is the raw X-NerveCenter-Project value; `scopeClass` comes from
 * the route table. Membership is looked up once per request and never cached across requests, so removing
 * someone applies at once. Returns null for routes that need no project.
 */
export async function resolveScope({ store, user, header, scopeClass, method = 'GET' }) {
  if (!SCOPE_CLASSES.includes(scopeClass)) throw httpError(500, 'This route has no scope class.');
  if (scopeClass === 'global') return null;
  if (scopeClass === 'admin-global') { if (!isAdmin(user)) throw httpError(403, 'Administrator role is required for this action'); return null; }
  const write = scopeClass === 'project' && !READ_METHODS.has(String(method).toUpperCase());
  const admin = isAdmin(user);
  const member = admin ? [] : await store.memberProjectIds(user?.id);
  let value = String(header ?? '').trim().toLowerCase();
  // SPEC-projects-03 FR-12: someone in no project may still read an open one, so "No project" waits for the header.
  if (!value) throw httpError(403, !admin && !member.length ? 'No project' : 'Project required');
  if (value === ALL_PROJECTS) {
    if (!admin) throw httpError(403, DENIED);
    if (write) throw httpError(403, 'Project required');
    return issue({ projectId: 'ALL', projectIds: (await store.list()).map(project => project.id), all: true, admin: true, archived: false, system: false, projectRole: 'admin', access: 'all' });
  }
  if (!PROJECT_ID_PATTERN.test(value)) throw httpError(403, DENIED);
  const isMember = member.some(id => id === value);
  const project = await store.get(value);
  // Same 403 body for a project that does not exist, one the caller is not in, and a write to an open one (no existence leak).
  if (!project || (!admin && project.kind === 'unrouted')) throw httpError(403, !admin && !member.length ? 'No project' : DENIED);
  if (!admin && !isMember && !(isOpen(project) && !write)) throw httpError(403, member.length ? DENIED : 'No project');
  if (write && project.archivedAt) throw httpError(409, 'This project is archived and read-only.');
  const memberProjectIds = admin ? (await store.list()).map(item => item.id) : member;
  // The role is read once per request, never cached across requests, so a change applies at once (FR-6).
  const projectRole = admin ? 'admin' : isMember ? await store.memberRole(project.id, user?.id) : 'open';
  return issue({ projectId: project.id, projectIds: [project.id], memberProjectIds, all: false, admin, archived: Boolean(project.archivedAt), system: false, projectRole, access: admin ? 'admin' : isMember ? 'member' : 'open' });
}

// SPEC-projects-03 FR-13: what a visitor to an open project does not read. Settings and connections hold connection details,
// tasks and the inbox hold Sonic's transcripts and approvals, routines and connectors their prompts and commands.
const VISITOR_HIDDEN = [/^\/api\/settings(?:\/|$)/, /^\/api\/connections(?:\/|$)/, /^\/api\/connection-provider-status$/, /^\/api\/connectors(?:\/|$)/, /^\/api\/tasks(?:\/|$)/, /^\/api\/inbox(?:\/|$)/, /^\/api\/routines(?:\/|$)/, /^\/api\/templates(?:\/|$)/];
/** Refuses a visitor's read of what FR-13 keeps from them, with the same 403 a non-member gets. */
export function assertVisitorMayRead(scope, pathname) {
  if (scope?.access === 'open' && VISITOR_HIDDEN.some(pattern => pattern.test(pathname))) throw httpError(403, DENIED);
}

/** FR-11, FR-12: an open project is one an app admin opened, still normal and not archived. */
const isOpen = project => project?.open === true && project.kind === 'normal' && !project.archivedAt;

/**
 * A person's role in one project: `admin` for app admins, else their member role (owner, developer, viewer), else `open` for
 * a visitor to an open project, else null. Blocked people never get here (they are refused before scopes).
 */
export async function projectRoleOf({ store, user, projectId }) {
  const id = String(projectId || '').trim().toLowerCase();
  if (!PROJECT_ID_PATTERN.test(id)) return null;
  const project = await store.get(id);
  if (!project) return null;
  if (isAdmin(user)) return 'admin';
  if (project.kind !== 'normal') return null;
  const role = user?.id ? await store.memberRole(project.id, user.id) : null;
  return role || (isOpen(project) ? 'open' : null);
}

/** SPEC-projects-03 FR-6, FR-10: does this person hold `permission` in this project. App admins hold every one. */
export async function hasProjectPermission({ store, user, projectId, permission }) {
  const role = await projectRoleOf({ store, user, projectId });
  return role === 'admin' || projectPermissionsFor(role).includes(permission);
}
export async function assertProjectPermission(args) {
  if (!(await hasProjectPermission(args))) throw httpError(403, DENIED);
}

/**
 * `GET /api/me/projects` (FR-15): what the home page and the project switcher offer this person. Their own projects first
 * (with their role), then for an app admin every other project (`admin`), then open projects they are not in (`open`).
 */
export async function listAccessibleProjects({ store, user }) {
  const projects = (await store.list()).filter(project => project.kind !== 'unrouted');
  const roles = new Map((user?.id ? await store.membershipsOf(user.id) : []).map(item => [item.projectId, item.role]));
  const admin = isAdmin(user);
  const item = (project, role) => ({ id: project.id, name: project.name, slug: project.slug, description: project.description, color: project.color, open: project.open, role, archived: Boolean(project.archivedAt) });
  const mine = projects.filter(project => roles.has(project.id)).map(project => item(project, roles.get(project.id)));
  const rest = projects.filter(project => !roles.has(project.id));
  const others = admin ? rest.map(project => item(project, 'admin')) : rest.filter(isOpen).map(project => item(project, 'open'));
  return { items: [...mine, ...others], all: admin };
}
