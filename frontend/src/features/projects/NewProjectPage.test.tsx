import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { ToastProvider } from "@/components/ui";
import { NewProjectPage } from "./NewProjectPage";
import { jsonResponse, meResponse, mockFetch, renderWithClient, testUsers } from "@/test/utils";

// SPEC-projects-03 FR-18, FR-19: five steps and one call that creates the project with all of it.

const grantable = {
  connections: [{ id: "jira-shared", name: "Jira", provider: "jira", projectAdminsMayGrant: true }, { id: "snow-locked", name: "ServiceNow", provider: "servicenow", projectAdminsMayGrant: false }],
  knowledge: [{ id: "runbooks", name: "Runbooks" }],
  skills: [{ id: "rca", name: "rca" }],
};

function serve(role: string) {
  const posts: unknown[] = [];
  mockFetch((url, init) => {
    if (url.endsWith("/api/me/projects")) return jsonResponse({ items: [], all: role === "admin" });
    if (url.endsWith("/api/me")) return meResponse(testUsers.operator, role);
    if (url.endsWith("/api/projects/grantable")) return jsonResponse(grantable);
    if (url.includes("/api/people")) return jsonResponse({ items: [{ id: "priya", name: "Priya Nair", email: "priya@zs.com" }] });
    if (url.endsWith("/api/projects") && init?.method === "POST") { posts.push(JSON.parse(String(init.body))); return jsonResponse({ id: "market-mix", name: "Market Mix" }, 201); }
    return jsonResponse({});
  });
  return posts;
}
const show = () => renderWithClient(<MemoryRouter initialEntries={["/new"]}><ToastProvider><Routes><Route path="/new" element={<NewProjectPage />} /><Route path="/" element={<p>Home page</p>} /></Routes></ToastProvider></MemoryRouter>);

describe("NewProjectPage", () => {
  it("creates the project with its sources, knowledge, Sonic settings and people in one call", async () => {
    const posts = serve("developer");
    show();
    await userEvent.type(await screen.findByLabelText("Name"), "Market Mix");
    expect(screen.getByLabelText("ID")).toHaveValue("market-mix");
    await userEvent.click(screen.getByRole("button", { name: /Sources/ }));
    expect(await screen.findByText("Ask an admin")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("switch", { name: "Use Jira" }));
    await userEvent.type(screen.getByPlaceholderText("Comma separated"), "MMM, MIX");
    await userEvent.click(screen.getByRole("button", { name: /Knowledge/ }));
    await userEvent.click(screen.getByRole("button", { name: "Runbooks" }));
    await userEvent.click(screen.getByRole("button", { name: /Sonic/ }));
    await userEvent.click(screen.getByRole("radio", { name: "Opus" }));
    await userEvent.click(screen.getByRole("radio", { name: "Only read" }));
    await userEvent.click(screen.getByRole("button", { name: /People/ }));
    expect(screen.queryByRole("switch", { name: "Open to everyone" })).not.toBeInTheDocument();
    await userEvent.type(screen.getByRole("combobox", { name: "Name or email" }), "pri");
    await userEvent.click(await screen.findByRole("option", { name: /Priya Nair/ }));
    await userEvent.click(screen.getByRole("button", { name: "Create project" }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toEqual({
      id: "market-mix", name: "Market Mix", color: "teal",
      grants: [{ resourceType: "connection", resourceId: "jira-shared", scope: { projectKeys: ["MMM", "MIX"] } }, { resourceType: "knowledge", resourceId: "runbooks" }],
      members: [{ userId: "priya", role: "developer" }],
      settings: { model: "opus", autonomy: "read" },
    });
  });

  it("creates from any step once there is a name, and an admin may open it to everyone", async () => {
    const posts = serve("admin");
    show();
    await userEvent.type(await screen.findByLabelText("Name"), "Commons");
    await userEvent.click(screen.getByRole("button", { name: /People/ }));
    await userEvent.click(screen.getByRole("switch", { name: "Open to everyone" }));
    await userEvent.click(screen.getByRole("button", { name: /Basics/ }));
    await userEvent.click(screen.getByRole("button", { name: "Create now" }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toMatchObject({ id: "commons", name: "Commons", open: true });
  });

  it("FR-2: a viewer cannot create projects and is sent home", async () => {
    serve("viewer");
    show();
    expect(await screen.findByText("Home page")).toBeInTheDocument();
  });
});
