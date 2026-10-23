import { ROLES, isRole, resolveRole } from '../app/rbac.mjs';
import { getRbacStore } from '../app/rbac-store.mjs';

// What a person's role lets the agent do on their behalf, and what reaches the agent's session.
//
//   viewer     tasks are read-only; cannot decide approvals
//   developer  tasks up to the workspace policy (read-only, ask, policy); approves every change but access changes
//   admin      any task permission, including allow; approves everything
//
// Work nobody started (automatic ticket triage, a routine with no owner) runs with developer rights.

const RANK = { 'read-only': 0, ask: 1, policy: 2, allow: 3 };
const CEILING = { [ROLES.VIEWER]: 'read-only', [ROLES.DEVELOPER]: 'policy', [ROLES.ADMIN]: 'allow' };

/** The role a task's person has now (a role changed in Settings applies to their next step). */
export function roleOf(user) {
  if (!user?.id || user.id === 'system') return ROLES.DEVELOPER;
  if (isRole(user.role)) return user.role;
  const store = getRbacStore();
  const base = { type: 'user', id: String(user.id), name: user.name || String(user.id), groups: user.groups || [], roles: user.roles || [] };
  return resolveRole(store?.overlay ? store.overlay(base) : base);
}

// SPEC-projects-03 FR-22: a person's role in one project, `(user, projectId) => 'admin'|'owner'|'developer'|'viewer'|'open'|null`.
// The backend sets it at boot; without one (a unit test of this file) the app role decides, as before projects had roles.
let projectRoles = null;
export function setProjectRoleResolver(resolve) { projectRoles = resolve; }

/**
 * Why work for this person must not start in `projectId` (blocked, or a viewer there), or null. Work nobody owns is never held
 * back. A person already resolved for a project (a request's user) carries `projectRole`, so their role is read from it.
 */
export async function ownerHold(user, projectId = null) {
  if (!user?.id || user.id === 'system' || user.type === 'agent') return null;
  const store = getRbacStore();
  const overlaid = store?.overlay ? store.overlay({ type: 'user', id: String(user.id), name: user.name || String(user.id), groups: user.groups || [], roles: user.roles || [] }) : user;
  if (overlaid?.blocked) return `${user.name || user.id} is blocked`;
  let role = roleOf(user);
  if (user.projectRole === undefined && projectId && projectRoles) {
    const inProject = await projectRoles({ ...overlaid, role: resolveRole(overlaid) }, projectId);
    role = inProject === 'admin' ? ROLES.ADMIN : ['owner', 'developer'].includes(inProject) ? ROLES.DEVELOPER : ROLES.VIEWER;
  }
  return role === ROLES.VIEWER ? `${user.name || user.id} is now a viewer and viewers cannot start agent work` : null;
}

/** The most a role may grant the agent. */
export function permissionCeiling(role) { return CEILING[role] || CEILING[ROLES.DEVELOPER]; }

/** `permission`, lowered to what `role` allows. */
export function capPermission(permission, role) {
  const ceiling = permissionCeiling(role);
  return (RANK[permission] ?? RANK.policy) > RANK[ceiling] ? ceiling : permission;
}

/** Whether a person with `role` may approve (or deny) a change of `category`. */
export function canDecide(role, category, decision = 'approved') {
  if (role === ROLES.VIEWER) return false;
  if (role === ROLES.ADMIN) return true;
  return decision === 'denied' || category !== 'privileged_access';
}

/* ---------------------------------------------------------------- environment */

// The agent's session gets the operating system's basics, network settings, its own model
// credentials and the connectors' variables; never the backend's database, identity, encryption
// or cloud credentials. Names referenced as ${VAR} by a connection in operations.yaml pass too,
// because MCP servers and skills read them.
const BASE_NAMES = new Set(['PATH', 'PATHEXT', 'HOME', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'APPDATA', 'LOCALAPPDATA', 'PROGRAMDATA', 'ALLUSERSPROFILE', 'PROGRAMFILES', 'PROGRAMFILES(X86)', 'PROGRAMW6432', 'COMMONPROGRAMFILES', 'COMMONPROGRAMFILES(X86)', 'SYSTEMROOT', 'SYSTEMDRIVE', 'WINDIR', 'COMSPEC', 'OS', 'PROCESSOR_ARCHITECTURE', 'NUMBER_OF_PROCESSORS', 'PSMODULEPATH', 'TEMP', 'TMP', 'TMPDIR', 'USER', 'USERNAME', 'LOGNAME', 'SHELL', 'TERM', 'LANG', 'LANGUAGE', 'TZ', 'PWD', 'HOSTNAME', 'COMPUTERNAME', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'XDG_DATA_HOME', 'VIRTUAL_ENV', 'PYTHONPATH', 'PYTHONIOENCODING', 'PYTHONUTF8', 'NODE_EXTRA_CA_CERTS', 'NODE_OPTIONS', 'SSL_CERT_FILE', 'SSL_CERT_DIR', 'REQUESTS_CA_BUNDLE', 'CURL_CA_BUNDLE', 'GIT_SSL_CAINFO', 'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'ALL_PROXY', 'UV_CACHE_DIR', 'UV_TOOL_DIR', 'NPM_CONFIG_CACHE', 'NPM_CONFIG_PREFIX']);
const BASE_PREFIXES = [/^LC_/, /^ANTHROPIC_/, /^CLAUDE_CODE_/, /^CLAUDE_CONFIG_DIR$/, /^SMTP_/, /^EMAIL_/, /^OPS_AGENT_/, /^DISABLE_/];
// When the model runs through a cloud provider, the CLI needs that provider's credentials.
const PROVIDER_PREFIXES = { CLAUDE_CODE_USE_BEDROCK: [/^AWS_/], CLAUDE_CODE_USE_VERTEX: [/^GOOGLE_/, /^GCLOUD_/, /^CLOUD_ML_REGION$/, /^VERTEX_/], CLAUDE_CODE_USE_FOUNDRY: [/^AZURE_/, /^ANTHROPIC_FOUNDRY_/] };

/** Names referenced as ${VAR} by the connections in operations.yaml. */
export function referencedEnvNames(operations = {}) {
  const names = new Set();
  for (const connection of Object.values(operations?.connections || {})) for (const value of Object.values(connection?.env || {})) for (const match of String(value).matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g)) names.add(match[1]);
  return names;
}

/** The environment for an agent session: an allowlist of the backend's, plus what the session is given. */
export function agentEnv(processEnv = process.env, { referenced = new Set(), extra = {} } = {}) {
  const prefixes = [...BASE_PREFIXES];
  for (const [flag, more] of Object.entries(PROVIDER_PREFIXES)) if (/^(1|true|yes)$/i.test(String(processEnv[flag] || ''))) prefixes.push(...more);
  const out = {};
  for (const [name, value] of Object.entries(processEnv)) {
    if (value === undefined) continue;
    const upper = name.toUpperCase();
    if (BASE_NAMES.has(upper) || prefixes.some(pattern => pattern.test(upper)) || referenced.has(name)) out[name] = value;
  }
  return { ...out, ...extra };
}
