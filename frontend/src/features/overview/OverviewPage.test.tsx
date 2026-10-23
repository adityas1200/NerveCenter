import { agentLines, agentToday } from "./agentLines";
import type { Task } from "@/api/tasks";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { OverviewPage } from "@/features/overview/OverviewPage";
import { ToastProvider } from "@/components/ui";
import { jsonResponse, meResponse, mockFetch, renderWithClient, testUsers } from "@/test/utils";

const overview = {
  generatedAt: "2026-08-20T05:00:00Z",
  capabilities: {
    pipelineMonitoring: { available: true, reason: "Pipeline platform connected" },
    dqMonitoring: { available: false, reason: "DQ source is not configured" },
    slaTracking: { available: false, reason: "SLA policy is not configured" },
    upcomingSchedules: { available: true, reason: "1 enabled scheduled workflow discovered" },
  },
  summary: { totalPipelines: 4, latestRunsSucceeded: 3, failedPipelines: 1, failedMonitors: 0, runningPipelines: 0, healthyPipelines: 3, overduePipelines: 0, pausedPipelines: 0, criticalTickets: 1, pendingApprovals: 1, openHumanTasks: 0, activeWorkflows: 1, activeInvestigations: 1, scheduledPrevious12Hours: 1, scheduledNext12Hours: 1 },
  attentionItems: [
    { id: "approval:approval-1", kind: "approval", title: "Approval waiting", detail: "retrigger_pipeline · Review required", href: "/workbench/OPS-42", status: "pending approval", priority: "critical", updatedAt: "2026-08-20T05:00:00Z", ticketId: "OPS-42", rank: 0 },
    { id: "ticket:OPS-43", kind: "ticket", title: "Duplicate keys in fact table", detail: "OPS-43 · Unassigned", href: "/tickets/OPS-43", status: "open", priority: "high", owner: null, updatedAt: "2026-08-20T04:00:00Z", ticketId: "OPS-43", rank: 12 },
  ],
  attentionScope: "mine",
  pipelineFailures: [{ pipelineId: "p1", name: "Revenue daily", status: "failed", summary: "Latest run failed", ticketId: "OPS-42", investigationStatus: "rca_running" }],
  workflowSummary: { total: 1, queued: 0, running: 0, completed: 0, failed: 0, waitingApproval: 1, waitingHuman: 0 },
  activeWorkflows: [],
  ticketSummary: { open: 1, closed: 2, raised: 3, openFromWindow: 1, closedInWindow: 2, byPriority: { p1: 1, p2: 0, p3: 0, p4: 0, other: 0 } },
  criticalTickets: [{ ticketId: "OPS-42", title: "Revenue pipeline failure", priority: "critical", status: "open", createdAt: "2026-08-20T04:45:00Z" }],
  investigations: { active: 1, unassigned: 0, rcaRunning: 1, rcaComplete: 0 },
  scheduleWindow: null,
  monitors: null,
  pipelines: [{ pipelineId: "p1", name: "Revenue daily", platform: "databricks", status: "failed" }],
  recentRuns: [],
};

const tickets = { items: [
  { ticketId: "OPS-42", title: "Revenue pipeline failure", priority: "critical", status: "open", createdAt: new Date(Date.now() - 3600_000).toISOString() },
  { ticketId: "OPS-40", title: "Older", priority: "low", status: "closed", createdAt: new Date(Date.now() - 20 * 3600_000).toISOString(), closedAt: new Date(Date.now() - 2 * 3600_000).toISOString() },
] };

const monitor = { items: [], recentRuns: [
  { runId: "r1", pipelineId: "p1", status: "failed", startTime: new Date(Date.now() - 3600_000).toISOString() },
  { runId: "r2", pipelineId: "p2", status: "healthy", startTime: new Date(Date.now() - 7200_000).toISOString() },
] };

