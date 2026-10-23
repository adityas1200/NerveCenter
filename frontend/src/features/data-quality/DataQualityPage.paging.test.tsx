import { fireEvent, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ToastProvider } from "@/components/ui";
import { DataQualityPage } from "./DataQualityPage";
import { jsonResponse, mockFetch, renderWithClient } from "@/test/utils";

// SPEC-data-quality-02 FR-13, SPEC-platform-11 FR-3, SPEC-automations-01 FR-42: stored results are filtered and paged by the
// server, and a result links to the task that investigated it.

const tableConfiguration = { id: "dq-1", provider: "databricks", catalog: "ops", schema: "dq", resultTable: "results", enabled: true, mapping: { checkId: "check_id", checkName: "check_name", status: "status", executedAt: "executed_at" } };
const result = (n: number, extra = {}) => ({ id: `c${n}`, key: `k${n}`, checkId: `c${n}`, name: `check ${n}`, status: "passed", severity: "low", platform: "databricks", tableId: "dq-1", executedAt: new Date(Date.now() - n * 60_000).toISOString(), dataset: "", field: "", rule: "", failedRows: 0, message: "", recommendedFix: "", ...extra });

function setup() {
  const bodies: Array<Record<string, unknown>> = [];
  mockFetch((url) => {
    if (url.includes("/api/data-quality/providers")) return jsonResponse({ items: [{ id: "databricks", name: "Databricks", source: "deployment" }] });
    if (url.endsWith("/api/data-quality/config")) return jsonResponse({ configuration: tableConfiguration, tables: [tableConfiguration] });
    if (url.includes("/api/data-quality/monitor?")) {
      const params = new URL(url, "http://local").searchParams; const body = { ...Object.fromEntries(params), limit: Number(params.get("limit")), offset: Number(params.get("offset")) }; bodies.push(body);
      const offset = Number(body.offset || 0);
      const items = Array.from({ length: 10 }, (_, i) => result(offset + i + 1, offset + i === 0 ? { status: "failed", severity: "high", taskId: "T-1300", alertId: "AL-9" } : {}));
      return jsonResponse({ configured: true, configuration: tableConfiguration, providers: [], range: "Last 24 hours", from: null, fetchedAt: new Date().toISOString(), source: { mode: "configured", platform: "databricks", label: "databricks result table", reason: "ok" }, summary: { total: 150, passed: 149, failed: 1, warning: 0, unreported: 0 }, items, total: 150, offset, limit: body.limit });
    }
    return jsonResponse({ items: [] });
  });
  renderWithClient(<MemoryRouter initialEntries={["/data-quality"]}><ToastProvider><DataQualityPage /></ToastProvider></MemoryRouter>);
  return bodies;
}

describe("DataQualityPage paging", () => {
  it("pages the stored results on the server and links the investigating task", async () => {
    const bodies = setup();
    expect(await screen.findByText("1–10 of 150 results", undefined, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Task" })).toHaveAttribute("href", "/tasks/T-1300");
    expect(bodies[0]).toMatchObject({ limit: 10, offset: 0 });
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(await screen.findByText("11–20 of 150 results")).toBeInTheDocument();
    expect(bodies.at(-1)).toMatchObject({ limit: 10, offset: 10 });
    const nav = screen.getByRole("navigation", { name: "Pages" });
    expect(within(nav).getByRole("button", { name: "15" })).toBeInTheDocument();
  });
});
