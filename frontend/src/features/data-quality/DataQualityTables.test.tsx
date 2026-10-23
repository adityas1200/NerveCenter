import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { ToastProvider } from "@/components/ui";
import { DataQualityPage } from "./DataQualityPage";
import { jsonResponse, mockFetch, renderWithClient } from "@/test/utils";

const mapping = { checkId: "CHECK_ID", status: "STATUS", executedAt: "EXECUTED_AT" };
const columns = [{ name: "CHECK_ID", normalizedName: "check_id", type: "VARCHAR", nullable: true }, { name: "STATUS", normalizedName: "status", type: "VARCHAR", nullable: true }, { name: "EXECUTED_AT", normalizedName: "executed_at", type: "TIMESTAMP", nullable: true }];
const tables = [
  { id: "dq-1", name: "Commercial checks", provider: "snowflake", catalog: "COMMERCIAL", schema: "QUALITY", resultTable: "DQ_LOG", mapping, enabled: true, ddl: "CREATE TABLE DQ_LOG (CHECK_ID VARCHAR, STATUS VARCHAR, EXECUTED_AT TIMESTAMP);", ddlHash: "h1", discoveredColumns: columns },
  { id: "dq-2", name: "Field checks", provider: "snowflake", catalog: "FIELD", schema: "QUALITY", resultTable: "DQ_LOG", mapping, enabled: true },
];
const item = (checkId: string, name: string, status: string, table: (typeof tables)[number]) => ({ id: checkId, checkId, name, status, severity: "high", platform: "snowflake", table: table.name, tableId: table.id, executedAt: "2026-08-28T07:59:00Z", dataset: "COMMERCIAL.CUSTOMER", field: "", rule: "", failedRows: 0, message: "", recommendedFix: "" });
const monitor = {
  configured: true, configuration: tables[0], tables: tables.map(({ id, name, provider, catalog, schema, resultTable, enabled }) => ({ id, name, provider, catalog, schema, resultTable, enabled })), providers: [], range: "Last 24 h", from: null, fetchedAt: "2026-08-28T08:00:00Z",
  source: { mode: "configured", platform: "snowflake", label: "2 result tables", reason: "Read 2 of 2" },
  sources: [{ tableId: "dq-1", table: "Commercial checks", status: "ok", count: 1 }, { tableId: "dq-2", table: "Field checks", status: "ok", count: 1 }],
  summary: { total: 2, passed: 1, failed: 1, warning: 0, unreported: 0 },
  items: [item("DQ-001", "Customer key completeness", "failed", tables[0]), item("DQ-001", "Territory freshness", "passed", tables[1])],
};

function renderPage() {
  mockFetch((url) => {
    if (url.includes("/api/data-quality/providers")) return jsonResponse({ items: [{ id: "snowflake", name: "Snowflake", source: "managed" }] });
    if (url.endsWith("/api/data-quality/config")) return jsonResponse({ configuration: tables[0], tables });
    if (url.includes("/api/data-quality/monitor")) return jsonResponse(monitor);
    if (url.endsWith("/api/connections")) return jsonResponse({ items: [] });
    throw new Error(`Unexpected request: ${url}`);
  });
  renderWithClient(<MemoryRouter initialEntries={["/data-quality"]}><ToastProvider><DataQualityPage /></ToastProvider></MemoryRouter>);
}

describe("DataQualityPage with several result tables", () => {
  afterEach(() => { try { window.localStorage?.clear(); } catch { /* jsdom without storage */ } });

  it("shows which table each check came from and filters by table", async () => {
    renderPage();
    expect(await screen.findByRole("button", { name: "Customer key completeness" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /Table/ })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Filter by table" })).toBeInTheDocument();
    expect(screen.getByText("Read from")).toHaveAttribute("title", "COMMERCIAL.QUALITY.DQ_LOG, FIELD.QUALITY.DQ_LOG");
    const rows = screen.getAllByRole("row");
    expect(rows.some((row) => within(row).queryByText("Field checks"))).toBe(true);
  });

  it("edits a result table in place from the page menu", async () => {
    renderPage();
    await screen.findByRole("button", { name: "Customer key completeness" });
    await userEvent.click(screen.getByRole("button", { name: "More actions" }));
    expect(await screen.findByRole("menuitem", { name: /Edit Field checks/ })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /Add result table/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("menuitem", { name: /Edit Commercial checks/ }));
    expect(await screen.findByRole("heading", { name: "Edit result table" })).toBeInTheDocument();
    expect(screen.getByLabelText("Result table name")).toHaveValue("Commercial checks");
    // The stored mapping is shown straight away, so a rename saves without a new analysis.
    expect(screen.getByRole("region", { name: "DDL mapping review" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });
});
