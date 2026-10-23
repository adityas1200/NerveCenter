import { config } from '../config.mjs';
import { httpError } from '../lib/util.mjs';

// Two levels (SPEC-projects-03). The app role decides who runs the app: admin has full control of the platform and of
// every project, developer may also create projects, viewer (everyone's start) may not. Inside a project what a person
// can do comes from their project role (owner, developer, viewer) and nothing else; the app role never caps it.
export const ROLES = Object.freeze({ ADMIN: 'admin', DEVELOPER: 'developer', VIEWER: 'viewer' });
export const ROLE_IDS = Object.freeze(Object.values(ROLES));
export function isRole(value) { return ROLE_IDS.includes(value); }

// What a project developer does in their project; an owner adds running the project (SPEC-projects-03 FR-6).
const PROJECT_WORK = Object.freeze(['tickets.manage', 'tasks.manage', 'approvals.decide', 'routines.manage', 'boards.manage', 'skills.manage', 'knowledge.manage', 'connectors.use']);
const PROJECT_OWNER = Object.freeze([...PROJECT_WORK, 'project.settings', 'project.members', 'project.grants', 'knowledge.review']);
const ADMIN_PERMISSIONS = Object.freeze([
  'users.manage', 'roles.manage', 'security.manage',
  'secrets.manage', 'connections.manage', 'settings.platform.manage', 'logs.view', 'projects.create',
  ...PROJECT_OWNER,
]);
// The app developer's only extra is creating projects. Outside a project (the global routes) these are what a request
// carries; inside one, `projectUser` swaps them for the project role's set.
const DEVELOPER_PERMISSIONS = Object.freeze(['projects.create']);

export const PROJECT_ROLES = Object.freeze({ OWNER: 'owner', DEVELOPER: 'developer', VIEWER: 'viewer' });
export const PROJECT_ROLE_IDS = Object.freeze(Object.values(PROJECT_ROLES));
export const isProjectRole = value => PROJECT_ROLE_IDS.includes(value);
const PROJECT_PERMISSIONS = Object.freeze({ owner: PROJECT_OWNER, developer: PROJECT_WORK, viewer: Object.freeze([]) });

function normalize(role) { return String(role || '').trim().toLowerCase(); }

export function resolveRole(user) {
  // A role assigned in the Admin Console (stored on the user record) wins over
  // IdP-provided roles so admins can promote/demote without changing the IdP.
  if (isRole(user?.storedRole)) return user.storedRole;
  const roles = (user?.roles || []).map(normalize);
  if (user?.id && config.adminUserIds.includes(user.id)) return ROLES.ADMIN;
  if (roles.includes(normalize(config.adminRole))) return ROLES.ADMIN;
  if (roles.includes(ROLES.ADMIN)) return ROLES.ADMIN;
  if (roles.includes(ROLES.DEVELOPER)) return ROLES.DEVELOPER;
  if (roles.includes(ROLES.VIEWER)) return ROLES.VIEWER;
  if (['development', 'single-user'].includes(config.identityMode)) return ROLES.ADMIN;
  // SPEC-projects-03 FR-1: anyone the directory and the IdP say nothing about starts as a viewer.
  return ROLES.VIEWER;
}

export function permissionsFor(role) {
  if (role === ROLES.ADMIN) return [...ADMIN_PERMISSIONS];
  if (role === ROLES.DEVELOPER) return [...DEVELOPER_PERMISSIONS];
  return [];
}

/**
 * The permissions of a project role (FR-6). `open` (a visitor to an open project), a missing role and anything unknown get
 * none: read access is decided by the scope, and nothing here ever grants more than the role's own set.
 */
export function projectPermissionsFor(projectRole) { return [...(PROJECT_PERMISSIONS[projectRole] || [])]; }

/**
 * The person as they act inside one project (SPEC-projects-03 FR-6, FR-9): the only place the app role, the project role
 * and the open flag meet. App admins keep everything. Everyone else gets their project role's permissions, and `role`
 * becomes developer (owner, developer) or viewer (viewer, visitor), so the role checks written for one workspace read the
 * project role. `appRole` keeps the app role; `projectRole` is owner, developer, viewer, open, or admin for app admins.
 * Outside a single project (global routes, the admin All view, system work) the person is returned unchanged.
 */
export function projectUser(user, scope) {
  if (!user || !scope || scope.all || scope.system || !scope.projectId) return user;
  const appRole = user.appRole || user.role || resolveRole(user);
  if (appRole === ROLES.ADMIN) return { ...user, appRole, projectRole: 'admin', projectOwnerIds: [scope.projectId] };
  const projectRole = isProjectRole(scope.projectRole) || scope.projectRole === 'open' ? scope.projectRole : null;
  const working = projectRole === PROJECT_ROLES.OWNER || projectRole === PROJECT_ROLES.DEVELOPER;
  return { ...user, appRole, role: working ? ROLES.DEVELOPER : ROLES.VIEWER, projectRole, permissions: projectPermissionsFor(projectRole), projectOwnerIds: projectRole === PROJECT_ROLES.OWNER ? [scope.projectId] : [] };
}

function roleOf(user) { return user?.role || resolveRole(user); }

