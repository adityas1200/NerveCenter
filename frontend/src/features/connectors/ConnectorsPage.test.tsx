import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { Connector } from "@/api/connectors";
import { AgentPanelProvider } from "@/components/ops/AgentPanel";
import { ToastProvider } from "@/components/ui";
import { ConnectorsPage } from "./ConnectorsPage";
import { jsonResponse, meResponse, mockFetch, renderWithClient, testUsers } from "@/test/utils";

const atlassian: Connector = {
  id: "atlassian", name: "Atlassian", description: "Jira issues become tickets. Bitbucket is used for fixes and pull requests.", usedBy: ["Tickets", "Tasks", "Knowledge"], kind: "catalog", configured: false, state: "not_connected",
  fields: [{ key: "site", label: "Jira site URL", placeholder: "https://company.atlassian.net", required: true, env: "JIRA_URL" }, { key: "email", label: "Account email", required: true, env: "JIRA_USERNAME" }, { key: "project", label: "Default Jira project key", required: false }],
  secrets: [{ key: "apiToken", label: "API token", env: "JIRA_API_TOKEN", required: true }], settings: {}, secretsSet: [], mcp: null,
};
const databricks: Connector = { id: "databricks", name: "Databricks", description: "Pipelines, data quality and RCA read the jobs and SQL APIs.", usedBy: ["Pipelines", "Data Quality"], kind: "catalog", configured: true, state: "connected", fields: [{ key: "host", label: "Workspace URL", required: true, env: "DATABRICKS_HOST" }], secrets: [{ key: "token", label: "Personal access token", env: "DATABRICKS_TOKEN", required: true }], settings: { host: "https://adb-1.azuredatabricks.net" }, secretsSet: ["DATABRICKS_TOKEN"], mcp: { transport: "stdio", command: "uvx", args: ["databricks-mcp-server"], url: null, env: ["DATABRICKS_HOST", "DATABRICKS_TOKEN"], enabled: true } };
const runbooks: Connector = { id: "runbook-search", name: "Runbook search", description: "Any MCP server the agent should be able to use.", kind: "custom", configured: true, state: "connected", settings: {}, secretsSet: [], mcp: { transport: "http", command: null, args: [], url: "https://runbooks.internal/mcp", env: ["RUNBOOKS_TOKEN"], enabled: true } };

function renderPage() {
  return renderWithClient(<MemoryRouter initialEntries={["/connectors"]}><ToastProvider><AgentPanelProvider><ConnectorsPage /></AgentPanelProvider></ToastProvider></MemoryRouter>);
}

