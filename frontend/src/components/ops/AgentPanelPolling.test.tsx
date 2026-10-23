import { QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AgentPanelProvider } from "@/components/ops/AgentPanel";
import { ToastProvider } from "@/components/ui";
import { createTestQueryClient, jsonResponse, meResponse, mockFetch, testUsers } from "@/test/utils";

describe("AgentPanel activity polling", () => {
  it("loads activity once without polling while visible or hidden", async () => {
    let hasRunningTask = false;
    let taskReads = 0;
    const originalVisibility = document.visibilityState;
    const setVisibility = (state: "visible" | "hidden") => Object.defineProperty(document, "visibilityState", { configurable: true, value: state });
    window.sessionStorage.clear();
    mockFetch((url) => {
      if (url.includes("/api/me")) return meResponse(testUsers.demo, "developer");
      if (url.includes("/api/inbox")) return jsonResponse({ items: [], pending: 0 });
      if (url.includes("/api/tasks?status=running")) {
        taskReads += 1;
        return jsonResponse({ items: hasRunningTask ? [{ id: "T-1", createdBy: testUsers.demo }] : [] });
      }
      return jsonResponse({ items: [] });
    });
    setVisibility("visible");
    vi.useFakeTimers();

    try {
      render(
        <QueryClientProvider client={createTestQueryClient()}>
          <MemoryRouter initialEntries={["/tickets"]}>
            <ToastProvider><AgentPanelProvider><div>Tickets body</div></AgentPanelProvider></ToastProvider>
          </MemoryRouter>
        </QueryClientProvider>,
      );
      await act(async () => { for (let index = 0; index < 50; index += 1) await Promise.resolve(); });
      expect(screen.getByText("Tickets body")).toBeInTheDocument();
      expect(taskReads).toBe(1);
      hasRunningTask = true;
      await act(async () => { await vi.advanceTimersByTimeAsync(59_999); });
      expect(taskReads).toBe(1);
      await act(async () => { await vi.advanceTimersByTimeAsync(1); await Promise.resolve(); });
      expect(taskReads).toBe(1);
      await act(async () => { await vi.advanceTimersByTimeAsync(9_999); });
      expect(taskReads).toBe(1);
      await act(async () => { await vi.advanceTimersByTimeAsync(1); await Promise.resolve(); });
      expect(taskReads).toBe(1);

      setVisibility("hidden");
      await act(async () => { document.dispatchEvent(new Event("visibilitychange")); await vi.advanceTimersByTimeAsync(30_000); });
      expect(taskReads).toBe(1);
    } finally {
      vi.useRealTimers();
      Object.defineProperty(document, "visibilityState", { configurable: true, value: originalVisibility });
    }
  });
});