export function hasPermission(user, permission) {
  return (user?.permissions || permissionsFor(roleOf(user))).includes(permission);
}

export function assertPermission(user, permission) {
  if (hasPermission(user, permission)) return;
  throw httpError(403, roleOf(user) === ROLES.VIEWER ? 'Viewers have read-only access. Ask an administrator to change your role.' : 'Your role does not allow this action.');
}

// Route guard: every write in the route table declares its permission (ANY_USER for open writes).
// Keep the missing-permission fallback for callers outside the validated route table (FR-9).
export const ANY_USER = '*';
export function authorizeRoute(user, method, needs, scope = null) {
  if (needs === ANY_USER) return;
  if (needs === 'admin') return assertAdmin(user);
  if (needs) return assertPermission(user, needs);
  if (['GET', 'HEAD'].includes(String(method || '').toUpperCase())) return;
  if (scope && !scope.all && !scope.system && scope.projectId && roleOf(user) !== ROLES.ADMIN) return assertPermission(user, 'project.settings');
  assertAdmin(user);
}

export function assertAdmin(user) {
  if (roleOf(user) !== ROLES.ADMIN) throw httpError(403, 'Administrator role is required for this action');
}

// Routes gated beyond their declared permission. Without `project`, app admins only: platform controls (secrets,
// connections, integrations, platform settings). With `project`, the permission named there inside the request's project
// (SPEC-projects-03 FR-9): an owner for the project's settings and templates, a developer for its knowledge and skills.
const ADMIN_ROUTES = [
  { methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], pattern: /^\/api\/admin(?:\/.*)?$/ },
  { methods: ['POST', 'PUT', 'DELETE'], pattern: /^\/api\/secrets\/[^/]+$/ },
  { methods: ['POST', 'PUT', 'DELETE'], pattern: /^\/api\/connections(?:\/[^/]+(?:\/set-default)?)?$/ },
  { methods: ['POST', 'PUT', 'DELETE'], pattern: /^\/api\/data-quality\/config(?:\/[^/]+)?$/, project: 'project.settings' },
  { methods: ['PUT', 'PATCH', 'POST', 'DELETE'], pattern: /^\/api\/settings(?:\/.*)?$/, project: 'project.settings' },
  { methods: ['POST'], pattern: /^\/api\/integrations\/servicenow\/sync$/ },
  { methods: ['POST'], pattern: /^\/api\/tickets\/poll$/ },
  { methods: ['POST'], pattern: /^\/api\/integrations\/jira\/sync$/ },
  { methods: ['PUT', 'POST', 'DELETE'], pattern: /^\/api\/connectors(?:\/.*)?$/ },
  { methods: ['POST', 'DELETE'], pattern: /^\/api\/skills(?:\/.*)?$/, project: 'skills.manage' },
  { methods: ['POST', 'DELETE'], pattern: /^\/api\/templates(?:\/.*)?$/, project: 'project.settings' },
  // Keeping or discarding Sonic's lesson drafts is the owner's review; the rest of a project's knowledge is its developers'.
  { methods: ['POST'], pattern: /^\/api\/knowledge\/[^/]+\/drafts\/(?:keep|discard)$/, project: 'knowledge.review' },
  // Starting the knowledge setup is the owner's too: it decides what the team is asked (SPEC-knowledge-03 FR-1).
  { methods: ['POST'], pattern: /^\/api\/knowledge\/setup$/, project: 'knowledge.review' },
  // So is the weekly knowledge pass: it drafts into the project's bases every week (SPEC-knowledge-07 FR-2).
  { methods: ['PUT'], pattern: /^\/api\/knowledge\/pass$/, project: 'knowledge.review' },
  { methods: ['POST', 'PUT', 'DELETE'], pattern: /^\/api\/knowledge(?:\/.*)?$/, project: 'knowledge.manage' },
  // Projects: archiving stays app-admin only. Renaming and opening a project are checked in its PATCH route, because the
  // same call takes an owner's description and colour (SPEC-projects-03 FR-11). Creating, members and grants check their own.
  { methods: ['POST'], pattern: /^\/api\/projects\/[^/]+\/(?:archive|unarchive)$/ },
  // A project's own Anthropic key is a secret: app admins only (SPEC-projects-04 FR-3).
  { methods: ['PUT', 'DELETE'], pattern: /^\/api\/projects\/[^/]+\/api-key$/ },
];

/** null, 'global' (app admins only) or 'project' (the permission `adminRoutePermission` names, inside the request's project). */
export function adminRouteKind(method, pathname) {
  const entry = adminRoute(method, pathname);
  return entry ? (entry.project ? 'project' : 'global') : null;
}
/** The project permission a gated project route needs, or null. */
export function adminRoutePermission(method, pathname) { return adminRoute(method, pathname)?.project || null; }
function adminRoute(method, pathname) {
  const m = String(method || '').toUpperCase();
  return ADMIN_ROUTES.find(item => item.methods.includes(m) && item.pattern.test(pathname)) || null;
}
export const isAdminOnlyRoute = (method, pathname) => adminRouteKind(method, pathname) !== null;

export function summarize(user) {
  const role = resolveRole(user);
  return { role, permissions: permissionsFor(role) };
}
