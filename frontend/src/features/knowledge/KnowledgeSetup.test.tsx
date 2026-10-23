import { fireEvent, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { AgentPanelProvider } from "@/components/ops/AgentPanel";
import { ToastProvider } from "@/components/ui";
import { jsonResponse, meResponse, mockFetch, renderWithClient, testUsers } from "@/test/utils";
import { KnowledgePage } from "./KnowledgePage";

// SPEC-knowledge-03 FR-1, FR-3: the owner starts the knowledge setup from the Knowledge page, or continues it.

const runbooks = { name: "platform-runbooks", title: "Platform runbooks", description: "", hasIndex: true, kind: "git", url: "https://github.com/acme/runbooks.git", branch: "main", folders: [], hasToken: true, addedBy: null, addedAt: null, lastSyncAt: null, lastCommit: null, lastError: null, files: 12, pendingChanges: 0 };

function renderAt({ role = "admin", permissions = [] as string[], setup = { taskId: null as string | null, base: null as string | null }, calls = [] as Array<{ method: string; url: string; body?: unknown }> } = {}) {
  mockFetch((url, init) => {
    const method = init?.method || "GET";
    calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (url.includes("/api/me")) return meResponse(testUsers.admin, role, permissions);
    if (url.endsWith("/api/knowledge/setup") && method === "POST") return jsonResponse({ taskId: "T-31", base: "platform-runbooks", created: true }, 201);
    if (url.endsWith("/api/knowledge/setup")) return jsonResponse(setup);
    if (url.endsWith("/api/knowledge")) return jsonResponse({ items: [runbooks], mcp: { mode: "local", connection: "", collections: [] } });
    return jsonResponse({ items: [] });
  });
  return renderWithClient(<MemoryRouter initialEntries={["/knowledge"]}><ToastProvider><AgentPanelProvider><Routes><Route path="/knowledge" element={<KnowledgePage />} /><Route path="/tasks/:taskId" element={<p>Task page</p>} /></Routes></AgentPanelProvider></ToastProvider></MemoryRouter>);
}

describe("Knowledge setup on the Knowledge page", () => {
  it("an owner picks the base, starts the setup and lands in its task", async () => {
    const calls: Array<{ method: string; url: string; body?: unknown }> = [];
    renderAt({ role: "developer", permissions: ["knowledge.manage", "knowledge.review"], calls });
    fireEvent.click(await screen.findByRole("button", { name: "Set up knowledge" }));
    expect(screen.getByRole("dialog", { name: "Set up knowledge" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Save drafts to" })).toHaveTextContent("Team knowledge");
    fireEvent.click(screen.getByRole("button", { name: "Start setup" }));
    expect(await screen.findByText("Task page")).toBeInTheDocument();
    expect(calls.find((call) => call.method === "POST" && call.url.endsWith("/api/knowledge/setup"))?.body).toEqual({});
  });

  it("sends the chosen base when it is not team knowledge", async () => {
    const calls: Array<{ method: string; url: string; body?: unknown }> = [];
    renderAt({ calls });
    fireEvent.click(await screen.findByRole("button", { name: "Set up knowledge" }));
    fireEvent.click(screen.getByRole("combobox", { name: "Save drafts to" }));
    fireEvent.click(await screen.findByRole("option", { name: "Platform runbooks" }));
    fireEvent.click(screen.getByRole("button", { name: "Start setup" }));
    await waitFor(() => expect(calls.find((call) => call.method === "POST" && call.url.endsWith("/api/knowledge/setup"))?.body).toEqual({ base: "platform-runbooks" }));
  });

  it("an open setup shows Continue setup, linking to its task", async () => {
    renderAt({ setup: { taskId: "T-12", base: "team-knowledge" } });
    expect(await screen.findByRole("link", { name: "Continue setup" })).toHaveAttribute("href", "/tasks/T-12");
    expect(screen.queryByRole("button", { name: "Set up knowledge" })).toBeNull();
  });

  it("developers who cannot review knowledge see no setup button and never ask for it", async () => {
    const calls: Array<{ method: string; url: string }> = [];
    renderAt({ role: "developer", permissions: ["knowledge.manage"], calls });
    expect(await screen.findByText("Platform runbooks")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Set up knowledge" })).toBeNull();
    expect(calls.some((call) => call.url.endsWith("/api/knowledge/setup"))).toBe(false);
  });
});
