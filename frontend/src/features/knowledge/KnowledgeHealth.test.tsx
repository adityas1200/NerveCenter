import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import type { Journey, KnowledgePass } from "@/api/library";
import { ToastProvider } from "@/components/ui";
import { jsonResponse, meResponse, mockFetch, renderWithClient, testUsers } from "@/test/utils";
import { KnowledgeHealth } from "./KnowledgeHealth";

// SPEC-knowledge-06 FR-8 (Journeys) and SPEC-knowledge-07 FR-6 (This week).

const journeys: Journey[] = [
  { journey: "brand-request", cases: 6, latest: { score: 42, passed: 2, partial: 1, failed: 3, total: 6, at: new Date().toISOString(), taskId: "T-9" }, previous: 50, trend: [50, 42], failing: [{ path: "ops/evals/brand-request/inc-7.md", result: "fail", note: "Sent it to the data team, not the brand lead.", missing: ["ops/business/approvals.md", "ops/pipelines/sales.md (should name the vendor)", "A page mapping job names to pipelines (does not exist yet)"] }, { path: "ops/evals/brand-request/inc-8.md", result: "partial" }] },
  { journey: "late-pipeline", cases: 4, latest: { score: 84, passed: 3, partial: 1, failed: 0, total: 4, at: new Date().toISOString(), taskId: "T-8" }, previous: 78, trend: [70, 78, 84], failing: [] },
  { journey: "dq-failure", cases: 2, latest: null, previous: null, trend: [], failing: [] },
];
const digest = { at: new Date().toISOString(), taskId: "T-20", drafts: { waiting: 9, fromCorrections: 4, fromLessons: 5, merged: 1 }, stale: [{ path: "ops/runbooks/old.md", staleAfter: "2026-09-01" }], drift: [{ path: "ops/pipelines/sales.md", field: "sla", page: "07:00", live: "08:00" }], changedDocs: [], gaps: [{ text: "Did not know who approves Brand X refreshes.", journey: "brand-request", tasks: ["T-4"] }], evals: [{ journey: "late-pipeline", score: 84, previous: 78 }], weakest: "brand-request", summary: "Nine drafts wait; late-pipeline went from 78 to 84." };
const pass = (extra: Partial<KnowledgePass> = {}): KnowledgePass => ({ enabled: false, weekday: 1, time: "07:00", timezone: null, routine: null, digest: null, ...extra });

function renderHealth({ permissions = ["knowledge.manage", "knowledge.review"], journeyList = journeys as Journey[] | null, state = pass(), entry = "/knowledge", calls = [] as Array<{ method: string; url: string; body?: unknown }> } = {}) {
  let current = state;
  mockFetch((url, init) => {
    const method = init?.method || "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, url, body });
    if (url.includes("/api/me")) return meResponse(testUsers.admin, "developer", permissions);
    if (url.endsWith("/api/knowledge/journeys")) return journeyList ? jsonResponse({ journeys: journeyList }) : jsonResponse({ error: "Journeys are not available" }, 500);
    if (url.endsWith("/api/knowledge/pass") && method === "PUT") { current = { ...current, enabled: body.enabled, routine: body.enabled ? { name: "knowledge-pass", nextRunAt: new Date(Date.now() + 86_400_000).toISOString(), lastRun: null } : current.routine }; return jsonResponse(current); }
    if (url.endsWith("/api/knowledge/pass")) return jsonResponse(current);
    return jsonResponse({});
  });
  renderWithClient(<MemoryRouter initialEntries={[entry]}><ToastProvider><KnowledgeHealth /></ToastProvider></MemoryRouter>);
  return { calls };
}

