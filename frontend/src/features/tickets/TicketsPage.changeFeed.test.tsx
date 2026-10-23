import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { changesApi } from "@/api/changes";
import { projectQueryKeyHash, setCurrentProject } from "@/api/projects";
import { jsonResponse } from "@/test/utils";
import { ProjectChangeFeed } from "@/lib/ProjectChangeFeed";
import { ProjectContext, type ProjectContextValue } from "@/lib/projectContext";
import { AgentPanelProvider } from "@/components/ops/AgentPanel";
import { ToastProvider } from "@/components/ui";
import { TicketsPage } from "./TicketsPage";

function projectValue(): ProjectContextValue {
  return { projectId: "project-a", slug: "project-a", project: null, projects: [], isGlobalAdmin: false, unrouted: 0, visitor: false, setProject: vi.fn() };
}

function Harness({ client }: { client: QueryClient }) {
  setCurrentProject("project-a");
  return <QueryClientProvider client={client}><ProjectContext.Provider value={projectValue()}><ProjectChangeFeed><MemoryRouter initialEntries={["/tickets"]}><ToastProvider><AgentPanelProvider><Routes><Route path="/tickets" element={<TicketsPage />} /></Routes></AgentPanelProvider></ToastProvider></MemoryRouter></ProjectChangeFeed></ProjectContext.Provider></QueryClientProvider>;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  setCurrentProject(null);
});

describe("TicketsPage manual refresh (SPEC-platform-manual-refresh FR-1)", () => {
  it("does not subscribe to changes or run fallback polling", async () => {
    vi.useFakeTimers();
    let notifyReady: (() => void) | undefined;
    let endStream: (() => void) | undefined;
    vi.spyOn(changesApi, "stream").mockImplementation(({ onMessage }, signal) => new Promise<void>((resolve, reject) => {
      notifyReady = () => onMessage({ event: "ready", data: {} });
      endStream = resolve;
      signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }));
    let ticketRequests = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.startsWith("/api/tickets?")) ticketRequests += 1;
      if (path.startsWith("/api/tickets?")) return jsonResponse({ items: [], total: 0, meta: { open: 0, highOpen: 0, waitingOnYou: 0, closed: 0, resolved: 0, scoped: 0, options: { priority: [], status: [], assignee: [], source: [] }, people: [] } });
      return jsonResponse({ items: [], configured: false, ready: false });
    }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, queryKeyHashFn: projectQueryKeyHash } } });
    const view = render(<Harness client={client} />);

    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    expect(ticketRequests).toBe(1);
    act(() => notifyReady?.());
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(ticketRequests).toBe(1);

    await act(async () => { endStream?.(); await Promise.resolve(); });
    expect(ticketRequests).toBe(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(ticketRequests).toBe(1);

    expect(changesApi.stream).not.toHaveBeenCalled();
    view.unmount();
    client.clear();
  });
});
