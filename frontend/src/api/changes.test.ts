import { afterEach, describe, expect, it, vi } from "vitest";
import { changesApi } from "@/api/changes";
import { setCurrentProject } from "@/api/projects";
import { mockFetch, sseResponse } from "@/test/utils";

afterEach(() => {
  setCurrentProject(null);
});

describe("changesApi (SPEC-platform-13 FR-4)", () => {
  it("opens the project-scoped change stream and forwards ready and change frames", async () => {
    setCurrentProject("project-a");
    const fetch = mockFetch(async () => sseResponse([
      "event: ready\ndata: {}\n\n",
      'event: change\ndata: {"projectId":"project-a","resource":"ticket","id":"T-1","at":"2026-10-12T00:00:00Z"}\n\n',
    ]));
    const onMessage = vi.fn();

    await changesApi.stream({ onMessage });

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toMatch(/\/api\/changes\/stream$/);
    const headers = new Headers(init?.headers);
    expect(init).toMatchObject({ method: "GET", credentials: "include" });
    expect(headers.get("accept")).toBe("text/event-stream");
    expect(headers.get("X-NerveCenter-Project")).toBe("project-a");
    expect(onMessage.mock.calls.map(([message]) => message.event)).toEqual(["ready", "change"]);
    expect(onMessage.mock.calls[1]?.[0].data).toEqual({ projectId: "project-a", resource: "ticket", id: "T-1", at: "2026-10-12T00:00:00Z" });
  });

  it("surfaces a failed stream response", async () => {
    mockFetch(async () => new Response(JSON.stringify({ error: "Project access denied" }), {
      status: 403,
      headers: { "content-type": "application/json" },
    }));

    await expect(changesApi.stream({ onMessage: vi.fn() })).rejects.toMatchObject({ status: 403, message: "Project access denied" });
  });
});
