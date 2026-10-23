import { screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { ToastProvider } from "@/components/ui";
import { AdminConsolePage } from "./AdminConsolePage";
import { jsonResponse, meResponse, mockFetch, renderWithClient, testUsers } from "@/test/utils";

// ADR 0003: the RBAC audit log is removed, so the admin console has no Audit log tab and never asks for it.

function serve() {
  const urls: string[] = [];
  mockFetch((url) => {
    urls.push(url);
    if (url.endsWith("/api/me/projects")) return jsonResponse({ items: [], all: true, unrouted: 0 });
    if (url.endsWith("/api/me")) return meResponse(testUsers.operator, "admin");
    if (url.endsWith("/api/admin/rbac/users")) return jsonResponse({ items: [{ id: "mitesh", name: "Mitesh Shinde", email: "mitesh@zs.com", role: "admin", blocked: false, projects: [] }] });
    return jsonResponse({ items: [] });
  });
  return urls;
}
const show = (path: string) => renderWithClient(<MemoryRouter initialEntries={[path]}><ToastProvider><Routes><Route path="/admin" element={<AdminConsolePage />} /><Route path="/admin/:tab" element={<AdminConsolePage />} /></Routes></ToastProvider></MemoryRouter>);

describe("AdminConsolePage without the audit log", () => {
  it("offers People, Projects and Connections only", async () => {
    serve();
    show("/admin");
    expect(await screen.findByRole("button", { name: /Mitesh Shinde/ })).toBeInTheDocument();
    for (const name of ["People", "Projects", "Connections"]) expect(screen.getByRole("radio", { name })).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: "Audit log" })).not.toBeInTheDocument();
  });

  it("an old /admin/audit link opens People and never calls the removed route", async () => {
    const urls = serve();
    show("/admin/audit");
    expect(await screen.findByRole("button", { name: /Mitesh Shinde/ })).toBeInTheDocument();
    expect(screen.queryByText("Find an entry")).not.toBeInTheDocument();
    expect(urls.some((url) => url.includes("/api/admin/rbac/audit"))).toBe(false);
  });
});
