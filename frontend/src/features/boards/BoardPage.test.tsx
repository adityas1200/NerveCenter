import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { BoardPage } from "./BoardPage";
import { AgentPanelContext, type AgentPanelState } from "@/components/ops/agentPanelContext";
import { ToastProvider } from "@/components/ui";
import { createTestQueryClient, jsonResponse, mockFetch } from "@/test/utils";

const AT = "2026-09-25T09:00:00Z";

const board = {
  id: "standup",
  title: "Daily stand-up",
  description: "Pipelines and tickets for the morning call.",
  status: "published",
  owner: { id: "priya", name: "Priya" },
  filters: [
    { key: "range", label: "Period", type: "range", default: "7d" },
    { key: "brand", label: "Brand", type: "select", options: ["veltrix", "corvana"], default: "all", allLabel: "Everything" },
  ],
  widgets: [
    { id: "health", type: "metric", title: "Pipelines", size: "md", note: null, source: { kind: "nervecenter", query: "pipelines.health", params: {} }, viz: { tone: "auto" } },
    { id: "tickets", type: "table", title: "Open tickets", size: "lg", note: null, source: { kind: "nervecenter", query: "tickets.list", params: {} }, viz: { columns: [], statusColumn: "Status", limit: 2 } },
    { id: "runs", type: "chart", title: "Pipeline runs", size: "md", note: "Per day", source: { kind: "nervecenter", query: "pipelines.runs_over_time", params: {} }, viz: { xColumn: "Period", seriesColumns: ["Succeeded", "Failed"], layout: "stacked" } },
    { id: "note", type: "text", title: "About this board", size: "lg", note: null, source: { kind: "text", markdown: "Built by **Priya** for the stand-up." } },
    { id: "rows", type: "metric", title: "Veltrix rows", size: "sm", note: null, source: { kind: "sql", provider: "databricks", statement: "select 1" }, viz: { valueColumn: "rows_loaded", suffix: "rows", tone: "auto" } },
  ],
  createdAt: "2026-09-20T08:00:00Z",
  updatedAt: "2026-09-24T08:00:00Z",
  publishedAt: "2026-09-21T08:00:00Z",
  views: 12,
  canEdit: true,
};

const data = {
  boardId: "standup",
  filters: { range: { preset: "7d", from: "2026-09-18T09:00:00Z", to: AT }, brand: "all" },
  widgets: {
    health: { columns: ["Health", "Count"], rows: [["Healthy", 4], ["Failed", 1], ["Overdue", 0], ["Paused", 2]], source: "Pipelines", total: 7, at: AT },
    tickets: {
      columns: ["Ticket", "Title", "Priority", "Status", "Assignee", "Updated"],
      rows: [
        ["INC-1", "Revenue feed late", "High", "Open", "Asha", "2026-09-25T06:00:00Z"],
        ["INC-2", "Schema drift on gold.sales", "Critical", "In progress", "Unassigned", "2026-09-24T06:00:00Z"],
        ["INC-3", "Duplicate HCP rows", "Low", "Open", "Asha", "2026-09-23T06:00:00Z"],
      ],
      source: "Tickets",
      links: { Ticket: ["/tickets/T-1", "/tickets/T-2", "/tickets/T-3"] },
      at: AT,
    },
    runs: { columns: ["Period", "Succeeded", "Failed"], rows: [["24 Sep", 10, 1], ["25 Sep", 8, 0]], source: "Pipelines", at: AT },
    note: { columns: [], rows: [], markdown: "Built by **Priya** for the stand-up.", at: AT },
    rows: { error: "The SQL in this widget has a syntax error.", at: AT },
  },
};

type Call = { url: string; body: string };

const buildingTask = {
  id: "task-9", type: "adhoc", title: "Add a donut of tickets by priority to Daily stand-up", summary: "", status: "running", permission: "ask",
  context: { page: { name: "Boards", path: "/boards/standup", selection: { kind: "board", id: "standup", title: "Daily stand-up" } } },
  createdBy: { id: "dev", name: "Dev" }, createdAt: AT, updatedAt: AT, cost: { totalUsd: 0, inputTokens: 0, outputTokens: 0, turns: 0, durationMs: 0, runs: 0 },
};

