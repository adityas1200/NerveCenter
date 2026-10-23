import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { ToastProvider } from "@/components/ui";
import { DataQualityPage } from "./DataQualityPage";
import { jsonResponse, renderWithClient } from "@/test/utils";

const connection = { id: "snowflake-prod", provider: "snowflake", name: "Snowflake production", config: { account: "client-account", warehouse: "DQ_WH", database: "COMMERCIAL", schema: "QUALITY", role: "DQ_READER" }, enabled: true, isDefault: true, credentialConfigured: true, secretSource: "direct", lastTest: { status: "connected", message: "Connection verified" } };
const tableConfiguration = { provider: "snowflake", catalog: "COMMERCIAL", schema: "QUALITY", resultTable: "DQ_LOG", ruleTable: "DQ_RULES", enabled: true, mapping: { checkId: "CHECK_ID", checkName: "CHECK_NAME", status: "STATUS", executedAt: "EXECUTED_AT" } };
const failedResult = { id: "dq-log-1", checkId: "DQ-001", name: "Customer key completeness", status: "failed", severity: "high", platform: "snowflake", executedAt: "2026-08-28T07:59:00Z", dataset: "COMMERCIAL.CUSTOMER", field: "CUSTOMER_ID", rule: "CUSTOMER_ID IS NOT NULL", failedRows: 12, message: "12 rows have a null customer id.", recommendedFix: "Backfill the customer id.", ticketAction: "view", ticket: { ticketId: "OPS-2002", status: "open", taskId: null }, routing: { ticketId: "OPS-2002", sourceRef: "dq-table:abc" } };
const tableMonitor = { configured: true, configuration: tableConfiguration, providers: [], range: "Last 24 h", from: "2026-08-27T08:00:00Z", fetchedAt: "2026-08-28T08:00:00Z", source: { mode: "configured", platform: "snowflake", label: "snowflake result table", reason: "Results were read from the configured DQ source." }, summary: { total: 1, passed: 0, failed: 1, warning: 0, unreported: 0 }, items: [failedResult], reconciliationErrors: {} };
const unconfigured = { configured: false, configuration: null, providers: [], range: "Last 24 hours", from: null, fetchedAt: "2026-08-28T08:00:00Z", source: { mode: "unconfigured", platform: "", label: "No DQ source configured", reason: "Configure a verified DQ result table." }, summary: { total: 0, passed: 0, failed: 0, warning: 0, unreported: 0 }, items: [] };

function commonResponse(url: string) {
  if (url.includes("/api/data-quality/providers")) return jsonResponse({ items: [{ id: "snowflake", name: "Snowflake", source: "managed", profileId: "snowflake-prod" }] });
  if (url.endsWith("/api/connections")) return jsonResponse({ items: [connection] });
  return null;
}

function renderPage(fetchMock: ReturnType<typeof vi.fn>) {
  vi.stubGlobal("fetch", fetchMock);
  renderWithClient(<MemoryRouter initialEntries={["/data-quality"]}><ToastProvider><DataQualityPage /></ToastProvider></MemoryRouter>);
}

