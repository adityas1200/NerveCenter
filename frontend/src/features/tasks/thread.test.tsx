import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { Task, TaskEvent } from "@/api/tasks";
import { ToastProvider } from "@/components/ui";
import { renderWithClient } from "@/test/utils";
import { groupEvents } from "./taskEvents";
import { TaskThread } from "./TaskThread";
import type { StartingTool } from "./useTaskStream";

// SPEC-tasks-10 FR-6 to FR-11: the thread as one conversation.
const task: Task = { id: "T-1", type: "ticket", title: "Veltrix load failed", summary: "", status: "done", permission: "policy", context: {}, createdBy: { id: "mitesh.shinde", name: "Mitesh Shinde" }, createdAt: "2026-10-11T09:00:00Z", updatedAt: "2026-10-11T09:10:00Z", cost: { totalUsd: 0, inputTokens: 0, outputTokens: 0, turns: 1, durationMs: 1000, runs: 1 }, pendingApprovalId: null };
let seq = 0;
const at = () => `2026-10-11T09:${String(seq).padStart(2, "0")}:00Z`;
const ev = (extra: Partial<TaskEvent>): TaskEvent => { seq += 1; return { id: `e${seq}`, taskId: "T-1", seq, at: at(), type: "status", ...extra } as TaskEvent; };
const call = (name: string, input: Record<string, unknown>) => ev({ type: "tool.use", name: name.includes("__") || /^[A-Z]/.test(name) ? name : `mcp__nervecenter__${name}`, input: JSON.stringify(input), toolUseId: `tu${seq + 1}` });
const done = (call: TaskEvent, content: unknown = { shown: true }) => ev({ type: "tool.result", toolUseId: call.toolUseId, content: JSON.stringify(content) });
const message = (text: string) => ev({ type: "user.message", text });
const reply = (text: string) => ev({ type: "assistant.text", text });

function thread(events: TaskEvent[], props: { task?: Task; pendingApproval?: TaskEvent | null; startingTool?: StartingTool | null; compact?: boolean } = {}) {
  return renderWithClient(<MemoryRouter><ToastProvider><TaskThread task={props.task ?? task} events={events} pendingApproval={props.pendingApproval ?? null} startingTool={props.startingTool ?? null} compact={props.compact} /></ToastProvider></MemoryRouter>);
}
const position = (a: HTMLElement, b: HTMLElement) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

const explain = () => call("explain_action", { title: "Rerun job 731", what: "Starts a new run of the Veltrix daily load now.", checks: ["The schema fix is merged"], impact: "Refreshes gold.sales", rollback: "Nothing to undo", ifFails: "The table keeps yesterday's data" });
const approval = () => ev({ type: "approval.requested", inboxId: "I-1", category: "production_changes", title: "Waiting for approval: Run command: databricks jobs run-now 731", tool: { name: "Bash", input: JSON.stringify({ command: "databricks jobs run-now --job-id 731" }) } });