describe("Journeys panel", () => {
  it("FR-8 lists journeys weakest first with score, change, cases and unrun ones last", async () => {
    renderHealth();
    const rows = await screen.findAllByTestId(/^journey-/);
    expect(rows.map((row) => row.getAttribute("data-testid"))).toEqual(["journey-brand-request", "journey-late-pipeline", "journey-dq-failure"]);
    expect(within(rows[0]).getByText("Brand request")).toBeInTheDocument();
    expect(within(rows[0]).getByLabelText("Down 8 since the last run")).toBeInTheDocument();
    expect(within(rows[1]).getByLabelText("Up 6 since the last run")).toBeInTheDocument();
    expect(within(rows[1]).getByRole("img", { name: "Late pipeline scores: 70, 78, 84" })).toBeInTheDocument();
    expect(within(rows[2]).getByText("Not run yet")).toBeInTheDocument();
    expect(screen.getByText(/3 journeys · 12 eval cases/)).toBeInTheDocument();
  });

  it("FR-8 opening a journey shows its failing cases with notes, the pages that would have helped and the run", async () => {
    renderHealth();
    const row = await screen.findByTestId("journey-brand-request");
    fireEvent.click(within(row).getByRole("button", { expanded: false }));
    expect(within(row).getByText("Sent it to the data team, not the brand lead.")).toBeInTheDocument();
    expect(within(row).getByText("Failed")).toBeInTheDocument();
    expect(within(row).getByText("Partial")).toBeInTheDocument();
    expect(within(row).getByRole("link", { name: "Ops › Business › Approvals" })).toHaveAttribute("href", `/knowledge?path=${encodeURIComponent("ops/business/approvals.md")}`);
    // A path with a note links the path only; a page described in words is plain text.
    expect(within(row).getByRole("link", { name: "Ops › Pipelines › Sales" })).toHaveAttribute("href", `/knowledge?path=${encodeURIComponent("ops/pipelines/sales.md")}`);
    expect(within(row).getByText("(should name the vendor)")).toBeInTheDocument();
    expect(within(row).getByText("A page mapping job names to pipelines (does not exist yet)").tagName).toBe("SPAN");
    expect(within(row).getAllByRole("link")).toHaveLength(5);
    expect(within(row).getByRole("link", { name: "Open the run" })).toHaveAttribute("href", "/tasks/T-9");
  });

  it("FR-8 has empty and error states", async () => {
    renderHealth({ journeyList: [] });
    expect(await screen.findByText("No eval cases yet")).toBeInTheDocument();
  });

  it("FR-8 shows the error when journeys fail to load", async () => {
    renderHealth({ journeyList: null });
    expect(await screen.findByText(/Journeys are not available/)).toBeInTheDocument();
  });
});

describe("This week panel", () => {
  it("FR-6 an owner switches the weekly pass on; the panel shows the schedule and next run", async () => {
    const calls: Array<{ method: string; url: string; body?: unknown }> = [];
    renderHealth({ calls });
    expect(await screen.findByText("No pass yet")).toBeInTheDocument();
    const toggle = await screen.findByRole("switch", { name: "Weekly knowledge pass" });
    expect(toggle).toHaveAttribute("data-state", "unchecked");
    fireEvent.click(toggle);
    await waitFor(() => expect(calls.find((call) => call.method === "PUT")?.body).toEqual({ enabled: true }));
    expect(await screen.findByText("Weekly pass on")).toBeInTheDocument();
    expect(await screen.findByText(/Mondays at 07:00 · next/)).toBeInTheDocument();
  });

  it("FR-6 someone who is not an owner sees whether the pass is on, without the switch", async () => {
    renderHealth({ permissions: ["knowledge.manage"], state: pass({ enabled: true, routine: { name: "knowledge-pass", nextRunAt: null, lastRun: null } }) });
    expect(await screen.findByText("Weekly pass on")).toBeInTheDocument();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  });

  it("FR-6 the digest shows its counts as tiles, each opening its list, plus eval movements and the run", async () => {
    renderHealth({ state: pass({ enabled: true, digest }), entry: "/knowledge?digest=drift" });
    expect(await screen.findByLabelText("Drafts waiting: 9")).toBeInTheDocument();
    expect(screen.getByLabelText("Past review date: 1")).toBeInTheDocument();
    expect(screen.getByLabelText("Gaps: 1")).toBeInTheDocument();
    expect(screen.getByText("4 from corrections")).toBeInTheDocument();
    const list = screen.getByRole("list", { name: "Digest list" });
    expect(within(list).getByText("08:00")).toBeInTheDocument();
    expect(screen.getByLabelText("Differs from live: 1")).toHaveAttribute("href", "/knowledge");
    expect(screen.getByLabelText("Gaps: 1")).toHaveAttribute("href", "/knowledge?digest=gaps");
    const evals = screen.getByRole("list", { name: "Eval scores this week" });
    expect(evals).toHaveTextContent("Late pipeline78 →84");
    expect(screen.getByText(/^Weakest:/)).toHaveTextContent("Weakest: Brand request");
    expect(screen.getByRole("link", { name: "Open the pass" })).toHaveAttribute("href", "/tasks/T-20");
    fireEvent.click(screen.getByLabelText("Gaps: 1"));
    expect(await screen.findByText("Did not know who approves Brand X refreshes.")).toBeInTheDocument();
  });
});
