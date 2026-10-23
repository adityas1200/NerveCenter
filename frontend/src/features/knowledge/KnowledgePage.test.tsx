import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AgentPanelProvider } from "@/components/ops/AgentPanel";
import { ToastProvider } from "@/components/ui";
import { KnowledgePage } from "./KnowledgePage";
import { jsonResponse, meResponse, mockFetch, renderWithClient, testUsers } from "@/test/utils";

const runbooks = { name: "platform-runbooks", title: "Platform runbooks", description: "Recovery steps for every pipeline.", hasIndex: true, kind: "git", url: "https://github.com/acme/runbooks.git", branch: "main", folders: ["runbooks", "platform"], hasToken: true, addedBy: "mitesh", addedAt: "2026-09-24T08:00:00Z", lastSyncAt: "2026-09-24T09:00:00Z", lastCommit: "9de9ff3", lastError: null, files: 12, pendingChanges: 2 };
const local = { name: "definitions", title: "definitions", description: "", hasIndex: false, kind: "local", url: null, branch: null, folders: [], hasToken: false, addedBy: null, addedAt: null, lastSyncAt: null, lastCommit: null, lastError: null, files: 3, pendingChanges: 0 };
const fresh = { ...runbooks, name: "sops", title: "SOPs", url: "https://github.com/acme/sops.git", folders: [], lastSyncAt: null, lastCommit: null, pendingChanges: 0, files: 0 };
const broken = { ...runbooks, name: "policies", title: "Policies", url: "https://github.com/acme/policies.git", folders: [], pendingChanges: 0, lastError: "fatal: Authentication failed for 'https://github.com/acme/policies.git/'" };
const tree = [
  { name: "runbooks", path: "runbooks", type: "directory", children: [{ name: "index.md", path: "runbooks/index.md", type: "file", size: 200 }, { name: "job-repair.md", path: "runbooks/job-repair.md", type: "file", size: 640 }] },
  { name: "index.md", path: "index.md", type: "file", size: 300 },
];
const files: Record<string, string> = {
  "index.md": "---\ntype: Index\ntitle: Platform runbooks\nstatus: stable\nupdated: 2026-09-15\ntags: [databricks, remediation]\nverified:\n  by: human:mitesh.shinde\n  at: 2026-09-15T09:00:00Z\n---\n# Runbooks\n\nStart with [the runbooks section](runbooks/) or go straight to [job repair](runbooks/job-repair.md#when-to-rerun). See [Databricks docs](https://docs.databricks.com).\n",
  "runbooks/index.md": "# Runbook index\n\n- [Job repair](./job-repair.md)\n- [Back to the start](../index.md)\n- [Missing](missing.md)\n",
  "runbooks/job-repair.md": "# Job repair\n\n## When to rerun\n\nOnly after the input changed. [Up](../index.md)\n",
};
const uploaded = { ...local, name: "ops-docs", title: "Ops docs", description: "Knowledge drafted from uploaded documents.", hasIndex: true, kind: "upload", files: 1, pendingChanges: 3, documents: ["SOP restart.docx", "owners.csv"], lastTaskId: "T-42", lastUploadAt: "2026-10-01T09:00:00Z" };
const inspection = { url: "https://github.com/acme/new", branch: "main", commit: "abc1234", suggestedTitle: "New", rootFiles: ["index.md"], files: 9, markdown: 8, folders: [{ name: "runbooks", path: "runbooks", files: 4, markdown: 4, children: [{ name: "deep", path: "runbooks/deep", files: 1, markdown: 1, children: [] }] }, { name: "platform", path: "platform", files: 3, markdown: 2, children: [] }, { name: "templates", path: "templates", files: 1, markdown: 1, children: [] }] };

