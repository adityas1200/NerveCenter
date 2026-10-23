import { httpError } from '../lib/util.mjs';

export type NotificationPosition = { at: string; id: string };
export type NotificationRow = { at: string; id: string; kind?: unknown; pinned?: unknown; [key: string]: unknown };
export type NotificationView = 'all' | 'agent' | 'operations';

export function encodeNotificationPosition(row: NotificationPosition): string {
  return Buffer.from(JSON.stringify({ at: row.at, id: row.id })).toString('base64url');
}

export function decodeNotificationPosition(value: string | null | undefined): NotificationPosition | null {
  if (!value) return null;
  if (value.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(value)) throw httpError(400, 'Invalid notification position. Refresh notifications and try again.');
  try {
    const row = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<NotificationPosition>;
    if (typeof row.at === 'string' && !Number.isNaN(Date.parse(row.at)) && typeof row.id === 'string' && row.id.length > 0 && row.id.length <= 512) {
      return { at: new Date(row.at).toISOString(), id: row.id };
    }
  } catch { /* invalid position is reported below */ }
  throw httpError(400, 'Invalid notification position. Refresh notifications and try again.');
}

export function compareNotificationPosition(left: NotificationPosition, right: NotificationPosition): number {
  return Date.parse(left.at) - Date.parse(right.at) || left.id.localeCompare(right.id);
}

export function isBellNotification(row: NotificationRow): boolean {
  const kind = String(row.kind || '');
  return !row.pinned && !kind.startsWith('system.') && kind !== 'approval.pending' && kind !== 'agent.approval' && kind !== 'agent.question';
}

export function matchesNotificationView(row: NotificationRow, view: NotificationView): boolean {
  if (!isBellNotification(row)) return false;
  const agent = String(row.kind || '').startsWith('agent.');
  return view === 'all' || (view === 'agent' ? agent : !agent);
}

export function pageNotifications<T extends NotificationRow>(rows: T[], { limit, cursor }: { limit: number; cursor: NotificationPosition | null }) {
  const page = cursor ? rows.filter(row => compareNotificationPosition(row, cursor) < 0) : rows;
  const items = page.slice(0, limit);
  return { items, nextCursor: page.length > limit && items.length ? encodeNotificationPosition(items[items.length - 1]) : null };
}