function route(url: string) {
  if (url.startsWith("/api/overview/tickets")) return jsonResponse({ generatedAt: overview.generatedAt, ticketSummary: overview.ticketSummary, agentResolved: { total: 0, inWindow: 0, pipelines: 0, dataQuality: 0 }, dqOpen: 0, chart: { raised: [1], resolved: [1], dqResolved: [0] } });
  if (url.startsWith("/api/overview/pipelines")) return jsonResponse({ generatedAt: overview.generatedAt, capability: overview.capabilities.pipelineMonitoring, platform: "databricks", counts: { total: 4, succeeded: 3, failed: 1, missed: 0, paused: 0, other: 0 }, chart: { succeeded: [1], failed: [1] } });
  if (url.startsWith("/api/overview/data-quality")) return jsonResponse({ generatedAt: overview.generatedAt, configured: false, summary: { total: 0, passed: 0, warning: 0, failed: 0 } });
  if (url.startsWith("/api/overview/work")) return jsonResponse({ generatedAt: overview.generatedAt, items: overview.attentionItems.map(item => ({ ...item, title: item.ticketId === "OPS-42" ? "Revenue pipeline failure" : item.title })), scope: "mine" });
  if (url.startsWith("/api/overview/agent")) return jsonResponse({ generatedAt: overview.generatedAt, today: agentToday([], { from: null, to: null }), lines: agentLines([], { from: null, to: null }), waiting: 1 });
  if (url.startsWith("/api/tickets?status=all")) return jsonResponse(tickets);
  if (url.startsWith("/api/monitor?")) return jsonResponse(monitor);
  if (url.startsWith("/api/me")) return meResponse(testUsers.demo, "admin");
  return jsonResponse({});
}

function renderPage() {
  return renderWithClient(<MemoryRouter><ToastProvider><OverviewPage /></ToastProvider></MemoryRouter>);
}

const overviewCalls = (fetchMock: ReturnType<typeof vi.fn>) => fetchMock.mock.calls.map(([input]) => String(input)).filter((url) => url.startsWith("/api/overview"));

