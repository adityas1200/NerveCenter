import { apiClient } from "@/api/client";
import type { NotificationItem } from "@/api/types";

export type NotificationView = "all" | "agent" | "operations";

export interface NotificationSummary {
  generatedAt: string;
  unread: number;
  systemCount: number;
  watermark: string | null;
}

export interface NotificationPage {
  generatedAt: string;
  total: number;
  items: NotificationItem[];
  system: NotificationItem[];
  nextCursor: string | null;
}

export interface NotificationUpdates extends Omit<NotificationPage, "total"> {
  total: number;
  unread: number;
  watermark: string | null;
}

function params(values: Record<string, string | null | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (value !== null && value !== undefined) query.set(key, value);
  return query.toString();
}

/** Serializes the alert poll and drawer page reads in one browser tab. */
export class NotificationRequestQueue {
  private pending: Promise<unknown> = Promise.resolve();

  run<T>(request: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const next = this.pending.catch(() => undefined).then(() => {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      return request();
    });
    this.pending = next.catch(() => undefined);
    return next;
  }
}

export const notificationsApi = {
  summary: (seenAt: string, signal?: AbortSignal) =>
    apiClient.get<NotificationSummary>(`/api/notifications?${params({ mode: "summary", seenAt })}`, { signal }),
  updates: (seenAt: string, after: string, cursor: string | null, signal?: AbortSignal) =>
    apiClient.get<NotificationUpdates>(`/api/notifications?${params({ mode: "updates", seenAt, after, cursor, limit: "50" })}`, { signal }),
  page: (view: NotificationView, cursor: string | null, signal?: AbortSignal) =>
    apiClient.get<NotificationPage>(`/api/notifications?${params({ mode: "page", view, cursor, limit: "50" })}`, { signal }),
};

/** Drain a burst before the caller advances its watermark. A failed page commits nothing. */
export async function fetchNotificationUpdates(queue: NotificationRequestQueue, seenAt: string, after: string, signal: AbortSignal) {
  const items: NotificationItem[] = [];
  let cursor: string | null = null;
  let first: NotificationUpdates | undefined;
  do {
    signal.throwIfAborted();
    const page: NotificationUpdates = await queue.run(() => notificationsApi.updates(seenAt, after, cursor, signal), signal);
    first ??= page;
    items.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  signal.throwIfAborted();
  return { ...first, items, systemCount: first.system.length };
}
