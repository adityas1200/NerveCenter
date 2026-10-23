import { screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/ui";
import { jsonResponse, mockFetch, renderWithClient } from "@/test/utils";
import { DraftsDialog } from "./DraftsDialog";

// SPEC-knowledge-05 FR-4: each draft says where it came from, and a correction names who taught it.

const draft = (path: string, extra: Record<string, unknown>) => ({ base: "ops", path, change: "added", title: path, section: null, sourceTicket: null, reason: null, taskId: null, by: "agent", at: null, diff: "+x", ...extra });

describe("DraftsDialog origins", () => {
  it("FR-4 labels corrections, interviews, documents, the weekly pass and eval cases; a draft saved before origins gets none", async () => {
    mockFetch((url) => (url.endsWith("/api/knowledge/ops/drafts") ? jsonResponse({ name: "ops", items: [
      draft("business/sla.md", { origin: "correction", taughtBy: "Priya Rao" }),
      draft("business/vendors.md", { origin: "interview", taughtBy: "Ops lead" }),
      draft("runbooks/restart.md", { origin: "document" }),
      draft("known-issues/late.md", { origin: "pass" }),
      draft("evals/late/inc-1.md", { origin: "eval" }),
      draft("known-issues/old.md", { origin: "lesson" }),
      draft("known-issues/legacy.md", {}),
    ] }) : jsonResponse({ items: [] })));
    renderWithClient(<MemoryRouter><ToastProvider><DraftsDialog base="ops" title="Ops" open onOpenChange={() => {}} canDecide onOpenFile={vi.fn()} /></ToastProvider></MemoryRouter>);
    const sla = await screen.findByTestId("draft-business/sla.md");
    expect(within(sla).getByText("Correction from Priya Rao")).toBeInTheDocument();
    const vendors = screen.getByTestId("draft-business/vendors.md");
    expect(within(vendors).getByText("Interview")).toBeInTheDocument();
    expect(within(vendors).getByText("By Sonic, from Ops lead")).toBeInTheDocument();
    expect(within(screen.getByTestId("draft-runbooks/restart.md")).getByText("From documents")).toBeInTheDocument();
    expect(within(screen.getByTestId("draft-known-issues/late.md")).getByText("Weekly pass")).toBeInTheDocument();
    expect(within(screen.getByTestId("draft-evals/late/inc-1.md")).getByText("Eval case")).toBeInTheDocument();
    expect(within(screen.getByTestId("draft-known-issues/old.md")).getByText("Lesson")).toBeInTheDocument();
    const legacy = screen.getByTestId("draft-known-issues/legacy.md");
    expect(within(legacy).getByText("By Sonic")).toBeInTheDocument();
    expect(within(legacy).queryByText(/Lesson|Correction|Interview|Weekly pass|Eval case|From documents/)).not.toBeInTheDocument();
  });
});
