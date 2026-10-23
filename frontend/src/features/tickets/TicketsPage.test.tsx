import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { TicketsPage } from "@/features/tickets/TicketsPage";
import { AgentPanelProvider } from "@/components/ops/AgentPanel";
import { ToastProvider } from "@/components/ui";
import { jsonResponse, meResponse, mockFetch, renderWithClient, testUsers } from "@/test/utils";
import { ticketPageTestResponse } from "./ticketPageTestServer";

const incident = {
  ticketId: "OPS-1001",
  appStatus: "in_progress",
  sourceStatus: "In Progress",
  agent: { state: "done", label: "Findings ready", summary: "The upstream file arrived without REGION_CODE.", taskId: "T-1" },
  taskId: "T-1",
  taskStatus: "done",
  source: "servicenow",
  pipelineId: "servicenow:sn-1",
  runId: "sn-1",
  platform: "servicenow",
  title: "Daily sales ingestion failed",
  failureSummary: "The source schema changed.",
  priority: "high",
  status: "in_progress",
  category: "Data Platform",
  createdAt: "2026-08-24T07:20:00Z",
  updatedAt: "2026-08-24T08:15:00Z",
  externalReference: { system: "servicenow", sysId: "sn-1", number: "INC0012345", url: "https://fixture.service-now.com/nav_to.do?uri=incident.do" },
  metadata: { source: "servicenow", serviceNow: { sysId: "sn-1", number: "INC0012345", state: "In Progress", requester: "Data Operations", assignedTo: "Platform Support", category: "Data Platform" } },
  approver: { id: "access.approver", name: "Access Approver" },
  classification: {
    ticketId: "OPS-1001",
    version: 1,
    runId: "classification-run-1",
    intent: "snowflake_access",
    category: "access_request",
    ticketType: "Snowflake access",
    confidence: 0.97,
    reason: "The ticket explicitly requests Snowflake production access.",
    evidence: ["Snowflake", "production access"],
    extractedFields: { environment: "prod", requesterType: "employee" },
    missingFields: ["requestedRole"],
    specialistAgent: "ticket-access-specialist",
    recommendedQueue: "Data Access",
    agentGoal: "Validate the requester and prepare the governed Snowflake access request.",
    references: [],
    risk: "high",
    approvalRequired: true,
    approvalReason: "Production access requires approval.",
    humanReviewRequired: true,
    reassignmentRecommended: false,
    autoExecutable: false,
    executionBlockedReason: "This external ticket requires human write-back because no approved external update connector is registered.",
    review: { required: true, status: "open", workItemId: "work-item-1", queue: "Data Access" },
    actionPlan: { goal: "Prepare the approved access request.", status: "ready", approvalRequired: true, approvalStatus: "pending", steps: [] },
    createdAt: "2026-08-24T08:14:00Z",
  },
  permissions: { canAssign: false },
};

const serviceNowReady = { mode: "fixture", configured: true, ready: true, instance: "fixture.service-now.com", source: "fixture", assignmentGroups: ["Data Platform Support"] };

type Handler = (path: string, init?: RequestInit) => Promise<Response> | null;

function stubFetch(handler: Handler) {
  const fetchMock = mockFetch((path, init) => {
    const handled = handler(path, init);
    if (handled && path.startsWith("/api/tickets?")) return Promise.resolve(handled).then(async response => {
      const body = await response.clone().json();
      return ticketPageTestResponse(path, body.items || []);
    });
    if (handled) return handled;
    if (path.startsWith("/api/me")) return meResponse(testUsers.demo, "admin");
    if (path.includes("/api/integrations/servicenow/status")) return jsonResponse(serviceNowReady);
    if (/\/api\/tickets\/[^/]+\/activity$/.test(path)) return jsonResponse({ items: [] });
    return jsonResponse({ items: [] });
  });
  return fetchMock;
}

function renderTickets(path: string) {
  return renderWithClient(<MemoryRouter initialEntries={[path]}><ToastProvider><AgentPanelProvider><Routes><Route path="/tickets" element={<TicketsPage />} /><Route path="/tickets/:ticketId" element={<TicketsPage />} /><Route path="/workbench/:ticketId" element={<p>Workbench</p>} /></Routes></AgentPanelProvider></ToastProvider></MemoryRouter>);
}

