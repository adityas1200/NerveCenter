import { screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { setCurrentProject } from "@/api/projects";
import { ToastProvider, TooltipProvider } from "@/components/ui";
import { AppRouter } from "@/lib/appRouter";
import { ProjectProvider } from "@/lib/project";
import { Root } from "./Root";
import { jsonResponse, meResponse, mockFetch, renderWithClient, testUsers } from "@/test/utils";

// SPEC-projects-03 FR-14, FR-16: home outside a project; a link from before projects had URLs opens in your last project.

const mine = { items: [{ id: "alpha", name: "Alpha", slug: "alpha", role: "developer", archived: false }, { id: "beta", name: "Beta", slug: "beta", role: "owner", archived: false }], all: false };
function serve() {
  return mockFetch((url) => {
    if (url.endsWith("/api/me/projects")) return jsonResponse(mine);
    if (url.endsWith("/api/me")) return meResponse(testUsers.operator, "developer");
    if (url.endsWith("/api/me/access")) return jsonResponse({ projectId: "beta", access: "member", appRole: "developer", projectRole: "owner", role: "developer", permissions: ["tickets.manage"] });
    return jsonResponse({ items: [] });
  });
}
function renderAt(path: string) {
  window.history.replaceState({}, "", path);
  return renderWithClient(<AppRouter><ProjectProvider><TooltipProvider><ToastProvider><Root /></ToastProvider></TooltipProvider></ProjectProvider></AppRouter>);
}
afterEach(() => { localStorage.clear(); setCurrentProject(null); window.history.replaceState({}, "", "/"); });

describe("Root", () => {
  it("shows Home at /", async () => {
    serve();
    renderAt("/");
    expect(await screen.findByRole("heading", { name: "Projects" })).toBeInTheDocument();
  });

  it("opens an old link in the project used last", async () => {
    serve();
    localStorage.setItem("nc-project", "beta");
    renderAt("/tickets/OPS-12?status=all");
    await waitFor(() => expect(window.location.pathname).toBe("/p/beta/tickets/OPS-12"));
    expect(window.location.search).toBe("?status=all");
  });

  it("opens an old link in the first project when none was used before", async () => {
    serve();
    renderAt("/boards");
    await waitFor(() => expect(window.location.pathname).toBe("/p/alpha/boards"));
  });
});
