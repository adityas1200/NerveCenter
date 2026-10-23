import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";
import { AgentPanelProvider } from "./AgentPanel";
import { useAskSonic } from "./agentPanelContext";
import { ToastProvider } from "@/components/ui";
import { createTestQueryClient, jsonResponse, meResponse, mockFetch, sseResponse, testUsers } from "@/test/utils";


const runningTask = (id: string, createdBy: { id: string; name: string }) => ({ id, type: "adhoc", title: "Looking into it", summary: "", status: "running", permission: "policy", context: {}, createdBy, createdAt: "2026-09-25T09:00:00Z", updatedAt: "2026-09-25T09:01:00Z", sessionId: null, cost: { totalUsd: 0, inputTokens: 0, outputTokens: 0, turns: 0, durationMs: 0, runs: 0 }, pendingApprovalId: null });

function stubApi({ running = [] as unknown[], onCreate, onMessage }: { running?: unknown[]; onCreate?: (body: Record<string, unknown>) => void; onMessage?: (body: Record<string, unknown>) => void } = {}) {
  mockFetch((url, init) => {
    if (url.includes("/api/me")) return meResponse(testUsers.demo, "developer");
    if (url.includes("/api/inbox")) return jsonResponse({ items: [], pending: 0 });
    if (url.endsWith("/api/tasks") && init?.method === "POST") { const body = JSON.parse(String(init.body)); onCreate?.(body); return jsonResponse({ ...runningTask("T-9001", { id: "demo.user", name: "Demo User" }), context: body.context, events: [] }, 201); }
    if (url.includes("/api/tasks?status=running")) return jsonResponse({ items: running });
    if (url.includes("/events")) return sseResponse();
    if (url.includes("/api/tasks/T-9001/messages") && init?.method === "POST") { onMessage?.(JSON.parse(String(init.body))); return jsonResponse({ queued: false, task: runningTask("T-9001", { id: "demo.user", name: "Demo User" }) }, 202); }
    // The first reply has finished by the time the reader asks again.
    if (url.includes("/api/tasks/T-9001")) return jsonResponse({ ...runningTask("T-9001", { id: "demo.user", name: "Demo User" }), status: "done", events: [] });
    return jsonResponse({ items: [] });
  });
}

/** A page that hands one pipeline to Sonic the way Pipelines and Data Quality do. */
function PipelinesStub() {
  const askSonic = useAskSonic();
  return (
    <div>
      <button type="button" onClick={() => askSonic({ kind: "pipeline", id: "veltrix-1", title: "veltrix_sales_daily_load" }, "Why did veltrix_sales_daily_load fail? What should I do?")}>Ask about veltrix</button>
      <Link to="/tickets">Go to tickets</Link>
    </div>
  );
}

function renderAt(path: string) {
  const client = createTestQueryClient();
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <ToastProvider>
          <AgentPanelProvider>
            <Routes>
              <Route path="/monitor" element={<PipelinesStub />} />
              <Route path="/tickets" element={<div>Tickets body</div>} />
              <Route path="/tasks" element={<div>Tasks list</div>} />
              <Route path="/tasks/new" element={<div>New task body</div>} />
              <Route path="/tasks/:taskId" element={<div>Task body</div>} />
            </Routes>
          </AgentPanelProvider>
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Sonic pill and panel", () => {
  afterEach(() => { window.sessionStorage.clear(); });
  // The panel body is code-split and loads on first open; compile it once here so a test waits for behaviour, not the bundler.
  beforeAll(() => import("@/components/ops/AgentPanelBody"), 30_000);

  it("shows the pill on list pages but not on /tasks/new or a task page, which have their own composer", async () => {
    stubApi();
    const { unmount } = renderAt("/tasks");
    const pill = screen.getByRole("button", { name: "Ask Sonic" });
    expect(pill).toHaveClass("bg-raised", "border-line");
    fireEvent.click(pill);
    const panel = await screen.findByRole("complementary", { name: "Sonic panel" });
    expect(within(panel).getByRole("button", { name: "Send" })).toBeInTheDocument();
    expect(within(panel).getAllByRole("button").filter((button) => /\?$/.test(button.textContent || "")).length).toBeLessThanOrEqual(4);
    unmount();
    renderAt("/tasks/new");
    expect(screen.getByText("New task body")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ask Sonic" })).not.toBeInTheDocument();
  });

  it("says Sonic is working only when a running task belongs to the reader", async () => {
    stubApi({ running: [runningTask("T-1", { id: "someone.else", name: "Someone Else" })] });
    const { unmount } = renderAt("/tickets");
    await screen.findByText("Tickets body");
    await waitFor(() => expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.some(([url]) => String(url).includes("status=running"))).toBe(true));
    expect(screen.getByRole("button", { name: "Ask Sonic" })).toHaveTextContent("Ask Sonic");
    expect(screen.queryByText("Sonic is working")).not.toBeInTheDocument();
    unmount();
    vi.unstubAllGlobals();

    stubApi({ running: [runningTask("T-2", { id: "demo.user", name: "Demo User" })] });
    renderAt("/tickets");
    expect(await screen.findByText("Sonic is working")).toBeInTheDocument();
  });

  it("a row's Ask Sonic selects the record, sends it as context, and the selection clears on the next page", async () => {
    let created: Record<string, unknown> | null = null;
    let message: Record<string, unknown> | null = null;
    stubApi({ onCreate: (body) => { created = body; }, onMessage: (body) => { message = body; } });
    renderAt("/monitor");
    fireEvent.click(screen.getByRole("button", { name: "Ask about veltrix" }));
    const panel = await screen.findByRole("complementary", { name: "Sonic panel" });
    // Clicking only types the prompt; nothing is sent until the user sends it.
    await waitFor(() => expect(within(panel).getByRole("textbox")).toHaveValue("Why did veltrix_sales_daily_load fail? What should I do?"));
    expect(created).toBeNull();
    fireEvent.click(within(panel).getByRole("button", { name: "Send" }));
    await waitFor(() => expect(created).not.toBeNull());
    expect(created).toMatchObject({ type: "adhoc", prompt: "Why did veltrix_sales_daily_load fail? What should I do?", context: { page: { name: "Pipelines", path: "/monitor", selection: { kind: "pipeline", id: "veltrix-1", title: "veltrix_sales_daily_load" } } } });

    fireEvent.click(screen.getByRole("link", { name: "Go to tickets" }));
    await screen.findByText("Tickets body");
    // The open panel keeps its conversation across pages, so asking from Tickets is a follow-up in the
    // same task; it carries the page the reader is on now, and the selection made on Pipelines is gone.
    created = null;
    fireEvent.change(within(panel).getByRole("textbox"), { target: { value: "What needs attention here?" } });
    fireEvent.click(within(panel).getByRole("button", { name: "Send" }));
    await waitFor(() => expect(message).not.toBeNull());
    expect(created).toBeNull();
    const page = (message as unknown as { context: { page: Record<string, unknown> } }).context.page;
    expect(page).toMatchObject({ name: "Tickets", path: "/tickets" });
    expect(page).not.toHaveProperty("selection");
  });
});
