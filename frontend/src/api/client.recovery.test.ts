import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { apiClient, streamSse } from "./client";
import { clearSessionNotice, getSessionNotice, readCookieSession, subscribeSessionNotice } from "./session";
import { PROJECT_HEADER, setCurrentProject } from "./projects";
import { jsonResponse, mockFetch, sseResponse } from "@/test/utils";

const signedIn = { authenticated: true, user: { id: "u", name: "User" } };
const anonymous = { authenticated: false, user: null };
const unauthorized = () => jsonResponse({ error: "Authentication is required" }, 401);

beforeEach(() => {
  vi.stubEnv("VITE_AUTH_ENABLED", "true");
  window.history.replaceState(null, "", "/p/pilot/monitor?status=Failed#pipeline");
  sessionStorage.clear();
  clearSessionNotice();
  setCurrentProject(null);
});
afterEach(() => {
  clearSessionNotice();
  setCurrentProject(null);
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("SPEC-platform-16 FR-2/FR-3/FR-5: cookie API recovery", () => {
  it("replays a rejected write once with its body, project/custom headers, signal and cookies intact", async () => {
    setCurrentProject("pilot");
    let attempts = 0;
    const fetchMock = mockFetch(url => url.endsWith("/session") ? jsonResponse(signedIn) : ++attempts === 1 ? unauthorized() : jsonResponse({ id: "new" }));
    const controller = new AbortController();
    await expect(apiClient.post("/api/tickets", { title: "Issue" }, { signal: controller.signal, headers: { "x-request-id": "same-request" } })).resolves.toEqual({ id: "new" });
    const calls = fetchMock.mock.calls.filter(([url]) => url === "/api/tickets");
    expect(calls).toHaveLength(2);
    expect(calls[1][1]).toBe(calls[0][1]);
    const init = calls[1][1]!;
    expect(init).toMatchObject({ method: "POST", credentials: "include", body: JSON.stringify({ title: "Issue" }), signal: controller.signal });
    expect(new Headers(init.headers).get(PROJECT_HEADER)).toBe("pilot");
    expect(new Headers(init.headers).get("x-request-id")).toBe("same-request");
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/session"))).toHaveLength(1);
    expect(getSessionNotice()).toBeNull();
  });

  it("shares a pending session check across concurrent 401s", async () => {
    let finish!: (response: Response) => void;
    const pending = new Promise<Response>(resolve => { finish = resolve; });
    const attempts = new Map<string, number>();
    const fetchMock = mockFetch(url => {
      if (url.endsWith("/session")) return pending;
      const count = (attempts.get(url) ?? 0) + 1;
      attempts.set(url, count);
      return count === 1 ? unauthorized() : jsonResponse({ ok: true });
    });
    const requests = [apiClient.get("/api/one"), apiClient.get("/api/two")];
    await vi.waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/session"))).toHaveLength(1));
    finish(await jsonResponse(signedIn));
    await expect(Promise.all(requests)).resolves.toEqual([{ ok: true }, { ok: true }]);
    expect(attempts).toEqual(new Map([["/api/one", 2], ["/api/two", 2]]));
  });

  it("expires once when concurrent requests find an anonymous session and preserves the complete return URL", async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeSessionNotice(listener);
    const fetchMock = mockFetch(url => url.endsWith("/session") ? jsonResponse(anonymous) : unauthorized());
    const results = await Promise.allSettled([apiClient.get("/api/one"), apiClient.get("/api/two")]);
    expect(results.every(result => result.status === "rejected")).toBe(true);
    expect(getSessionNotice()?.kind).toBe("expired");
    expect(listener).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem("nervecenter_requested_path")).toBe("/p/pilot/monitor?status=Failed#pipeline");
    expect(fetchMock.mock.calls.filter(([url]) => String(url).startsWith("/api/"))).toHaveLength(2);
    await expect(apiClient.get("/api/three")).rejects.toMatchObject({ status: 401, code: "SESSION_EXPIRED" });
    expect(fetchMock.mock.calls.some(([url]) => url === "/api/three")).toBe(false);
    unsubscribe();
  });

  it("stops after a second API 401", async () => {
    const fetchMock = mockFetch(url => url.endsWith("/session") ? jsonResponse(signedIn) : unauthorized());
    await expect(apiClient.get("/api/tickets")).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(getSessionNotice()?.kind).toBe("expired");
  });

  it("treats a session endpoint 401 as expiry", async () => {
    mockFetch(unauthorized);
    await expect(apiClient.get("/api/tickets")).rejects.toMatchObject({ status: 401 });
    expect(getSessionNotice()?.kind).toBe("expired");
  });

  it("leaves API 403 responses out of session recovery", async () => {
    const fetchMock = mockFetch(() => jsonResponse({ error: "Access denied" }, 403));
    await expect(apiClient.get("/api/tickets")).rejects.toMatchObject({ status: 403, message: "Access denied" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getSessionNotice()).toBeNull();
  });

  it("keeps a retry's 403 as access denied rather than session expiry", async () => {
    let attempts = 0;
    mockFetch(url => url.endsWith("/session") ? jsonResponse(signedIn) : ++attempts === 1 ? unauthorized() : jsonResponse({ error: "Access denied" }, 403));
    await expect(apiClient.get("/api/tickets")).rejects.toMatchObject({ status: 403 });
    expect(attempts).toBe(2);
    expect(getSessionNotice()).toBeNull();
  });

  it.each([403, 503])("reports session verification HTTP %s without declaring expiry or replaying a write", async status => {
    const fetchMock = mockFetch(url => url.endsWith("/session") ? jsonResponse({ error: "Unavailable" }, status) : unauthorized());
    await expect(apiClient.post("/api/tickets", { title: "Issue" })).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(getSessionNotice()?.kind).toBe("unavailable");
    expect(sessionStorage.getItem("nervecenter_requested_path")).toBeNull();
  });

  it.each([null, {}, { authenticated: true, user: null }, { authenticated: "true", user: signedIn.user }])("rejects malformed session data without logging the user out: %j", async body => {
    mockFetch(url => url.endsWith("/session") ? jsonResponse(body) : unauthorized());
    await expect(apiClient.get("/api/tickets")).rejects.toMatchObject({ status: 401 });
    expect(getSessionNotice()?.kind).toBe("unavailable");
  });

  it("can recover on a later action after a transient session network failure", async () => {
    let unavailable = true;
    const attempts = new Map<string, number>();
    mockFetch(url => {
      if (url.endsWith("/session")) return unavailable ? Promise.reject(new TypeError("Offline")) : jsonResponse(signedIn);
      const count = (attempts.get(url) ?? 0) + 1;
      attempts.set(url, count);
      return count < 3 ? unauthorized() : jsonResponse({ ok: true });
    });
    await expect(apiClient.get("/api/tickets")).rejects.toMatchObject({ status: 401 });
    expect(getSessionNotice()?.kind).toBe("unavailable");
    unavailable = false;
    await expect(apiClient.get("/api/tickets")).resolves.toEqual({ ok: true });
    expect(getSessionNotice()).toBeNull();
  });

  it("does not replay an aborted caller or cancel another caller's shared session check", async () => {
    let finish!: (response: Response) => void;
    const pending = new Promise<Response>(resolve => { finish = resolve; });
    const attempts = new Map<string, number>();
    const fetchMock = mockFetch(url => {
      if (url.endsWith("/session")) return pending;
      const count = (attempts.get(url) ?? 0) + 1;
      attempts.set(url, count);
      return count === 1 ? unauthorized() : jsonResponse({ ok: true });
    });
    const controller = new AbortController();
    const cancelled = apiClient.get("/api/one", { signal: controller.signal });
    const aborted = expect(cancelled).rejects.toMatchObject({ name: "AbortError" });
    const remaining = apiClient.get("/api/two");
    await vi.waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/session"))).toHaveLength(1));
    controller.abort();
    await aborted;
    finish(await jsonResponse(signedIn));
    await expect(remaining).resolves.toEqual({ ok: true });
    expect(attempts.get("/api/one")).toBe(1);
    expect(attempts.get("/api/two")).toBe(2);
    expect(getSessionNotice()).toBeNull();
  });

  it("revalidates SSE connection establishment and keeps its event parsing and headers", async () => {
    let attempts = 0;
    const fetchMock = mockFetch(url => url.endsWith("/session") ? jsonResponse(signedIn) : ++attempts === 1 ? unauthorized() : sseResponse(['id: 4\nevent: update\ndata: {"text":"Hello"}\n\n']));
    const onMessage = vi.fn();
    await streamSse("/api/tasks/T-1/events", { onMessage });
    expect(onMessage).toHaveBeenCalledWith({ id: "4", event: "update", data: { text: "Hello" }, retry: undefined });
    const calls = fetchMock.mock.calls.filter(([url]) => String(url).includes("/events"));
    expect(calls).toHaveLength(2);
    expect(new Headers(calls[1][1]?.headers).get("accept")).toBe("text/event-stream");
  });

  it("preserves disabled-auth behavior and public metadata requests", async () => {
    const fetchMock = mockFetch(unauthorized);
    await expect(apiClient.get("/api/meta")).rejects.toMatchObject({ status: 401 });
    vi.stubEnv("VITE_AUTH_ENABLED", "false");
    await expect(apiClient.get("/api/tickets")).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(getSessionNotice()).toBeNull();
  });

  it("FR-6: makes no guessed renewal calls or background timer when the verified provider has no renewal contract", async () => {
    vi.useFakeTimers();
    const fetchMock = mockFetch(() => jsonResponse(signedIn));
    await readCookieSession();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(600_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/auth\/session$/);
  });

  it("bounds a stalled cookie session check to five seconds", async () => {
    vi.useFakeTimers();
    mockFetch((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    }));
    const check = expect(readCookieSession()).rejects.toMatchObject({ name: "SessionCheckError" });
    await vi.advanceTimersByTimeAsync(5_000);
    await check;
    expect(vi.getTimerCount()).toBe(0);
  });
});
