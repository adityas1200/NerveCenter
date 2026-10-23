import { QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { useMe } from "./rbac";
import { rememberPlatformMe, takePlatformMe } from "@/auth-session";
import { createTestQueryClient, meResponse, mockFetch, testUsers } from "@/test/utils";

// Under platform auth the sign-in check fetches /api/me; useMe reuses that answer instead of fetching it again.

const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={createTestQueryClient()}>{children}</QueryClientProvider>;
const meCalls = (fetchMock: ReturnType<typeof vi.fn>) => fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/api/me")).length;

describe("useMe and the platform sign-in answer", () => {
  afterEach(() => { takePlatformMe(); vi.unstubAllGlobals(); });

  it("starts from the answer the sign-in check already has, without fetching /api/me", async () => {
    const fetchMock = mockFetch(() => meResponse(testUsers.admin, "admin"));
    rememberPlatformMe({ user: testUsers.demo, role: "developer", permissions: ["tickets.manage"] });
    const { result } = renderHook(() => useMe(), { wrapper });
    expect(result.current.data?.user.id).toBe("demo.user");
    expect(result.current.data?.role).toBe("developer");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(meCalls(fetchMock)).toBe(0);
  });

  it("is handed over once: a later reader with no answer waiting fetches as usual", async () => {
    rememberPlatformMe({ user: testUsers.demo, role: "developer", permissions: [] });
    expect(takePlatformMe()).toBeTruthy();
    const fetchMock = mockFetch(() => meResponse(testUsers.admin, "admin"));
    const { result } = renderHook(() => useMe(), { wrapper });
    await waitFor(() => expect(result.current.data?.user.id).toBe("admin.local"));
    expect(meCalls(fetchMock)).toBe(1);
  });
});
