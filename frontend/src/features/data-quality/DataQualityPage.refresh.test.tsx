import { fireEvent, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ToastProvider } from "@/components/ui";
import { DataQualityPage } from "./DataQualityPage";
import { jsonResponse, mockFetch, renderWithClient } from "@/test/utils";

// SPEC-data-quality-02 FR-15 (ADR-0007): the page asks for a data-quality fetch when it opens, then re-reads, and still
// shows results when the server refuses a refresh made within 30 seconds of the last one.

const tableConfiguration = { id: "dq-1", provider: "databricks", catalog: "ops", schema: "dq", resultTable: "results", enabled: true, mapping: { checkId: "check_id", checkName: "check_name", status: "status", executedAt: "executed_at" } };
const item = { id: "c1", key: "k1", checkId: "c1", name: "not null", status: "passed", severity: "low", platform: "databricks", tableId: "dq-1", executedAt: new Date().toISOString(), dataset: "", field: "", rule: "", failedRows: 0, message: "", recommendedFix: "" };

function setup(refreshStatus: number) {
  const calls: string[] = []; const refreshBodies: unknown[] = [];
  mockFetch((url, init) => {
    calls.push(`${init?.method || "GET"} ${url}`);
    if (url.includes("/api/monitor/refresh")) { refreshBodies.push(JSON.parse(String(init?.body || "{}"))); return refreshStatus === 200 ? jsonResponse({ status: {} }) : jsonResponse({ error: "Refreshed a moment ago. Try again in half a minute." }, refreshStatus); }
    if (url.includes("/api/data-quality/providers")) return jsonResponse({ items: [{ id: "databricks", name: "Databricks", source: "deployment" }] });
    if (url.endsWith("/api/data-quality/config")) return jsonResponse({ configuration: tableConfiguration, tables: [tableConfiguration] });
    if (url.includes("/api/data-quality/monitor?")) return jsonResponse({ configured: true, configuration: tableConfiguration, providers: [], range: "Last 24 hours", from: null, fetchedAt: new Date().toISOString(), source: { mode: "configured", platform: "databricks", label: "databricks result table", reason: "ok" }, summary: { total: 1, passed: 1, failed: 0, warning: 0, unreported: 0 }, items: [item], total: 1, offset: 0, limit: 10 });
    return jsonResponse({ items: [] });
  });
  renderWithClient(<MemoryRouter initialEntries={["/data-quality"]}><ToastProvider><DataQualityPage /></ToastProvider></MemoryRouter>);
  return { calls, refreshBodies };
}

const reads = (calls: string[]) => calls.filter((call) => call.includes("/api/data-quality/monitor?")).length;

describe("DataQualityPage manual refresh", () => {
  it("reads stored results once on entry and again on Refresh without synchronizing sources", async () => {
    const { calls, refreshBodies } = setup(200);
    expect(await screen.findByText("not null")).toBeInTheDocument();
    expect(reads(calls)).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await vi.waitFor(() => expect(reads(calls)).toBe(2));
    expect(refreshBodies).toEqual([]);
  });
  it("does not depend on the external refresh endpoint being available", async () => {
    const { refreshBodies } = setup(429);
    expect(await screen.findByText("not null")).toBeInTheDocument();
    expect(refreshBodies).toEqual([]);
    expect(screen.queryByText(/could not/i)).not.toBeInTheDocument();
  });
});
