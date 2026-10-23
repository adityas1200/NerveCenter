import { agentLines, agentToday } from "@/features/overview/agentLines";
import { screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import App from "@/App";
import { ToastProvider } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { jsonResponse, meResponse, mockFetch, renderWithClient, testUsers } from "@/test/utils";

function renderApp(path = "/") { return renderWithClient(<MemoryRouter initialEntries={[path]}><TooltipProvider><ToastProvider><App /></ToastProvider></TooltipProvider></MemoryRouter>); }
const overviewResponse = { generatedAt: "2026-08-25T10:00:00Z", capabilities: { pipelineMonitoring: { available: true, reason: "Connected" }, dqMonitoring: { available: false, reason: "Not configured" }, slaTracking: { available: false, reason: "Not configured" }, upcomingSchedules: { available: false, reason: "Not configured" } }, summary: { totalPipelines: 5, latestRunsSucceeded: 4, failedPipelines: 1, runningPipelines: 0, criticalTickets: 0, pendingApprovals: 0, openHumanTasks: 0, activeWorkflows: 0, activeInvestigations: 0, scheduledPrevious12Hours: 0, scheduledNext12Hours: 0 }, attentionItems: [], attentionScope: "team", pipelineFailures: [], workflowSummary: { total: 0, queued: 0, running: 0, completed: 0, failed: 0, waitingApproval: 0, waitingHuman: 0 }, activeWorkflows: [], ticketSummary: { open: 0, closed: 0, raised: 0, openFromWindow: 0, closedInWindow: 0, byPriority: { p1: 0, p2: 0, p3: 0, p4: 0, other: 0 } }, criticalTickets: [], investigations: { active: 0, unassigned: 1, rcaRunning: 0, rcaComplete: 0 }, scheduleWindow: null, monitors: null, pipelines: [], recentRuns: [] };

describe("NerveCenter shell", () => {
  beforeEach(() => { mockFetch((path) => { if (path.includes("/api/overview/tickets")) return jsonResponse({ ...overviewResponse, dqOpen: 0, agentResolved: { inWindow: 0, pipelines: 0, dataQuality: 0 }, chart: { raised: [], resolved: [], dqResolved: [] } }); if (path.includes("/api/overview/agent")) return jsonResponse({ generatedAt: overviewResponse.generatedAt, today: agentToday([], { from: null, to: null }), lines: agentLines([], { from: null, to: null }), waiting: 0 }); if (path.includes("/api/overview/work")) return jsonResponse({ generatedAt: overviewResponse.generatedAt, items: [], scope: "team" }); if (path.includes("/api/overview/pipelines")) return jsonResponse({ generatedAt: overviewResponse.generatedAt, capability: { available: true }, platform: "databricks", counts: { total: 0, succeeded: 0, failed: 0, missed: 0, paused: 0, other: 0 }, chart: { succeeded: [], failed: [] } }); if (path.includes("/api/overview/data-quality")) return jsonResponse({ generatedAt: overviewResponse.generatedAt, configured: false, summary: { total: 0, passed: 0, warning: 0, failed: 0 } }); if (path.includes("/api/me")) return meResponse(testUsers.demo, "admin"); if (path.includes("/api/monitor")) return jsonResponse({ items: [{ pipelineId: "p1", name: "Revenue daily", platform: "databricks", status: "failed", lastRunId: "failed-run", recentRuns: [{ pipelineId: "p1", runId: "failed-run", status: "failed", ticketAction: "view", ticket: { ticketId: "OPS-1", status: "open" } }], ticket: { ticketId: "OPS-1", number: null, status: "open" }, ticketAction: "view" }], recentRuns: [], workspaceTotal: 1 }); return jsonResponse({ items: [] }); }); });
  it("shows the surviving operations pages in order and nothing from the old control plane", async () => {
    renderApp();
    expect(await screen.findByRole("link", { name: "Pipelines" })).toHaveAttribute("href", "/monitor");
    const nav = screen.getByRole("complementary", { name: "Primary navigation" });
    const labels = Array.from(nav.querySelectorAll("nav a")).map((link) => link.textContent?.trim());
    expect(labels.slice(0, 5)).toEqual(["Overview", "Tickets", "Pipelines", "Data quality", "Boards"]);
    for (const removed of ["Workbench", "Approvals", "AI Curator", "Workflows", "Agents", "Connectors & Tools", "Runs"]) expect(screen.queryByRole("link", { name: removed })).not.toBeInTheDocument();
  });
  it("redirects removed routes to their nearest surviving page", async () => {
    renderApp("/workbench");
    expect(await screen.findByRole("heading", { name: "Tickets" }, { timeout: 5000 })).toBeInTheDocument();
  });
  it("redirects the removed Data Platform route to Pipelines", async () => { renderApp("/data-platform"); expect(await screen.findByRole("heading", { name: "Pipelines" })).toBeInTheDocument(); });
  it("links a failed run to its ticket instead of an investigation state", async () => { renderApp("/monitor"); expect(await screen.findByRole("button", { name: /OPS-1/ })).toBeInTheDocument(); expect(screen.queryByRole("button", { name: /RCA running/i })).not.toBeInTheDocument(); });

  describe("a section turned off in Settings", () => {
    beforeEach(() => {
      mockFetch((path) => {
        if (path.includes("/api/overview/tickets")) return jsonResponse({ ...overviewResponse, dqOpen: 0, agentResolved: { inWindow: 0, pipelines: 0, dataQuality: 0 }, chart: { raised: [], resolved: [], dqResolved: [] } }); if (path.includes("/api/overview/agent")) return jsonResponse({ generatedAt: overviewResponse.generatedAt, today: agentToday([], { from: null, to: null }), lines: agentLines([], { from: null, to: null }), waiting: 0 }); if (path.includes("/api/overview/work")) return jsonResponse({ generatedAt: overviewResponse.generatedAt, items: [], scope: "team" }); if (path.includes("/api/overview/pipelines")) return jsonResponse({ generatedAt: overviewResponse.generatedAt, capability: { available: true }, platform: "databricks", counts: { total: 0, succeeded: 0, failed: 0, missed: 0, paused: 0, other: 0 }, chart: { succeeded: [], failed: [] } }); if (path.includes("/api/overview/data-quality")) return jsonResponse({ generatedAt: overviewResponse.generatedAt, configured: false, summary: { total: 0, passed: 0, warning: 0, failed: 0 } });
        if (path.includes("/api/me")) return meResponse(testUsers.demo, "admin");
        if (path.includes("/api/settings")) return jsonResponse({ operations: { ui: { disabledSections: ["data-quality"] } }, validation: { errors: [], warnings: [] }, mcp: { mcpServers: {} } });
        return jsonResponse({ items: [] });
      });
    });

    it("hides it from the sidebar", async () => {
      renderApp();
      await screen.findByRole("link", { name: "Pipelines" });
      await waitFor(() => expect(screen.queryByRole("link", { name: "Data quality" })).not.toBeInTheDocument());
    });

    it("redirects away if someone opens its URL directly", async () => {
      renderApp("/data-quality");
      expect(await screen.findByRole("heading", { name: "Overview" })).toBeInTheDocument();
    });
  });
});