describe("DataQualityPage", () => {
  afterEach(() => { try { window.localStorage?.clear(); } catch { /* jsdom without storage */ } });

  it("shows results from the monitoring table and links a failure to its ticket", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      const shared = commonResponse(url); if (shared) return shared;
      if (url.endsWith("/api/data-quality/config")) return jsonResponse({ configuration: tableConfiguration });
      if (url.includes("/api/data-quality/monitor")) return jsonResponse(tableMonitor);
      throw new Error(`Unexpected request: ${url}`);
    });
    renderPage(fetchMock);

    expect(await screen.findByRole("heading", { name: "Data quality" })).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: /^Checks run: 1/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Failed: 1 of 1" })).toHaveAttribute("href", "/data-quality?status=failed");
    expect(screen.getByRole("radiogroup", { name: "Reporting period" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "More actions" }));
    expect(await screen.findByRole("menuitem", { name: /Edit result table/i })).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(screen.getByText("COMMERCIAL.QUALITY.DQ_LOG")).toBeInTheDocument();
    expect(screen.getByText("CUSTOMER_ID IS NOT NULL")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Customer key completeness" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /OPS-2002/ })).toHaveAttribute("href", "/tickets/OPS-2002");
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add check" })).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url, init]) => String(url).includes("/api/data-quality/monitor?") && init?.method === "GET")).toBe(true);
  });

  it("clears every active filter in one click, not just the last one", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      const shared = commonResponse(url); if (shared) return shared;
      if (url.endsWith("/api/data-quality/config")) return jsonResponse({ configuration: tableConfiguration });
      if (url.includes("/api/data-quality/monitor")) return jsonResponse(tableMonitor);
      throw new Error(`Unexpected request: ${url}`);
    });
    renderPage(fetchMock);
    expect(await screen.findByRole("link", { name: "Failed: 1 of 1" })).toBeInTheDocument();

    // Two filters active at once: the status tile (a navigation, like a person clicking it) and a typed search.
    await userEvent.click(screen.getByRole("link", { name: "Failed: 1 of 1" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Search results" }), "customer");
    const clear = await screen.findByRole("button", { name: "Clear filters" });

    await userEvent.click(clear);
    // Both must be gone, not just the last one set (a stale-closure bug used to leave the status filter behind).
    expect(screen.getByRole("textbox", { name: "Search results" })).toHaveValue("");
    expect(screen.queryByRole("button", { name: "Clear filters" })).not.toBeInTheDocument();
  });

  it("sends the shared reporting window to reconciliation", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      const shared = commonResponse(url); if (shared) return shared;
      if (url.endsWith("/api/data-quality/config")) return jsonResponse({ configuration: tableConfiguration });
      if (url.includes("/api/data-quality/monitor?")) return jsonResponse(tableMonitor);
      throw new Error(`Unexpected request: ${url}`);
    });
    renderPage(fetchMock);
    const control = await screen.findByRole("radiogroup", { name: "Reporting period" });
    await userEvent.click(within(control).getByRole("radio", { name: "Today" }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/api/data-quality/monitor?") && new URL(String(url), "http://local").searchParams.get("range") === "Today" && new URL(String(url), "http://local").searchParams.has("from"))).toBe(true));
  });

  it("analyzes pasted DDL, shows the proposed mapping, and saves the reviewed table contract", async () => {
    let savedBody: Record<string, unknown> | null = null;
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const shared = commonResponse(url); if (shared) return shared;
      if (url.endsWith("/api/data-quality/analyze")) return jsonResponse({ provider: "snowflake", catalog: "COMMERCIAL", schema: "QUALITY", resultTable: "DQ_LOG", columns: [{ name: "CHECK_ID", normalizedName: "check_id", type: "VARCHAR", nullable: true }, { name: "STATUS", normalizedName: "status", type: "VARCHAR", nullable: true }, { name: "EXECUTED_AT", normalizedName: "executed_at", type: "TIMESTAMP", nullable: false }], mapping: { checkId: "CHECK_ID", status: "STATUS", executedAt: "EXECUTED_AT" }, candidates: { checkId: ["CHECK_ID"], status: ["STATUS"], executedAt: ["EXECUTED_AT"] }, issues: [], missingRequired: [], confidence: 1, ddlHash: "hash-1", agent: { used: false, reason: "The DDL matched the canonical DQ names" }, sample: { used: false, rowCount: 0 } });
      if (url.endsWith("/api/data-quality/config") && init?.method === "PUT") { savedBody = JSON.parse(String(init.body)); return jsonResponse({ ...savedBody, updatedAt: "2026-08-28T08:00:00Z" }); }
      if (url.endsWith("/api/data-quality/config")) return jsonResponse({ configuration: null });
      if (url.includes("/api/data-quality/monitor")) return jsonResponse(unconfigured);
      throw new Error(`Unexpected request: ${url}`);
    });
    renderPage(fetchMock);

    await userEvent.click(await screen.findByRole("button", { name: /Set up result table/i }));
    expect(await screen.findByRole("heading", { name: "Add result table" })).toBeInTheDocument();
    expect(screen.getByLabelText("Monitoring database")).toHaveValue("COMMERCIAL");
    expect(screen.getByLabelText("Monitoring schema")).toHaveValue("QUALITY");
    await userEvent.type(screen.getByLabelText("Monitoring result table"), "DQ_LOG");
    await userEvent.type(screen.getByLabelText("Monitoring table DDL"), "CREATE TABLE DQ_LOG (CHECK_ID VARCHAR, STATUS VARCHAR, EXECUTED_AT TIMESTAMP);");
    await userEvent.click(screen.getByRole("button", { name: "Analyze DDL" }));
    expect(await screen.findByRole("region", { name: "DDL mapping review" })).toBeInTheDocument();
    expect(screen.getByText(/mapping confidence is 100%/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await vi.waitFor(() => expect(savedBody).not.toBeNull());
    expect(savedBody).toMatchObject({ provider: "snowflake", catalog: "COMMERCIAL", schema: "QUALITY", resultTable: "DQ_LOG", mapping: { checkId: "CHECK_ID", status: "STATUS", executedAt: "EXECUTED_AT" } });
  });
});