describe("ConnectorsPage", () => {
  it("shows one card per system with its state, and connecting Jira sends settings and the secret separately", async () => {
    const bodies: Array<{ method: string; url: string; body: unknown }> = [];
    mockFetch((url, init) => {
      const method = init?.method || "GET";
      if (init?.body) bodies.push({ method, url, body: JSON.parse(String(init.body)) });
      if (url.includes("/api/me")) return meResponse(testUsers.admin, "admin");
      if (url.endsWith("/api/connectors/atlassian") && method === "PUT") return jsonResponse({ ...atlassian, configured: true, state: "connected", settings: { site: "https://company.atlassian.net", email: "me@company.com" }, secretsSet: ["JIRA_API_TOKEN"] });
      if (url.includes("/api/connectors")) return jsonResponse({ items: [databricks, atlassian, runbooks] });
      if (url.includes("/api/settings")) return jsonResponse({ operations: { connections: {} }, validation: { errors: [], warnings: [] }, mcp: { mcpServers: { databricks: { type: "stdio", command: "uvx", args: ["databricks-mcp-server"], env: { DATABRICKS_TOKEN: "${DATABRICKS_TOKEN}" } } } } });
      return jsonResponse({ items: [] });
    });
    renderPage();

    const databricksCard = await screen.findByTestId("connector-databricks");
    expect(within(databricksCard).getByText("Connected")).toBeInTheDocument();
    expect(within(databricksCard).getByText("Pipelines · Data Quality")).toBeInTheDocument();
    expect(within(databricksCard).getByText("1 of 1 stored")).toBeInTheDocument();
    expect(within(databricksCard).getByRole("button", { name: "Configure" })).toBeInTheDocument();
    expect(within(databricksCard).getByRole("button", { name: "Test" })).toBeInTheDocument();
    expect(within(databricksCard).getByRole("button", { name: "More actions for Databricks" })).toBeInTheDocument();
    expect(within(databricksCard).queryByRole("button", { name: /Remove/ })).not.toBeInTheDocument();
    const customCard = screen.getByTestId("connector-runbook-search");
    expect(within(customCard).getByText("https://runbooks.internal/mcp")).toBeInTheDocument();
    expect(screen.getByText("2 of 3 connected")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "More actions" })).not.toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Connectors" })).queryByRole("button", { name: /Ask the agent/ })).not.toBeInTheDocument();

    const disclosure = await screen.findByRole("button", { name: /Advanced/ });
    expect(disclosure).toHaveAttribute("aria-expanded", "false");
    expect(disclosure).toHaveTextContent("1 MCP server");
    expect(screen.queryByText(/\.mcp\.json/)).not.toBeInTheDocument();
    expect(within(customCard).getByText("https://runbooks.internal/mcp")).not.toHaveClass("font-mono");
    expect(screen.queryByRole("button", { name: "Copy .mcp.json" })).not.toBeInTheDocument();
    fireEvent.click(disclosure);
    expect(disclosure).toHaveAttribute("aria-expanded", "true");
    // The readable server list shows first; the raw JSON stays a level deeper, for people who need it verbatim.
    const serverRow = screen.getByText("databricks").closest("li")!;
    expect(within(serverRow).getByText("uvx databricks-mcp-server")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Copy .mcp.json" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "View raw JSON" }));
    expect(screen.getByRole("button", { name: "Copy .mcp.json" })).toBeInTheDocument();

    const atlassianCard = screen.getByTestId("connector-atlassian");
    expect(within(atlassianCard).getByText("Not connected")).toBeInTheDocument();
    expect(within(atlassianCard).queryByRole("button", { name: "Configure" })).not.toBeInTheDocument();
    fireEvent.click(within(atlassianCard).getByRole("button", { name: "Connect" }));
    const dialog = await screen.findByRole("dialog");
    const connect = within(dialog).getByRole("button", { name: "Connect" });
    expect(connect).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText(/Jira site URL/), { target: { value: "company.atlassian.net" } });
    fireEvent.change(within(dialog).getByLabelText(/Account email/), { target: { value: "me@company.com" } });
    expect(connect).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText(/API token/), { target: { value: "secret-token" } });
    expect(connect).toBeEnabled();
    fireEvent.click(connect);
    await waitFor(() => expect(bodies.some((call) => call.method === "PUT" && call.url.endsWith("/api/connectors/atlassian"))).toBe(true));
    const saved = bodies.find((call) => call.method === "PUT")!;
    expect(saved.body).toEqual({ settings: { site: "company.atlassian.net", email: "me@company.com" }, secrets: { apiToken: "secret-token" } });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("opens the Add connector form from the dashed card, with no duplicate header button", async () => {
    mockFetch((url) => {
      if (url.includes("/api/me")) return meResponse(testUsers.admin, "admin");
      if (url.includes("/api/connectors")) return jsonResponse({ items: [databricks] });
      if (url.includes("/api/settings")) return jsonResponse({ operations: { connections: {} }, validation: { errors: [], warnings: [] }, mcp: { mcpServers: {} } });
      return jsonResponse({ items: [] });
    });
    renderPage();
    await screen.findByTestId("connector-databricks");
    const buttons = screen.getAllByRole("button", { name: /Add connector/ });
    expect(buttons).toHaveLength(1);
    fireEvent.click(buttons[0]);
    expect(await screen.findByRole("dialog", { name: "Add connector" })).toBeInTheDocument();
  });

  it("sends non-admins to the overview, like Settings", async () => {
    const calls: string[] = [];
    mockFetch((url) => { calls.push(url); return url.includes("/api/me") ? meResponse(testUsers.dev, "developer") : jsonResponse({ items: [] }); });
    renderWithClient(<MemoryRouter initialEntries={["/connectors"]}><ToastProvider><AgentPanelProvider><Routes><Route path="/connectors" element={<ConnectorsPage />} /><Route path="/" element={<p>Overview</p>} /></Routes></AgentPanelProvider></ToastProvider></MemoryRouter>);
    expect(await screen.findByText("Overview")).toBeInTheDocument();
    expect(calls.some((url) => url.includes("/api/connectors"))).toBe(false);
  });

  it("narrows the grid by name and by connected state from the search bar and filter menu", async () => {
    mockFetch((url) => {
      if (url.includes("/api/me")) return meResponse(testUsers.admin, "admin");
      if (url.includes("/api/connectors")) return jsonResponse({ items: [databricks, atlassian, runbooks] });
      if (url.includes("/api/settings")) return jsonResponse({ operations: { connections: {} }, validation: { errors: [], warnings: [] }, mcp: { mcpServers: {} } });
      return jsonResponse({ items: [] });
    });
    renderPage();
    await screen.findByTestId("connector-databricks");
    expect(screen.getByTestId("connector-atlassian")).toBeInTheDocument();
    expect(screen.getByTestId("connector-runbook-search")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Search connectors"), { target: { value: "data" } });
    expect(screen.getByTestId("connector-databricks")).toBeInTheDocument();
    expect(screen.queryByTestId("connector-atlassian")).not.toBeInTheDocument();
    expect(screen.queryByTestId("connector-runbook-search")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Search connectors"), { target: { value: "" } });

    await userEvent.click(screen.getByRole("button", { name: "Filter connectors" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Not connected" }));
    expect(screen.getByTestId("connector-atlassian")).toBeInTheDocument();
    expect(screen.queryByTestId("connector-databricks")).not.toBeInTheDocument();
    expect(screen.queryByTestId("connector-runbook-search")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Filter connectors" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Connected" }));
    expect(screen.getByTestId("connector-databricks")).toBeInTheDocument();
    expect(screen.getByTestId("connector-runbook-search")).toBeInTheDocument();
    expect(screen.queryByTestId("connector-atlassian")).not.toBeInTheDocument();
  });
});
