import { screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import type { Task, TaskEvent } from "@/api/tasks";
import { ToastProvider } from "@/components/ui";
import { renderWithClient } from "@/test/utils";
import { TaskThread } from "./TaskThread";
import { teachMomentsFrom } from "./teachMoments";
import { groupEvents } from "./taskEvents";

// SPEC-knowledge-05 FR-5: a correction Sonic saved shows as a "Saved for review" card in the turn.

const task: Task = { id: "T-1", type: "adhoc", title: "Brand X refresh", summary: "", status: "done", permission: "policy", context: {}, createdBy: { id: "priya", name: "Priya Rao" }, createdAt: "2026-10-20T09:00:00Z", updatedAt: "2026-10-20T09:10:00Z", cost: { totalUsd: 0, inputTokens: 0, outputTokens: 0, turns: 1, durationMs: 1000, runs: 1 }, pendingApprovalId: null };
let seq = 0;
const ev = (extra: Partial<TaskEvent>): TaskEvent => { seq += 1; return { id: `e${seq}`, taskId: "T-1", seq, at: `2026-10-20T09:${String(seq).padStart(2, "0")}:00Z`, type: "status", ...extra } as TaskEvent; };
const save = (input: Record<string, unknown>, output: Record<string, unknown>, isError = false) => {
  const use = ev({ type: "tool.use", name: "mcp__nervecenter__update_knowledge", input: JSON.stringify(input), toolUseId: `tu${seq + 1}` });
  const result = ev({ type: "tool.result", toolUseId: use.toolUseId, content: isError ? "Error: nope" : JSON.stringify(output), isError });
  return [use, result];
};
const correction = (extra: Record<string, unknown> = {}) => save(
  { decision: "append", base: "ops", path: "business/requesters.md", origin: "correction", taughtBy: "Priya Rao", fields: { tier: "VP" }, ...extra },
  { saved: true, decision: "append", base: "ops", path: "business/requesters.md", title: "VP asks go first", origin: String(extra.origin || "correction"), taughtBy: "Priya Rao", fields: { tier: "VP", response: "same day" }, link: "/knowledge/ops?file=business%2Frequesters.md" },
);

describe("teach moments", () => {
  it("FR-5 only saved corrections and interviews count, not lessons or failed saves", () => {
    seq = 0;
    const lesson = save({ decision: "create", base: "ops", path: "x.md" }, { saved: true, base: "ops", path: "x.md", title: "A lesson", origin: "lesson", link: "/knowledge/ops?file=x.md" });
    const failed = save({ decision: "append", base: "ops", path: "y.md", origin: "correction" }, {}, true);
    const groups = groupEvents([ev({ type: "user.message", text: "No, VPs go first." }), ...lesson, ...failed, ...correction(), ev({ type: "assistant.text", text: "Got it." })], false);
    const moments = teachMomentsFrom(groups);
    expect(moments).toHaveLength(1);
    expect(moments[0]).toMatchObject({ title: "VP asks go first", base: "ops", path: "business/requesters.md", taughtBy: "Priya Rao", fields: { tier: "VP", response: "same day" } });
    seq = 0;
    const plain = save({ decision: "append", base: "ops", path: "business/brands.md", origin: "correction", content: "## Sign-off\n\n- The brand lead signs off a Brand X refresh." }, { saved: true, base: "ops", path: "business/brands.md", title: "Sign-off", origin: "correction", link: "/knowledge/ops?file=business%2Fbrands.md" });
    expect(teachMomentsFrom(groupEvents(plain, false))[0].excerpt).toBe("The brand lead signs off a Brand X refresh.");
  });

  it("FR-5 the turn shows the card after the reply, with who taught it, the fields and links to open and review", () => {
    seq = 0;
    renderWithClient(<MemoryRouter><ToastProvider><TaskThread task={task} events={[ev({ type: "user.message", text: "No, VPs go first and get an answer the same day." }), ...correction(), ev({ type: "assistant.text", text: "Understood: VP asks go to the front." })]} pendingApproval={null} /></ToastProvider></MemoryRouter>);
    const card = screen.getByRole("region", { name: "Saved for review" });
    expect(within(card).getByText("VP asks go first")).toBeInTheDocument();
    expect(within(card).getByText("From Priya Rao")).toBeInTheDocument();
    expect(within(card).getByText("Business › Requesters")).toBeInTheDocument();
    expect(card).toHaveTextContent("Tier VP");
    expect(card).toHaveTextContent("Response same day");
    expect(within(card).getByRole("link", { name: "Open draft" })).toHaveAttribute("href", "/knowledge/ops?file=business%2Frequesters.md");
    expect(within(card).getByRole("link", { name: "Review" })).toHaveAttribute("href", "/knowledge/ops?drafts=1");
  });
});
