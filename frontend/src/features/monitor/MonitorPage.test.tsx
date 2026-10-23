import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { MonitorPage } from "./MonitorPage";
import { compactDuration, nextRunText } from "./pipelineWords";
import { AgentPanelContext, type AgentPanelState } from "@/components/ops/agentPanelContext";
import { ToastProvider } from "@/components/ui";
import { jsonResponse, mockFetch, renderWithClient } from "@/test/utils";

const HOUR = 3_600_000;
const inHours = (hours: number) => new Date(Date.now() + hours * HOUR).toISOString();

const monitorBody = {
  range: "Last 24 h",
  fetchedAt: "2026-08-27T09:05:00Z",
  items: [
    { pipelineId: "finance-1", name: "Finance daily", dagId: "finance_daily", dagName: "finance_daily", platform: "databricks", status: "failed", health: "failed", owner: "Finance Ops", schedule: "0 0 4 * * ? · Asia/Kolkata", nextRunAt: inHours(30), typicalDurationMs: 60_000, recentRuns: [
      { runId: "run-failed", pipelineId: "finance-1", status: "failed", startTime: "2026-08-27T08:00:00Z", durationMs: 120_000, failureSummary: "Schema mismatch: unexpected column REGION_CODE", ticketAction: "view", ticket: { ticketId: "OPS-7", automationStatus: "running" } },
      { runId: "run-ok-2", pipelineId: "finance-1", status: "healthy", startTime: "2026-08-26T08:00:00Z", durationMs: 60_000 },
      { runId: "run-ok-1", pipelineId: "finance-1", status: "healthy", startTime: "2026-08-25T08:00:00Z", durationMs: 60_000 },
    ], ticket: { ticketId: "OPS-7", number: null, status: "in_progress" }, ticketAction: "view" },
    { pipelineId: "quiet-1", name: "Quiet task", platform: "databricks", kind: "task", status: "no_runs", health: "no_runs", owner: "Finance Ops", recentRuns: [] },
    { pipelineId: "customer-1", name: "Customer daily", dagId: "customer_daily", dagName: "customer_daily", platform: "databricks", status: "healthy", health: "healthy", owner: "Customer Ops", schedule: null, recentRuns: [{ runId: "run-success", pipelineId: "customer-1", status: "succeeded", startTime: "2026-08-27T07:00:00Z", durationMs: 60_000 }] },
    { pipelineId: "active-1", name: "Active load", dagId: "active_load", dagName: "active_load", platform: "databricks", status: "running", health: "running", recentRuns: [{ runId: "run-active", pipelineId: "active-1", status: "running", startTime: "2026-08-27T09:00:00Z", durationMs: 30_000 }] },
    { pipelineId: "late-1", name: "Weekly refresh", platform: "databricks", status: "healthy", health: "overdue", dueAt: "2026-08-27T06:00:00Z", nextRunAt: inHours(150), schedule: { quartzCronExpression: "0 0 6 ? * MON", timezoneId: "UTC", pauseStatus: "UNPAUSED" }, recentRuns: [{ runId: "run-old", pipelineId: "late-1", status: "healthy", startTime: "2026-08-20T06:00:00Z", durationMs: 240_000 }] },
    { pipelineId: "paused-1", name: "Alignment publish", platform: "databricks", status: "no_runs", health: "paused", schedule: { quartzCronExpression: "0 0 7 1 * ?", timezoneId: "UTC", pauseStatus: "PAUSED" }, recentRuns: [] },
  ],
  recentRuns: [
    { runId: "run-failed", pipelineId: "finance-1", status: "failed" },
    { runId: "run-success", pipelineId: "customer-1", status: "succeeded" },
    { runId: "run-active", pipelineId: "active-1", status: "running" },
  ],
  workspaceTotal: 6,
  summary: { succeeded: 2, failed: 1, missed: 1, paused: 1, idle: 1, matchingIdle: 1, platforms: ["databricks"], statuses: ["Failed", "Missed", "Paused", "Running", "Succeeded"] },
  diagnostics: { pipelineAccessScope: "Pipelines visible to the configured service identity", providers: [] },
};

