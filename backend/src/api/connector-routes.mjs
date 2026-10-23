import { reply, route, scoped } from '../lib/router.mjs';
import { forProject } from '../projects/project-bound.mjs';

// Connectors: the five cards plus custom MCP servers. Writes are admin-only (see rbac ADMIN_ROUTES).
// They live in the request project's operations.yaml, with the project's own secrets (FR-24).
export function connectorRoutes({ connectors }) {
  if (!connectors) return [];
  const of = scope => forProject(connectors, scope);
  return scoped('project', [
    route('GET', '/api/connectors', async ({ scope }) => ({ items: await (await of(scope)).list() }), 'connectors.use'),
    route('POST', '/api/connectors/custom', async ({ body, scope }) => reply(201, await (await of(scope)).saveCustom(await body())), 'admin'),
    route('PUT', '/api/connectors/:id', async ({ params: { id }, body, scope }) => (await of(scope)).save(id, await body()), 'admin'),
    route('DELETE', '/api/connectors/:id', async ({ params: { id }, scope }) => ({ id, deleted: await (await of(scope)).remove(id) }), 'admin'),
    route('POST', '/api/connectors/:id/test', async ({ params: { id }, scope }) => (await of(scope)).test(id), 'admin'),
  ]);
}
