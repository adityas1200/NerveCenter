import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { BoardsPage, NEW_BOARD_PROMPT } from "./BoardsPage";
import { AgentPanelContext, type AgentPanelState } from "@/components/ops/agentPanelContext";
import { ToastProvider } from "@/components/ui";
import { createTestQueryClient, jsonResponse, mockFetch } from "@/test/utils";

const boards = [
  { id: "standup", title: "Commercial data ops daily", description: "Pipelines, tickets and data quality for the daily stand-up.", status: "published", owner: { id: "priya", name: "Priya" }, widgets: 5, filters: 2, createdAt: "2026-09-20T08:00:00Z", updatedAt: "2026-09-24T08:00:00Z", publishedAt: "2026-09-21T08:00:00Z", views: 12, canEdit: true },
  { id: "veltrix", title: "Veltrix loads", description: "", status: "draft", owner: { id: "dev", name: "Dev" }, widgets: 1, filters: 1, createdAt: "2026-09-25T08:00:00Z", updatedAt: "2026-09-25T08:00:00Z", publishedAt: null, views: 0, canEdit: true },
];

function stub(role: "admin" | "developer" | "viewer", items: unknown[] = boards) {
  const fetchMock = mockFetch((url) => {
    if (url.includes("/api/me")) return jsonResponse({ user: { id: "dev", name: "Dev" }, role, permissions: [] });
    if (url.includes("/api/boards")) return jsonResponse({ items });
    throw new Error(`Unexpected request: ${url}`);
  });
  return fetchMock;
}

function renderBoards(panel?: AgentPanelState) {
  const client = createTestQueryClient();
  const page = panel ? <AgentPanelContext.Provider value={panel}><BoardsPage /></AgentPanelContext.Provider> : <BoardsPage />;
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={["/boards"]}><ToastProvider>{page}</ToastProvider></MemoryRouter></QueryClientProvider>);
}

describe("BoardsPage", () => {
  it("lists published boards and drafts as cards that open the board", async () => {
    stub("admin");
    renderBoards();
    expect(await screen.findByRole("region", { name: "Published" })).toBeInTheDocument();
    expect(screen.queryByText("1 published · 1 draft")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Boards" })).toBeInTheDocument();

    const published = screen.getByRole("region", { name: "Published" });
    const card = within(published).getByRole("link", { name: /Commercial data ops daily/ });
    expect(card).toHaveAttribute("href", "/boards/standup");
    expect(within(card).getByTitle("5 widgets")).toHaveTextContent("5Widgets");
    expect(within(card).getByText("Priya")).toBeInTheDocument();
    expect(within(card).getByText(/^Updated/)).toBeInTheDocument();
    expect(within(published).queryByText("Draft")).not.toBeInTheDocument();

    // Admins see every draft under "Drafts"; the chip marks it.
    const drafts = screen.getByRole("region", { name: "Drafts" });
    expect(within(drafts).getByRole("link", { name: /Veltrix loads/ })).toHaveAttribute("href", "/boards/veltrix");
    expect(within(drafts).getByText("Draft")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New board" })).toBeInTheDocument();
  });

  it("narrows both sections to boards whose title or description match the search", async () => {
    stub("admin");
    renderBoards();
    await screen.findByRole("region", { name: "Published" });
    fireEvent.change(screen.getByRole("textbox", { name: "Search boards" }), { target: { value: "veltrix" } });
    expect(screen.queryByRole("link", { name: /Commercial data ops daily/ })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Veltrix loads/ })).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Published" })).getByText("No published boards match")).toBeInTheDocument();
  });

  it("calls the drafts section 'Your drafts' for a developer", async () => {
    stub("developer");
    renderBoards();
    expect(await screen.findByRole("region", { name: "Your drafts" })).toBeInTheDocument();
  });

  it("gives viewers no New board button and a plain empty state", async () => {
    stub("viewer", []);
    renderBoards();
    expect(await screen.findByText("Nothing published yet")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New board" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Build one with Sonic/ })).not.toBeInTheDocument();
  });

  it("starts a new board as a prompt to Sonic", async () => {
    stub("developer");
    const panel: AgentPanelState = { open: false, setOpen: vi.fn(), toggle: vi.fn(), setSelection: vi.fn(), setScreen: vi.fn(), ask: vi.fn() };
    renderBoards(panel);
    fireEvent.click(await screen.findByRole("button", { name: "New board" }));
    expect(panel.setSelection).toHaveBeenLastCalledWith({ kind: "boards", id: "new" });
    expect(panel.ask).toHaveBeenLastCalledWith(NEW_BOARD_PROMPT);
    expect(panel.setScreen).toHaveBeenCalledWith(expect.objectContaining({ visible: ["Commercial data ops daily (standup)", "Veltrix loads (veltrix)"], summary: "2 boards: 1 published, 1 draft" }));
  });
});