const closedByAgent = (ticketId: string, extra: Record<string, unknown>) => ({ ...incident, ticketId, status: "closed", resolvedWithAgent: true, closedAt: new Date(Date.now() - 3600_000).toISOString(), updatedAt: new Date(Date.now() - 3600_000).toISOString(), externalReference: undefined, source: "manual", ...extra });

describe("TicketsPage", () => {
  afterEach(() => { try { window.localStorage?.clear(); } catch { /* jsdom without storage */ } });
  // The Sonic panel body is code-split and loads on first open; compile it once here so a test waits for behaviour, not the bundler.
  beforeAll(() => import("@/components/ops/AgentPanelBody"), 30_000);

  it("imports a filtered ServiceNow set through the sync dialog and shows the ticket as a table row and a quick view", async () => {
    let tickets: unknown[] = [];
    stubFetch((path, init) => {
      if (path.includes("/api/integrations/servicenow/preview") && init?.method === "POST") return jsonResponse({ total: 1, alreadyImported: 0, sample: [] });
      if (path.includes("/api/integrations/servicenow/sync") && init?.method === "POST") { tickets = [incident]; return jsonResponse({ synced: 1, source: "fixture", tickets }); }
      if (path === "/api/tickets/OPS-1001") return jsonResponse(incident);
      if (path.startsWith("/api/tickets?")) return jsonResponse({ items: tickets });
      return null;
    });
    renderTickets("/tickets");

    const more = await screen.findByRole("button", { name: "More actions" });
    await userEvent.click(more);
    const serviceNowItem = await screen.findByRole("menuitem", { name: /ServiceNow/i });
    await waitFor(() => expect(serviceNowItem).toBeEnabled());
    fireEvent.click(serviceNowItem);
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText(/1 incident matches/)).toBeInTheDocument();
    expect(within(dialog).getByRole("switch", { name: "Start agent triage on imported tickets" })).toHaveAttribute("aria-checked", "false");
    fireEvent.click(within(dialog).getByRole("button", { name: /^Import/ }));

    await screen.findByText("INC0012345");
    const table = screen.getByRole("table");
    expect(within(table).getByText("P2")).toBeInTheDocument();
    expect(within(table).getByText("In progress")).toBeInTheDocument();
    expect(within(table).queryByText("The upstream file arrived without REGION_CODE.")).not.toBeInTheDocument();
    expect(within(table).getByText("ServiceNow")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open tickets: 1" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "High priority open: 1" })).toHaveAttribute("href", "/tickets?priority=critical,high");
    expect(screen.queryByRole("combobox", { name: /Filter by agent/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: /Filter by type/i })).not.toBeInTheDocument();

    const syncCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.find(([url, init]) => String(url).includes("/servicenow/sync") && (init as RequestInit)?.method === "POST");
    expect(JSON.parse(String((syncCall?.[1] as RequestInit).body))).toMatchObject({ assignmentGroup: "Data Platform Support", states: ["New", "In Progress"], priorities: ["1", "2"], limit: 10, startTriage: false });

    fireEvent.click(within(table).getByRole("button", { name: "Daily sales ingestion failed" }));
    await screen.findByText("What Sonic found");
    const sonic = within(screen.getByRole("dialog"));
    expect(sonic.getByRole("button", { name: "Ask Sonic" })).toBeInTheDocument();
    // A ticket with a finished task opens that task and can send it back over the ticket; only a ticket without a task says Investigate.
    expect(sonic.getByRole("link", { name: "Open task" })).toHaveAttribute("href", "/tasks/T-1");
    expect(sonic.getByRole("button", { name: "Look again" })).toBeInTheDocument();
    expect(sonic.queryByRole("button", { name: "Investigate" })).not.toBeInTheDocument();
    expect(sonic.getByText("The upstream file arrived without REGION_CODE.")).toBeInTheDocument();
    expect(screen.getByText("Saved in ServiceNow INC0012345 too.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Run RCA/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Open in Workbench/i })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open INC0012345 in ServiceNow/i })).toHaveAttribute("href", incident.externalReference.url);
    expect(screen.getByRole("button", { name: "Comment" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resolve" })).toBeInTheDocument();
    expect(screen.getByText("ServiceNow state")).toBeInTheDocument();
    expect(screen.queryByText("Why it was routed this way")).not.toBeInTheDocument();
  });

  it("applies filters from the URL, including a comma list, so Overview tiles land on a filtered list", async () => {
    const lowPriority = { ...incident, ticketId: "OPS-1002", priority: "low", externalReference: undefined, source: "manual", title: "Rotate a service key" };
    const critical = { ...incident, ticketId: "OPS-1003", priority: "critical", externalReference: undefined, source: "manual", title: "Warehouse is down" };
    stubFetch((path) => path.startsWith("/api/tickets?") ? jsonResponse({ items: [incident, lowPriority, critical] }) : null);
    renderTickets("/tickets?priority=critical,high");
    await screen.findByText("INC0012345");
    expect(screen.getByText("Warehouse is down")).toBeInTheDocument();
    expect(screen.queryByText("Rotate a service key")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear 1" })).toBeInTheDocument();
  });

  it("filters the agent's fixes by kind from the URL and accepts the old resolved=dobby value", async () => {
    const pipelineFix = closedByAgent("OPS-2001", { kind: "pipeline", title: "Sales refresh fixed" });
    const dqFix = closedByAgent("OPS-2002", { kind: "data_quality", title: "Null regions fixed" });
    const closedByHand = closedByAgent("OPS-2003", { kind: "pipeline", resolvedWithAgent: false, title: "Closed by a person" });
    stubFetch((path) => path.startsWith("/api/tickets?") ? jsonResponse({ items: [incident, pipelineFix, dqFix, closedByHand] }) : null);
    const { unmount } = renderTickets("/tickets?scope=closed&resolved=sonic&kind=pipeline&range=24h");
    expect(await screen.findByText("Sales refresh fixed")).toBeInTheDocument();
    expect(screen.queryByText("Null regions fixed")).not.toBeInTheDocument();
    expect(screen.queryByText("Closed by a person")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear 2" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /^Fixed with Sonic: 2 of 3 closed/ })).toHaveAttribute("href", "/tickets?scope=closed&resolved=sonic&range=24h");
    expect(screen.queryByText(/Resolved with Sonic/)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Waiting on you: 0" })).toBeInTheDocument();
    unmount();

    renderTickets("/tickets?scope=closed&resolved=dobby");
    expect(await screen.findByText("Sales refresh fixed")).toBeInTheDocument();
    expect(screen.getByText("Null regions fixed")).toBeInTheDocument();
    expect(screen.queryByText("Closed by a person")).not.toBeInTheDocument();
  });

  it("filters by category from the URL, treating data_quality as any check-sourced ticket", async () => {
    const byCategory = { ...incident, ticketId: "OPS-3001", category: "data_quality", externalReference: undefined, source: "manual", title: "Row count drift" };
    const bySource = { ...incident, ticketId: "OPS-3002", category: undefined, externalReference: undefined, source: "agentic-monitor", title: "Freshness check failed" };
    stubFetch((path) => path.startsWith("/api/tickets?") ? jsonResponse({ items: [incident, byCategory, bySource] }) : null);
    renderTickets("/tickets?category=data_quality");
    expect(await screen.findByText("Row count drift")).toBeInTheDocument();
    expect(screen.getByText("Freshness check failed")).toBeInTheDocument();
    expect(screen.queryByText("Daily sales ingestion failed")).not.toBeInTheDocument();
    expect(screen.getByText("2 of 3 open tickets")).toBeInTheDocument();
  });

  it("shows when each ticket was last updated in a sortable column", async () => {
    const older = { ...incident, ticketId: "OPS-4001", externalReference: undefined, source: "manual", title: "Older change", updatedAt: new Date(Date.now() - 3 * 24 * 3600_000).toISOString() };
    const newer = { ...incident, ticketId: "OPS-4002", externalReference: undefined, source: "manual", title: "Fresh change", updatedAt: new Date(Date.now() - 5 * 60_000).toISOString() };
    stubFetch((path) => path.startsWith("/api/tickets?") ? jsonResponse({ items: [older, newer] }) : null);
    renderTickets("/tickets");
    await screen.findByText("Older change");
    const header = screen.getByRole("columnheader", { name: /Updated/ });
    expect(header).toHaveAttribute("aria-sort", "none");
    expect(screen.getByText("3d ago")).toBeInTheDocument();
    expect(screen.getByText("5m ago")).toBeInTheDocument();
    await userEvent.click(within(header).getByRole("button"));
    await waitFor(() => expect(screen.getByRole("columnheader", { name: /Updated/ })).toHaveAttribute("aria-sort", "ascending"));
    const titles = () => screen.getAllByRole("row").slice(1).map((row) => within(row).getByRole("button", { name: /change$/ }).textContent);
    expect(titles()).toEqual(["Fresh change", "Older change"]);
    await userEvent.click(within(screen.getByRole("columnheader", { name: /Updated/ })).getByRole("button"));
    await waitFor(() => expect(titles()).toEqual(["Older change", "Fresh change"]));
  });

  it("points at Connectors when there are no tickets and no ticket source is configured", async () => {
    stubFetch((path) => {
      if (path.includes("/api/integrations/servicenow/status")) return jsonResponse({ mode: "disabled", configured: false, ready: false });
      if (path.includes("/api/integrations/jira/status")) return jsonResponse({ mode: "disabled", configured: false, ready: false });
      if (path.startsWith("/api/tickets?")) return jsonResponse({ items: [] });
      return null;
    });
    renderTickets("/tickets");
    expect(await screen.findByText(/No ticket source connected/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Connect ServiceNow or Jira" })).toHaveAttribute("href", "/connectors");
    expect(screen.queryByText("No open tickets")).not.toBeInTheDocument();
  });

  it("keeps the plain empty state when a source is connected but has nothing open", async () => {
    stubFetch((path) => path.startsWith("/api/tickets?") ? jsonResponse({ items: [] }) : null);
    renderTickets("/tickets");
    expect(await screen.findByText("No open tickets")).toBeInTheDocument();
    expect(screen.queryByText(/No ticket source connected/)).not.toBeInTheDocument();
  });

  it("asks Sonic about a ticket from the row without opening it", async () => {
    let created: Record<string, unknown> | null = null;
    const panelTask = { id: "T-9001", type: "adhoc", title: "Ticket", summary: "", status: "running", permission: "policy", context: {}, createdBy: testUsers.demo, createdAt: "2026-09-24T09:14:00Z", updatedAt: "2026-09-24T09:14:00Z", cost: { totalUsd: 0, inputTokens: 0, outputTokens: 0, turns: 0, durationMs: 0, runs: 0 } };
    const fetchMock = stubFetch((path, init) => {
      if (path.endsWith("/api/tasks") && init?.method === "POST") { created = JSON.parse(String(init.body)); return jsonResponse({ ...panelTask, events: [] }, 201); }
      if (path.includes("/api/tasks/T-9001/events")) return Promise.resolve(new Response("", { status: 200, headers: { "content-type": "text/event-stream" } }));
      if (path.endsWith("/api/tasks/T-9001")) return jsonResponse({ ...panelTask, events: [] });
      if (path.startsWith("/api/tickets?")) return jsonResponse({ items: [incident] });
      return null;
    });
    renderTickets("/tickets");
    await screen.findByText("INC0012345");
    fireEvent.click(screen.getByRole("button", { name: "Ask Sonic about this ticket" }));
    // Clicking only types the prompt; nothing is sent until the user sends it.
    const panel = await screen.findByRole("complementary", { name: "Sonic panel" });
    await waitFor(() => expect(within(panel).getByRole("textbox")).toHaveValue("Tell me about ticket INC0012345 and what I should do next"));
    expect(created).toBeNull();
    fireEvent.click(within(panel).getByRole("button", { name: "Send" }));
    await waitFor(() => expect(created).not.toBeNull());
    expect(created).toMatchObject({ type: "adhoc", prompt: "Tell me about ticket INC0012345 and what I should do next", context: { page: { name: "Tickets", selection: { kind: "ticket", id: "OPS-1001", title: "Daily sales ingestion failed" } } } });
    expect(document.querySelector('aside[aria-label="Sonic panel"]')).toHaveAttribute("aria-hidden", "false");
    expect(fetchMock.mock.calls.some(([url]) => String(url) === "/api/tickets/OPS-1001")).toBe(false);
  });

  it("keeps open tickets visible regardless of the reporting window but scopes closed ones", async () => {
    const oldClosed = { ...incident, ticketId: "OPS-0900", status: "closed", closedAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", externalReference: undefined, source: "manual", title: "Ancient closed ticket" };
    const oldOpen = { ...incident, ticketId: "OPS-0901", status: "open", updatedAt: "2026-01-01T00:00:00Z", externalReference: undefined, source: "manual", title: "Ancient but still open" };
    stubFetch((path) => path.startsWith("/api/tickets?") ? jsonResponse({ items: [oldClosed, oldOpen] }) : null);
    renderTickets("/tickets?scope=all");
    expect(await screen.findByText("Ancient but still open")).toBeInTheDocument();
    expect(screen.queryByText("Ancient closed ticket")).not.toBeInTheDocument();
  });

  it("lets a person claim an unowned ticket from the row and comment from the quick view", async () => {
    const unowned = { ...incident, assignee: null, permissions: { canAssign: true, canComment: true } };
    const fetchMock = stubFetch((path, init) => {
      if (path === "/api/tickets/OPS-1001" && init?.method === "PATCH") return jsonResponse({ ...unowned, assignee: JSON.parse(String(init.body)).assignee });
      if (path === "/api/tickets/OPS-1001/comments" && init?.method === "POST") return jsonResponse({ ticketId: "OPS-1001", event: { id: "e1", type: "ticket.comment", title: "Demo User commented", detail: "Looking now", at: "2026-08-24T09:00:00Z" } });
      if (path === "/api/tickets/OPS-1001") return jsonResponse(unowned);
      if (path.startsWith("/api/tickets?")) return jsonResponse({ items: [unowned] });
      return null;
    });
    renderTickets("/tickets");
    await userEvent.click(await screen.findByRole("button", { name: "Assign to me" }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url, init]) => String(url) === "/api/tickets/OPS-1001" && (init as RequestInit)?.method === "PATCH")).toBe(true));
    const patch = fetchMock.mock.calls.find(([, init]) => (init as RequestInit)?.method === "PATCH")?.[1] as RequestInit;
    expect(JSON.parse(String(patch.body))).toEqual({ assignee: { id: "demo.user", name: "Demo User" } });

    fireEvent.click(screen.getByRole("button", { name: "Daily sales ingestion failed" }));
    fireEvent.click(await screen.findByRole("button", { name: "Comment" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Comment" }), "Looking now");
    fireEvent.click(screen.getByRole("button", { name: "Add comment" }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url, init]) => String(url) === "/api/tickets/OPS-1001/comments" && (init as RequestInit)?.method === "POST")).toBe(true));
  });

  it("creates a ticket with a priority and an owner and without source or reference fields", async () => {
    const fetchMock = stubFetch((path, init) => {
      if (path === "/api/tickets" && init?.method === "POST") return jsonResponse({ ticketId: "OPS-2001", status: "open", title: "Access for the new analyst" });
      if (path.startsWith("/api/tickets?")) return jsonResponse({ items: [] });
      return null;
    });
    renderTickets("/tickets");
    fireEvent.click(await screen.findByRole("button", { name: /New ticket/i }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByLabelText(/Source/)).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText(/Reference/)).not.toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText("Title"), "Access for the new analyst");
    fireEvent.click(within(dialog).getByRole("button", { name: "Create ticket" }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url, init]) => String(url) === "/api/tickets" && (init as RequestInit)?.method === "POST")).toBe(true));
    const body = JSON.parse(String((fetchMock.mock.calls.find(([url, init]) => String(url) === "/api/tickets" && (init as RequestInit)?.method === "POST")?.[1] as RequestInit).body));
    expect(body).toMatchObject({ title: "Access for the new analyst", category: "incident", priority: "medium", assignee: { id: "demo.user", name: "Demo User" }, startTriage: true });
    expect(body.source).toBeUndefined();
    expect(body.sourceRef).toBeUndefined();
  });
});
