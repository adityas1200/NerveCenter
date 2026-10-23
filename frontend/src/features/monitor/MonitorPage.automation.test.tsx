import { fireEvent, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { MonitorPage } from "./MonitorPage";
import { ToastProvider } from "@/components/ui";
import { jsonResponse, mockFetch, renderWithClient } from "@/test/utils";

// SPEC-automations-01 FR-41, SPEC-pipelines-01 FR-15, FR-16, SPEC-platform-10 FR-6: missed slots, the investigating task, and the
// run history paged from the server with its Task column.

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
const run = (runId: string, minutes: number, status = "healthy", extra = {}) => ({ runId, pipelineId: "42", platform: "databricks", status, startTime: ago(minutes), durationMs: 60_000, ...extra });
const monitorBody = {
  fetchedAt: ago(2),
  items: [
    { pipelineId: "42", name: "sales_load", platform: "databricks", status: "healthy", health: "healthy", missedCount: 2, lateCount: 1, automation: { pipelineFailed: "task", pipelineLate: "task_and_ticket" }, alert: { id: "AL-1", trigger: "pipelineLate", status: "open", openedAt: ago(30), taskId: "T-1201", ticketId: null, investigation: "started" }, recentRuns: [run("r9", 10)] },
    { pipelineId: "7", name: "orders_load", platform: "databricks", status: "healthy", health: "healthy", recentRuns: [run("o1", 20)] },
  ],
  recentRuns: [run("r9", 10), run("o1", 20)],
  workspaceTotal: 2,
  summary: { succeeded: 2, failed: 0, missed: 1, paused: 0, idle: 0, matchingIdle: 0, platforms: ["databricks"], statuses: ["Succeeded"] },
  diagnostics: { source: "ledger", truncated: false, maxRuns: null, providers: [] },
};

function setup() {
  const calls: string[] = [];
  mockFetch((url, init) => {
    calls.push(`${init?.method || "GET"} ${url}`);
    if (url.includes("/api/monitor?")) return jsonResponse(monitorBody);
    if (url.includes("/api/monitor/refresh")) return jsonResponse({ status: {} });
    if (url.includes("/api/pipelines/42/runs")) {
      const offset = Number(new URL(url, "http://x").searchParams.get("offset") || 0);
      const items = Array.from({ length: 10 }, (_, i) => run(`r${40 - offset - i}`, 30 * (offset + i + 1), i === 0 ? "failed" : "healthy", i === 0 ? { taskId: "T-1199" } : {}));
      return jsonResponse({ items, total: 40, fetchedAt: ago(2), slots: [{ at: ago(90), status: "missed", taskId: "T-1201", alertId: "AL-1" }, { at: ago(150), status: "late", startedAt: ago(140), taskId: null }] });
    }
    return jsonResponse({ items: [] });
  });
  renderWithClient(<MemoryRouter initialEntries={["/monitor"]}><ToastProvider><MonitorPage /></ToastProvider></MemoryRouter>);
  return calls;
}

describe("MonitorPage automations", () => {
  it("counts a pipeline with a missed slot as Missed, says so on the row, and links the investigating task", async () => {
    setup();
    expect(await screen.findByRole("link", { name: "Missed: 1 of 2" }, { timeout: 5000 })).toBeInTheDocument();
    const table = screen.getByRole("table");
    expect(within(table).getByText(/2 missed, 1 late in the last day/)).toBeInTheDocument();
    expect(within(table).getByRole("link", { name: "Investigating" })).toHaveAttribute("href", "/tasks/T-1201");
    expect(screen.getByText(/updated 2m ago/)).toBeInTheDocument();
  });

  it("refresh reads the displayed snapshot without synchronizing sources", async () => {
    const calls = setup();
    await screen.findByRole("table", undefined, { timeout: 5000 });
    const refresh = screen.getByRole("button", { name: "Refresh" });
    await vi.waitFor(() => expect(refresh).not.toBeDisabled());
    fireEvent.click(refresh);
    await vi.waitFor(() => expect(calls.filter(call => call.startsWith("GET") && call.includes("/api/monitor?")).length).toBe(2));
    expect(calls.some(call => call.includes("/api/monitor/refresh"))).toBe(false);
  });

  it("the detail sheet lists missed and late starts and pages the stored run history with a Task column", async () => {
    const calls = setup();
    fireEvent.click(await screen.findByRole("button", { name: "sales_load" }, { timeout: 5000 }));
    expect(await screen.findByText("Missed and late starts")).toBeInTheDocument();
    expect(screen.getByText("Started late")).toBeInTheDocument();
    expect(await screen.findByText("r40")).toBeInTheDocument();
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getAllByRole("link", { name: "Task" }).map((link) => link.getAttribute("href"))).toEqual(["/tasks/T-1201", "/tasks/T-1199"]);
    expect(within(dialog).getByText("1–10 of 40 runs")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Next page" }));
    expect(await screen.findByText("r30")).toBeInTheDocument();
    expect(calls.some((call) => call.includes("/api/pipelines/42/runs?limit=10&offset=10&provider=databricks"))).toBe(true);
  });
});
