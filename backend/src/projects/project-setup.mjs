import fs from 'node:fs/promises';
import path from 'node:path';
import { httpError } from '../lib/util.mjs';
import { hasProjectPermission } from './project-access.mjs';

// Creating a project with its setup in one call (SPEC-projects-03 FR-18): the whole request is checked first, and only a
// request that passes is applied, so a bad grant or an unknown person never leaves a half-made project behind.

// How far Sonic may go, as the project's operations.yaml `policy` (permission-policy.mjs categories). Knowledge drafts stay
// allowed in every mode: a person keeps or discards each one.
export const AUTONOMY_POLICIES = Object.freeze({
  read: { default_write: 'deny', workspace_changes: 'deny', ticket_writes: 'deny', production_changes: 'deny', privileged_access: 'deny', email_send: 'deny', knowledge_drafts: 'allow' },
  ask: { default_write: 'ask', workspace_changes: 'ask', ticket_writes: 'ask', production_changes: 'ask', privileged_access: 'ask', email_send: 'ask', knowledge_drafts: 'allow' },
  dev: { default_write: 'allow', workspace_changes: 'allow', ticket_writes: 'ask', production_changes: 'ask', privileged_access: 'ask', email_send: 'ask', knowledge_drafts: 'allow' },
});
const MODELS = ['sonnet', 'opus', 'fable', 'haiku'];
// What "copy settings from a project" copies: the operations.yaml sections that name no connection, so nothing points at a
// connection the new project was not granted. Templates come along as files.
export const COPIED_SECTIONS = Object.freeze(['agent', 'policy', 'documents', 'branding', 'communication', 'tickets', 'ui']);
const appRoleOf = user => user?.appRole || user?.role || 'viewer';

export async function createProjectWithSetup({ projectStore, grants, workspaces }, input = {}, user) {
  const admin = appRoleOf(user) === 'admin';
  if (!['admin', 'developer'].includes(appRoleOf(user))) throw httpError(403, 'Viewers cannot create projects. Ask an admin to make you a developer.');
  const { id, name, description = '', color = null, open = false, copyFrom = null, grants: wanted = [], members = [], settings = {}, ownerUserIds = null, adminUserIds = null } = input || {};

  /* ---- check everything */
  if (open === true && !admin) throw httpError(403, 'Only an app admin can open a project to everyone.');
  const owners = ownerUserIds ?? adminUserIds;
  if (owners && !admin) throw httpError(403, 'Only an app admin can name other owners.');
  const { projectId } = await projectStore.checkNew({ id, name, color });
  const people = projectStore.checkMembers(members).filter(member => String(member.userId).toLowerCase() !== String(user?.id || '').toLowerCase());
  if (owners) projectStore.checkMembers((Array.isArray(owners) ? owners : []).map(userId => ({ userId, role: 'owner' })));
  if (copyFrom !== null && copyFrom !== undefined && copyFrom !== '') {
    if (!(await projectStore.get(copyFrom)) || !(await hasProjectPermission({ store: projectStore, user, projectId: copyFrom, permission: 'project.settings' }))) throw httpError(403, 'You can only copy settings from a project you own.');
  }
  if (settings && typeof settings !== 'object') throw httpError(400, 'settings must be an object.');
  if (settings?.model !== undefined && !MODELS.includes(settings.model)) throw httpError(400, `settings.model must be one of ${MODELS.join(', ')}.`);
  if (settings?.autonomy !== undefined && !AUTONOMY_POLICIES[settings.autonomy]) throw httpError(400, `settings.autonomy must be one of ${Object.keys(AUTONOMY_POLICIES).join(', ')}.`);
  if (!Array.isArray(wanted)) throw httpError(400, 'grants must be a list.');
  if (wanted.length && !grants) throw httpError(400, 'This server cannot grant resources to projects.');
  const seen = new Set();
  for (const grant of wanted) {
    const key = `${grant?.resourceType}:${grant?.resourceId}`;
    if (seen.has(key)) throw httpError(400, `${grant?.resourceId} is granted twice.`);
    seen.add(key);
    await grants.check(projectId, grant || {}, { globalAdmin: admin, inLibrary: true });
  }

  /* ---- apply, in order: the project and its owner, the workspace, the settings, the grants, the members */
  const project = await projectStore.create({ id: projectId, name, description, color, open: admin && open === true, ownerUserIds: owners }, user);
  if (workspaces) {
    const workspace = await workspaces.for(projectId);
    if (copyFrom) await copySettings(await workspaces.for(copyFrom), workspace);
    if (settings?.model) await workspace.setSection('agent', { ...((await workspace.getSection('agent')) || {}), model: settings.model });
    if (settings?.autonomy) await workspace.setSection('policy', { ...((await workspace.getSection('policy')) || {}), ...AUTONOMY_POLICIES[settings.autonomy] });
  }
  for (const grant of wanted) await grants.grant(projectId, grant, user, { globalAdmin: admin });
  for (const member of people) await projectStore.addMember(projectId, member.userId, user, { role: member.role, requireUser: true });
  return project;
}

async function copySettings(from, to) {
  const source = await from.readOperations();
  for (const section of COPIED_SECTIONS) if (source[section] !== undefined && source[section] !== null) await to.setSection(section, source[section]);
  const entries = await fs.readdir(from.templatesDir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) if (entry.isFile()) await fs.copyFile(path.join(from.templatesDir, entry.name), path.join(to.templatesDir, entry.name));
}
