import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { ToastProvider } from "@/components/ui";
import { AdminConsolePage } from "./AdminConsolePage";
import { jsonResponse, meResponse, mockFetch, renderWithClient, testUsers } from "@/test/utils";

// SPEC-projects-03 FR-20: people and their roles, projects and the open flag, which connections owners may grant.

type Call = { url: string; method: string; body: unknown };
const project = (id: string, name: string, open = false) => ({ id, name, slug: id, description: "", kind: "normal", open, color: "teal", archivedAt: null, createdAt: "2026-10-05T00:00:00Z", createdBy: "x" });

function serve(role = "admin") {
  const calls: Call[] = [];
  mockFetch((url, init) => {
    const method = init?.method ?? "GET";
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (url.endsWith("/api/me/projects")) return jsonResponse({ items: [], all: role === "admin", unrouted: 2 });
    if (url.endsWith("/api/me")) return meResponse(testUsers.operator, role);
    if (url.endsWith("/api/admin/rbac/users") && method === "POST") return jsonResponse({ id: "new@zs.com", name: "New", role: "viewer", blocked: false }, 201);
    if (url.endsWith("/api/admin/rbac/users")) return jsonResponse({ items: [
      { id: "mitesh", name: "Mitesh Shinde", email: "mitesh@zs.com", role: "admin", blocked: false, projects: [{ projectId: "sales", role: "owner" }] },
      { id: "priya", name: "Priya Nair", email: "priya@zs.com", role: "viewer", blocked: false, projects: [{ projectId: "sales", role: "developer" }] },
    ] });
    if (url.includes("/api/admin/rbac/users/") && method === "POST") return jsonResponse({});
    if (url.endsWith("/api/projects")) return jsonResponse({ items: [project("sales", "Sales"), project("finance", "Finance", true)] });
    if (url.endsWith("/members")) return jsonResponse({ items: [{ projectId: "sales", userId: "mitesh", role: "owner" }] });
    if (url.endsWith("/grants")) return jsonResponse({ items: url.includes("/sales/") ? [{ projectId: "sales", resourceType: "connection", resourceId: "jira-lib" }] : [] });
    if (url.endsWith("/api/connections")) return jsonResponse({ items: [{ id: "jira-lib", name: "Jira", provider: "jira", projectAdminsMayGrant: false }] });
    return jsonResponse({});
  });
  return calls;
}
const show = (path = "/admin") => renderWithClient(<MemoryRouter initialEntries={[path]}><ToastProvider><Routes><Route path="/admin" element={<AdminConsolePage />} /><Route path="/admin/:tab" element={<AdminConsolePage />} /><Route path="/" element={<p>Home page</p>} /></Routes></ToastProvider></MemoryRouter>);

describe("AdminConsolePage", () => {
  it("People: lists everyone with their app role, and changes one", async () => {
    const calls = serve();
    show();
    const priya = await screen.findByRole("button", { name: /Priya Nair/ });
    expect(priya).toHaveTextContent("Viewer");
    await userEvent.click(priya);
    const drawer = await screen.findByRole("complementary", { name: "Priya Nair" });
    await userEvent.click(within(drawer).getByRole("radio", { name: "Developer" }));
    await waitFor(() => expect(calls.some((call) => call.method === "POST" && call.url.endsWith("/api/admin/rbac/users/priya/role"))).toBe(true));
    expect(calls.find((call) => call.url.endsWith("/users/priya/role"))?.body).toEqual({ role: "developer" });
    expect(within(drawer).getByRole("combobox", { name: "Role in Sales" })).toHaveTextContent("Developer");
  });

  it("People: adds a person before they sign in, with inline validation, as a viewer by default", async () => {
    const calls = serve();
    show();
    await screen.findByRole("button", { name: /Priya Nair/ });
    await userEvent.click(screen.getByRole("button", { name: "Add person" }));
    const dialog = await screen.findByRole("dialog", { name: "Add person" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Add person" }));
    expect(within(dialog).getByRole("alert")).toHaveTextContent("Enter an email or user id");
    const id = within(dialog).getByRole("textbox", { name: "Email or user id" });
    await userEvent.type(id, "PRIYA");
    expect(within(dialog).getByRole("alert")).toHaveTextContent("Already a user");
    await userEvent.clear(id); await userEvent.type(id, "new@zs.com");
    await userEvent.click(within(dialog).getByRole("button", { name: "Add person" }));
    await waitFor(() => expect(calls.some((call) => call.method === "POST" && call.url.endsWith("/api/admin/rbac/users"))).toBe(true));
    expect(calls.find((call) => call.method === "POST" && call.url.endsWith("/api/admin/rbac/users"))?.body).toEqual({ id: "new@zs.com", name: "new@zs.com", email: "new@zs.com", role: "viewer" });
  });

  it("Projects: opens a project to everyone, and the Unrouted queue is a click away", async () => {
    const calls = serve();
    show("/admin/projects");
    const toggle = await screen.findByRole("switch", { name: "Open Sales to everyone" });
    expect(screen.getByRole("switch", { name: "Open Finance to everyone" })).toBeChecked();
    expect(screen.getByRole("button", { name: /Unrouted\s*2/ })).toBeInTheDocument();
    await userEvent.click(toggle);
    await waitFor(() => expect(calls.some((call) => call.method === "PATCH" && call.url.endsWith("/api/projects/sales"))).toBe(true));
    expect(calls.find((call) => call.method === "PATCH")?.body).toEqual({ open: true });
  });

  it("Connections: shows which projects use each one and lets owners grant it", async () => {
    const calls = serve();
    show("/admin/connections");
    const toggle = await screen.findByRole("switch", { name: "Owners can grant Jira" });
    expect(screen.getAllByTitle("sales").length).toBeGreaterThan(0);
    await userEvent.click(toggle);
    await waitFor(() => expect(calls.some((call) => call.method === "PATCH" && call.url.endsWith("/api/connections/jira-lib"))).toBe(true));
    expect(calls.find((call) => call.method === "PATCH" && call.url.endsWith("/api/connections/jira-lib"))?.body).toEqual({ projectAdminsMayGrant: true });
  });

  it("is for app admins only", async () => {
    serve("developer");
    show();
    expect(await screen.findByText("Home page")).toBeInTheDocument();
  });
});