function renderAt(path: string, calls: Array<{ method: string; url: string; body?: unknown }> = [], mcpConnection = "", bases: unknown[] = [runbooks, local]) {
  mockFetch((url, init) => {
    const method = init?.method || "GET";
    calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (url.includes("/api/me")) return meResponse(testUsers.admin, "admin");
    if (url.endsWith("/api/knowledge/inspect") && method === "POST") return jsonResponse(inspection);
    if (url.endsWith("/api/knowledge/upload") && method === "POST") return jsonResponse({ ...uploaded, name: "new-docs", title: "New docs", documents: ["SOP restart.docx"], received: ["SOP restart.docx"], taskId: "T-7" }, 201);
    if (url.endsWith("/api/knowledge/ops-docs/documents") && method === "POST") return jsonResponse({ ...uploaded, received: ["deck.pptx"], taskId: "T-43" }, 201);
    if (url.includes("/api/knowledge/ops-docs/tree")) return jsonResponse({ name: "ops-docs", items: [{ name: "index.md", path: "index.md", type: "file", size: 80 }] });
    if (url.includes("/api/knowledge/ops-docs/file")) return jsonResponse({ path: "index.md", size: 80, content: ["---", "type: Index", "title: Ops docs", "---", "# Ops docs", ""].join("\n") });
    if (url.includes("/api/knowledge/new-docs/tree")) return jsonResponse({ name: "new-docs", items: [] });
    if (url.endsWith("/api/knowledge") && method === "POST") return jsonResponse({ ...runbooks, name: "new-base", title: "New base", files: 4 }, 201);
    if (url.endsWith("/api/knowledge")) return jsonResponse({ items: bases, mcp: { mode: mcpConnection ? "both" : "local", connection: mcpConnection, collections: [] } });
    if (url.includes("/api/knowledge/platform-runbooks/sync")) return jsonResponse({ ...runbooks, lastCommit: "abc1234" });
    if (url.includes("/api/knowledge/platform-runbooks/tree")) return jsonResponse({ name: "platform-runbooks", items: tree });
    const file = /\/api\/knowledge\/platform-runbooks\/file\?path=([^&]+)/.exec(url);
    if (file) { const key = decodeURIComponent(file[1]); return jsonResponse({ path: key, size: files[key]?.length ?? 0, content: files[key] ?? "" }); }
    if (url.includes("/api/knowledge/new-base/tree")) return jsonResponse({ name: "new-base", items: [] });
    return jsonResponse({ items: [] });
  });
  return renderWithClient(<MemoryRouter initialEntries={[path]}><ToastProvider><AgentPanelProvider><Routes><Route path="/knowledge" element={<KnowledgePage />} /><Route path="/knowledge/:name" element={<KnowledgePage />} /></Routes></AgentPanelProvider></ToastProvider></MemoryRouter>);
}

