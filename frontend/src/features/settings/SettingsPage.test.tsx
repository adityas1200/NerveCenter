import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ToastProvider } from "@/components/ui";
import { SettingsPage } from "./SettingsPage";
import { ProjectContext, type ProjectContextValue } from "@/lib/projectContext";
import { jsonResponse, meResponse, mockFetch, renderWithClient, testUsers } from "@/test/utils";

const operations = {
  team: { name: "Data Operations", timezone: "Asia/Kolkata", operator: { name: "Mitesh", email: "ops@company.com" } },
  sync: { enabled: true, interval_seconds: 15 },
  ticketing: { platform: "jira", connection: "atlassian", scope: { site: "https://company.atlassian.net", project: "DATAOPS", queue: "" }, fields: { category: "labels" }, conventions: "Labels dq and pipeline identify work.", app: { sources: [{ platform: "jira", connection: "atlassian", filters: { jql: "project = DATAOPS AND priority in (Highest, High)" }, auto_create_tasks: false, max_concurrent_tasks: 3, permission: "read-only" }] } },
  platforms: [{ name: "analytics", type: "databricks", connection: "databricks", environments: { default: { workspace: "adb-1.azuredatabricks.net", writable: false } }, monitoring: { jobs: "", data_quality: "monitoring.dq_results" } }],
  policy: { default_write: "ask", production_changes: "ask", privileged_access: "ask", ticket_close: "verified-only", email_send: "ask", external_recipients: "deny" },
  connections: { atlassian: { kind: "mcp" }, databricks: { kind: "mcp" } },
};

const alpha = { id: "alpha", name: "Alpha", slug: "alpha", role: "owner" as const, archived: false };
const inAlpha: ProjectContextValue = { projectId: "alpha", slug: "alpha", project: alpha, projects: [alpha], isGlobalAdmin: false, unrouted: 0, visitor: false, setProject: () => {} };

function renderPage(path = "/settings", project?: Partial<ProjectContextValue>) {
  const page = <MemoryRouter initialEntries={[path]}><ToastProvider><Routes><Route path="/settings" element={<SettingsPage />} /><Route path="/" element={<p>Overview</p>} /></Routes></ToastProvider></MemoryRouter>;
  return renderWithClient(project ? <ProjectContext.Provider value={{ ...inAlpha, ...project }}>{page}</ProjectContext.Provider> : page);
}