function renderMonitor(initialEntry = "/monitor") {
  return renderWithClient(<MemoryRouter initialEntries={[initialEntry]}><ToastProvider><MonitorPage /></ToastProvider></MemoryRouter>);
}

const stub = (monitor: (url: string) => Promise<Response>) => {
  const fetchMock = mockFetch((url) => {
    if (url.includes("/api/monitor?")) return monitor(url);
    throw new Error(`Unexpected request: ${url}`);
  });
  return fetchMock;
};

const monitorPageFor = (url: string) => {
  const params = new URL(url, "http://local").searchParams;
  const status = params.get("status"); const term = (params.get("q") || "").toLowerCase(); const platform = params.get("platform");
  const filtered = (monitorBody.items as Array<Record<string, unknown>>).filter((item) => {
    if (params.has("pipelineId") && item.pipelineId !== params.get("pipelineId")) return false;
    const health = String(item.health || "");
    if (!params.has("showIdle") && health === "no_runs") return false;
    if (status === "Succeeded" || status === "Healthy") { if (health !== "healthy" && health !== "running") return false; }
    else if (status === "Missed" || status === "Overdue") { if (health !== "overdue" && !("missedCount" in item && Number(item.missedCount) > 0)) return false; }
    else if (status === "Failed" || status === "Paused" || status === "Running" || status === "Unknown") { if (health !== status.toLowerCase()) return false; }
    if (platform && item.platform !== platform) return false;
    return !term || `${item.pipelineId} ${item.name} ${item.dagName} ${item.owner}`.toLowerCase().includes(term);
  });
  const offset = Number(params.get("offset") || 0); const limit = Number(params.get("limit") || 10);
  return jsonResponse({ ...monitorBody, items: filtered.slice(offset, offset + limit), total: filtered.length });
};

