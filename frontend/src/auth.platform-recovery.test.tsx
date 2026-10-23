import { screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { jsonResponse, mockFetch, renderWithClient } from "@/test/utils";

afterEach(() => { vi.unstubAllEnvs(); });

it("SPEC-platform-16 FR-5: platform bootstrap and API 401s do not call the cookie SSO service", async () => {
  vi.resetModules();
  vi.stubEnv("VITE_AUTH_MODE", "platform");
  vi.stubEnv("VITE_AUTH_ENABLED", "true");
  const { AuthGate } = await import("./auth");
  const { AppRouter } = await import("@/lib/appRouter");
  const { apiClient } = await import("@/api/client");
  const { getSessionNotice } = await import("@/api/session");
  window.history.replaceState(null, "", "/");
  const fetchMock = mockFetch(url => url.endsWith("/api/me") ? jsonResponse({ user: { id: "platform-user", name: "Platform user" } }) : jsonResponse({ error: "Unauthorized" }, 401));
  renderWithClient(<AppRouter><AuthGate><div>Platform content</div></AuthGate></AppRouter>);
  expect(await screen.findByText("Platform content")).toBeInTheDocument();
  await expect(apiClient.get("/api/protected")).rejects.toMatchObject({ status: 401 });
  expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual(["/api/me", "/api/protected"]);
  expect(getSessionNotice()).toBeNull();
});
