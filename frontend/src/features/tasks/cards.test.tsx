import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { TaskEvent } from "@/api/tasks";
import { cardFrom, planFrom } from "./cards/cards";
import { PlanCard } from "./cards/PlanCard";
import { PullRequestCard } from "./cards/PullRequestCard";
import { TableCard } from "./cards/TableCard";

const toolUse = (seq: number, tool: string, input: Record<string, unknown>): TaskEvent => ({ id: `e${seq}`, taskId: "T-1", seq, at: `2026-09-25T09:${String(seq).padStart(2, "0")}:00Z`, type: "tool.use", toolUseId: `tu${seq}`, name: `mcp__nervecenter__${tool}`, input: JSON.stringify(input) });

describe("TableCard", () => {
  it("colours the Status column, links ticket ids, right-aligns numbers and folds after 8 rows", () => {
    const rows = Array.from({ length: 10 }, (_, index) => [`OPS-${1001 + index}`, index === 0 ? "Failed" : "Healthy", 1200 + index]);
    const card = cardFrom(toolUse(1, "show_table", { title: "Runs today", columns: ["Ticket", "status", "Rows"], rows, note: "Last 24 hours" }));
    expect(card?.kind).toBe("table");
    if (!card || card.kind !== "table") throw new Error("expected a table card");
    render(<MemoryRouter><TableCard card={card} /></MemoryRouter>);
    expect(screen.getByRole("heading", { name: "Runs today" })).toBeInTheDocument();
    expect(screen.getByText("Last 24 hours")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "OPS-1001" })).toHaveAttribute("href", "/tickets/OPS-1001");
    const failed = screen.getByText("Failed");
    expect(failed.closest("span")).toHaveClass("text-rose-700");
    expect(screen.getAllByText("Healthy")[0].closest("span")).toHaveClass("text-emerald-700");
    expect(screen.getByRole("columnheader", { name: "Rows" })).toHaveClass("text-right");
    expect(screen.getByRole("columnheader", { name: "Ticket" })).not.toHaveClass("text-right");
    expect(screen.getAllByRole("row")).toHaveLength(9); // header + 8
    expect(screen.getByRole("button", { name: "Show all 10" })).toBeInTheDocument();
  });

  it("keeps 4 columns and 5 rows in the compact form and points at the task", () => {
    const card = cardFrom(toolUse(1, "show_table", { title: "Wide", columns: ["A", "B", "C", "D", "E"], rows: Array.from({ length: 7 }, (_, index) => [index, index, index, index, index]) }));
    if (!card || card.kind !== "table") throw new Error("expected a table card");
    render(<MemoryRouter><TableCard card={card} compact taskId="T-77" /></MemoryRouter>);
    expect(screen.getAllByRole("columnheader")).toHaveLength(4);
    expect(screen.getAllByRole("row")).toHaveLength(6);
    expect(screen.getByRole("link", { name: "Open task" })).toHaveAttribute("href", "/tasks/T-77");
    expect(screen.getByText("2 more rows · 1 more column")).toBeInTheDocument();
  });
});

describe("PlanCard", () => {
  const events: TaskEvent[] = [
    toolUse(1, "propose_plan", { title: "Fix the Veltrix load", steps: [{ id: "s1", text: "Read the failed run", kind: "read" }, { id: "s2", text: "Repair the run", kind: "change" }, { id: "s3", text: "Check the mart is fresh", kind: "check" }] }),
    toolUse(2, "update_plan", { stepId: "s1", state: "done", note: "Run 900100826 failed on plan_type." }),
  ];

  it("folds the last plan with its updates and marks the next step active while the task runs", () => {
    const plan = planFrom(events, true);
    expect(plan).toMatchObject({ title: "Fix the Veltrix load", done: 1, total: 3 });
    expect(plan?.steps.map((step) => step.state)).toEqual(["done", "active", "pending"]);
    expect(plan?.steps[0].note).toBe("Run 900100826 failed on plan_type.");
    expect(planFrom(events, false)?.steps.map((step) => step.state)).toEqual(["done", "pending", "pending"]);
    // A later plan replaces the first; updates before it are ignored.
    const replaced = planFrom([...events, toolUse(3, "propose_plan", { steps: [{ id: "a", text: "Only step" }] }), toolUse(4, "update_plan", { stepId: "s1", state: "done" })], false);
    expect(replaced).toMatchObject({ title: null, done: 0, total: 1 });
    expect(planFrom([], true)).toBeNull();
  });

  it("renders the checklist with a state per step, the change chip and the footer actions", () => {
    const plan = planFrom(events, true);
    if (!plan) throw new Error("expected a plan");
    const onAdjust = vi.fn(); const onStop = vi.fn();
    render(<MemoryRouter><PlanCard plan={plan} live onAdjust={onAdjust} onStop={onStop} /></MemoryRouter>);
    expect(screen.getByRole("heading", { name: "Fix the Veltrix load" })).toBeInTheDocument();
    expect(screen.getByText("1 of 3 done")).toBeInTheDocument();
    const steps = within(screen.getByRole("list", { name: "Plan steps" })).getAllByRole("listitem");
    expect(steps.map((step) => step.dataset.state)).toEqual(["done", "active", "pending"]);
    expect(screen.getByLabelText("Done")).toBeInTheDocument();
    expect(screen.getByLabelText("In progress")).toBeInTheDocument();
    expect(screen.getAllByText("Changes a system")).toHaveLength(1);
    expect(screen.getByText("Run 900100826 failed on plan_type.")).toBeInTheDocument();
    screen.getByRole("button", { name: "Adjust plan" }).click();
    expect(onAdjust).toHaveBeenCalledWith("Change the plan: ");
    screen.getByRole("button", { name: "Stop" }).click();
    expect(onStop).toHaveBeenCalled();
  });
});

describe("PullRequestCard", () => {
  it("shows the pull request Sonic opened with its state, branches, size, ticket and a link to GitHub", () => {
    const card = cardFrom(toolUse(1, "show_pull_request", { url: "https://github.com/acme/data-platform/pull/42", number: 42, title: "Handle the new plan_type column", branch: "sonic/ops-1001-plan-type", base: "main", state: "draft", summary: "Adds plan_type to the Veltrix load schema", ticketId: "OPS-1001", additions: 12, deletions: 3, files: 2 }));
    if (!card || card.kind !== "pull_request") throw new Error("expected a pull request card");
    render(<MemoryRouter><PullRequestCard card={card} /></MemoryRouter>);
    expect(screen.getByRole("heading", { name: "Pull request" })).toBeInTheDocument();
    expect(screen.getByText("Draft")).toBeInTheDocument();
    expect(screen.getByText("Handle the new plan_type column")).toBeInTheDocument();
    expect(screen.getByText("acme/data-platform")).toBeInTheDocument();
    expect(screen.getByLabelText("Merges sonic/ops-1001-plan-type into main")).toBeInTheDocument();
    expect(screen.getByText("+12")).toBeInTheDocument();
    expect(screen.getByText("2 files")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "OPS-1001" })).toHaveAttribute("href", "/tickets/OPS-1001");
    expect(screen.getByRole("link", { name: "Review on GitHub" })).toHaveAttribute("href", "https://github.com/acme/data-platform/pull/42");
  });

  it("draws nothing for a link that is not a GitHub pull request", () => {
    expect(cardFrom(toolUse(1, "show_pull_request", { url: "https://evil.example/pull/1", number: 1, title: "x", branch: "a", base: "main" }))).toBeNull();
  });
});
