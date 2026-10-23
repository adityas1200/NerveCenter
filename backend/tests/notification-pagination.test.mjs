import test from 'node:test';
import assert from 'node:assert/strict';
import { compareNotificationPosition, decodeNotificationPosition, encodeNotificationPosition, matchesNotificationView, pageNotifications } from '../src/app/notification-page.mjs';

test('notification pagination filters before paging, breaks timestamp ties and keeps older cursors stable', () => {
  const rows = Array.from({ length: 125 }, (_, i) => ({ id: String(125 - i).padStart(3, '0'), at: '2026-10-13T00:00:00Z', kind: i % 2 ? 'agent.update' : 'ticket.created' }));
  const page = pageNotifications(rows, { limit: 50, cursor: null });
  const next = pageNotifications([{ id: 'new', at: '2026-10-14T00:00:00Z' }, ...rows], { limit: 50, cursor: decodeNotificationPosition(page.nextCursor) });
  assert.equal(page.items.length, 50);
  assert.equal(next.items[0].id, rows[50].id);
  assert.equal(new Set([...page.items, ...next.items].map(r => r.id)).size, 100);
  const agents = rows.filter(r => matchesNotificationView(r, 'agent'));
  assert.equal(pageNotifications(agents, { limit: 50, cursor: null }).items.length, 50);
  assert.ok(compareNotificationPosition(rows[0], rows[1]) > 0);
  assert.deepEqual(decodeNotificationPosition(encodeNotificationPosition(rows[0])), { at: new Date(rows[0].at).toISOString(), id: rows[0].id });
  assert.throws(() => decodeNotificationPosition('not-a-cursor'), /Invalid notification/);
});
