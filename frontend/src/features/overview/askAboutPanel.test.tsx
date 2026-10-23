import { fireEvent, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AgentPanelContext, type AgentPanelState } from "@/components/ops/agentPanelContext";
import { ToastProvider } from "@/components/ui";
import { OverviewPage } from "@/features/overview/OverviewPage";
import { jsonResponse, meResponse, mockFetch, renderWithClient, testUsers } from "@/test/utils";
import { agentLines, agentToday } from "./agentLines";

/** SPEC-tasks-12 FR-4: "Ask Sonic about this" on the Overview panels, and on a picked chart column. */

const generatedAt = "2026-10-13T09:00:00Z";

function stub() {
  mockFetch((url) => {
    if (url.startsWith("/api/overview/tickets")) return jsonResponse({ generatedAt, ticketSummary: { open: 4, closed: 2, raised: 9, openFromWindow: 1, closedInWindow: 5, byPriority: { p1: 1, p2: 1, p3: 0, p4: 0, other: 0 } }, agentResolved: { total: 1, inWindow: 1, pipelines: 0, dataQuality: 0 }, dqOpen: 0, chart: { raised: [2, 3, 1, 0, 1, 2, 0], resolved: [1, 1, 0, 1, 1, 1, 0], dqResolved: [0, 0, 0, 0, 0, 0, 0] } });
    if (url.startsWith("/api/overview/pipelines")) return jsonResponse({ generatedAt, capability: { available: true, reason: "Connected" }, platform: "databricks", counts: { total: 4, succeeded: 3, failed: 1, missed: 0, paused: 0, other: 0 }, chart: { succeeded: [3, 3, 2, 3, 3, 3, 3], failed: [0, 1, 0, 0, 0, 1, 0] } });
    if (url.startsWith("/api/overview/data-quality")) return jsonResponse({ generatedAt, configured: false, summary: { total: 0, passed: 0, warning: 0, failed: 0 } });
    if (url.startsWith("/api/overview/work")) return jsonResponse({ generatedAt, items: [], scope: "mine" });
    if (url.startsWith("/api/overview/agent")) return jsonResponse({ generatedAt, today: agentToday([], { from: null, to: null }), lines: agentLines([], { from: null, to: null }), waiting: 0 });
    if (url.startsWith("/api/me")) return meResponse(testUsers.demo, "developer");
    return jsonResponse({});
  });
}

function renderOverview(panel: AgentPanelState) {
  return renderWithClient(<MemoryRouter><ToastProvider><AgentPanelContext.Provider value={panel}><OverviewPage /></AgentPanelContext.Provider></ToastProvider></MemoryRouter>);
}

const panelState = (canChat: boolean): AgentPanelState => ({ open: false, setOpen: vi.fn(), toggle: vi.fn(), setSelection: vi.fn(), setScreen: vi.fn(), ask: vi.fn(), canChat });

describe("Ask Sonic about an Overview panel (SPEC-tasks-12 FR-4)", () => {
  it("selects the panel with the period on screen and types a question", async () => {
    stub();
    const panel = panelState(true);
    renderOverview(panel);
    fireEvent.click(await screen.findByRole("button", { name: "Ask Sonic about Pipelines" }));
    expect(panel.setSelection).toHaveBeenLastCalledWith({ kind: "overview_panel", id: "pipelines", title: expect.stringMatching(/^Pipelines · /), detail: expect.objectContaining({ panel: "pipelines", range: expect.any(String), rangeQuery: expect.any(String) }) });
    expect(panel.ask).toHaveBeenLastCalledWith(expect.stringMatching(/^Explain what the Pipelines panel shows .+ and check whether it is right\.$/));
  });

  it("pins a picked column and sends it as the point", async () => {
    stub();
    const panel = panelState(true);
    renderOverview(panel);
    const chart = await screen.findByRole("img", { name: "Pipeline runs succeeded and failed over time" });
    const card = chart.closest("div[class*='rounded']")?.parentElement as HTMLElement;
    const columns = within(card).getAllByTestId("chart-pick");
    fireEvent.click(columns[1]);
    const pinned = within(card).getByTestId("picked-point");
    expect(pinned).toHaveTextContent(/Succeeded 3, Failed runs 1/);
    fireEvent.click(within(pinned).getByRole("button", { name: "Ask Sonic about this" }));
    expect(panel.setSelection).toHaveBeenLastCalledWith(expect.objectContaining({ kind: "overview_panel", id: "pipelines", detail: expect.objectContaining({ point: { label: expect.any(String), values: { Succeeded: 3, "Failed runs": 1 } } }) }));
    expect(panel.ask).toHaveBeenLastCalledWith(expect.stringMatching(/Succeeded 3, Failed runs 1 in the Pipelines panel and check whether it is right\.$/));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(within(card).queryByTestId("picked-point")).not.toBeInTheDocument();
  });

  it("offers nothing to viewers and visitors", async () => {
    stub();
    renderOverview(panelState(false));
    expect(await screen.findByRole("img", { name: "Pipeline runs succeeded and failed over time" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Ask Sonic about/ })).not.toBeInTheDocument();
    expect(screen.queryAllByTestId("chart-pick")).toHaveLength(0);
  });
});