describe("OverviewPage", () => {
  afterEach(() => { try { window.localStorage?.clear(); } catch { /* jsdom without storage */ } });

  it("SPEC-platform-16 FR-1: moves independent timestamps beside the range picker without extra reads", async () => {
    const times = ["agent", "tickets", "pipelines", "data-quality", "work"].map((group, index) => ({ group, time: new Date(Date.now() - (index + 1) * 60_000).toISOString() }));
    const fetchMock = mockFetch(async url => {
      const response = await route(url);
      const item = times.find(({ group }) => url.startsWith(`/api/overview/${group}`));
      return item ? jsonResponse({ ...await response.json(), generatedAt: item.time }) : response;
    });
    renderPage();
    const updates = await screen.findByLabelText("Section update times");
    await waitFor(() => expect(updates.querySelectorAll("time")).toHaveLength(5));
    expect(updates.closest("[data-list-toolbar]")).toContainElement(screen.getByRole("radio", { name: "Last 24 h" }));
    expect(Array.from(updates.querySelectorAll("time"), time => time.dateTime)).toEqual(times.map(item => item.time));
    for (const label of ["Sonic activity", "Tickets", "Pipelines", "Data quality", "Your work"]) {
      expect(within(screen.getByRole("region", { name: label })).queryByText(/^Updated/)).not.toBeInTheDocument();
    }
    expect(overviewCalls(fetchMock)).toHaveLength(5);
  });

  it("page-auto-refresh FR-3/4: refreshes only its five groups and waits a full interval after failure", async () => {
    vi.useFakeTimers();
    try {
      let fail = false;
      const fetchMock = mockFetch(url => fail && url.startsWith("/api/overview/tickets") ? jsonResponse({ error: "Unavailable" }, 503) : route(url));
      const view = renderPage();
      await act(async () => { await vi.advanceTimersByTimeAsync(100); });
      expect(overviewCalls(fetchMock)).toHaveLength(5);
      expect(screen.getByRole("button", { name: "Refresh" })).toBeEnabled();
      fetchMock.mockClear();
      fail = true;
      await act(async () => { await vi.advanceTimersByTimeAsync(301_000); });
      expect(fetchMock).toHaveBeenCalledTimes(5);
      expect(overviewCalls(fetchMock)).toHaveLength(5);
      expect(screen.getByRole("alert")).toHaveTextContent("Could not refresh Tickets");
      await act(async () => { await vi.advanceTimersByTimeAsync(298_000); });
      expect(fetchMock).toHaveBeenCalledTimes(5);
      fail = false;
      await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
      expect(fetchMock).toHaveBeenCalledTimes(10);
      view.unmount();
      await act(async () => { await vi.advanceTimersByTimeAsync(600_000); });
      expect(fetchMock).toHaveBeenCalledTimes(10);
    } finally { vi.useRealTimers(); }
  });

  it("renders completed groups while a slow group shows a skeleton, then refreshes without overlapping", async () => {
    let release: (() => void) | undefined;
    let hold = true;
    const fetchMock = mockFetch(async url => {
      if (url.startsWith("/api/overview/pipelines") && hold) await new Promise<void>(resolve => { release = resolve; });
      return route(url);
    });
    renderPage();
    await screen.findByRole("link", { name: "Revenue pipeline failure" });
    expect(screen.getByRole("region", { name: "Pipelines" })).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("link", { name: "Open tickets: 1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Refresh" })).toBeDisabled();
    hold = false;
    await act(async () => release?.());
    await waitFor(() => expect(screen.getByRole("button", { name: "Refresh" })).not.toBeDisabled());
    hold = true;
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(overviewCalls(fetchMock)).toHaveLength(10));
    expect(screen.getByRole("link", { name: "Succeeded: 3 of 4" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Pipelines" })).toHaveAttribute("aria-busy", "true");
    hold = false;
    await act(async () => release?.());
    await waitFor(() => expect(screen.getByRole("button", { name: "Refresh" })).not.toBeDisabled());
  });

  it("retains the last successful section on refresh failure without retrying automatically", async () => {
    let fail = false;
    const fetchMock = mockFetch(url => fail && url.startsWith("/api/overview/tickets") ? jsonResponse({ error: "Unavailable" }, 503) : route(url));
    renderPage();
    await screen.findByRole("link", { name: "Revenue pipeline failure" });
    await waitFor(() => expect(screen.getByRole("button", { name: "Refresh" })).not.toBeDisabled());
    fail = true;
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not refresh Tickets");
    expect(screen.getByRole("link", { name: "Open tickets: 1" })).toBeInTheDocument();
    expect(overviewCalls(fetchMock).filter(url => url.includes("/tickets?"))).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Try again" })).toBeEnabled();
  });

  it("shows one panel per domain with three linked numbers and a chart, then the work that needs this person", async () => {
    const fetchMock = mockFetch(route);
    renderPage();

    await screen.findByRole("link", { name: "Revenue pipeline failure" });

    const headings = screen.getAllByRole("heading", { level: 2 }).map((node) => node.textContent);
    expect(headings).toEqual(["Tickets", "Pipelines", "Data quality", "Your work"]);

    expect(screen.getByRole("link", { name: "Open tickets: 1" })).toHaveAttribute("href", "/tickets");
    expect(screen.getByRole("link", { name: "High priority open: 1" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Waiting on you: 1" })).toHaveAttribute("href", "/inbox");
    expect(screen.getByRole("link", { name: "Resolved: 2 in the last 24 hours" })).toHaveAttribute("href", "/tickets?scope=closed&range=24h");
    expect(screen.getByText("3 raised and 2 resolved in the last 24 hours")).toBeInTheDocument();

    // The pipeline tiles are one rule and add up to the total, in business words, each with a plain explanation.
    expect(screen.getByRole("link", { name: "Succeeded: 3 of 4" })).toHaveAttribute("href", "/monitor?status=Succeeded&range=24h");
    expect(screen.getByRole("link", { name: "Failed: 1 of 4" })).toHaveAttribute("href", "/monitor?status=Failed&range=24h");
    expect(screen.getByRole("link", { name: "Missed: 0 of 4" })).toHaveAttribute("href", "/monitor?status=Missed&range=24h");
    expect(screen.getByRole("link", { name: "Paused: 0 of 4" })).toHaveAttribute("href", "/monitor?status=Paused&range=24h");
    expect(within(screen.getByRole("link", { name: "Missed: 0 of 4" })).getByRole("img", { name: /scheduled run that did not start on time/ })).toBeInTheDocument();
    expect(screen.queryByText("Healthy")).not.toBeInTheDocument();
    expect(screen.queryByText("Overdue")).not.toBeInTheDocument();

    // The agent's credit already sits in the "Fixed with Sonic" chip below each chart, so the trend
    // charts plot only the two dominant series (raised/resolved, succeeded/failed) instead of adding
    // a Sonic bar that is usually too small next to them to read.
    expect(await screen.findByRole("img", { name: "Tickets raised and resolved over time" })).toBeInTheDocument();
    expect(await screen.findByRole("img", { name: "Pipeline runs succeeded and failed over time" })).toBeInTheDocument();

    // The agent's credit is tickets, not pipelines, so it sits in the agent line under each panel rather than as a fifth tile.
    const fixed = screen.getAllByRole("link", { name: /^Fixed with Sonic: / });
    expect(fixed.map((link) => link.getAttribute("href"))).toEqual([
      "/tickets?scope=closed&resolved=sonic&range=24h",
      "/tickets?scope=closed&resolved=sonic&kind=pipeline&range=24h",
    ]);
    expect(fixed.map((link) => link.getAttribute("aria-label"))).toEqual(["Fixed with Sonic: 0 of 2 resolved", "Fixed with Sonic: 0 tickets in the last 24 hours"]);
    expect(screen.queryByText(/Resolved with Sonic/)).not.toBeInTheDocument();
    for (const link of fixed) expect(link.closest("[data-testid=agent-line]")).not.toBeNull();

    expect(screen.getByText("No result table set up")).toBeInTheDocument();
    expect(screen.getByText("Not set up")).toBeInTheDocument();
    expect(screen.queryByText("Not connected")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Set up" })).toHaveAttribute("href", "/data-quality");

    const work = screen.getAllByRole("table")[0];
    expect(within(work).getByText("Needs your approval")).toBeInTheDocument();
    expect(within(work).getByText("No owner yet")).toBeInTheDocument();
    expect(within(work).getByRole("button", { name: "Assign to me" })).toBeInTheDocument();
    expect(within(work).getByRole("link", { name: "Review" })).toHaveAttribute("href", "/workbench/OPS-42");

    expect(screen.queryByText(/Team queue/)).not.toBeInTheDocument();
    expect(overviewCalls(fetchMock)).toHaveLength(5);
    expect(overviewCalls(fetchMock)[0]).toMatch(/^\/api\/overview\/tickets\?from=/);
    expect(fetchMock.mock.calls.some(([url]) => String(url).startsWith("/api/tickets?"))).toBe(false);
  });

  it("shows the Sonic today strip: finished, working now and needs you as links, then the latest task", async () => {
    const now = Date.now();
    const at = (minutesAgo: number) => new Date(now - minutesAgo * 60_000).toISOString();
    const task = (id: string, title: string, status: string, minutesAgo: number) => ({ id, type: "adhoc", title, summary: "", status, permission: "policy", context: {}, createdBy: { id: "demo.user", name: "Demo User" }, createdAt: at(minutesAgo + 5), updatedAt: at(minutesAgo), cost: { totalUsd: 0, inputTokens: 0, outputTokens: 0, turns: 0, durationMs: 0, runs: 1 } });
    const tasks = { items: [
      task("T-1", "Revenue daily failure", "done", 30),
      task("T-2", "Weekly ticket review", "done", 120),
      task("T-3", "Check null region codes", "running", 4),
      task("T-4", "Old report", "done", 3 * 24 * 60),
    ] };
    const inbox = { items: [
      { id: "a-1", kind: "approval", status: "pending", taskId: "T-3", title: "Waiting for approval: repair job", createdAt: at(2), updatedAt: at(2) },
      { id: "n-1", kind: "notification", status: "pending", taskId: "T-1", title: "Task finished", createdAt: at(30), updatedAt: at(30) },
    ], pending: 1 };
    mockFetch((url) => {
      if (url.startsWith("/api/overview/agent")) { const bounds = { from: new Date(now - 86400_000).toISOString(), to: null }; return jsonResponse({ generatedAt: overview.generatedAt, today: agentToday(tasks.items as Task[], bounds), lines: agentLines(tasks.items as Task[], bounds), waiting: inbox.pending }); }
      if (url.startsWith("/api/inbox")) return jsonResponse(inbox);
      return route(url);
    });
    renderPage();
    await screen.findByRole("link", { name: "Revenue pipeline failure" });

    const strip = screen.getByTestId("agent-today");
    expect(within(strip).getByRole("link", { name: "finished: 2" })).toHaveAttribute("href", "/tasks?status=done");
    expect(within(strip).getByRole("link", { name: "working now: 1" })).toHaveAttribute("href", "/tasks?status=running");
    expect(await within(strip).findByRole("link", { name: "waiting on you: 1" })).toHaveAttribute("href", "/inbox");
    expect(within(strip).getByRole("link", { name: "Check null region codes" })).toHaveAttribute("href", "/tasks/T-3");
    expect(strip).toHaveTextContent(/Last: Check null region codes · 4m ago/);
    expect(strip.querySelector("[data-state=thinking]")).not.toBeNull();
    expect(within(strip).queryByText("No tasks in this period")).not.toBeInTheDocument();
  });

  it("says when Sonic has not run anything in the period and keeps the numbers quiet at zero", async () => {
    mockFetch((url) => {
      if (url.startsWith("/api/overview/agent")) return jsonResponse({ generatedAt: overview.generatedAt, today: agentToday([], { from: null, to: null }), lines: agentLines([], { from: null, to: null }), waiting: 0 });
      if (url.startsWith("/api/inbox")) return jsonResponse({ items: [], pending: 0 });
      return route(url);
    });
    renderPage();
    await screen.findByRole("link", { name: "Revenue pipeline failure" });
    const strip = screen.getByTestId("agent-today");
    expect(await within(strip).findByText("No tasks in this period")).toBeInTheDocument();
    expect(within(strip).getByRole("link", { name: "finished: 0" })).toBeInTheDocument();
    expect(strip.querySelector("[data-state=idle]")).not.toBeNull();
    expect(strip.querySelector(".text-amber-600")).toBeNull();
  });

  it("links the data quality tiles to the filtered ticket lists when a result table is set up", async () => {
    const withDq = { ...overview, capabilities: { ...overview.capabilities, dqMonitoring: { available: true, reason: "ok" } }, agentResolved: { total: 4, inWindow: 3, pipelines: 2, dataQuality: 1, items: [] } };
    const dqTickets = { items: [...tickets.items, { ticketId: "OPS-50", title: "Null region codes", priority: "medium", status: "open", category: "data_quality", createdAt: new Date(Date.now() - 1800_000).toISOString() }] };
    mockFetch((url) => {
      if (url.startsWith("/api/overview/tickets")) return jsonResponse({ generatedAt: overview.generatedAt, ticketSummary: overview.ticketSummary, agentResolved: withDq.agentResolved, dqOpen: 1, chart: { raised: [1], resolved: [1], dqResolved: [0] } });
      if (url.startsWith("/api/tickets?status=all")) return jsonResponse(dqTickets);
      if (url.startsWith("/api/overview/data-quality")) return jsonResponse({ generatedAt: overview.generatedAt, configured: true, summary: { total: 0, failed: 0, warning: 0, passed: 0 } });
      return route(url);
    });
    renderPage();
    await screen.findByRole("link", { name: "Revenue pipeline failure" });
    expect(screen.getByRole("link", { name: "Open data quality tickets: 1" })).toHaveAttribute("href", "/tickets?category=data_quality");
    expect(screen.getByRole("link", { name: "Checks passed: 0" })).toHaveAttribute("href", "/data-quality?status=passed&range=24h");
    expect(screen.getByRole("link", { name: "Warnings: 0" })).toHaveAttribute("href", "/data-quality?status=warning&range=24h");
    expect(screen.getByRole("link", { name: "Checks failed: 0" })).toHaveAttribute("href", "/data-quality?status=failed&range=24h");
    expect(screen.getByRole("link", { name: "Fixed with Sonic: 1 ticket in the last 24 hours" })).toHaveAttribute("href", "/tickets?scope=closed&resolved=sonic&kind=data_quality&range=24h");
  });

  it("changes the reporting window from the segmented control and refetches with the new bounds", async () => {
    const fetchMock = mockFetch(route);
    renderPage();
    await screen.findByRole("link", { name: "Revenue pipeline failure" });
    const before = overviewCalls(fetchMock).length;

    const control = screen.getByRole("radiogroup", { name: "Reporting period" });
    expect(within(control).getByRole("radio", { name: "Last 24 h" })).toHaveAttribute("aria-checked", "true");
    await userEvent.click(within(control).getByRole("radio", { name: "Today" }));

    await waitFor(() => expect(overviewCalls(fetchMock).length).toBeGreaterThan(before));
    expect(within(control).getByRole("radio", { name: "Today" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("link", { name: "Failed: 1 of 4" })).toHaveAttribute("href", "/monitor?status=Failed&range=today");
    expect(window.localStorage.getItem("nc-time-range")).toBe("today");
  });

  it("assigns an unowned ticket to the signed-in user from the work table", async () => {
    const fetchMock = mockFetch((url, init) => {
      if (init?.method === "PATCH") return jsonResponse({ ticketId: "OPS-43", status: "open", assignee: { id: "demo.user", name: "Demo User" } });
      return route(url);
    });
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Assign to me" }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([input, init]) => String(input) === "/api/tickets/OPS-43" && init?.method === "PATCH")).toBe(true));
    const patch = fetchMock.mock.calls.find(([, init]) => init?.method === "PATCH")?.[1] as RequestInit;
    expect(JSON.parse(String(patch.body))).toEqual({ assignee: { id: "demo.user", name: "Demo User" } });
  });
});
