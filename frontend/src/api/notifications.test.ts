import { NotificationRequestQueue, fetchNotificationUpdates, notificationsApi } from "./notifications";

it("serializes notification reads, skips cancelled queued work and recovers after failure", async () => {
  const queue = new NotificationRequestQueue();
  let release!: () => void;
  const first = queue.run(() => new Promise<void>(resolve => { release = resolve; }));
  const cancelled = new AbortController();
  const read = vi.fn(async () => 2);
  const second = queue.run(read, cancelled.signal).catch(e => e.name);
  cancelled.abort();
  const third = queue.run(read);
  await Promise.resolve();
  await Promise.resolve();
  expect(read).not.toHaveBeenCalled();
  release();
  await first;
  expect(await second).toBe("AbortError");
  expect(await third).toBe(2);
  expect(read).toHaveBeenCalledTimes(1);
  await expect(queue.run(async () => { throw new Error("failed"); })).rejects.toThrow("failed");
  expect(await queue.run(async () => 3)).toBe(3);
});

it("drains update pages sequentially and keeps the first page watermark", async () => {
  const calls = vi.spyOn(notificationsApi, "updates");
  const item = { id: "one", kind: "agent.update", at: "2026-10-13T00:00:00Z", title: "Ready", href: "/tasks/one", tone: "neutral" as const };
  calls.mockResolvedValueOnce({ generatedAt: item.at, unread: 101, total: 101, items: Array.from({ length: 50 }, (_, i) => ({ ...item, id: String(i) })), system: [], watermark: "first", nextCursor: "page2" });
  calls.mockResolvedValueOnce({ generatedAt: item.at, unread: 102, total: 102, items: Array.from({ length: 50 }, (_, i) => ({ ...item, id: String(i + 50) })), system: [], watermark: "later", nextCursor: "page3" });
  calls.mockResolvedValueOnce({ generatedAt: item.at, unread: 102, total: 102, items: [{ ...item, id: "100" }], system: [], watermark: "later", nextCursor: null });
  try {
    const signal = new AbortController().signal;
    const result = await fetchNotificationUpdates(new NotificationRequestQueue(), "seen", "previous", signal);
    expect(result.items).toHaveLength(101);
    expect(new Set(result.items.map(i => i.id)).size).toBe(101);
    expect(result.watermark).toBe("first");
    expect(calls.mock.calls.map(c => [c[1], c[2]])).toEqual([["previous", null], ["previous", "page2"], ["previous", "page3"]]);
  } finally { calls.mockRestore(); }
});

it("does not return a partial burst after a page failure", async () => {
  const calls = vi.spyOn(notificationsApi, "updates").mockResolvedValueOnce({ generatedAt: "now", unread: 51, total: 51, items: [], system: [], watermark: "new", nextCursor: "page2" }).mockRejectedValueOnce(new Error("offline"));
  try { await expect(fetchNotificationUpdates(new NotificationRequestQueue(), "seen", "old", new AbortController().signal)).rejects.toThrow("offline"); }
  finally { calls.mockRestore(); }
});
