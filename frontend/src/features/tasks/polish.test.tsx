import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { Task, TaskEvent } from "@/api/tasks";
import { ToastProvider } from "@/components/ui";
import { renderWithClient } from "@/test/utils";
import { componentFrom, plainEmail } from "./cards/blocks";
import { ComponentView } from "./cards/BlockCard";
import { MetricsCard } from "./cards/MetricsCard";
import { InvestigationCard } from "./cards/InvestigationCard";
import { investigationFrom } from "./investigation";
import { OutcomeLine } from "./OutcomeLine";
import { TaskThread } from "./TaskThread";
import { commandGist, toolMeta } from "./tools";

// SPEC-tasks-10 NFR "no slop": what the live runs on 11 Oct showed readers that they should not see.
const task: Task = { id: "T-1", type: "adhoc", title: "Why did it fail?", summary: "", status: "done", permission: "policy", context: {}, createdBy: { id: "mitesh.shinde", name: "Mitesh Shinde" }, createdAt: "2026-10-11T09:00:00Z", updatedAt: "2026-10-11T09:10:00Z", cost: { totalUsd: 0, inputTokens: 0, outputTokens: 0, turns: 1, durationMs: 1000, runs: 1 }, pendingApprovalId: null };
let seq = 0;
const ev = (extra: Partial<TaskEvent>): TaskEvent => { seq += 1; return { id: `e${seq}`, taskId: "T-1", seq, at: `2026-10-11T09:${String(seq).padStart(2, "0")}:00Z`, type: "status", ...extra } as TaskEvent; };
const call = (name: string, input: Record<string, unknown>) => ev({ type: "tool.use", name, input: JSON.stringify(input), toolUseId: `tu${seq + 1}` });
const done = (use: TaskEvent, content: unknown = { shown: true }) => ev({ type: "tool.result", toolUseId: use.toolUseId, content: JSON.stringify(content) });
const thread = (events: TaskEvent[]) => renderWithClient(<MemoryRouter><ToastProvider><TaskThread task={task} events={events} pendingApproval={null} /></ToastProvider></MemoryRouter>);
const after = (a: HTMLElement, b: HTMLElement) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

