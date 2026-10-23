import { fireEvent, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { InboxItem } from "@/api/inbox";
import type { Task, TaskEvent } from "@/api/tasks";
import { ToastProvider } from "@/components/ui";
import { InboxPage } from "@/features/inbox/InboxPage";
import { jsonResponse, meResponse, mockFetch, renderWithClient, testUsers } from "@/test/utils";
import { presentTense, stepLabel } from "../stepLabels";
import { groupEvents } from "../taskEvents";
import { TaskThread } from "../TaskThread";
import { fixResultFrom, proposalFrom, proposalsFrom } from "./fixes";

/** SPEC-tasks-13: the proposal card (FR-8), the evidence on the approval (FR-11) and the verified result (FR-16). */

const TARGET = "commercial.gold.veltrix_sales_daily";
const SANDBOX = "commercial.nc_fix_sandbox.veltrix_sales_daily_fix_a1b2c3";
const STATEMENT = `UPDATE ${TARGET} SET payer_type = 'Commercial' WHERE payer_type = 'COMM'`;
const viz = { xColumn: "payer_type", seriesColumns: ["units"] };

const proposal = {
  proposalId: "FP-1a2b3c4d", state: "proposed", provider: "databricks", title: "Map COMM payer type to Commercial", summary: "COMM is the old code for Commercial.", target: TARGET, sandbox: SANDBOX,
  snapshot: { version: 7, lastAlteredAt: null, rowCount: 4, takenAt: "2026-10-13T09:00:00Z" },
  diff: { rowsBefore: 4, rowsAfter: 4, onlyBefore: 2, onlyAfter: 2, key: ["npi"], changedColumns: ["payer_type"], before: { columns: ["npi", "payer_type", "units"], rows: [["1002", "COMM", 3], ["1003", "COMM", 2]] }, after: { columns: ["npi", "payer_type", "units"], rows: [["1002", "Commercial", 3], ["1003", "Commercial", 2]] } },
  checks: [{ label: "No COMM rows", statement: `SELECT COUNT(*) FROM ${TARGET} WHERE payer_type = 'COMM'`, expect: { op: "eq", value: 0 }, expected: 0, predicted: "pass" }],
  previews: [{ boardId: "B-sales", boardTitle: "Veltrix sales", widgetId: "w-payer", title: "Sales by payer type", type: "chart", viz, now: { columns: ["payer_type", "units"], rows: [["COMM", 5], ["Commercial", 12]] }, after: { columns: ["payer_type", "units"], rows: [["Commercial", 17]] } }],
  tests: [{ name: "No COMM rows on the copy", result: "passed" }, { name: "Row count unchanged", result: "passed" }],
  testsPassed: 2, testsTotal: 2, apply: { statement: STATEMENT },
};
const fix = { proposalId: proposal.proposalId, title: proposal.title, target: TARGET, sandbox: SANDBOX, testsPassed: 2, testsTotal: 2, statement: STATEMENT };
const applied = {
  proposalId: proposal.proposalId, applied: true, appliedAt: "2026-10-13T09:05:00Z", provider: "databricks", target: TARGET, sandbox: SANDBOX, title: proposal.title,
  verification: { status: "passed", checks: [{ label: "No COMM rows", expect: { op: "eq", value: 0 }, expected: 0, actual: 0, result: "pass" }], rowCount: { before: 4, after: 4 }, previews: [{ boardId: "B-sales", widgetId: "w-payer", title: "Sales by payer type", type: "chart", viz, matches: true, expected: { columns: ["payer_type", "units"], rows: [["Commercial", 17]] }, actual: { columns: ["payer_type", "units"], rows: [["Commercial", 17]] } }] },
  sandboxDropped: true,
};

let seq = 0;
const at = "2026-10-13T09:00:00Z";
const event = (fields: Partial<TaskEvent>): TaskEvent => { seq += 1; return { id: `e${seq}`, taskId: "T-1042", seq, at, type: "status", ...fields } as TaskEvent; };
const toolUse = (tool: string, input: unknown, toolUseId: string) => event({ type: "tool.use", name: `mcp__nervecenter__${tool}`, toolUseId, input: JSON.stringify(input) });
const result = (toolUseId: string, content: unknown, isError = false) => event({ type: "tool.result", toolUseId, content: typeof content === "string" ? content : JSON.stringify(content, null, 1), isError });

function story({ decided = false, outcome = applied as unknown, failedTest = false }: { decided?: boolean; outcome?: unknown; failedTest?: boolean } = {}) {
  seq = 0;
  const stored = failedTest ? { ...proposal, tests: [...proposal.tests, { name: "Totals match finance", result: "failed", detail: "off by 3 units" }], testsPassed: 2, testsTotal: 3 } : proposal;
  const approval = event({ type: "approval.requested", inboxId: "I-7", category: "production_changes", title: `Apply tested fix to ${TARGET}`, tool: { name: "mcp__nervecenter__apply_fix", input: JSON.stringify({ proposalId: proposal.proposalId, reason: "Apply the tested fix." }) }, reason: "Apply the tested fix.", fix });
  const events = [
    event({ type: "user.message", text: "COMM looks wrong on the payer chart" }),
    toolUse("propose_fix", { title: proposal.title }, "tu-propose"),
    result("tu-propose", stored),
    toolUse("apply_fix", { proposalId: proposal.proposalId, reason: "Apply the tested fix." }, "tu-apply"),
    approval,
    ...(decided ? [event({ type: "approval.decided", inboxId: "I-7", decision: "approved", actor: { id: "mitesh", name: "Mitesh" } }), result("tu-apply", outcome, typeof outcome === "string")] : []),
  ];
  return { events, approval };
}

const task = (status: Task["status"], pendingApprovalId: string | null = null): Task => ({ id: "T-1042", type: "adhoc", title: "Payer type", summary: "", status, permission: "policy", context: {}, createdBy: { id: "mitesh", name: "Mitesh" }, createdAt: at, updatedAt: at, cost: { totalUsd: 0, inputTokens: 0, outputTokens: 0, turns: 1, durationMs: 1000, runs: 1 }, pendingApprovalId });

function thread(events: TaskEvent[], { pending = null as TaskEvent | null, status = "done" as Task["status"] } = {}) {
  mockFetch(() => jsonResponse({ items: [] }));
  return renderWithClient(<MemoryRouter><ToastProvider><TaskThread task={task(status, pending?.inboxId ?? null)} events={events} pendingApproval={pending} /></ToastProvider></MemoryRouter>);
}

describe("reading fix results", () => {
  it("reads the stored proposal and result, and refuses anything else", () => {
    const read = proposalFrom(proposal);
    expect(read).toMatchObject({ proposalId: "FP-1a2b3c4d", testsPassed: 2, testsTotal: 2, statement: STATEMENT, diff: { onlyBefore: 2, changedColumns: ["payer_type"] } });
    expect(read?.previews[0]).toMatchObject({ widgetId: "w-payer", type: "chart", now: { rows: [["COMM", 5], ["Commercial", 12]] } });
    expect(proposalFrom({ ...proposal, state: "applied" })).toBeNull();
    expect(proposalFrom(null)).toBeNull();
    expect(fixResultFrom(applied)?.status).toBe("passed");
    expect(fixResultFrom({ ...applied, verification: { status: "whatever" } })?.status).toBe("inconclusive");
    expect(fixResultFrom({ proposalId: "FP-1" })).toBeNull();
    const { events } = story();
    expect([...proposalsFrom(events).keys()]).toEqual(["FP-1a2b3c4d"]);
  });

  it("FR-11: puts the approval before the apply card, which waits for the result", () => {
    const { events } = story({ decided: true });
    expect(groupEvents(events, false).map((group) => group.kind === "component" ? `component:${group.event.name?.replace(/^.*__/, "")}` : group.kind)).toEqual(["user", "component:propose_fix", "approval", "component:apply_fix"]);
  });
});

describe("the thread", () => {
  it("FR-8: draws the proposal: tests, the table change, the checks, the widget now and after, and the statement on request", () => {
    const { events } = story();
    thread(events.slice(0, 3));
    expect(screen.getByRole("heading", { name: proposal.title })).toBeInTheDocument();
    expect(screen.getByText("Tested on a copy · 2 of 2 tests passed")).toBeInTheDocument();
    expect(screen.getByText("COMM is the old code for Commercial.")).toBeInTheDocument();
    expect(screen.getByText("2 rows out, 2 rows in")).toBeInTheDocument();
    expect(screen.getByText("payer_type", { selector: "dd" })).toBeInTheDocument();
    expect(screen.getByText("No COMM rows").closest("li")).toHaveTextContent("No COMM rowsexpect = 00Pass");
    expect(screen.getByRole("figure", { name: "Sales by payer type, Now" })).toBeInTheDocument();
    expect(screen.getByRole("figure", { name: "Sales by payer type, After fix" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Veltrix sales" })).toHaveAttribute("href", "/boards/B-sales");
    expect(screen.queryByText(STATEMENT)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show statement" }));
    expect(screen.getByText(STATEMENT)).toBeInTheDocument();
  });

  it("FR-8: a failed test leads the card in red", () => {
    const { events } = story({ failedTest: true });
    thread(events.slice(0, 3));
    const failed = screen.getByRole("list", { name: "Failed tests" });
    expect(failed).toHaveTextContent("Totals match finance · off by 3 units");
    expect(failed).toHaveClass("text-rose-700");
  });

  it("FR-11: the pending approval shows what NerveCenter measured, not a raw input, and no apply card yet", () => {
    const { events, approval } = story();
    thread(events, { pending: approval, status: "waiting" });
    const prompt = screen.getByText("Sonic needs your approval").closest("[data-prompt]") as HTMLElement;
    const evidence = within(prompt).getByTestId("fix-approval");
    expect(evidence).toHaveTextContent(`${TARGET} · 2 of 2 tests passed on ${SANDBOX}`);
    expect(within(evidence).getByRole("figure", { name: "Sales by payer type, After fix" })).toBeInTheDocument();
    expect(within(prompt).getByRole("button", { name: "Approve" })).toBeInTheDocument();
    expect(within(prompt).queryByText(/"proposalId"/)).not.toBeInTheDocument();
    expect(screen.queryByText("Applying the fix")).not.toBeInTheDocument();
  });

  it("FR-16: after approval, the result card shows the verdict, expected against actual, and the widget match", () => {
    const { events } = story({ decided: true });
    thread(events);
    expect(screen.getByText(/Approved by Mitesh/)).toBeInTheDocument();
    const result = screen.getByTestId("fix-result");
    const card = result.parentElement?.parentElement as HTMLElement;
    expect(within(card).getByText("Verified")).toBeInTheDocument();
    const row = within(result).getByRole("row", { name: /No COMM rows/ });
    expect(within(row).getAllByRole("cell").map((cell) => cell.textContent)).toEqual(["No COMM rows= 0", "0", "0", "Pass"]);
    expect(within(result).getByText("Matches the preview")).toBeInTheDocument();
    expect(within(result).getByRole("figure", { name: "Sales by payer type, Expected" })).toBeInTheDocument();
    expect(within(result).getByRole("figure", { name: "Sales by payer type, Actual" })).toBeInTheDocument();
    expect(within(result).getByText("The sandbox copy was dropped.")).toBeInTheDocument();
    expect(within(result).getAllByRole("link", { name: "Open the board" })).toHaveLength(1);
    // Decided, the approval is a short record: the result card carries the evidence now.
    const record = screen.getByTestId("fix-approval");
    expect(record).toHaveTextContent(`${TARGET} · 2 of 2 tests passed on ${SANDBOX}`);
    expect(within(record).queryByRole("figure")).not.toBeInTheDocument();
    expect(within(record).queryByText(/Approving runs this statement once/)).not.toBeInTheDocument();
  });

  it("names the running step in the present tense", () => {
    expect(presentTense(stepLabel(toolUse("apply_fix", { proposalId: "FP-1a2b3c4d" }, "tu-x")))).toBe("Applying tested fix FP-1a2b3c4d");
    expect(presentTense(stepLabel(toolUse("create_fix_sandbox", { table: TARGET }, "tu-y")))).toBe(`Copying ${TARGET} into the fix sandbox`);
  });

  it("FR-12, FR-16: a refused apply reads as not applied, with the reason", () => {
    const { events } = story({ decided: true, outcome: `Error: ${TARGET} changed since the fix was tested (version 7 → 8). Clone it again, test again and propose the fix again.` });
    thread(events);
    expect(screen.getByRole("heading", { name: "Fix not applied" })).toBeInTheDocument();
    expect(screen.getByText(/changed since the fix was tested \(version 7 → 8\)/)).toBeInTheDocument();
  });
});

describe("the Inbox", () => {
  it("FR-11: an apply_fix approval shows the tested fix and links the task for the full preview", async () => {
    const item: InboxItem = { id: "I-7", kind: "approval", status: "pending", taskId: "T-1042", title: `Apply tested fix to ${TARGET}`, category: "production_changes", categoryLabel: "Production change", detail: "Payer type · production changes ask first", tool: { name: "mcp__nervecenter__apply_fix", input: JSON.stringify({ proposalId: proposal.proposalId, reason: "Apply the tested fix." }) }, fix, createdAt: at, updatedAt: at };
    mockFetch((url) => { if (url.includes("/api/me")) return meResponse(testUsers.demo, "admin"); if (url.includes("/api/inbox")) return jsonResponse({ items: [item], total: 1, pending: 1, approvals: 1, unread: 1 }); return jsonResponse({ items: [] }); });
    renderWithClient(<MemoryRouter><ToastProvider><InboxPage /></ToastProvider></MemoryRouter>);
    const evidence = await screen.findByTestId("fix-approval");
    expect(evidence).toHaveTextContent(proposal.title);
    expect(evidence).toHaveTextContent(`${TARGET} · 2 of 2 tests passed on ${SANDBOX}`);
    fireEvent.click(within(evidence).getByRole("button", { name: "Show statement" }));
    expect(within(evidence).getByText(STATEMENT)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "See the table change and board preview in the task" })).toHaveAttribute("href", "/tasks/T-1042");
    expect(screen.queryByText("proposalId")).not.toBeInTheDocument();
  });
});
