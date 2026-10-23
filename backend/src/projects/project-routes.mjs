import { reply, route, scoped } from '../lib/router.mjs';
import { httpError } from '../lib/util.mjs';
import { PROJECT_HEADER, assertProjectPermission, listAccessibleProjects, projectRoleOf } from './project-access.mjs';
import { createProjectWithSetup } from './project-setup.mjs';

// /api/projects* and /api/me/projects (SPEC-projects-01, SPEC-projects-03). All of them are `global`: they decide which project
// you can pick, so they cannot need one. Each checks the caller's role in the project named in the path: members and grants
// are the owners' (`project.members`, `project.grants`), renaming, opening and archiving the app admins'.
const DENIED = 'You do not have access to this project.';
const appAdmin = user => (user?.appRole || user?.role) === 'admin';

export function projectRoutes({ projectStore, grants = null, workspaces = null, users = null, apiKeys = null, unroutedCount = async () => 0 }) {
  if (!projectStore) return [];
  // An owner acts only on the project named in the path, and a project header, when sent, must name the same one.
  const guard = async (user, id, req, permission) => {
    const header = String(req?.headers?.[PROJECT_HEADER] ?? '').trim().toLowerCase();
    if (header && header !== String(id).toLowerCase() && !appAdmin(user)) throw httpError(403, DENIED);
    await assertProjectPermission({ store: projectStore, user, projectId: id, permission });
  };
  // Members of a project (any role) and app admins see who is in it; a visitor to an open project does not (FR-13).
  const seesMembers = async (user, id) => ['admin', 'owner', 'developer', 'viewer'].includes(await projectRoleOf({ store: projectStore, user, projectId: id }));
  return scoped('global', [
    route('GET', '/api/me/projects', async ({ user }) => {
      const result = await listAccessibleProjects({ store: projectStore, user });
      return result.all ? { ...result, unrouted: await unroutedCount() } : result;
    }, '*'),
    route('GET', '/api/projects', async ({ user }) => {
      const mine = await listAccessibleProjects({ store: projectStore, user });
      const visible = new Set(mine.items.map(item => item.id));
      return { items: (await projectStore.list()).filter(project => project.kind !== 'unrouted' || appAdmin(user)).filter(project => appAdmin(user) || visible.has(project.id)) };
    }),
    // People to add to a project, by name, id or email: the create flow and the owners' People tab (FR-19, FR-21). Blocked people are left out.
    route('GET', '/api/people', ({ url }) => {
      const query = String(url.searchParams.get('q') || '').trim().toLowerCase();
      const items = (users?.list() || []).filter(item => !item.blocked).filter(item => !query || [item.id, item.name, item.email].some(value => String(value || '').toLowerCase().includes(query)));
      return { items: items.slice(0, 20).map(item => ({ id: item.id, name: item.name || item.id, email: item.email || '' })) };
    }),
    // What a new project could be granted, for the create flow: library bases and skills, and connections with their safeguard flag.
    ...(grants ? [route('GET', '/api/projects/grantable', ({ user }) => { if (!['admin', 'developer'].includes(user?.appRole || user?.role)) throw httpError(403, 'Viewers cannot create projects.'); return grants.grantable(); })] : []),
    // FR-2, FR-18: app developers and admins create projects, set up in one call; the creator becomes the owner.
    route('POST', '/api/projects', async ({ body, user }) => reply(201, await createProjectWithSetup({ projectStore, grants, workspaces }, await body(), user)), 'projects.create'),
    route('GET', '/api/projects/:id', async ({ params: { id }, user }) => {
      const project = await projectStore.get(id);
      // The same 403 for a project that does not exist and one the caller cannot see.
      if (!project || !(await projectRoleOf({ store: projectStore, user, projectId: id }))) throw httpError(403, DENIED);
      return project;
    }),
    // FR-11: the name and the open flag are the app admins'; the description and colour also the owners'.
    route('PATCH', '/api/projects/:id', async ({ params: { id }, body, user, req }) => {
      const input = await body();
      if (input.name !== undefined || input.open !== undefined) { if (!appAdmin(user)) throw httpError(403, 'Only an app admin can rename a project or open it to everyone.'); }
      else await guard(user, id, req, 'project.settings');
      const { name, description, color, open } = input;
      return projectStore.update(id, { name, description, color, open }, user);
    }, '*'),
    route('POST', '/api/projects/:id/archive', ({ params: { id }, user }) => projectStore.setArchived(id, true, user), 'admin'),
    route('POST', '/api/projects/:id/unarchive', ({ params: { id }, user }) => projectStore.setArchived(id, false, user), 'admin'),
    // Members: anyone in the project reads the list; owners and app admins change it (FR-7).
    route('GET', '/api/projects/:id/members', async ({ params: { id }, user }) => {
      if (!(await seesMembers(user, id))) throw httpError(403, DENIED);
      // With their name and email from the directory, so the People tab shows people rather than sign-in ids.
      return { items: (await projectStore.listMembers(id)).map(member => { const record = users?.find?.(member.userId); return { ...member, name: record?.name || member.userId, email: record?.email || '' }; }) };
    }),
    route('PUT', '/api/projects/:id/members', async ({ params: { id }, body, user, req }) => { await guard(user, id, req, 'project.members'); const input = await body(); return { items: await projectStore.setMembers(id, input.members ?? input.userIds, user) }; }, '*'),
    route('POST', '/api/projects/:id/members', async ({ params: { id }, body, user, req }) => { await guard(user, id, req, 'project.members'); const input = await body(); return reply(201, await projectStore.addMember(id, input.userId, user, { role: input.role || 'developer', requireUser: true })); }, '*'),
    route('PATCH', '/api/projects/:id/members/:userId', async ({ params: { id, userId }, body, user, req }) => { await guard(user, id, req, 'project.members'); return projectStore.setMemberRole(id, userId, (await body()).role, user); }, '*'),
    route('DELETE', '/api/projects/:id/members/:userId', async ({ params: { id, userId }, user, req }) => { await guard(user, id, req, 'project.members'); return projectStore.removeMember(id, userId, user); }, '*'),
    ...(grants ? [
      route('GET', '/api/projects/:id/grants', async ({ params: { id }, user, req }) => { await guard(user, id, req, 'project.grants'); return { items: await projectStore.listGrants(id) }; }),
      route('GET', '/api/projects/:id/grantable', async ({ params: { id }, user, req }) => { await guard(user, id, req, 'project.grants'); return grants.grantable(); }),
      route('PUT', '/api/projects/:id/grants', async ({ params: { id }, body, user, req }) => { await guard(user, id, req, 'project.grants'); return grants.grant(id, await body(), user, { globalAdmin: appAdmin(user) }); }, '*'),
      route('DELETE', '/api/projects/:id/grants/:type/:resourceId', async ({ params: { id, type, resourceId }, user, req }) => { await guard(user, id, req, 'project.grants'); return grants.revoke(id, type, resourceId, user, { globalAdmin: appAdmin(user) }); }, '*'),
    ] : []),
    // SPEC-projects-04: anyone in the project sees whether it has its own Anthropic key; only app admins set or remove it
    // (also gated in ADMIN_ROUTES). The key itself never leaves the server.
    ...(apiKeys ? [
      route('GET', '/api/projects/:id/api-key', async ({ params: { id }, user }) => { if (!(await seesMembers(user, id))) throw httpError(403, DENIED); return apiKeys.status(id); }),
      route('PUT', '/api/projects/:id/api-key', async ({ params: { id }, body, user }) => {
        if (!appAdmin(user)) throw httpError(403, 'Only an app admin can set a project\'s API key.');
        if (!(await projectStore.get(id))) throw httpError(404, 'Project not found');
        return apiKeys.set(id, (await body()).apiKey, user);
      }, 'admin'),
      route('DELETE', '/api/projects/:id/api-key', async ({ params: { id }, user }) => { if (!appAdmin(user)) throw httpError(403, 'Only an app admin can remove a project\'s API key.'); return apiKeys.remove(id, user); }, 'admin'),
    ] : []),
  ]);
}