describe("no slop", () => {
  it("a command reads as what it does, not as a raw line with local paths", () => {
    expect(commandGist({ command: "cd \"C:/Users/MS47079/Desktop/Beacon/repo\" && git log --oneline -5", description: "List the last five commits" })).toEqual({ description: "List the last five commits", command: "git log --oneline -5" });
    expect(commandGist({ command: "cd /home/sonic/work && python C:\\Users\\me\\tools\\check.py --all" }).command).toBe("python tools/check.py --all");
    expect(toolMeta("Bash")?.label?.({ command: "cd \"C:/x/y\" && ls" })).toBe("Ran ls");
    expect(toolMeta("ToolSearch")?.label?.({ query: "select:mcp__nervecenter__describe_board_data" })).toBe("Loaded tools");
  });

  it("an email draft shows plain text, not markdown", () => {
    expect(plainEmail("Hi,\n\n**What we know**\n- The file changed\n## Next\nThanks")).toBe("Hi,\n\nWhat we know\n• The file changed\nNext\nThanks");
  });

  it("the phase divider names the skill doing the work, never a writing helper", () => {
    seq = 0;
    const helper = call("Skill", { skill: "operations-fleet:unslop" });
    const rca = call("Skill", { skill: "operations-fleet:rca" });
    thread([ev({ type: "user.message", text: "Why?" }), helper, done(helper), rca, done(rca), ev({ type: "assistant.text", text: "It failed on plan_type." })]);
    expect(screen.getByRole("separator", { name: "rca" })).toBeInTheDocument();
    expect(screen.queryByRole("separator", { name: "unslop" })).not.toBeInTheDocument();
  });

  it("next steps close the turn, after the reply", () => {
    seq = 0;
    const chart = call("mcp__nervecenter__show_chart", { title: "Durations", labels: ["Mon", "Tue"], series: [{ name: "Minutes", values: [21, 20] }] });
    const actions = call("mcp__nervecenter__show_actions", { items: [{ label: "Rerun job 731", kind: "ask", prompt: "Rerun job 731" }] });
    thread([ev({ type: "user.message", text: "Why?" }), chart, done(chart), actions, done(actions, { shown: true, actions: 1, questions: 0 }), ev({ type: "assistant.text", text: "The run failed on plan_type. A contract v8 is needed first." })]);
    expect(after(screen.getByText("A contract v8 is needed first."), screen.getByRole("button", { name: /Rerun job 731/ }))).toBe(true);
  });

  it("the root cause shows once, with its chips once, not again under the confirmed hypothesis", () => {
    seq = 0;
    const text = "curate_sales_facts selects plan_type but the data has plan_id only.";
    const events = [
      call("mcp__nervecenter__record_finding", { kind: "hypothesis", id: "h1", text: "The input lost plan_type" }),
      call("mcp__nervecenter__record_finding", { kind: "root_cause", hypothesisId: "h1", text, confidence: "medium", evidence: [{ label: "RCA write-up", kind: "file", ref: "report.md" }] }),
    ];
    render(<MemoryRouter><InvestigationCard investigation={investigationFrom(events)} live={false} compact={false} /></MemoryRouter>);
    expect(screen.getAllByText(text)).toHaveLength(1);
    expect(screen.getAllByText("RCA write-up")).toHaveLength(1);
    expect(screen.getByText("Confirmed")).toBeInTheDocument();
  });

  it("the outcome line keeps the headline readable and shows at most three facts", () => {
    const items = ["Ticket", "Job", "Confidence", "Connector", "Owner"].map((label) => ({ label, value: `${label} value`, tone: "neutral" as const }));
    render(<OutcomeLine line={{ mood: "good", word: "Answered", headline: "The load fails because plan_type is missing", items, waiting: null }} />);
    expect(screen.getByText("Confidence value")).toBeInTheDocument();
    expect(screen.queryByText("Connector value")).not.toBeInTheDocument();
  });

  it("a fact that would be cut off is left out of the outcome line", () => {
    render(<OutcomeLine line={{ mood: "good", word: "Answered", headline: "Root cause found", items: [{ label: "Confidence", value: "Medium (cause), low (trigger and timing)", tone: "warning" }, { label: "Job", value: "731", tone: "bad" }], waiting: null }} />);
    expect(screen.queryByText(/Medium \(cause\)/)).not.toBeInTheDocument();
    expect(screen.getByText("731")).toBeInTheDocument();
  });

  it("a long reply under the cards opens on its first lines, the rest one click away", async () => {
    seq = 0;
    const chart = call("mcp__nervecenter__show_chart", { title: "Durations", labels: ["Mon", "Tue"], series: [{ name: "Minutes", values: [21, 20] }] });
    const rest = Array.from({ length: 12 }, (_, index) => `Paragraph ${index + 1} explains one more detail about the failed load and what to check.`).join("\n\n");
    thread([ev({ type: "user.message", text: "Why?" }), chart, done(chart), ev({ type: "assistant.text", text: `The run failed on plan_type.\n\n${rest}` })]);
    const more = screen.getByRole("button", { name: "Show the full reply" });
    expect(more).toHaveAttribute("aria-expanded", "false");
    more.click();
    expect(await screen.findByRole("button", { name: "Show less" })).toHaveAttribute("aria-expanded", "true");
  });

  it("a note's run-in title keeps its full stop, so it does not read into the sentence after it", () => {
    seq = 0;
    const use = call("mcp__nervecenter__show_notes", { title: "Check before you send", items: [{ title: "Last good date is not in the email", text: "Add it if you know it.", tone: "warning" }] });
    const component = componentFrom(use, done(use));
    render(<MemoryRouter>{component ? <ComponentView component={component} compact={false} taskId="T-1" /> : null}</MemoryRouter>);
    expect(screen.getByText("Last good date is not in the email.")).toBeInTheDocument();
  });

  it("a metric's wordy sub-line is a plain note; only a real delta is a chip", () => {
    render(<MetricsCard card={{ kind: "metrics", title: null, note: null, items: [{ label: "DQ failing", value: "4", suffix: null, delta: "1 warning, 5 passed", trend: [], tone: "bad" }, { label: "Rows", value: "11,982", suffix: null, delta: "+4%", trend: [3, 4, 5], tone: "good" }] }} />);
    expect(screen.getByText("1 warning, 5 passed")).toHaveClass("line-clamp-2");
    expect(screen.getByText("+4%")).toHaveClass("font-mono");
  });
});
