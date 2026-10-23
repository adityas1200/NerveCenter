import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ToastProvider } from "@/components/ui";
import { SettingsPage } from "./SettingsPage";
import { jsonResponse, meResponse, mockFetch, renderWithClient, testUsers } from "@/test/utils";

const operations = {
  team: { name: "Data Operations", timezone: "Asia/Kolkata", operator: { name: "Mitesh", email: "ops@company.com" } },
  ticketing: { app: { sources: [] } },
  platforms: [{ name: "commercial-databricks", type: "databricks", connection: "databricks", environments: { prod: { workspace: "https://adb-1.azuredatabricks.net", writable: false } }, monitoring: { jobs: "Jobs API run history", data_quality: "commercial.ops_monitoring.dq_results" } }],
  policy: { default_write: "allow", production_changes: "ask", privileged_access: "ask", ticket_close: "verified-only", email_send: "ask", external_recipients: "deny", ticket_writes: "ask", workspace_changes: "ask", knowledge_drafts: "allow" },
  connections: { databricks: { kind: "mcp" }, servicenow: { kind: "mcp" } },
};
const mapping = { checkId: "check_id", status: "status", executedAt: "run_at" };
const tables = [
  { id: "dq-1", name: "Commercial checks", provider: "databricks", catalog: "commercial", schema: "ops_monitoring", resultTable: "dq_results_with_a_very_long_name_that_would_overflow", warehouseId: "wh-1", mapping, enabled: true },
  { id: "dq-2", name: "Warehouse checks", provider: "snowflake", catalog: "DW", schema: "QUALITY", resultTable: "DQ_LOG", mapping, enabled: false },
];

type Call = { url: string; method: string; body: unknown };

function mockApi(overrides: (url: string, init?: RequestInit) => Promise<Response> | null = () => null) {
  const calls: Call[] = [];
  mockFetch((url, init) => {
    const method = init?.method || "GET";
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const custom = overrides(url, init); if (custom) return custom;
    if (url.includes("/api/me")) return meResponse(testUsers.operator, "admin");
    if (url.includes("/api/settings/") && method === "PUT") return jsonResponse({ section: url.split("/").pop(), value: {}, validation: { errors: [], warnings: [] } });
    if (url.includes("/api/settings")) return jsonResponse({ operations, validation: { errors: [], warnings: [] }, mcp: { mcpServers: {} } });
    if (url.includes("/api/connectors")) return jsonResponse({ items: [{ id: "databricks", name: "Databricks", state: "connected", configured: true, kind: "catalog", settings: {}, secretsSet: [], mcp: null, description: "" }, { id: "servicenow", name: "ServiceNow", state: "error", reason: "401", configured: true, kind: "catalog", settings: {}, secretsSet: [], mcp: null, description: "" }] });
    if (url.includes("/api/data-quality/providers")) return jsonResponse({ items: [{ id: "databricks", name: "Databricks", source: "managed" }] });
    if (url.includes("/api/data-quality/config") && method === "GET") return jsonResponse({ configuration: tables[0], tables });
    if (url.includes("/api/data-quality/config")) return jsonResponse({ ...tables[0], enabled: false });
    if (url.includes("/api/connections")) return jsonResponse({ items: [] });
    if (url.includes("/api/admin/rbac/users") && method === "POST") return jsonResponse({ id: "priya@company.com", name: "Priya", role: "developer", blocked: false }, 201);
    if (url.includes("/api/admin/rbac/users")) return jsonResponse({ items: [{ id: "mitesh", name: "Mitesh", email: "mitesh@company.com", role: "admin", blocked: false }] });
    return jsonResponse({ items: [] });
  });
  return calls;
}

function renderAt(path: string) {
  return renderWithClient(<MemoryRouter initialEntries={[path]}><ToastProvider><Routes><Route path="/settings" element={<SettingsPage />} /><Route path="/data-quality" element={<p>Data quality page</p>} /></Routes></ToastProvider></MemoryRouter>);
}

