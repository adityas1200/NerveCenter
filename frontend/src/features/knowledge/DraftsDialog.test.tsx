import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ToastProvider } from "@/components/ui";
import { DraftsDialog } from "./DraftsDialog";
import { jsonResponse, mockFetch, renderWithClient } from "@/test/utils";

const drafts = [
  { base: "ops", path: "known-issues/pipelines.md", change: "modified", title: "Schema change on finance_daily", section: "Schema change", sourceTicket: "OPS-7", reason: "Same cause as \"Schema change\"; adds where it was seen.", taskId: "T-3", by: "agent", at: new Date().toISOString(), diff: "diff --git a/x b/x\nindex 1..2\n--- a/x\n+++ b/x\n@@ -9,3 +9,6 @@\n A new column breaks the merge.\n+<!-- draft source=OPS-7 -->\n+Also seen on finance_daily.\n+<!-- /draft -->" },
  { base: "ops", path: "known-issues/cluster-quota.md", change: "added", title: "Cluster quota", section: null, sourceTicket: "OPS-11", reason: "No page covers capacity failures.", taskId: null, by: "agent", at: null, diff: "+---\n+title: Cluster quota\n+status: draft" },
];

function renderDialog({ canDecide = true, onOpenFile = vi.fn() } = {}) {
  const calls: Array<{ method: string; url: string; body?: unknown }> = [];
  mockFetch((url, init) => {
    const method = init?.method || "GET";
    calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (url.endsWith("/api/knowledge/ops/drafts")) return jsonResponse({ name: "ops", items: drafts });
    if (url.endsWith("/drafts/keep")) return jsonResponse({ base: "ops", kept: ["known-issues/pipelines.md"] });
    if (url.endsWith("/drafts/discard")) return jsonResponse({ base: "ops", discarded: ["known-issues/cluster-quota.md"] });
    return jsonResponse({ items: [] });
  });
  renderWithClient(<MemoryRouter><ToastProvider><DraftsDialog base="ops" title="Ops runbooks" open onOpenChange={() => {}} canDecide={canDecide} onOpenFile={onOpenFile} /></ToastProvider></MemoryRouter>);
  return { calls, onOpenFile };
}

describe("DraftsDialog", () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it("shows where each draft went, why, where it came from and only what changed", async () => {
    renderDialog();
    const row = await screen.findByTestId("draft-known-issues/pipelines.md");
    expect(within(row).getByRole("button", { name: "Known issues › Pipelines › Schema change" })).toBeInTheDocument();
    expect(within(row).getByText("Added to page")).toBeInTheDocument();
    expect(within(row).getByText(/Same cause as "Schema change"/)).toBeInTheDocument();
    expect(within(row).getByRole("link", { name: "OPS-7" })).toHaveAttribute("href", "/tickets/OPS-7");
    expect(within(row).getByRole("link", { name: "task T-3" })).toHaveAttribute("href", "/tasks/T-3");
    const diff = within(row).getByLabelText("What changed");
    expect(diff).toHaveTextContent("+Also seen on finance_daily.");
    expect(diff).not.toHaveTextContent("diff --git");
    expect(within(screen.getByTestId("draft-known-issues/cluster-quota.md")).getByText("New page")).toBeInTheDocument();
  });

  it("keeps one draft, keeps all, or discards after a confirm", async () => {
    const { calls } = renderDialog();
    const row = await screen.findByTestId("draft-known-issues/pipelines.md");
    fireEvent.click(within(row).getByRole("button", { name: "Keep" }));
    await waitFor(() => expect(calls.some((call) => call.url.endsWith("/api/knowledge/ops/drafts/keep") && (call.body as { path?: string })?.path === "known-issues/pipelines.md")).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: "Keep all 2" }));
    await waitFor(() => expect(calls.some((call) => call.url.endsWith("/drafts/keep") && (call.body as { all?: boolean })?.all === true)).toBe(true));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.click(within(screen.getByTestId("draft-known-issues/cluster-quota.md")).getByRole("button", { name: "Discard" }));
    await waitFor(() => expect(calls.some((call) => call.url.endsWith("/drafts/discard") && (call.body as { path?: string })?.path === "known-issues/cluster-quota.md")).toBe(true));
  });

  it("lets everyone read drafts but only admins decide, and opens a draft's page", async () => {
    const { onOpenFile } = renderDialog({ canDecide: false });
    const row = await screen.findByTestId("draft-known-issues/cluster-quota.md");
    expect(within(row).queryByRole("button", { name: "Keep" })).toBeNull();
    expect(screen.getByText("An admin keeps or discards drafts.")).toBeInTheDocument();
    fireEvent.click(within(row).getByRole("button", { name: "Known issues › Cluster quota" }));
    expect(onOpenFile).toHaveBeenCalledWith("known-issues/cluster-quota.md");
  });
});