describe("MonitorPage", () => {
  afterEach(() => { try { window.localStorage?.clear(); } catch { /* jsdom without storage */ } });

  it("sorts every pipeline into healthy, failed, overdue or paused, keeps failure text out of the table and hides idle pipelines", async () => {
    const fetchMock = stub(monitorPageFor);
    renderMonitor();

    expect(await screen.findByRole("link", { name: "Succeeded: 2 of 6" }, { timeout: 5000 })).toHaveAttribute("href", "/monitor?status=Succeeded");
    expect(screen.getByRole("link", { name: "Failed: 1 of 6" })).toHaveAttribute("href", "/monitor?status=Failed");
    expect(screen.getByRole("link", { name: "Missed: 1 of 6" })).toHaveAttribute("href", "/monitor?status=Missed");
    expect(screen.getByRole("link", { name: "Paused: 1 of 6" })).toHaveAttribute("href", "/monitor?status=Paused");
    expect(screen.queryByRole("link", { name: /Last run succeeded/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Running now/ })).not.toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: "Reporting period" })).toBeInTheDocument();

    const table = screen.getByRole("table");
    expect(within(table).getByText("Succeeded")).toBeInTheDocument();
    expect(within(table).getByText("Failed")).toBeInTheDocument();
    expect(within(table).getByText("Missed")).toBeInTheDocument();
    expect(within(table).getByText("Running")).toBeInTheDocument();
    expect(within(table).getAllByText("Paused").length).toBeGreaterThan(0);
    expect(within(table).queryByText("Successful")).not.toBeInTheDocument();
    expect(within(table).queryByText("In progress")).not.toBeInTheDocument();
    expect(within(table).queryByText("Schema mismatch: unexpected column REGION_CODE")).not.toBeInTheDocument();
    expect(screen.queryByText(/0 0 4 \* \* \?/)).not.toBeInTheDocument();
    expect(screen.queryByText("Finance Ops")).not.toBeInTheDocument();

    // Runs as a strip of marks, oldest to newest; the last run against the usual; the next run in plain words.
    expect(within(table).getByRole("group", { name: "3 runs: 2 healthy, 1 failed" })).toBeInTheDocument();
    expect(within(table).getByText(/^, 2m$/)).toHaveClass("text-amber-700");
    expect(within(table).getByText(/usually 1m/)).toBeInTheDocument();
    expect(within(table).getByTitle("At 04:00 (Asia/Kolkata)")).toHaveTextContent(/^(Today|Tomorrow|\w{3}) \d\d:\d\d$/);
    expect(within(table).getAllByText("On demand").length).toBeGreaterThan(0);
    expect(within(table).getByRole("button", { name: /OPS-/ })).toBeInTheDocument();

    expect(screen.queryByText("Quiet task")).not.toBeInTheDocument();
    expect(screen.getByText("Alignment publish")).toBeInTheDocument();
    expect(screen.getByText(/1 pipeline had no runs in the last 24 hours/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Show idle (1)" }));
    expect(screen.getByText("Quiet task")).toBeInTheDocument();

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/\/api\/monitor\?.*from=/), expect.objectContaining({ method: "GET", signal: expect.any(AbortSignal) })));
  });

  it("filters Succeeded to include pipelines that are running right now, and still reads the old Healthy link", async () => {
    stub(monitorPageFor);
    renderMonitor("/monitor?status=Healthy");
    await screen.findByRole("link", { name: "Succeeded: 2 of 6" });
    expect(screen.getByText("customer_daily")).toBeInTheDocument();
    expect(screen.getByText("active_load")).toBeInTheDocument();
    expect(screen.queryByText("finance_daily")).not.toBeInTheDocument();
    expect(screen.queryByText("Weekly refresh")).not.toBeInTheDocument();
  });

  it("SPEC-platform-15 FR-7: status tiles request a server-filtered page", async () => {
    const fetchMock = stub(monitorPageFor);
    renderMonitor();
    await screen.findByRole("link", { name: "Failed: 1 of 6" });
    await userEvent.click(screen.getByRole("link", { name: "Failed: 1 of 6" }));
    await screen.findByText("finance_daily");
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).includes("status=Failed"))).toBe(true));
    expect(screen.queryByText("customer_daily")).not.toBeInTheDocument();
  });

  it("keeps direct pipeline links opening the selected pipeline when it is outside the current page", async () => {
    const fetchMock = stub(monitorPageFor);
    renderMonitor("/monitor?pipeline=paused-1");
    expect(await screen.findByRole("heading", { name: "Alignment publish" })).toBeInTheDocument();
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).includes("pipelineId=paused-1"))).toBe(true));
  });

  it("shows one plain not-connected sentence when no platform returns pipelines", async () => {
    stub(() => jsonResponse({ items: [], recentRuns: [], workspaceTotal: 0, diagnostics: { providers: [{ provider: "databricks", error: "Databricks GET /api/2.2/jobs/list failed (403): Invalid access token." }] } }));
    renderMonitor();
    expect(await screen.findByText(/Databricks rejected the access token\./)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Fix connection" })).toHaveAttribute("href", "/connectors");
    expect(screen.queryByRole("link", { name: /^Pipelines:/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/\/api\/2\.2/)).not.toBeInTheDocument();
  });

  it("treats a platform that rejects the reconcile call as not connected instead of showing a raw error", async () => {
    stub(() => Promise.resolve(new Response(JSON.stringify({ error: "databricks: Databricks GET /api/2.2/jobs/list failed (403): Invalid access token." }), { status: 502, headers: { "content-type": "application/json" } })));
    renderMonitor();
    expect(await screen.findByText(/Databricks rejected the access token/, {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps working pipelines visible and names the provider that failed when only one platform is down", async () => {
    stub(() => jsonResponse({ ...monitorBody, summary: monitorBody.summary, diagnostics: { providers: [{ provider: "snowflake", error: "Configure a snowflake connection before reading its pipelines" }] } }));
    renderMonitor();
    expect(await screen.findByRole("link", { name: "Succeeded: 2 of 6" })).toBeInTheDocument();
    expect(screen.getByText(/No snowflake connection is configured\./)).toBeInTheDocument();
  });

  it("keeps legacy business-check query parameters on the pipelines-only monitor", async () => {
    const fetchMock = stub(() => jsonResponse({ items: [], recentRuns: [], workspaceTotal: 2 }));
    renderMonitor("/monitor?view=business-checks");
    expect(await screen.findByRole("heading", { name: "Pipelines" })).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/api/business-checks"))).toBe(false);
  });

  it("hands a pipeline to Sonic from its row and from the detail sheet with a question that fits its state", async () => {
    stub(monitorPageFor);
    const panel: AgentPanelState = { open: false, setOpen: vi.fn(), toggle: vi.fn(), setSelection: vi.fn(), setScreen: vi.fn(), ask: vi.fn() };
    renderWithClient(<MemoryRouter initialEntries={["/monitor"]}><ToastProvider><AgentPanelContext.Provider value={panel}><MonitorPage /></AgentPanelContext.Provider></ToastProvider></MemoryRouter>);
    await screen.findByRole("link", { name: "Succeeded: 2 of 6" });

    // Every row has the same entry point; the click does not open the row.
    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("button", { name: /^Ask Sonic about / })).toHaveLength(5);
    fireEvent.click(within(table).getByRole("button", { name: "Ask Sonic about finance_daily" }));
    expect(panel.setSelection).toHaveBeenLastCalledWith({ kind: "pipeline", id: "finance-1", title: "finance_daily" });
    expect(panel.ask).toHaveBeenLastCalledWith("Why did finance_daily fail? What should I do?");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.click(within(table).getByRole("button", { name: "Ask Sonic about Weekly refresh" }));
    expect(panel.ask).toHaveBeenLastCalledWith("Why did Weekly refresh not run when it was due? What should I do?");
    fireEvent.click(within(table).getByRole("button", { name: "Ask Sonic about customer_daily" }));
    expect(panel.ask).toHaveBeenLastCalledWith("Summarize the recent runs of customer_daily");

    // The detail sheet carries the same action.
    fireEvent.click(within(table).getByRole("button", { name: "finance_daily" }));
    const sheet = await screen.findByRole("dialog");
    fireEvent.click(within(sheet).getByRole("button", { name: "Ask Sonic about finance_daily" }));
    expect(panel.ask).toHaveBeenLastCalledWith("Why did finance_daily fail? What should I do?");
    expect(panel.ask).toHaveBeenCalledTimes(4);
  });

  it("redirects the removed KPI view to Data Quality", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    renderWithClient(<MemoryRouter initialEntries={["/monitor?view=kpi"]}><ToastProvider><Routes><Route path="/monitor" element={<MonitorPage />} /><Route path="/data-quality" element={<h1>Data quality</h1>} /></Routes></ToastProvider></MemoryRouter>);
    expect(await screen.findByRole("heading", { name: "Data quality" })).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("pipeline words", () => {
  it("rounds durations to the size a reader compares", () => {
    expect(compactDuration(45_000)).toBe("45s");
    expect(compactDuration(6 * 60_000 + 20_000)).toBe("6m");
    expect(compactDuration(65 * 60_000)).toBe("1h 05m");
    expect(compactDuration(-1)).toBe("—");
  });

  it("names the next run relative to today", () => {
    const now = new Date(2026, 8, 24, 10, 0, 0).getTime();
    expect(nextRunText(new Date(2026, 8, 24, 20, 0).toISOString(), now)).toBe("Today 20:00");
    expect(nextRunText(new Date(2026, 8, 25, 4, 0).toISOString(), now)).toBe("Tomorrow 04:00");
    expect(nextRunText(new Date(2026, 8, 28, 6, 0).toISOString(), now)).toBe("Mon 06:00");
    expect(nextRunText(new Date(2026, 9, 1, 7, 0).toISOString(), now)).toMatch(/^(1 Oct|Oct 1) 07:00$/);
    expect(nextRunText("not a date", now)).toBe("—");
  });
});