describe("Settings tabs", () => {
  it("saves the workspace name and timezone and leaves the older operator block alone", async () => {
    const calls = mockApi();
    renderAt("/settings?tab=team");
    const name = await screen.findByRole("textbox", { name: "Workspace name" });
    expect(screen.queryByText("Sonic")).not.toBeInTheDocument();
    await userEvent.clear(name); await userEvent.type(name, "Commercial Data Ops");
    const workspaceCard = screen.getByRole("heading", { name: "Workspace" }).closest(".shell-card-quiet");
    expect(workspaceCard).not.toBeNull();
    await userEvent.click(within(workspaceCard as HTMLElement).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(calls.some((call) => call.method === "PUT")).toBe(true));
    const put = calls.find((call) => call.method === "PUT")!;
    expect(put.url).toMatch(/\/api\/settings\/team$/);
    expect(put.body).toEqual({ name: "Commercial Data Ops", timezone: "Asia/Kolkata", operator: { name: "Mitesh", email: "ops@company.com" } });
  });

  it("sets each policy category with allow, ask or deny and saves the policy section", async () => {
    const calls = mockApi();
    renderAt("/settings?tab=policy");
    expect(await screen.findByText("Applies to every task that follows policy (the default). Look only tasks never change anything.")).toBeInTheDocument();
    const routine = screen.getByRole("radiogroup", { name: "Routine changes" });
    expect(within(routine).getByRole("radio", { name: "Allow" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    await userEvent.click(within(screen.getByRole("radiogroup", { name: "Sending email" })).getByRole("radio", { name: "Allow" }));
    await userEvent.click(within(screen.getByRole("radiogroup", { name: "Production changes" })).getByRole("radio", { name: "Deny" }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(calls.some((call) => call.method === "PUT")).toBe(true));
    const put = calls.find((call) => call.method === "PUT")!;
    expect(put.url).toMatch(/\/api\/settings\/policy$/);
    expect(put.body).toEqual({ ...operations.policy, email_send: "allow", production_changes: "deny" });
  });

  it("shows the approval history per category and offers to stop asking only after five approvals and no denial", async () => {
    const stats = { days: 30, since: "2026-08-26T00:00:00Z", totals: { approved: 16, denied: 1, pending: 0 }, categories: [
      { category: "email_send", label: "Send email", approved: 6, denied: 0, pending: 0, cancelled: 0, lastDecidedAt: "2026-09-24T09:00:00Z" },
      { category: "production_changes", label: "Production change", approved: 4, denied: 0, pending: 0, cancelled: 0, lastDecidedAt: "2026-09-24T09:00:00Z" },
      { category: "ticket_writes", label: "Ticket change", approved: 5, denied: 1, pending: 0, cancelled: 0, lastDecidedAt: "2026-09-24T09:00:00Z" },
      { category: "default_write", label: "Change", approved: 8, denied: 0, pending: 0, cancelled: 0, lastDecidedAt: "2026-09-24T09:00:00Z" },
    ] };
    const calls = mockApi((url) => (url.includes("/api/inbox/stats") ? jsonResponse(stats) : null));
    renderAt("/settings?tab=policy");
    expect(await screen.findByTestId("approval-history-email_send")).toHaveTextContent("Approved 6 of 6 in 30 days");
    expect(screen.getByTestId("approval-history-production_changes")).toHaveTextContent("Approved 4 of 4 in 30 days");
    expect(screen.getByTestId("approval-history-ticket_writes")).toHaveTextContent("Approved 5 of 6 in 30 days");
    expect(screen.getByTestId("approval-history-privileged_access")).toHaveTextContent("No requests yet");
    // Only the category that is set to ask, with five or more approvals and none denied, gets the action.
    const actions = screen.getAllByRole("button", { name: "Let Sonic do this without asking" });
    expect(actions).toHaveLength(1);
    expect(within(screen.getByTestId("approval-history-email_send")).getByRole("button", { name: "Let Sonic do this without asking" })).toBeInTheDocument();
    expect(within(screen.getByTestId("approval-history-default_write")).queryByRole("button")).not.toBeInTheDocument();

    await userEvent.click(actions[0]);
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Sonic will make sending email without asking. You can change this back any time.");
    await userEvent.click(within(dialog).getByRole("button", { name: "Stop asking" }));
    await waitFor(() => expect(calls.some((call) => call.method === "PUT")).toBe(true));
    const put = calls.find((call) => call.method === "PUT")!;
    expect(put.url).toMatch(/\/api\/settings\/policy$/);
    expect(put.body).toEqual({ ...operations.policy, email_send: "allow" });
  });

  it("shows members the approval numbers but not the action", async () => {
    const stats = { days: 30, since: "2026-08-26T00:00:00Z", totals: { approved: 6, denied: 0, pending: 0 }, categories: [
      { category: "email_send", label: "Send email", approved: 6, denied: 0, pending: 0, cancelled: 0, lastDecidedAt: "2026-09-24T09:00:00Z" },
    ] };
    mockApi((url) => (url.includes("/api/inbox/stats") ? jsonResponse(stats) : url.includes("/api/me") ? meResponse(testUsers.dev, "developer") : null));
    renderAt("/settings?tab=policy");
    expect(await screen.findByTestId("approval-history-email_send")).toHaveTextContent("Approved 6 of 6 in 30 days");
    expect(screen.queryByRole("button", { name: "Let Sonic do this without asking" })).not.toBeInTheDocument();
  });

  it("lists several result tables and configures them inside Settings", async () => {
    const calls = mockApi();
    renderAt("/settings?tab=data-quality");
    expect(await screen.findByText("The table your data quality jobs write check results to. NerveCenter reads it; it never writes.")).toBeInTheDocument();
    const list = await screen.findByRole("list", { name: "Result tables" });
    expect(within(list).getByText("Commercial checks")).toBeInTheDocument();
    expect(within(list).getByText("commercial.ops_monitoring.dq_results_with_a_very_long_name_that_would_overflow")).toHaveAttribute("title", "commercial.ops_monitoring.dq_results_with_a_very_long_name_that_would_overflow");
    expect(within(list).getByRole("switch", { name: "Monitor Warehouse checks" })).toHaveAttribute("aria-checked", "false");
    expect(screen.queryByText("Result tables by platform")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Add result table" }));
    expect(await screen.findByRole("heading", { name: "Add result table" })).toBeInTheDocument();
    expect(screen.queryByText("Data quality page")).not.toBeInTheDocument();
    // Settings stays underneath the dialog (aria-hidden while the dialog is open).
    expect(screen.getByRole("heading", { name: "Result tables", hidden: true })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await userEvent.click(screen.getByRole("button", { name: "Edit Commercial checks" }));
    expect(await screen.findByRole("heading", { name: "Edit result table" })).toBeInTheDocument();
    expect(screen.getByLabelText("Result table name")).toHaveValue("Commercial checks");
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await userEvent.click(within(list).getByRole("switch", { name: "Monitor Commercial checks" }));
    await waitFor(() => expect(calls.some((call) => call.method === "PUT" && call.url.endsWith("/api/data-quality/config"))).toBe(true));
    expect(calls.find((call) => call.method === "PUT")!.body).toEqual({ id: "dq-1", enabled: false });

    await userEvent.click(screen.getByRole("button", { name: "Remove Warehouse checks" }));
    await userEvent.click(await screen.findByRole("button", { name: "Remove" }));
    await waitFor(() => expect(calls.some((call) => call.method === "DELETE" && call.url.endsWith("/api/data-quality/config/dq-2"))).toBe(true));
  });

  it("shows each platform's connection readiness and saves a job filter", async () => {
    const calls = mockApi();
    renderAt("/settings?tab=pipelines");
    const list = await screen.findByRole("list", { name: "Platforms" });
    expect(within(list).getByText(/commercial-databricks/)).toBeInTheDocument();
    expect(await within(list).findByText("Ready")).toBeInTheDocument();
    expect(within(list).getByText("All jobs")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Add platform" }));
    const dialog = await screen.findByRole("dialog", { name: "Add platform" });
    await userEvent.clear(within(dialog).getByRole("textbox", { name: "Name" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(within(dialog).getByRole("alert")).toHaveTextContent("Name is required");
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Name" }), "commercial-databricks");
    expect(within(dialog).getByRole("alert")).toHaveTextContent("Another platform has this name");
    await userEvent.clear(within(dialog).getByRole("textbox", { name: "Name" }));
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Name" }), "sales-jobs");
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Show only jobs named" }), "sales, nbrx, sales");
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Hide jobs named" }), "_dev");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(calls.some((call) => call.method === "PUT")).toBe(true));
    const put = calls.find((call) => call.method === "PUT")!;
    expect(put.url).toMatch(/\/api\/settings\/platforms$/);
    const body = put.body as Array<Record<string, unknown>>;
    expect(body).toHaveLength(2);
    expect(body[0]).toEqual(operations.platforms[0]);
    expect(body[1]).toMatchObject({ name: "sales-jobs", type: "databricks", connection: "databricks", monitoring: { jobs: { include: ["sales", "nbrx"], exclude: ["_dev"] } } });
  });
});
