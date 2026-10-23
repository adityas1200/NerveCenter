import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AgentPanelProvider } from "./AgentPanel";
import { useAskSonic, useCanChat } from "./agentPanelContext";
import { ToastProvider } from "@/components/ui";
import { createTestQueryClient, jsonResponse, meResponse, mockFetch, sseResponse, testUsers } from "@/test/utils";

/** SPEC-tasks-12 FR-5: the panel says what the next message is about, and a cleared selection is not sent. */

const task = { id: "T-9100", type: "adhoc", title: "Sales by payer type", summary: "", status: "running", permission: "policy", context: {}, createdBy: { id: "demo.user", name: "Demo User" }, createdAt: "2026-10-13T09:00:00Z", updatedAt: "2026-10-13T09:00:00Z", sessionId: null, cost: { totalUsd: 0, inputTokens: 0, outputTokens: 0, turns: 0, durationMs: 0, runs: 0 }, pendingApprovalId: null };
const selection = { kind: "board_widget", id: "B-sales/w-payer", title: "Sales by payer type · COMM · units 5", detail: { boardId: "B-sales", boardTitle: "Veltrix sales", widgetId: "w-payer", widgetTitle: "Sales by payer type", widgetType: "chart", filters: { range: "7d" }, point: { label: "COMM", values: { units: 5 } } } };

function stubApi(role: string, created: Array<Record<string, unknown>>) {
  mockFetch((url, init) => {
    if (url.includes("/api/me")) return meResponse(testUsers.demo, role);
    if (url.includes("/api/inbox")) return jsonResponse({ items: [], pending: 0 });
    if (url.endsWith("/api/tasks") && init?.method === "POST") { const body = JSON.parse(String(init.body)); created.push(body); return jsonResponse({ ...task, context: body.context, events: [] }, 201); }
    if (url.includes("/events")) return sseResponse();
    if (url.includes("/api/tasks/T-9100")) return jsonResponse({ ...task, events: [] });
    return jsonResponse({ items: [] });
  });
}

function BoardStub() {
  const askSonic = useAskSonic();
  const canChat = useCanChat();
  return (
    <div>
      <p>{canChat ? "can chat" : "read only"}</p>
      <section data-widget-id="w-payer" aria-label="Sales by payer type">chart</section>
      <button type="button" onClick={() => askSonic(selection, 'Explain COMM · units 5 in "Sales by payer type" and check whether it is right.')}>Ask about the column</button>
    </div>
  );
}

function renderPanel() {
  return render(
    <QueryClientProvider client={createTestQueryClient()}>
      <MemoryRouter initialEntries={["/boards/B-sales"]}>
        <ToastProvider><AgentPanelProvider><Routes><Route path="/boards/:boardId" element={<BoardStub />} /></Routes></AgentPanelProvider></ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("What the next message is about (SPEC-tasks-12 FR-5)", () => {
  afterEach(() => { window.sessionStorage.clear(); });
  // The panel body is code-split and loads on first open; compile it once here so a test waits for behaviour, not the bundler.
  beforeAll(() => import("@/components/ops/AgentPanelBody"), 30_000);

  it("shows the selection as a chip and sends it, with its detail, in the page context", async () => {
    const created: Array<Record<string, unknown>> = [];
    stubApi("developer", created);
    renderPanel();
    expect(await screen.findByText("can chat")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Ask about the column" }));
    const panel = await screen.findByRole("complementary", { name: "Sonic panel" });
    const chip = within(panel).getByTestId("agent-about");
    expect(chip).toHaveTextContent("AboutSales by payer type · COMM · units 5");
    const box = within(panel).getByRole("textbox");
    await waitFor(() => expect(box).toHaveValue('Explain COMM · units 5 in "Sales by payer type" and check whether it is right.'));
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(created).toHaveLength(1));
    expect((created[0].context as { page: { selection: unknown } }).page.selection).toEqual(selection);
  });

  it("a cleared chip is not sent", async () => {
    const created: Array<Record<string, unknown>> = [];
    stubApi("developer", created);
    renderPanel();
    await screen.findByText("can chat");
    fireEvent.click(screen.getByRole("button", { name: "Ask about the column" }));
    const panel = await screen.findByRole("complementary", { name: "Sonic panel" });
    fireEvent.click(within(panel).getByRole("button", { name: "Clear what this message is about" }));
    expect(within(panel).queryByTestId("agent-about")).not.toBeInTheDocument();
    const box = within(panel).getByRole("textbox");
    fireEvent.change(box, { target: { value: "What changed today?" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(created).toHaveLength(1));
    expect((created[0].context as { page: { selection?: unknown } }).page.selection).toBeUndefined();
  });

  it("FR-1: viewers are told they cannot chat, so pages leave their ask actions out", async () => {
    stubApi("viewer", []);
    renderPanel();
    expect(await screen.findByText("read only")).toBeInTheDocument();
  });
});