describe("SettingsPage", () => {
  it("edits ticket sources as a table and saves the ticketing section without a conventions field", async () => {
    const puts: Array<{ url: string; body: unknown }> = [];
    mockFetch((url, init) => {
      if (url.includes("/api/me")) return meResponse(testUsers.admin, "admin");
      if (url.includes("/api/settings/") && init?.method === "PUT") { puts.push({ url, body: JSON.parse(String(init.body)) }); return jsonResponse({ section: url.split("/").pop(), value: {}, validation: { errors: [], warnings: [] } }); }
      if (url.includes("/api/settings")) return jsonResponse({ operations, validation: { errors: [], warnings: [] }, mcp: { mcpServers: {} } });
      if (url.includes("/api/connectors")) return jsonResponse({ items: [] });
      if (url.includes("/api/data-quality/config")) return jsonResponse({ configuration: null });
      return jsonResponse({ items: [] });
    });
    renderPage("/settings?tab=ticketing");

    const scope = await screen.findByLabelText("Source 1 scope");
    expect(scope).toHaveValue("project = DATAOPS AND priority in (Highest, High)");
    expect(screen.queryByLabelText(/conventions/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /conventions/i })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Category field")).toHaveValue("labels");
    const autoCreate = screen.getByRole("switch", { name: "Source 1 auto-create tasks" });
    expect(autoCreate).toHaveAttribute("aria-checked", "false");
    fireEvent.click(autoCreate);
    fireEvent.change(screen.getByLabelText("Source 1 max concurrent tasks"), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0].url).toMatch(/\/api\/settings\/ticketing$/);
    const body = puts[0].body as { app: { sources: Array<Record<string, unknown>> }; fields: { category: string }; platform: string };
    expect(body.platform).toBe("jira");
    expect(body.fields.category).toBe("labels");
    expect(body.app.sources[0]).toMatchObject({ platform: "jira", connection: "atlassian", auto_create_tasks: true, max_concurrent_tasks: 5, permission: "read-only", filters: { jql: "project = DATAOPS AND priority in (Highest, High)" } });
  });

  it("shows workspace and policy as forms, with the project's people instead of the app's users (SPEC-projects-03 FR-21)", async () => {
    mockFetch((url) => {
      if (url.includes("/api/me")) return meResponse(testUsers.admin, "admin", ["settings:write"]);
      if (url.includes("/api/settings")) return jsonResponse({ operations, validation: { errors: [], warnings: [] }, mcp: { mcpServers: {} } });
      if (url.includes("/api/admin/rbac/users")) return jsonResponse({ items: [{ id: "mitesh", name: "Mitesh", email: "mitesh@company.com", role: "admin", blocked: false }] });
      return jsonResponse({ items: [] });
    });
    renderPage();
    expect(await screen.findByRole("textbox", { name: "Workspace name" })).toHaveValue("Data Operations");
    expect(screen.queryByRole("textbox", { name: "Your name" })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Contact email" })).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Workspace", selected: true })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "Policy" }));
    const closing = await screen.findByRole("radiogroup", { name: "Closing tickets" });
    expect(within(closing).getByRole("radio", { name: "Verified only" })).toHaveAttribute("aria-checked", "true");
    expect(within(screen.getByRole("radiogroup", { name: "Email outside the company" })).getByRole("radio", { name: "Deny" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Workspace", "People", "Sources", "Ticketing", "Pipelines", "Data quality", "Automations", "Knowledge and skills", "Policy", "Model", "Templates"]);
    expect(screen.queryByRole("tab", { name: "Users & roles" })).not.toBeInTheDocument();
  });

  it("configures automatic integration sync from Workspace settings", async () => {
    const puts: Array<{ url: string; body: unknown }> = [];
    mockFetch((url, init) => {
      if (url.includes("/api/me")) return meResponse(testUsers.admin, "admin", ["settings:write"]);
      if (url.includes("/api/settings/") && init?.method === "PUT") { puts.push({ url, body: JSON.parse(String(init.body)) }); return jsonResponse({ section: url.split("/").pop(), value: {}, validation: { errors: [], warnings: [] } }); }
      if (url.includes("/api/settings")) return jsonResponse({ operations, validation: { errors: [], warnings: [] }, mcp: { mcpServers: {} } });
      if (url.includes("/api/admin/rbac/users")) return jsonResponse({ items: [] });
      return jsonResponse({ items: [] });
    });
    renderPage();

    const toggle = await screen.findByRole("switch", { name: "Auto sync" });
    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(screen.getByLabelText("Sync every")).toHaveValue(15);
    expect(screen.getByRole("combobox", { name: "Sync interval unit" })).toHaveTextContent("Seconds");
    fireEvent.change(screen.getByLabelText("Sync every"), { target: { value: "30" } });
    fireEvent.click(toggle);
    const card = screen.getByRole("heading", { name: "Automatic sync" }).closest(".shell-card-quiet");
    expect(card).not.toBeNull();
    expect(within(card as HTMLElement).getByLabelText("Sync every")).toBeDisabled();
    expect(within(card as HTMLElement).getByRole("combobox", { name: "Sync interval unit" })).toBeDisabled();
    fireEvent.click(within(card as HTMLElement).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]).toEqual({ url: expect.stringMatching(/\/api\/settings\/sync$/), body: { enabled: false, intervalValue: 30, intervalUnit: "seconds", pipelines: { every: 5, unit: "minutes" }, dataQuality: { every: 15, unit: "minutes" }, retainDays: 60 } });
  });

  it("turns a section off from Settings", async () => {
    const puts: Array<{ url: string; body: unknown }> = [];
    mockFetch((url, init) => {
      if (url.includes("/api/me")) return meResponse(testUsers.admin, "admin", ["settings:write"]);
      if (url.includes("/api/settings/") && init?.method === "PUT") { puts.push({ url, body: JSON.parse(String(init.body)) }); return jsonResponse({ section: url.split("/").pop(), value: {}, validation: { errors: [], warnings: [] } }); }
      if (url.includes("/api/settings")) return jsonResponse({ operations, validation: { errors: [], warnings: [] }, mcp: { mcpServers: {} } });
      if (url.includes("/api/admin/rbac/users")) return jsonResponse({ items: [] });
      return jsonResponse({ items: [] });
    });
    renderPage();

    const toggle = await screen.findByRole("switch", { name: "Data quality" });
    expect(toggle).toHaveAttribute("aria-checked", "true");
    fireEvent.click(toggle);
    const card = screen.getByRole("heading", { name: "Pages" }).closest(".shell-card-quiet") as HTMLElement;
    fireEvent.click(within(card).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]).toEqual({ url: expect.stringMatching(/\/api\/settings\/ui$/), body: { disabledSections: ["data-quality"] } });
  });

  it("turns an already-off section back on, removing it from the list rather than adding a flag", async () => {
    const puts: Array<{ url: string; body: unknown }> = [];
    mockFetch((url, init) => {
      if (url.includes("/api/me")) return meResponse(testUsers.admin, "admin", ["settings:write"]);
      if (url.includes("/api/settings/") && init?.method === "PUT") { puts.push({ url, body: JSON.parse(String(init.body)) }); return jsonResponse({ section: url.split("/").pop(), value: {}, validation: { errors: [], warnings: [] } }); }
      if (url.includes("/api/settings")) return jsonResponse({ operations: { ...operations, ui: { disabledSections: ["data-quality"] } }, validation: { errors: [], warnings: [] }, mcp: { mcpServers: {} } });
      if (url.includes("/api/admin/rbac/users")) return jsonResponse({ items: [] });
      return jsonResponse({ items: [] });
    });
    renderPage();

    const toggle = await screen.findByRole("switch", { name: "Data quality" });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    fireEvent.click(toggle);
    const card = screen.getByRole("heading", { name: "Pages" }).closest(".shell-card-quiet") as HTMLElement;
    fireEvent.click(within(card).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]).toEqual({ url: expect.stringMatching(/\/api\/settings\/ui$/), body: { disabledSections: [] } });
  });

  it("sets a custom sync interval in any unit, only while auto sync is on", async () => {
    const puts: Array<{ url: string; body: unknown }> = [];
    mockFetch((url, init) => {
      if (url.includes("/api/me")) return meResponse(testUsers.admin, "admin", ["settings:write"]);
      if (url.includes("/api/settings/") && init?.method === "PUT") { puts.push({ url, body: JSON.parse(String(init.body)) }); return jsonResponse({ section: url.split("/").pop(), value: {}, validation: { errors: [], warnings: [] } }); }
      if (url.includes("/api/settings")) return jsonResponse({ operations, validation: { errors: [], warnings: [] }, mcp: { mcpServers: {} } });
      if (url.includes("/api/admin/rbac/users")) return jsonResponse({ items: [] });
      return jsonResponse({ items: [] });
    });
    renderPage();

    await screen.findByRole("switch", { name: "Auto sync" });
    const card = screen.getByRole("heading", { name: "Automatic sync" }).closest(".shell-card-quiet") as HTMLElement;
    fireEvent.change(within(card).getByLabelText("Sync every"), { target: { value: "45" } });
    fireEvent.click(within(card).getByRole("combobox", { name: "Sync interval unit" }));
    fireEvent.click(await screen.findByRole("option", { name: "Seconds" }));
    fireEvent.click(within(card).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]).toEqual({ url: expect.stringMatching(/\/api\/settings\/sync$/), body: { enabled: true, intervalValue: 45, intervalUnit: "seconds", pipelines: { every: 5, unit: "minutes" }, dataQuality: { every: 15, unit: "minutes" }, retainDays: 60 } });

    fireEvent.click(within(card).getByRole("switch", { name: "Auto sync" }));
    expect(within(card).getByLabelText("Sync every")).toBeDisabled();
  });

  it("counts the project's people, not connections, in the People glance row", async () => {
    mockFetch((url) => {
      if (url.includes("/api/me")) return meResponse(testUsers.admin, "admin");
      if (url.includes("/api/settings")) return jsonResponse({ operations, validation: { errors: [], warnings: [] }, mcp: { mcpServers: {} } });
      if (url.includes("/api/projects/alpha/members")) return jsonResponse({ items: [{ projectId: "alpha", userId: "mitesh", role: "owner" }, { projectId: "alpha", userId: "priya", role: "developer" }, { projectId: "alpha", userId: "ravi", role: "viewer" }] });
      if (url.includes("/api/admin/rbac/users")) return jsonResponse({ items: [{ id: "mitesh", name: "Mitesh", role: "admin", blocked: false }, { id: "priya", name: "Priya", role: "developer", blocked: false }, { id: "ravi", name: "Ravi", role: "viewer", blocked: false }] });
      return jsonResponse({ items: [] });
    });
    renderPage("/settings", {});
    expect(await screen.findByText("3 people")).toBeInTheDocument();
    expect(screen.queryByText(/connections in operations.yaml/)).not.toBeInTheDocument();
  });

  it("picks a preset per format and uploads a custom file, saving both to the documents section", async () => {
    const presets = {
      word: [{ id: "plain", name: "Plain", description: "A minimal, unbranded document." }, { id: "formal-report", name: "Formal report", description: "A cover page and table of contents." }],
      ppt: [{ id: "plain", name: "Plain", description: "A minimal, unbranded deck." }],
      html: [{ id: "plain", name: "Plain", description: "A minimal, unbranded page." }],
    };
    const puts: Array<{ url: string; body: unknown }> = [];
    let uploaded: Record<string, unknown> | null = null;
    mockFetch((url, init) => {
      if (url.includes("/api/me")) return meResponse(testUsers.admin, "admin");
      if (url.endsWith("/api/templates/upload") && init?.method === "POST") { uploaded = JSON.parse(String(init.body)); return jsonResponse({ format: uploaded.format, kind: "custom", fileName: "123-brand.html", originalName: "brand.html", uploadedAt: "2026-09-29T00:00:00Z", uploadedBy: "admin.local" }, 201); }
      if (url.endsWith("/api/templates")) return jsonResponse({ presets });
      if (url.includes("/api/settings/") && init?.method === "PUT") { puts.push({ url, body: JSON.parse(String(init.body)) }); return jsonResponse({ section: url.split("/").pop(), value: {}, validation: { errors: [], warnings: [] } }); }
      if (url.includes("/api/settings")) return jsonResponse({ operations, validation: { errors: [], warnings: [] }, mcp: { mcpServers: {} } });
      return jsonResponse({ items: [] });
    });
    renderPage("/settings?tab=templates");

    const word = await screen.findByRole("radiogroup", { name: "Word template" });
    fireEvent.click(within(word).getByRole("radio", { name: /Formal report/ }));
    expect(within(word).getByRole("radio", { name: /Formal report/ })).toHaveAttribute("aria-checked", "true");
    expect(within(word).getByRole("radio", { name: /Plain/ })).toHaveAttribute("aria-checked", "false");

    const html = within(await screen.findByRole("radiogroup", { name: "HTML template" }));
    const file = new File(["<html></html>"], "brand.html", { type: "text/html" });
    fireEvent.change(html.getByLabelText("Upload a HTML template"), { target: { files: [file] } });
    await waitFor(() => expect(uploaded).not.toBeNull());
    expect(uploaded).toMatchObject({ format: "html", fileName: "brand.html" });
    await waitFor(() => expect(html.getByRole("radio", { name: /Upload your own/ })).toHaveAttribute("aria-checked", "true"));
    expect(html.getByText("brand.html")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0].url).toMatch(/\/api\/settings\/documents$/);
    expect(puts[0].body).toMatchObject({
      templates: {
        word: { kind: "preset", id: "formal-report" },
        html: { kind: "custom", fileName: "123-brand.html" },
      },
    });
  });

  it("opens People for someone who does not run the project, and sends a visitor back to the overview", async () => {
    mockFetch((url) => url.includes("/api/me") ? meResponse(testUsers.dev, "developer") : jsonResponse({ items: [] }));
    const { unmount } = renderPage("/settings", { project: { ...alpha, role: "developer" } });
    expect(await screen.findByRole("tab", { name: "People", selected: true })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Workspace" })).not.toBeInTheDocument();
    unmount();
    renderPage("/settings", { visitor: true, project: { ...alpha, role: "open" } });
    expect(await screen.findByText("Overview")).toBeInTheDocument();
  });

  it("lets a member read the policy, with the controls off and no other sections", async () => {
    mockFetch((url) => {
      if (url.includes("/api/me")) return meResponse(testUsers.dev, "developer");
      if (url.includes("/api/settings")) return jsonResponse({ operations, validation: { errors: [], warnings: [] }, mcp: { mcpServers: {} } });
      return jsonResponse({ items: [] });
    });
    renderPage("/settings?tab=policy");
    const closing = await screen.findByRole("radiogroup", { name: "Closing tickets" });
    expect(within(closing).getByRole("radio", { name: "Verified only" })).toHaveAttribute("aria-checked", "true");
    expect(within(closing).getByRole("radio", { name: "Verified only" })).toBeDisabled();
    expect(screen.getByText("Only owners can change this")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    // SPEC-projects-03 FR-21: People and Policy.
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["People", "Policy"]);
    expect(screen.queryByRole("tab", { name: "Users & roles" })).not.toBeInTheDocument();
    expect(screen.queryByText("Overview")).not.toBeInTheDocument();
  });
});
