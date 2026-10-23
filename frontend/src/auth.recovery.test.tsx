import { StrictMode } from "react";
import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthGate } from "./auth";
import { authBase, cacheUser } from "./auth-session";
import { apiClient } from "@/api/client";
import { clearSessionNotice, expireCookieSession, getSessionNotice } from "@/api/session";
import { SessionNotice } from "@/components/ops/SessionNotice";
import { ToastProvider } from "@/components/ui/toast";
import { AppRouter } from "@/lib/appRouter";
import { leavePageTo } from "@/lib/browserNav";
import { jsonResponse, mockFetch, renderWithClient } from "@/test/utils";

vi.mock("@/lib/browserNav", () => ({ leavePageTo: vi.fn() }));
const signedIn = { authenticated: true, user: { id: "u", name: "User" } };
const anonymous = { authenticated: false, user: null };
const originalPath = "/p/pilot/monitor?status=Failed#pipeline";
const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(0); });

function open() {
  return renderWithClient(<StrictMode><AppRouter><ToastProvider>
    <SessionNotice />
    <AuthGate><button onClick={() => { void apiClient.get("/api/protected").catch(() => {}); }}>Make request</button></AuthGate>
  </ToastProvider></AppRouter></StrictMode>);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("VITE_AUTH_ENABLED", "true");
  window.history.replaceState(null, "", originalPath);
  sessionStorage.clear();
  clearSessionNotice();
  vi.mocked(leavePageTo).mockClear();
});
afterEach(() => {
  clearSessionNotice();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("SPEC-platform-16 FR-3/FR-4: visible session recovery", () => {
  it("shows one runtime expiry toast before sign-in and returns the SSO button to the original page", async () => {
    let sessions = 0;
    const fetchMock = mockFetch(url => url.endsWith("/session") ? jsonResponse(++sessions === 1 ? signedIn : anonymous) : url.endsWith("/api/meta") ? jsonResponse({ adminContacts: [] }) : jsonResponse({ error: "Unauthorized" }, 401));
    open();
    await flush();
    expect(screen.getByRole("button", { name: "Make request" })).toBeInTheDocument();
    expect(sessions).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: "Make request" }));
    await flush();
    expect(screen.getByText("Your session has expired. Please sign in again.")).toBeVisible();
    expect(window.location.pathname).toBe("/p/pilot/monitor");
    expect(screen.queryByRole("button", { name: "Sign in with SSO" })).not.toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(2999); });
    expect(window.location.pathname).toBe("/p/pilot/monitor");
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(window.location.pathname).toBe("/login");
    expect(screen.getByRole("button", { name: "Sign in with SSO" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Sign in with SSO" }));
    expect(leavePageTo).toHaveBeenCalledWith(`${authBase}/login?redirect=${encodeURIComponent(originalPath)}`);
    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/protected")).toHaveLength(1);
    expect(sessions).toBe(2);
  });

  it.each(["cached", "401"])("renders the expiry toast during %s bootstrap before protected content mounts", async mode => {
    if (mode === "cached") cacheUser(signedIn.user);
    mockFetch(url => url.endsWith("/session") ? jsonResponse(anonymous, mode === "401" ? 401 : 200) : jsonResponse({ adminContacts: [] }));
    open();
    await flush();
    expect(screen.getByText("Your session has expired. Please sign in again.")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Make request" })).not.toBeInTheDocument();
    expect(window.location.pathname).toBe("/p/pilot/monitor");
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(window.location.pathname).toBe("/login");
    expect(screen.getByRole("button", { name: "Sign in with SSO" })).toBeInTheDocument();
    expect(sessionStorage.getItem("nervecenter_requested_path")).toBe(originalPath);
  });

  it("keeps a first-time anonymous visit on the existing sign-in flow without an expiry toast", async () => {
    mockFetch(url => url.endsWith("/session") ? jsonResponse(anonymous) : jsonResponse({ adminContacts: [] }));
    open();
    await flush();
    expect(window.location.pathname).toBe("/login");
    expect(screen.getByRole("button", { name: "Sign in with SSO" })).toBeInTheDocument();
    expect(screen.queryByText("Your session has expired. Please sign in again.")).not.toBeInTheDocument();
    expect(leavePageTo).not.toHaveBeenCalled();
    expect(getSessionNotice()).toBeNull();
  });

  it("shows a retry after a transient bootstrap failure without discarding the cached user or URL", async () => {
    cacheUser(signedIn.user);
    let unavailable = true;
    mockFetch(() => unavailable ? jsonResponse({ error: "Unavailable" }, 503) : jsonResponse(signedIn));
    open();
    await flush();
    expect(screen.getByRole("alert")).toHaveTextContent("Could not verify your session");
    expect(window.location.pathname).toBe("/p/pilot/monitor");
    expect(sessionStorage.getItem("nervecenter_auth_user")).toContain('"id":"u"');
    expect(screen.queryByText("Your session has expired. Please sign in again.")).not.toBeInTheDocument();
    unavailable = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await flush();
    expect(screen.getByRole("button", { name: "Make request" })).toBeInTheDocument();
    expect(getSessionNotice()).toBeNull();
  });

  it("retains notices emitted before the notification host mounts", async () => {
    expireCookieSession();
    mockFetch(() => jsonResponse(anonymous));
    open();
    await flush();
    expect(screen.getByText("Your session has expired. Please sign in again.")).toBeVisible();
  });

  it("does not schedule redirects after the notification host unmounts", async () => {
    mockFetch(() => jsonResponse(anonymous, 401));
    const view = open();
    await flush();
    view.unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
    expect(window.location.pathname).toBe("/p/pilot/monitor");
  });
});