function stub(role: "admin" | "developer" | "viewer", spec: unknown = board, running: unknown[] = []) {
  const calls: Call[] = [];
  mockFetch((url, init) => {
    calls.push({ url, body: typeof init?.body === "string" ? init.body : "" });
    if (url.includes("/api/me")) return jsonResponse({ user: { id: "dev", name: "Dev" }, role, permissions: [] });
    if (url.includes("/api/tasks")) return jsonResponse({ items: running });
    if (url.includes("/api/boards/standup/data")) return jsonResponse(data);
    if (url.includes("/api/boards/standup")) return jsonResponse(spec);
    if (url.includes("/api/boards/private")) return jsonResponse({ error: "This board is a draft that belongs to someone else" }, 403);
    throw new Error(`Unexpected request: ${url}`);
  });
  return calls;
}

function renderBoard(entry = "/boards/standup", panel?: AgentPanelState) {
  const client = createTestQueryClient();
  const routes = <Routes><Route path="/boards/:boardId" element={<BoardPage />} /><Route path="/boards" element={<h1>Boards</h1>} /></Routes>;
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[entry]}>
        <ToastProvider>{panel ? <AgentPanelContext.Provider value={panel}>{routes}</AgentPanelContext.Provider> : routes}</ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("BoardPage", () => {
  it("draws metric, table, chart and text widgets from the computed data", async () => {
    stub("developer");
    renderBoard();
    expect(await screen.findByRole("heading", { name: "Daily stand-up" })).toBeInTheDocument();
    const about = screen.getByRole("region", { name: "About this board" });
    expect(within(about).getByText("Priya")).toBeInTheDocument();
    expect(within(about).getByText("Live · visible to everyone")).toBeInTheDocument();
    expect(within(about).getByTitle("5 widgets")).toHaveTextContent("5Widgets");
    expect(screen.getByRole("link", { name: "Back to Boards" })).toHaveAttribute("href", "/boards");

    // Metric: one cell per row, colour only on a non-zero figure whose label names a state.
    const failed = await screen.findByLabelText("Failed: 1");
    expect(within(failed).getByText("1")).toHaveClass("text-rose-700");
    expect(within(screen.getByLabelText("Healthy: 4")).getByText("4")).toHaveClass("text-emerald-700");
    expect(within(screen.getByLabelText("Overdue: 0")).getByText("0")).toHaveClass("text-ink-1");
    expect(within(screen.getByLabelText("Paused: 2")).getByText("2")).toHaveClass("text-ink-1");
    expect(screen.getByText(/Pipelines · updated/)).toBeInTheDocument();

    // Table: status pills, link cells, relative times, capped rows.
    const table = screen.getByRole("region", { name: "Open tickets" });
    expect(within(table).getByRole("link", { name: "INC-1" })).toHaveAttribute("href", "/tickets/T-1");
    expect(within(table).getByText("In progress")).toBeInTheDocument();
    expect(within(table).getAllByRole("cell").some((cell) => cell.querySelector("time"))).toBe(true);
    expect(within(table).queryByText("INC-3")).not.toBeInTheDocument();
    expect(within(table).getByText("Showing 2 of 3")).toBeInTheDocument();

    // Chart: one series per configured column, legend above, the note in the label row.
    expect(screen.getByRole("img", { name: "Pipeline runs: Succeeded, Failed by Period" })).toBeInTheDocument();
    const chart = screen.getByRole("region", { name: "Pipeline runs" });
    expect(within(chart).getByText("Succeeded")).toBeInTheDocument();
    expect(within(chart).getByText("Per day")).toBeInTheDocument();

    // Text: markdown.
    expect(screen.getByText(/for the stand-up\./)).toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: "Period" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Filter by Brand" })).toHaveTextContent("Everything");
  });

  it("refetches with the new range when a filter changes and stops counting views", async () => {
    const calls = stub("developer");
    renderBoard("/boards/standup?brand=veltrix");
    await screen.findByLabelText("Failed: 1");
    const first = calls.find((call) => call.url.includes("/data"));
    expect(first?.url).toBe("/api/boards/standup/data");
    expect(first?.body).toContain('"range":"7d"');
    expect(first?.body).toContain('"brand":"veltrix"');

    fireEvent.click(screen.getByRole("radio", { name: "Last 24 h" }));
    await waitFor(() => expect(calls.filter((call) => call.url.includes("/data"))).toHaveLength(2));
    const second = calls.filter((call) => call.url.includes("/data"))[1];
    expect(second.url).toBe("/api/boards/standup/data?view=0");
    expect(second.body).toContain('"range":"24h"');
    expect(second.body).toContain('"brand":"veltrix"');
  });

  it("shows a widget's error sentence and lets a builder hand it to Sonic", async () => {
    stub("developer");
    const panel: AgentPanelState = { open: false, setOpen: vi.fn(), toggle: vi.fn(), setSelection: vi.fn(), setScreen: vi.fn(), ask: vi.fn() };
    renderBoard("/boards/standup", panel);
    const widget = await screen.findByRole("region", { name: "Veltrix rows" });
    expect(within(widget).getByText("The SQL in this widget has a syntax error.")).toBeInTheDocument();
    fireEvent.click(within(widget).getByRole("button", { name: "Ask Sonic to fix it" }));
    expect(panel.setSelection).toHaveBeenLastCalledWith({ kind: "board", id: "standup", title: "Daily stand-up" });
    expect(panel.ask).toHaveBeenLastCalledWith('Widget "Veltrix rows" on board "Daily stand-up" shows an error: The SQL in this widget has a syntax error. Fix it.');

    // No "Build with Sonic" header button: the floating Ask Sonic panel covers it.
    expect(screen.queryByRole("button", { name: "Build with Sonic" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "More actions" })).toBeInTheDocument();
    expect(panel.setScreen).toHaveBeenCalledWith(expect.objectContaining({ open: { kind: "board", id: "standup", title: "Daily stand-up" }, summary: "Daily stand-up: 5 widgets, published" }));
    expect(screen.queryByTestId("board-building")).not.toBeInTheDocument();
  });

  it("lets a builder hand one widget to Sonic from the edit-mode menu without sending a prompt", async () => {
    stub("developer");
    const panel: AgentPanelState = { open: false, setOpen: vi.fn(), toggle: vi.fn(), setSelection: vi.fn(), setScreen: vi.fn(), ask: vi.fn() };
    renderBoard("/boards/standup", panel);
    await screen.findByLabelText("Failed: 1");
    await userEvent.click(screen.getByRole("button", { name: "More actions" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Edit layout" }));
    await userEvent.click(screen.getByRole("button", { name: "More actions for Pipelines" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Ask Sonic to change this" }));
    expect(panel.setSelection).toHaveBeenLastCalledWith({ kind: "board", id: "standup", title: 'Daily stand-up · widget "Pipelines"' });
    expect(panel.setOpen).toHaveBeenLastCalledWith(true);
    expect(panel.ask).not.toHaveBeenCalled();
  });

  it("shows that Sonic is building the board when a running task points at it, and waits for manual refresh", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const calls = stub("developer", board, [buildingTask]);
      renderBoard();
      const banner = await screen.findByTestId("board-building");
      expect(banner).toHaveTextContent("Sonic is building this board · Add a donut of tickets by priority to Daily stand-up");
      expect(within(banner).getByRole("link", { name: "Open task" })).toHaveAttribute("href", "/tasks/task-9");
      await screen.findByLabelText("Failed: 1");
      const before = calls.filter((call) => call.url.includes("/data")).length;
      await vi.advanceTimersByTimeAsync(4_500);
      await waitFor(() => expect(calls.filter((call) => call.url.includes("/data")).length).toBe(before));
      await waitFor(() => expect(calls.filter((call) => call.url.includes("/api/boards/standup") && !call.url.includes("/data")).length).toBe(1));
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignores running tasks that have nothing to do with this board", async () => {
    stub("developer", board, [{ ...buildingTask, title: "Triage INC-7", context: { page: { name: "Tickets", path: "/tickets" } } }]);
    renderBoard();
    await screen.findByLabelText("Failed: 1");
    expect(screen.queryByTestId("board-building")).not.toBeInTheDocument();
  });

  it("gives viewers the filters but no menu, no Build with Sonic and no fix link", async () => {
    stub("viewer", { ...board, canEdit: false });
    renderBoard();
    await screen.findByLabelText("Failed: 1");
    expect(screen.queryByRole("button", { name: "More actions" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Build with Sonic" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ask Sonic to fix it" })).not.toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: "Period" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Filter by Brand" })).toBeInTheDocument();
  });

  it("tells a viewer when a draft belongs to someone else", async () => {
    stub("viewer");
    renderBoard("/boards/private");
    expect(await screen.findByRole("alert")).toHaveTextContent("This board is a draft that belongs to someone else");
  });
});
