import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { Connector } from "@/api/connectors";
import { AgentPanelProvider } from "@/components/ops/AgentPanel";
import { ToastProvider } from "@/components/ui";
import { ConnectorsPage } from "./ConnectorsPage";
import { jsonResponse, meResponse, mockFetch, renderWithClient, testUsers } from "@/test/utils";

const base = { configured: true, state: "connected" as const, settings: {}, secretsSet: [], source: "workspace" as const };
const servicenow: Connector = { ...base, id: "servicenow", name: "ServiceNow", description: "Incidents in scope become tickets and tasks.", usedBy: ["Tickets", "Tasks"], usedFor: [{ section: "ticketing", label: "Tickets" }], kind: "catalog", connectionKind: "mcp", settings: { instance: "http://127.0.0.1:8712" }, mcp: { transport: "stdio", command: "uvx", args: ["servicenow-mcp"], url: null, env: [], enabled: true } };
const identity: Connector = { ...base, id: "identity", name: "Identity", description: "Plain HTTP API (REST), not an MCP server. Sonic calls it directly to grant, remove and review access.", kind: "custom", connectionKind: "api", endpoint: "http://127.0.0.1:8714/identity", origin: "operations", usedFor: [{ section: "identity", label: "Access requests" }], settings: { base_url: "http://127.0.0.1:8714/identity" }, mcp: null };
const git: Connector = { ...base, id: "git", name: "Git", description: "Command-line tool on this machine. Sonic runs it to create branches, commit and open pull requests.", kind: "custom", connectionKind: "cli", endpoint: "git", origin: "operations", usedFor: [{ section: "source_control", label: "Code fixes" }], settings: { command: "git" }, mcp: null };
const confluence: Connector = { ...base, id: "confluence", name: "Confluence", description: "MCP server Sonic starts as a tool server.", kind: "custom", connectionKind: "mcp", endpoint: "https://mcp.example.com/confluence", origin: "connectors", usedFor: [], knowledgeSource: false, mcp: { transport: "http", command: null, args: [], url: "https://mcp.example.com/confluence", env: [], enabled: true } };

function renderPage(calls: Array<{ method: string; url: string; body?: unknown }>) {
  mockFetch((url, init) => {
    const method = init?.method || "GET";
    calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (url.includes("/api/me")) return meResponse(testUsers.admin, "admin");
    if (url.endsWith("/api/connectors/custom") && method === "POST") return jsonResponse({ ...identity, id: "hr-directory", name: "HR directory" }, 201);
    if (url.includes("/api/connectors")) return jsonResponse({ items: [servicenow, identity, git, confluence] });
    if (url.endsWith("/api/settings/knowledge") && method === "PUT") return jsonResponse({ section: "knowledge", value: {}, validation: { errors: [], warnings: [] } });
    if (url.includes("/api/settings")) return jsonResponse({ operations: { connections: {}, knowledge: { mode: "local", path: "knowledge", collections: ["helixa"], approved_only: true, connection: "" } }, validation: { errors: [], warnings: [] }, mcp: { mcpServers: {} } });
    return jsonResponse({ items: [] });
  });
  return renderWithClient(<MemoryRouter initialEntries={["/connectors"]}><ToastProvider><AgentPanelProvider><ConnectorsPage /></AgentPanelProvider></ToastProvider></MemoryRouter>);
}

