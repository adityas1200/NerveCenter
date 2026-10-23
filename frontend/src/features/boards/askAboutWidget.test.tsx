import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { BoardPage } from "./BoardPage";
import { chartPoint, pointLabel, rowPoint, widgetPrompt, widgetSelection } from "./boardSelection";
import { AgentPanelContext, type AgentPanelState } from "@/components/ops/agentPanelContext";
import { ToastProvider } from "@/components/ui";
import { createTestQueryClient, jsonResponse, mockFetch } from "@/test/utils";

/** SPEC-tasks-12: asking Sonic about a board widget, a chart point or a table row; SPEC-tasks-13 FR-18: the fix marker. */

const AT = "2026-10-13T09:00:00Z";

const board = {
  id: "B-sales", title: "Veltrix sales", description: "", status: "published", owner: { id: "dev", name: "Dev" },
  // A select starts at "all" and the range is always sent: the values the board asks its data for.
  filters: [{ key: "brand", label: "Brand", type: "select", options: ["veltrix", "corvana"], default: "veltrix" }],
  widgets: [
    { id: "w-payer", type: "chart", title: "Sales by payer type", size: "md", note: null, source: { kind: "sql", provider: "databricks", statement: "select payer_type, sum(units) from commercial.gold.veltrix_sales_daily group by 1" }, viz: { xColumn: "payer_type", seriesColumns: ["units"] } },
    { id: "w-rows", type: "table", title: "Latest loads", size: "lg", note: null, source: { kind: "sql", provider: "databricks", statement: "select * from commercial.gold.loads" }, viz: {} },
  ],
  createdAt: AT, updatedAt: AT, publishedAt: AT, views: 3, canEdit: false,
};

const data = {
  boardId: "B-sales",
  filters: { brand: "veltrix" },
  widgets: {
    "w-payer": { columns: ["payer_type", "units"], rows: [["Commercial", 12], ["COMM", 5], ["Medicare", 7]], source: "databricks SQL", at: AT },
    "w-rows": { columns: ["Load", "Rows", "Status"], rows: [["L-1", 1200, "Succeeded"], ["L-2", 0, "Failed"]], source: "databricks SQL", at: AT },
  },
  fixes: { "w-payer": { taskId: "T-1042", proposalId: "FP-1a2b3c4d", title: "Map COMM payer type to Commercial", status: "passed", appliedAt: AT } },
};

function stub(running: unknown[] = []) {
  mockFetch((url) => {
    if (url.includes("/api/me")) return jsonResponse({ user: { id: "dev", name: "Dev" }, role: "developer", permissions: [] });
    if (url.includes("/api/tasks")) return jsonResponse({ items: running });
    if (url.includes("/api/boards/B-sales/data")) return jsonResponse(data);
    if (url.includes("/api/boards/B-sales")) return jsonResponse(board);
    throw new Error(`Unexpected request: ${url}`);
  });
}

function panelState(canChat?: boolean): AgentPanelState {
  return { open: false, setOpen: vi.fn(), toggle: vi.fn(), setSelection: vi.fn(), setScreen: vi.fn(), ask: vi.fn(), ...(canChat === undefined ? {} : { canChat }) };
}