describe("KnowledgePage", () => {
  it("lists bases as cards with their folders, drafts to review and sync state, and has no MCP section", async () => {
    const calls: Array<{ method: string; url: string }> = [];
    renderAt("/knowledge", calls);
    expect(await screen.findByText("Platform runbooks")).toBeInTheDocument();
    expect(screen.getByText("2 bases · 15 files")).toBeInTheDocument();

    const runbooksCard = screen.getByTestId("knowledge-platform-runbooks");
    expect(within(runbooksCard).getByText("Git repository")).toBeInTheDocument();
    expect(within(runbooksCard).getByText("github.com/acme/runbooks · main")).toBeInTheDocument();
    expect(within(runbooksCard).getByText("Folders")).toBeInTheDocument();
    expect(within(runbooksCard).getByText("runbooks, platform")).toBeInTheDocument();
    expect(within(runbooksCard).getByText(/drafts from Sonic to review/)).toHaveTextContent("2 drafts from Sonic to review");
    expect(within(runbooksCard).getByText("Sync waits until they are committed or removed.")).toBeInTheDocument();
    expect(within(runbooksCard).getByText(/12 files · synced/)).toHaveAttribute("title", "Commit 9de9ff3");
    expect(within(runbooksCard).queryByText(/9de9ff3/)).not.toBeInTheDocument();
    expect(within(runbooksCard).getByText("Synced")).toBeInTheDocument();

    const localCard = screen.getByTestId("knowledge-definitions");
    expect(within(localCard).getAllByText("Local folder")).toHaveLength(2); // subtitle line + state label
    expect(within(localCard).getByText("Folder knowledge/definitions")).toBeInTheDocument();

    expect(screen.queryByText(/Agent access through MCP/)).not.toBeInTheDocument();
    expect(screen.queryByText(/also searches/)).not.toBeInTheDocument();
    fireEvent.click(within(runbooksCard).getByRole("button", { name: "Sync" }));
    await waitFor(() => expect(calls.some((call) => call.method === "POST" && call.url.includes("/api/knowledge/platform-runbooks/sync"))).toBe(true));
    expect(within(localCard).queryByRole("button", { name: "Sync" })).not.toBeInTheDocument();
  });

  it("says when a base was never synced or failed to sync, in plain words", async () => {
    renderAt("/knowledge", [], "", [fresh, broken]);
    expect(await screen.findByText("SOPs")).toBeInTheDocument();
    const freshCard = screen.getByTestId("knowledge-sops");
    expect(within(freshCard).getByText("Not synced yet")).toBeInTheDocument();
    expect(within(freshCard).getByText("0 files · not synced yet")).toBeInTheDocument();
    const brokenCard = screen.getByTestId("knowledge-policies");
    expect(within(brokenCard).getByText("Sync failed")).toBeInTheDocument();
    expect(within(brokenCard).getByText("The repository rejected the access token.")).toHaveAttribute("title", broken.lastError);
    expect(within(brokenCard).queryByText(/fatal:/)).not.toBeInTheDocument();
    expect(within(freshCard).queryByText("Synced")).not.toBeInTheDocument();
  });

  it("puts Sync now first on a base's own page and keeps Add knowledge base on the list", async () => {
    const calls: Array<{ method: string; url: string }> = [];
    renderAt("/knowledge/platform-runbooks", calls);
    await screen.findByRole("heading", { name: "Runbooks" });
    expect(screen.queryByRole("button", { name: "Add knowledge base" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Sync now" }));
    await waitFor(() => expect(calls.some((call) => call.method === "POST" && call.url.includes("/api/knowledge/platform-runbooks/sync"))).toBe(true));
  });

  it("shows one quiet line for an MCP knowledge source, linking to Connectors", async () => {
    renderAt("/knowledge", [], "confluence");
    expect(await screen.findByText(/also searches/)).toBeInTheDocument();
    expect(screen.getByText("Confluence")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Manage in Connectors" })).toHaveAttribute("href", "/connectors");
  });

  it("opens a base at its index with a properties header and follows relative links, folders and anchors", async () => {
    renderAt("/knowledge/platform-runbooks");
    expect(await screen.findByRole("heading", { name: "Runbooks" })).toBeInTheDocument();
    const properties = screen.getByLabelText("Properties");
    expect(within(properties).getByText("Stable")).toBeInTheDocument();
    expect(within(properties).getByText("databricks, remediation")).toBeInTheDocument();
    expect(within(properties).getByText("mitesh.shinde, 15 Sep 2026")).toBeInTheDocument();
    expect(within(properties).getByText("15 Sep 2026")).toBeInTheDocument();
    expect(screen.queryByText(/^type: Index/)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Databricks docs" })).toHaveAttribute("target", "_blank");
    expect(screen.getByRole("link", { name: "Knowledge" })).toHaveAttribute("href", "/knowledge");

    // A folder link opens the folder's index.md and the tree opens that folder.
    fireEvent.click(screen.getByRole("link", { name: "the runbooks section" }));
    expect(await screen.findByRole("heading", { name: "Runbook index" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /index\.md/ }).find((button) => button.getAttribute("aria-current") === "true")).toHaveAttribute("data-path", "runbooks/index.md");
    // ./ and ../ resolve against the open file's folder.
    fireEvent.click(screen.getByRole("link", { name: "Job repair" }));
    expect(await screen.findByRole("heading", { name: "When to rerun" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /job-repair.md/ })).toHaveAttribute("aria-current", "true");
    fireEvent.click(screen.getByRole("link", { name: "Up" }));
    expect(await screen.findByRole("heading", { name: "Runbooks" })).toBeInTheDocument();
    // file.md#section opens the file.
    fireEvent.click(screen.getByRole("link", { name: "job repair" }));
    expect(await screen.findByRole("heading", { name: "When to rerun" })).toBeInTheDocument();
  });

  it("adds a repository in two steps: look inside, then choose folders and a name", async () => {
    const calls: Array<{ method: string; url: string; body?: unknown }> = [];
    renderAt("/knowledge", calls);
    await screen.findByText("Platform runbooks");
    fireEvent.click(screen.getByRole("button", { name: /Add knowledge base/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Public GitHub repositories need neither a token nor a username.")).toBeInTheDocument();
    const look = within(dialog).getByRole("button", { name: "Look inside" });
    expect(look).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText(/Repository URL/), { target: { value: "https://github.com/acme/new" } });
    fireEvent.change(within(dialog).getByLabelText(/Access token/), { target: { value: "tok" } });
    fireEvent.click(look);
    await waitFor(() => expect(calls.some((call) => call.method === "POST" && call.url.endsWith("/api/knowledge/inspect"))).toBe(true));
    expect(calls.find((call) => call.url.endsWith("/api/knowledge/inspect"))!.body).toEqual({ url: "https://github.com/acme/new", token: "tok" });

    expect(await within(dialog).findByText("Whole repository")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Name")).toHaveValue("New");
    const whole = within(dialog).getByRole("checkbox", { name: /Whole repository/ });
    expect(whole).toBeChecked();
    expect(within(dialog).getByRole("checkbox", { name: "runbooks" })).toBeDisabled();
    fireEvent.click(whole);
    const add = within(dialog).getByRole("button", { name: "Add" });
    expect(add).toBeDisabled();
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "runbooks" }));
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "templates" }));
    expect(within(dialog).getByText(/2 folders · 6 pages/)).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "New base" } });
    fireEvent.click(add);
    await waitFor(() => expect(calls.some((call) => call.method === "POST" && call.url.endsWith("/api/knowledge"))).toBe(true));
    const post = calls.find((call) => call.method === "POST" && call.url.endsWith("/api/knowledge"))!;
    expect(post.body).toEqual({ title: "New base", url: "https://github.com/acme/new", token: "tok", folders: ["runbooks", "templates"] });
  });

  it("creates a knowledge base from uploaded documents and opens it", async () => {
    const calls: Array<{ method: string; url: string; body?: unknown }> = [];
    renderAt("/knowledge", calls);
    await screen.findByText("Platform runbooks");
    expect(screen.getByText("Git repository, MCP server or uploaded documents")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Add knowledge base/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("radio", { name: /Upload documents/ }));
    const create = within(dialog).getByRole("button", { name: "Create knowledge base" });
    expect(create).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "New docs" } });
    const picker = within(dialog).getByLabelText("Documents");
    fireEvent.change(picker, { target: { files: [new File(["# Restart"], "SOP restart.docx"), new File(["x"], "diagram.png")] } });
    expect(within(dialog).getByRole("list", { name: "Chosen documents" })).toHaveTextContent("SOP restart.docx");
    expect(within(dialog).getByText(/Left out, not a supported document: diagram.png/)).toBeInTheDocument();
    expect(create).toBeEnabled();
    fireEvent.click(create);
    await waitFor(() => expect(calls.some((call) => call.method === "POST" && call.url.endsWith("/api/knowledge/upload"))).toBe(true));
    const post = calls.find((call) => call.url.endsWith("/api/knowledge/upload"))!.body as { title: string; files: Array<{ name: string; data: string }> };
    expect(post.title).toBe("New docs");
    expect(post.files).toEqual([{ name: "SOP restart.docx", data: btoa("# Restart") }]);
    await waitFor(() => expect(calls.some((call) => call.url.includes("/api/knowledge/new-docs/tree"))).toBe(true));
  });

  it("shows an uploaded base with its documents, the task reading them, and adds more", async () => {
    const calls: Array<{ method: string; url: string; body?: unknown }> = [];
    renderAt("/knowledge/ops-docs", calls, "", [runbooks, uploaded]);
    expect(await screen.findByText("2 uploaded documents")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /reading them/ })).toHaveAttribute("href", "/tasks/T-42");
    expect(screen.getByRole("button", { name: /Review drafts/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Sync/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add documents" }));
    const dialog = await screen.findByRole("dialog");
    const add = within(dialog).getByRole("button", { name: "Add documents" });
    expect(add).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText("Documents"), { target: { files: [new File(["slides"], "deck.pptx")] } });
    fireEvent.click(add);
    await waitFor(() => expect(calls.some((call) => call.method === "POST" && call.url.endsWith("/api/knowledge/ops-docs/documents"))).toBe(true));
    expect(calls.find((call) => call.url.endsWith("/documents"))!.body).toEqual({ files: [{ name: "deck.pptx", data: btoa("slides") }] });
  });
});