describe("Connector cards", () => {
  it("say in words how each connection is reached, where, and what uses it; brand marks are in brand colours", async () => {
    renderPage([]);
    const identityCard = await screen.findByTestId("connector-identity");
    expect(within(identityCard).getByText("REST API · from operations.yaml")).toBeInTheDocument();
    expect(within(identityCard).getByText("Endpoint")).toBeInTheDocument();
    expect(within(identityCard).getByText("http://127.0.0.1:8714/identity")).toBeInTheDocument();
    expect(within(identityCard).getByText("Access requests")).toBeInTheDocument();
    expect(within(identityCard).getByText(/not an MCP server/)).toBeInTheDocument();
    expect(within(identityCard).queryByText("Use as a knowledge source")).not.toBeInTheDocument();

    const gitCard = screen.getByTestId("connector-git");
    expect(within(gitCard).getByText("Command line · from operations.yaml")).toBeInTheDocument();
    expect(within(gitCard).getByText("Command")).toBeInTheDocument();
    expect(within(gitCard).getByText("Code fixes")).toBeInTheDocument();

    const servicenowCard = screen.getByTestId("connector-servicenow");
    expect(within(servicenowCard).getByText("MCP server")).toBeInTheDocument();
    expect(within(servicenowCard).getByText("Tickets")).toBeInTheDocument();
    const mark = servicenowCard.querySelector("svg[data-brand='servicenow'] path");
    expect(mark).toHaveAttribute("fill", "#62D84E");
  });

  it("switch an MCP server on as a knowledge source, keeping the rest of the knowledge section", async () => {
    const calls: Array<{ method: string; url: string; body?: unknown }> = [];
    renderPage(calls);
    const card = await screen.findByTestId("connector-confluence");
    const toggle = within(card).getByRole("switch", { name: "Use as a knowledge source" });
    await waitFor(() => expect(toggle).toBeEnabled());
    fireEvent.click(toggle);
    await waitFor(() => expect(calls.some((call) => call.method === "PUT" && call.url.endsWith("/api/settings/knowledge"))).toBe(true));
    expect(calls.find((call) => call.method === "PUT")!.body).toEqual({ mode: "both", path: "knowledge", collections: ["helixa"], approved_only: true, connection: "confluence" });
  });

  it("add a REST API connection from the kind picker", async () => {
    const calls: Array<{ method: string; url: string; body?: unknown }> = [];
    renderPage(calls);
    await screen.findByTestId("connector-identity");
    fireEvent.click(screen.getAllByRole("button", { name: /Add connector/ }).at(-1)!);
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("radio", { name: /REST API/ }));
    fireEvent.change(within(dialog).getByLabelText(/Name/), { target: { value: "HR directory" } });
    fireEvent.change(within(dialog).getByLabelText(/Base URL/), { target: { value: "https://hr.example.com/api" } });
    const add = within(dialog).getByRole("button", { name: "Add connector" });
    expect(add).toBeEnabled();
    fireEvent.click(add);
    await waitFor(() => expect(calls.some((call) => call.method === "POST" && call.url.endsWith("/api/connectors/custom"))).toBe(true));
    expect(calls.find((call) => call.method === "POST")!.body).toEqual({ kind: "api", title: "HR directory", baseUrl: "https://hr.example.com/api", auth: "none" });
  });

  it("adds a git/Bitbucket connection with repository link, branch and token, and can mark it as knowledge", async () => {
    const calls: Array<{ method: string; url: string; body?: unknown }> = [];
    renderPage(calls);
    await screen.findByTestId("connector-identity");
    fireEvent.click(screen.getAllByRole("button", { name: /Add connector/ }).at(-1)!);
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("radio", { name: /Git \/ Bitbucket/ }));
    // No command, arguments or environment variables for a repository.
    expect(within(dialog).queryByLabelText("Command *")).toBeNull();
    expect(within(dialog).queryByText("Environment variables")).toBeNull();
    fireEvent.change(within(dialog).getByLabelText(/Connection name/), { target: { value: "Runbooks" } });
    const add = within(dialog).getByRole("button", { name: "Add connector" });
    expect(add).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText(/Repository link/), { target: { value: "https://bitbucket.org/acme/data-platform" } });
    fireEvent.change(within(dialog).getByLabelText("Branch"), { target: { value: "knowledge" } });
    fireEvent.change(within(dialog).getByLabelText("Personal access token"), { target: { value: "bb-secret" } });
    fireEvent.click(within(dialog).getByRole("switch", { name: "Use as knowledge" }));
    expect(add).toBeEnabled();
    fireEvent.click(add);
    await waitFor(() => expect(calls.some((call) => call.method === "POST" && call.url.endsWith("/api/knowledge"))).toBe(true));
    expect(calls.find((call) => call.method === "POST" && call.url.endsWith("/api/connectors/custom"))!.body).toEqual({ kind: "git", title: "Runbooks", repository: "https://bitbucket.org/acme/data-platform", branch: "knowledge", token: "bb-secret", knowledge: true });
    expect(calls.find((call) => call.method === "POST" && call.url.endsWith("/api/knowledge"))!.body).toEqual({ title: "Runbooks", url: "https://bitbucket.org/acme/data-platform", branch: "knowledge", token: "bb-secret", username: "x-token-auth" });
  });
});