function renderBoard(panel: AgentPanelState) {
  return render(
    <QueryClientProvider client={createTestQueryClient()}>
      <MemoryRouter initialEntries={["/boards/B-sales"]}>
        <ToastProvider><AgentPanelContext.Provider value={panel}><Routes><Route path="/boards/:boardId" element={<BoardPage />} /></Routes></AgentPanelContext.Provider></ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Ask Sonic about a board widget (SPEC-tasks-12)", () => {
  it("FR-1, FR-3, FR-9: the header action selects the widget with the board, the filters on screen and a prefilled question", async () => {
    stub();
    const panel = panelState(true);
    renderBoard(panel);
    const widget = await screen.findByRole("region", { name: "Sales by payer type" });
    fireEvent.click(within(widget).getByRole("button", { name: "Ask Sonic about Sales by payer type" }));
    expect(panel.setSelection).toHaveBeenLastCalledWith({
      kind: "board_widget", id: "B-sales/w-payer", title: "Sales by payer type",
      detail: { boardId: "B-sales", boardTitle: "Veltrix sales", widgetId: "w-payer", widgetTitle: "Sales by payer type", widgetType: "chart", filters: { range: "7d", brand: "all" } },
    });
    // FR-9: the question is typed in, not sent; the person edits it first.
    expect(panel.ask).toHaveBeenLastCalledWith('Explain what "Sales by payer type" shows and check whether it is right.');
  });

  it("FR-2: a picked column pins under the header, asks with the point, and lets go on a second click, the clear button or Escape", async () => {
    stub();
    const panel = panelState(true);
    renderBoard(panel);
    const widget = await screen.findByRole("region", { name: "Sales by payer type" });
    const columns = within(widget).getAllByTestId("chart-pick");
    expect(columns).toHaveLength(3);

    fireEvent.click(columns[1]);
    const pinned = within(widget).getByTestId("picked-point");
    expect(pinned).toHaveTextContent("COMM · units 5");
    fireEvent.click(within(pinned).getByRole("button", { name: "Ask Sonic about this" }));
    expect(panel.setSelection).toHaveBeenLastCalledWith(expect.objectContaining({
      kind: "board_widget", id: "B-sales/w-payer", title: "Sales by payer type · COMM · units 5",
      detail: expect.objectContaining({ widgetId: "w-payer", point: { label: "COMM", values: { units: 5 } } }),
    }));
    expect(panel.ask).toHaveBeenLastCalledWith('Explain COMM · units 5 in "Sales by payer type" and check whether it is right.');

    fireEvent.click(columns[1]);
    expect(within(widget).queryByTestId("picked-point")).not.toBeInTheDocument();
    fireEvent.click(columns[2]);
    fireEvent.click(within(widget).getByRole("button", { name: "Clear the picked point" }));
    expect(within(widget).queryByTestId("picked-point")).not.toBeInTheDocument();
    fireEvent.click(columns[0]);
    expect(within(widget).getByTestId("picked-point")).toHaveTextContent("Commercial · units 12");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(within(widget).queryByTestId("picked-point")).not.toBeInTheDocument();
  });

  it("FR-2: a table row is picked the same way and sent as its cells", async () => {
    stub();
    const panel = panelState(true);
    renderBoard(panel);
    const widget = await screen.findByRole("region", { name: "Latest loads" });
    fireEvent.click(within(widget).getByText("L-2"));
    const pinned = within(widget).getByTestId("picked-point");
    expect(pinned).toHaveTextContent("L-2 · 0 · Failed");
    fireEvent.click(within(pinned).getByRole("button", { name: "Ask Sonic about this" }));
    expect(panel.setSelection).toHaveBeenLastCalledWith(expect.objectContaining({ detail: expect.objectContaining({ widgetId: "w-rows", point: { row: { Load: "L-2", Rows: 0, Status: "Failed" } } }) }));
  });

  it("FR-1: viewers and visitors get no ask actions and cannot pick points", async () => {
    stub();
    renderBoard(panelState(false));
    const widget = await screen.findByRole("region", { name: "Sales by payer type" });
    expect(within(widget).queryByRole("button", { name: /Ask Sonic about/ })).not.toBeInTheDocument();
    expect(within(widget).queryAllByTestId("chart-pick")).toHaveLength(0);
  });

  it("SPEC-tasks-13 FR-18: a fixed widget says so under its title and links the task", async () => {
    stub();
    renderBoard(panelState(true));
    const widget = await screen.findByRole("region", { name: "Sales by payer type" });
    const marker = within(widget).getByTestId("widget-fix");
    expect(marker).toHaveTextContent("Fixed by Sonic · verified · T-1042");
    expect(marker).toHaveAttribute("href", "/tasks/T-1042");
    expect(within(screen.getByRole("region", { name: "Latest loads" })).queryByTestId("widget-fix")).not.toBeInTheDocument();
  });
});

describe("the board while Sonic works (SPEC-boards FR-9)", () => {
  const task = (selection: unknown) => ({ id: "T-1050", type: "adhoc", title: "Explain COMM in Sales by payer type", summary: "", status: "running", permission: "policy", context: { page: { name: "Boards", path: "/boards/B-sales", selection, open: { kind: "board", id: "B-sales", title: "Veltrix sales" } } }, createdBy: { id: "dev", name: "Dev" }, createdAt: AT, updatedAt: AT, cost: { totalUsd: 0, inputTokens: 0, outputTokens: 0, turns: 0, durationMs: 0, runs: 0 } });

  it("says Sonic is looking into the widget it was asked about, not building the board", async () => {
    stub([task({ kind: "board_widget", id: "B-sales/w-payer", title: "Sales by payer type · COMM · units 5", detail: { boardId: "B-sales", widgetId: "w-payer", widgetTitle: "Sales by payer type" } })]);
    renderBoard(panelState(true));
    expect(await screen.findByTestId("board-building")).toHaveTextContent("Sonic is looking into Sales by payer type · Explain COMM in Sales by payer type");
  });

  it("keeps the building words for a change to the board", async () => {
    stub([task({ kind: "board", id: "B-sales", title: "Veltrix sales" })]);
    renderBoard(panelState(true));
    expect(await screen.findByTestId("board-building")).toHaveTextContent("Sonic is building this board");
  });
});

describe("board selection helpers (FR-3)", () => {
  it("labels a bucket with each series and a row with its first cells, cutting long text", () => {
    const point = chartPoint("09/24", [{ name: "Failed", values: [1, 3] }, { name: "Succeeded", values: [9, 12] }], 1);
    expect(point).toEqual({ label: "09/24", values: { Failed: 3, Succeeded: 12 } });
    expect(pointLabel(point)).toBe("09/24 · Failed 3, Succeeded 12");
    const row = rowPoint(["Ticket", "Title", "Rows", "Owner"], ["INC-1", "x".repeat(200), 1200, null]);
    expect(String((row as { row: Record<string, unknown> }).row.Title)).toHaveLength(120);
    expect(pointLabel(rowPoint(["A", "B", "C", "D"], ["a", null, 1500, "d"]))).toBe("a · — · 1,500");
    const selection = widgetSelection({ id: "B-1", title: "Board" }, { id: "w", title: "Widget", type: "table" }, {}, null);
    expect(selection).toEqual({ kind: "board_widget", id: "B-1/w", title: "Widget", detail: { boardId: "B-1", boardTitle: "Board", widgetId: "w", widgetTitle: "Widget", widgetType: "table", filters: {} } });
    expect(widgetPrompt({ title: "Widget" }, null)).toBe('Explain what "Widget" shows and check whether it is right.');
  });
});
