import { reply, route, scoped } from '../lib/router.mjs';
import { NERVECENTER_SOURCES, RANGE_OPTIONS, WIDGET_SIZES, WIDGET_TYPES } from '../boards/board-service.mjs';

/**
 * Boards: list, read, build, publish, run. Reads (and POST data, which only carries filters) are open to every role;
 * writes need boards.manage (a developer or admin) and the board's owner (admins may edit any board). The service enforces both; the
 * routes only shape the request.
 */
export function boardRoutes({ boards }) {
  if (!boards) return [];
  return [
    ...scoped('project', [
    route('GET', '/api/boards', async ({ user, scope }) => ({ items: await boards.list(user, scope) })),
    route('POST', '/api/boards', async ({ body, user, scope }) => reply(201, await boards.create(await body(), user, scope)), 'boards.manage'),
    route('GET', '/api/boards/sources', () => ({ sources: NERVECENTER_SOURCES, widgetTypes: WIDGET_TYPES, sizes: WIDGET_SIZES, ranges: RANGE_OPTIONS })),
    route('GET', '/api/boards/:id', ({ params: { id }, user, scope }) => boards.get(id, user, scope)),
    route('PUT|PATCH', '/api/boards/:id', async ({ params: { id }, body, user, scope }) => boards.update(id, await body(), user, scope), 'boards.manage'),
    route('DELETE', '/api/boards/:id', ({ params: { id }, user, scope }) => boards.remove(id, user, scope), 'boards.manage'),
    route('POST', '/api/boards/:id/publish', ({ params: { id }, user, scope }) => boards.setPublished(id, true, user, scope), 'boards.manage'),
    route('POST', '/api/boards/:id/unpublish', ({ params: { id }, user, scope }) => boards.setPublished(id, false, user, scope), 'boards.manage'),
    ]),
    // Reads that arrive as POSTs (they only carry filters or a widget to try): the admin All view may use them.
    ...scoped('project-read', [
    route('POST', '/api/boards/preview', async ({ body, user, scope }) => { const b = await body(); return boards.preview(b.widget || {}, b.filters || {}, user, b.board || null, scope); }, 'boards.manage'),
    route('GET|POST', '/api/boards/:id/data', async ({ params: { id }, m, url, body, user, scope }) => {
      const picked = m === 'POST' ? (await body()).filters || {} : Object.fromEntries(url.searchParams.entries());
      const result = await boards.run(id, picked, user, scope);
      if (url.searchParams.get('view') !== '0') boards.noteView(id).catch(() => {});
      return result;
    }, '*'),
    ]),
  ];
}
