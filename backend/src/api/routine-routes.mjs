import { reply, route, scoped } from '../lib/router.mjs';
import { forProject } from '../projects/project-bound.mjs';

// Routines: list, create, edit, pause, run, test, check. Viewers read; every other route needs routines.manage.
// A routine belongs to the project of the request (FR-19): each handler works on that project's own routines.
export function routineRoutes({ routines }) {
  if (!routines) return [];
  const of = scope => forProject(routines, scope);
  return scoped('project', [
    route('GET', '/api/routines', async ({ scope }) => ({ items: await (await of(scope)).list() })),
    route('POST', '/api/routines', async ({ body, user, scope }) => reply(201, await (await of(scope)).save({ ...await body(), user })), 'routines.manage'),
    route('GET', '/api/routines/:name', async ({ params: { name }, scope }) => (await (await of(scope)).get(name)) || reply(404, { error: 'Routine not found' })),
    route('PUT|PATCH', '/api/routines/:name', async ({ params: { name }, body, user, scope }) => { const b = await body(); const routine = await of(scope); return Object.keys(b).length === 1 && 'enabled' in b ? routine.setEnabled(name, b.enabled) : routine.save({ ...b, name, user }); }, 'routines.manage'),
    route('DELETE', '/api/routines/:name', async ({ params: { name }, scope }) => ({ name, deleted: await (await of(scope)).remove(name) }), 'routines.manage'),
    route('POST', '/api/routines/:name/run', async ({ params: { name }, user, scope }) => reply(202, await (await of(scope)).run(name, { user, scope })), 'routines.manage'),
    route('POST', '/api/routines/:name/test', async ({ params: { name }, user, scope }) => reply(202, await (await of(scope)).run(name, { user, test: true, scope })), 'routines.manage'),
    route('POST', '/api/routines/:name/pause', async ({ params: { name }, scope }) => (await of(scope)).setEnabled(name, false), 'routines.manage'),
    route('POST', '/api/routines/:name/resume', async ({ params: { name }, scope }) => (await of(scope)).setEnabled(name, true), 'routines.manage'),
    route('POST', '/api/routines/:name/check', async ({ params: { name }, scope }) => (await of(scope)).check(name), 'routines.manage'),
  ]);
}