describe("the thread", () => {
  it("FR-6: a finished turn reads fold, its answer as a headline, its components in order, then the rest of its reply", () => {
    seq = 0;
    const read = call("get_pipeline_runs", { pipelineId: "731" });
    const chart = call("show_chart", { title: "Durations", labels: ["Mon", "Tue"], series: [{ name: "Minutes", values: [21, 20] }] });
    const checklist = call("show_checklist", { title: "Verification", items: [{ label: "Newest run", result: "pass" }] });
    thread([message("Why did it fail?"), read, done(read, []), chart, done(chart), checklist, done(checklist), reply("The run failed on plan_type. The contract needs a v8 before a rerun.")]);
    const fold = screen.getByRole("button", { name: /^Worked/ });
    const headline = screen.getByRole("heading", { name: "The run failed on plan_type." });
    const first = screen.getByRole("heading", { name: "Durations" });
    const second = screen.getByRole("heading", { name: "Verification" });
    const text = screen.getByText("The contract needs a v8 before a rerun.");
    expect(position(fold, headline) && position(headline, first) && position(first, second) && position(second, text)).toBe(true);
    // The component calls are not repeated as steps.
    expect(fold).toHaveTextContent("1 step");
  });

  it("FR-6: a live turn, or one that drew nothing, keeps its reply whole at the end", () => {
    seq = 0;
    const chart = call("show_chart", { title: "Durations", labels: ["Mon", "Tue"], series: [{ name: "Minutes", values: [21, 20] }] });
    const { unmount } = thread([message("Why?"), chart, done(chart), reply("The run failed on plan_type. A v8 is needed.")], { task: { ...task, status: "running" } });
    expect(screen.queryByRole("heading", { name: /The run failed/ })).not.toBeInTheDocument();
    expect(position(screen.getByRole("heading", { name: "Durations" }), screen.getByText(/The run failed on plan_type\. A v8 is needed\./))).toBe(true);
    unmount();
    seq = 0;
    thread([message("Who owns job 731?"), reply("Priya Nair owns job 731. She is on call this week.")]);
    expect(screen.queryByRole("heading", { name: /Priya/ })).not.toBeInTheDocument();
    expect(screen.getByText(/Priya Nair owns job 731\. She is on call this week\./)).toBeInTheDocument();
  });

  it("FR-7: a pending approval after explain_action shows Sonic's summary, the server's category and the command behind a toggle; the fold stays shut", async () => {
    seq = 0;
    const pending = approval();
    const events = [message("Rerun it"), call("Read", { file_path: "notes.md" }), explain(), pending];
    thread(events, { task: { ...task, status: "waiting", pendingApprovalId: "I-1" }, pendingApproval: pending });
    expect(groupEvents(events, false).map((group) => group.kind)).toEqual(["user", "steps", "approval"]);
    expect(screen.getByRole("button", { name: /^Worked/ })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("Sonic needs your approval")).toBeInTheDocument();
    expect(screen.getByText("Rerun job 731")).toBeInTheDocument();
    expect(screen.getByText("Starts a new run of the Veltrix daily load now.")).toBeInTheDocument();
    expect(screen.getByText("Refreshes gold.sales")).toBeInTheDocument();
    expect(screen.getByText(/Sonic's summary/)).toBeInTheDocument();
    expect(screen.getByText("Production change")).toBeInTheDocument();
    expect(screen.queryByText("databricks jobs run-now --job-id 731")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Show command" }));
    expect(screen.getByText("databricks jobs run-now --job-id 731")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument();
  });

  it("FR-7: a pending approval without an explanation still shows in the turn, with its command", () => {
    seq = 0;
    const pending = approval();
    thread([message("Rerun it"), pending], { task: { ...task, status: "waiting", pendingApprovalId: "I-1" }, pendingApproval: pending });
    expect(screen.getByText("Sonic needs your approval")).toBeInTheDocument();
    expect(screen.getByText("databricks jobs run-now --job-id 731")).toBeInTheDocument();
  });

  it("FR-8: a decided approval with an explanation stays in view with who decided; one without stays in the fold", () => {
    seq = 0;
    const explained = approval();
    const plain = ev({ type: "approval.requested", inboxId: "I-2", category: "ticket_writes", title: "Waiting for approval: Comment on ticket OPS-1", tool: { name: "mcp__nervecenter__comment_on_ticket", input: "{}" } });
    thread([message("Rerun it"), explain(), explained, ev({ type: "approval.decided", inboxId: "I-1", decision: "approved", actor: { id: "mitesh.shinde", name: "Mitesh Shinde" } }), plain, ev({ type: "approval.decided", inboxId: "I-2", decision: "approved" }), reply("Done.")]);
    expect(screen.getByText("Rerun job 731")).toBeInTheDocument();
    expect(screen.getByText("Approved by Mitesh Shinde")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Comment on ticket OPS-1/)).not.toBeInTheDocument();
  });

  it("FR-9: a turn's findings draw as one investigation card where the first one sits", () => {
    seq = 0;
    thread([
      message("Why is it empty?"),
      call("record_finding", { kind: "hypothesis", id: "h1", text: "The file changed shape" }),
      call("record_finding", { kind: "ruled_out", hypothesisId: "h2", text: "Late file", because: "It landed on time" }),
      call("record_finding", { kind: "root_cause", hypothesisId: "h1", text: "A new plan_type column broke the load", confidence: "high", evidence: [{ label: "Run 900001222", kind: "run" }] }),
      reply("Root cause found."),
    ]);
    expect(screen.getAllByRole("heading", { name: "Investigation" })).toHaveLength(1);
    const card = screen.getByRole("region", { name: "Root cause" });
    expect(within(card).getByText("A new plan_type column broke the load")).toBeInTheDocument();
    expect(within(card).getByText("Confident")).toBeInTheDocument();
    expect(screen.getByText("Root cause found")).toBeInTheDocument();
  });

  it("FR-10: while Sonic starts a component tool the turn shows a skeleton naming it", () => {
    seq = 0;
    thread([message("Chart it")], { task: { ...task, status: "running" }, startingTool: { name: "mcp__nervecenter__show_chart", title: "NerveCenter · show chart", at: "2026-10-11T09:01:00Z" } });
    expect(screen.getByRole("heading", { name: "Drawing a chart" })).toBeInTheDocument();
  });

  it("FR-11: the compact panel draws the same components", () => {
    seq = 0;
    const flow = call("show_flow", { title: "Where it broke", steps: [{ label: "Landing", state: "done" }, { label: "Load", state: "failed", sub: "plan_type" }, { label: "Board", state: "stale" }] });
    thread([message("Where did it break?"), flow, done(flow)], { compact: true });
    expect(screen.getByRole("heading", { name: "Where it broke" })).toBeInTheDocument();
    expect(screen.getByLabelText("Load: failed, plan_type")).toBeInTheDocument();
  });
});
