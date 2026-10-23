import http from 'node:http';
import { authorizeRoute, permissionsFor, projectUser } from '../src/app/rbac.mjs';
import { sendError, sendJson } from '../src/lib/http.mjs';
import { dispatch } from '../src/lib/router.mjs';
import { PROJECT_HEADER, resolveScope } from '../src/projects/project-access.mjs';

// A real HTTP server over a route list, for the knowledge route tests (SPEC-knowledge-04 to 07). The caller picks the
// user with `userId`; owner, dev and viewer are members of project pilot with that project role.
const ROLES = { owner: 'owner', dev: 'developer', viewer: 'viewer' };
const projectStore = {
  async memberProjectIds() { return ['pilot']; },
  async get(id) { return id === 'pilot' ? { id: 'pilot', kind: 'normal' } : null; },
  async list() { return [{ id: 'pilot', kind: 'normal' }]; },
  async memberRole(_projectId, userId) { return ROLES[userId] || null; },
};

export async function serveRoutes(routes) {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      const userId = String(req.headers['x-user-id'] || 'owner');
      const actor = { id: userId, name: userId, role: 'developer', permissions: permissionsFor('developer') };
      const handled = await dispatch(routes, {
        req, res, url, p: url.pathname.split('/').filter(Boolean), m: req.method, user: actor,
        scopeUser: scope => projectUser(actor, scope),
        resolveScope: entry => resolveScope({ store: projectStore, user: actor, header: req.headers[PROJECT_HEADER], scopeClass: entry.scope, method: req.method }),
        authorize: (needs, method, who, scope) => authorizeRoute(who, method, needs, scope),
      });
      if (!handled) sendJson(res, 404, { error: 'Route not found' });
    } catch (error) { sendError(res, error?.statusCode || 500, error); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, url, { body, userId = 'owner' } = {}) => {
    const response = await fetch(`${base}${url}`, { method, headers: { 'content-type': 'application/json', [PROJECT_HEADER]: 'pilot', 'x-user-id': userId }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json().catch(() => null) };
  };
  return { call, close: () => new Promise(resolve => server.close(resolve)) };
}
