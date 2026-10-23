import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AgentPanelProvider } from "./AgentPanel";
import { ToastProvider } from "@/components/ui";
import { createTestQueryClient, jsonResponse, meResponse, mockFetch, testUsers } from "@/test/utils";

// The panel body is split out of the app's first download: it mounts on first open and stays mounted after.

function stubApi() {
  return mockFetch((url) => {
    if (url.includes("/api/me")) return meResponse(testUsers.demo, "developer");
    if (url.includes("/api/inbox")) return jsonResponse({ items: [], pending: 0 });
    return jsonResponse({ items: [] });
  });
}

function renderAt(path: string) {
  return render(
    <QueryClientProvider client={createTestQueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <ToastProvider>
          <AgentPanelProvider>
            <Routes>
              <Route path="/tickets" element={<div>Tickets body</div>} />
              <Route path="/tasks/:taskId" element={<div>Task body</div>} />
            </Routes>
          </AgentPanelProvider>
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const fetchedUrls = () => (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.map(([url]) => String(url));

describe("Sonic panel loading", () => {
  afterEach(() => { window.sessionStorage.clear(); });
  beforeAll(() => import("@/components/ops/AgentPanelBody"), 30_000);

  it("mounts nothing of the panel until it is first opened, then keeps it when closed", async () => {
    stubApi();
    renderAt("/tickets");
    await screen.findByText("Tickets body");
    expect(document.querySelector('aside[aria-label="Sonic panel"]')).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Ask Sonic" }));
    const panel = await screen.findByRole("complementary", { name: "Sonic panel" });
    fireEvent.click(within(panel).getByRole("button", { name: "Close Sonic" }));
    // Closed, it stays mounted (hidden), so its conversation and scroll survive reopening.
    // A hidden element has no accessible name, so look it up by its label attribute.
    expect(document.querySelector('aside[aria-label="Sonic panel"]')).toHaveAttribute("aria-hidden", "true");
  });

  it("the pill asks for running tasks on list pages but not on task pages, where it is hidden", async () => {
    stubApi();
    const { unmount } = renderAt("/tasks/T-1");
    await screen.findByText("Task body");
    await waitFor(() => expect(fetchedUrls().some((url) => url.includes("/api/me"))).toBe(true));
    expect(fetchedUrls().some((url) => url.includes("status=running"))).toBe(false);
    unmount();
    vi.unstubAllGlobals();

    stubApi();
    renderAt("/tickets");
    await waitFor(() => expect(fetchedUrls().some((url) => url.includes("status=running"))).toBe(true));
  });
});
