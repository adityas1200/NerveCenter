import { screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { ToastProvider } from "@/components/ui";
import { HomePage } from "./HomePage";
import { jsonResponse, meResponse, mockFetch, renderWithClient, testUsers } from "@/test/utils";

// SPEC-projects-03 FR-15, FR-16: Home is the hero, your projects (name and role), the open ones, and the footer.

const project = (id: string, name: string, role: string) => ({ id, name, slug: id, role, archived: false, color: "teal" });

function serve(role: string, items: unknown[], all = false) {
  return mockFetch((url) => {
    if (url.endsWith("/api/me/projects")) return jsonResponse({ items, all });
    if (url.endsWith("/api/me")) return meResponse(testUsers.operator, role);
    if (url.endsWith("/api/meta")) return jsonResponse({ environment: "test" });
    return jsonResponse({});
  });
}
const show = () => renderWithClient(<MemoryRouter><ToastProvider><HomePage /></ToastProvider></MemoryRouter>);

describe("HomePage", () => {
  it("shows your projects with your role, the open ones apart, and New project for a developer", async () => {
    serve("developer", [project("sales", "Sales", "owner"), project("ops", "Ops", "viewer"), project("commons", "Commons", "open")]);
    show();
    const sales = await screen.findByRole("link", { name: /Sales\s*Owner/ });
    expect(sales).toHaveAttribute("href", "/p/sales");
    expect(screen.getByRole("link", { name: /Ops\s*Viewer/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Open to everyone" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Commons\s*View only/ })).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /New project/ }).length).toBeGreaterThan(0);
  });

  it("FR-1: a new viewer sees No projects yet and no New project", async () => {
    serve("viewer", [project("commons", "Commons", "open")]);
    show();
    expect(await screen.findByText("No projects yet")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /New project/ })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Commons\s*View only/ })).toBeInTheDocument();
  });

  it("an app admin sees every other project under Everything else, and and no footer links", async () => {
    serve("admin", [project("sales", "Sales", "developer"), project("finance", "Finance", "admin")], true);
    show();
    expect(await screen.findByRole("heading", { name: "Everything else" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Finance\s*Admin/ })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Footer" })).not.toBeInTheDocument();
  });
});
