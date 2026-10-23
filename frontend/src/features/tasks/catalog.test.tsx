import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import type { TaskEvent } from "@/api/tasks";
import { ComponentView } from "./cards/BlockCard";
import { componentFrom, followUpsFrom, safeHref, type Component } from "./cards/blocks";
import { TaskActionsContext, type TaskActions } from "./cards/taskActions";

// SPEC-tasks-10: Sonic's component catalog on the client.
let seq = 0;
const call = (tool: string, input: unknown, toolUseId = `tu${seq + 1}`): TaskEvent => { seq += 1; return { id: `e${seq}`, taskId: "T-1", seq, at: "2026-10-11T09:00:00Z", type: "tool.use", toolUseId, name: `mcp__nervecenter__${tool}`, input: typeof input === "string" ? input : JSON.stringify(input) }; };
const result = (toolUseId: string, content: unknown, isError = false): TaskEvent => { seq += 1; return { id: `e${seq}`, taskId: "T-1", seq, at: "2026-10-11T09:00:01Z", type: "tool.result", toolUseId, content: typeof content === "string" ? content : JSON.stringify(content), isError }; };
const block = (component: Component | null) => { if (!component || component.type !== "block") throw new Error("expected a block"); return component.block; };

function draw(event: TaskEvent, actions: Partial<TaskActions> = {}, resultEvent: TaskEvent | null = null): ReactElement {
  const component = componentFrom(event, resultEvent);
  if (!component) throw new Error("nothing to draw");
  return <MemoryRouter><TaskActionsContext.Provider value={{ canAsk: true, ...actions }}><ComponentView component={component} /></TaskActionsContext.Provider></MemoryRouter>;
}

describe("catalog parsers", () => {
  it("FR-16: reads partial or wrong input without throwing, and drops what it cannot read", () => {
    const chart = block(componentFrom(call("show_chart", { title: "Runs", labels: ["Mon", "Tue", "Wed"], series: [{ name: "Failed", values: ["2", "x"] }], type: "pie" })));
    expect(chart).toMatchObject({ kind: "chart", type: "column", series: [{ name: "Failed", values: [2, 0, 0] }] });
    const grid = block(componentFrom(call("show_status_grid", { title: "Runs", columns: ["Mon"], rows: [{ label: "Job 731", cells: [{ state: "exploded" }] }] })));
    expect(grid).toMatchObject({ kind: "status_grid", rows: [{ cells: [{ state: "none" }] }] });
    expect(componentFrom(call("show_chart", "{not json"))).toBeNull();
    expect(componentFrom(call("show_checklist", { title: "Checks", items: "nope" }))).toBeNull();
    const actions = block(componentFrom(call("show_actions", { items: [{ label: "Run", kind: "ask" }, { label: "Open", kind: "open", href: "javascript:alert(1)" }, { label: "Ticket", kind: "open", href: "/tickets/OPS-1" }] })));
    expect(actions).toMatchObject({ kind: "actions", items: [{ label: "Ticket", href: "/tickets/OPS-1" }] });
    expect([safeHref("https://github.com/x/y/pull/1"), safeHref("//evil.com"), safeHref("report.html"), safeHref("../secret.html"), safeHref("http://plain.com")]).toEqual(["https://github.com/x/y/pull/1", null, "report.html", null, null]);
  });

  it("FR-16: a kind the page does not know becomes a plain card of its title and fields, alone or in a view", () => {
    expect(block(componentFrom(call("show_load_profile", { title: "Load by hour", peakHour: 9, owners: ["a", "b"], window: { from: "Mon", to: "Sun" }, hours: [{ hour: 9, runs: 4 }, { hour: 10, runs: 2, late: true }] })))).toEqual({
      kind: "generic", title: "Load by hour",
      fields: [["Peak Hour", "9"], ["Owners", "a, b"], ["Window · From", "Mon"], ["Window · To", "Sun"]],
      tables: [{ title: "Hours", columns: ["Hour", "Runs", "Late"], rows: [["9", "4", ""], ["10", "2", "true"]], more: 0 }],
    });
    const view = block(componentFrom(call("show_view", { title: "Morning", blocks: [{ kind: "sparkles", title: "New thing", level: 3 }] })));
    expect(view).toMatchObject({ kind: "view", blocks: [{ width: "full", item: { type: "block", block: { kind: "generic", title: "New thing" } } }] });
  });

  it("FR-5: the follow-ups are the questions of the last show_actions since the reader's last message", () => {
    const first = call("show_actions", { questions: ["Why run-now?"] });
    const reader: TaskEvent = { id: "u2", taskId: "T-1", seq: 99, at: "2026-10-11T09:05:00Z", type: "user.message", text: "Thanks" };
    expect(followUpsFrom([first])).toEqual(["Why run-now?"]);
    expect(followUpsFrom([first, reader])).toEqual([]);
    expect(followUpsFrom([first, reader, call("show_actions", { questions: ["What changed?", "Who owns it?"] })])).toEqual(["What changed?", "Who owns it?"]);
  });
});

describe("catalog renderers", () => {
  it("FR-13 / S4: a view draws its blocks in order under one title, and an unknown block as a plain card", () => {
    render(draw(call("show_view", { title: "Veltrix this morning", blocks: [
      { kind: "metrics", items: [{ label: "Failed runs", value: 1, tone: "bad" }] },
      { kind: "chart", width: "half", title: "Durations", labels: ["20 Sep", "21 Sep"], series: [{ name: "Minutes", values: [21, 20] }] },
      { kind: "status_grid", width: "half", title: "Last runs", columns: ["20 Sep", "21 Sep"], rows: [{ label: "Job 731", cells: [{ state: "ok" }, { state: "failed" }] }] },
      { kind: "checklist", title: "Verification", items: [{ label: "Newest run", result: "pass" }, { label: "DQ checks", result: "open" }] },
      { kind: "sparkles", title: "Something new" },
    ] })));
    const view = screen.getByRole("region", { name: "Veltrix this morning" });
    const headings = within(view).getAllByRole("heading").map((heading) => heading.textContent);
    expect(headings).toEqual(["Veltrix this morning", "Durations", "Last runs", "Verification", "Something new"]);
    expect(within(view).getByText("Failed runs")).toBeInTheDocument();
    expect(within(view).getByRole("cell", { name: "Job 731 · 21 Sep · Failed" })).toBeInTheDocument();
    expect(within(view).getByText("1 of 2 pass · 1 open")).toBeInTheDocument();
  });

  it("FR-16: an unknown component's records render as a table, so a new kind is readable before it has a renderer", () => {
    render(draw(call("show_capacity_plan", { title: "Cluster capacity", cluster: "etl-prod", nodes: [{ name: "n1", cpu: "72%" }, { name: "n2", cpu: "41%" }] })));
    expect(screen.getByRole("heading", { name: "Cluster capacity" })).toBeInTheDocument();
    expect(screen.getByText("etl-prod")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Cpu" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "72%" })).toBeInTheDocument();
  });

  it("FR-18: actions ask in the reader's words, open routes and links safely, and say when they need approval", async () => {
    const ask = vi.fn();
    render(draw(call("show_actions", { items: [
      { label: "Rerun the load", kind: "ask", prompt: "Rerun job 731 now", needsApproval: true },
      { label: "Open the ticket", kind: "open", href: "/tickets/OPS-1" },
      { label: "Open the PR", kind: "open", href: "https://github.com/acme/etl/pull/7" },
    ] }), { ask }));
    const rerun = screen.getByRole("button", { name: /Rerun the load/ });
    expect(rerun).toHaveTextContent("Needs approval");
    await userEvent.click(rerun);
    expect(ask).toHaveBeenCalledWith("Rerun job 731 now");
    expect(rerun).toBeDisabled();
    expect(screen.getByRole("link", { name: /Open the ticket/ })).toHaveAttribute("href", "/tickets/OPS-1");
    const pr = screen.getByRole("link", { name: /Open the PR/ });
    expect(pr).toHaveAttribute("target", "_blank");
    expect(pr).toHaveAttribute("rel", "noreferrer");
  });

  it("FR-18: an ask action is off while asking is blocked, and says why", () => {
    render(draw(call("show_actions", { items: [{ label: "Rerun", kind: "ask", prompt: "Rerun it" }] }), { ask: vi.fn(), canAsk: false, askBlocked: "Sonic is working" }));
    const button = screen.getByRole("button", { name: /Rerun/ });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("title", "Sonic is working");
  });

  it("FR-21: an open checklist item and a status-grid cell ask like an action", async () => {
    const ask = vi.fn();
    const { unmount } = render(draw(call("show_checklist", { title: "Verification", items: [{ label: "DQ checks", result: "open", ask: "Run the DQ checks on gold.sales" }] }), { ask }));
    await userEvent.click(screen.getByRole("button", { name: "Settle this" }));
    expect(ask).toHaveBeenCalledWith("Run the DQ checks on gold.sales");
    unmount();
    render(draw(call("show_status_grid", { title: "Runs", columns: ["21 Sep"], rows: [{ label: "Job 731", cells: [{ state: "failed", label: "Run 900001222 failed", ask: "Why did run 900001222 fail?" }] }] }), { ask }));
    fireEvent.click(screen.getByRole("button", { name: "Run 900001222 failed" }));
    expect(ask).toHaveBeenLastCalledWith("Why did run 900001222 fail?");
  });

  it("FR-19: the email draft can be edited, and Send asks Sonic to send exactly the edited text", async () => {
    const ask = vi.fn();
    render(draw(call("show_email", { to: ["owner@acme.com"], subject: "Veltrix load recovered", body: "The load is back." }), { ask }));
    const subject = screen.getByLabelText("Subject");
    await userEvent.clear(subject);
    await userEvent.type(subject, "Veltrix load is back");
    await userEvent.type(screen.getByLabelText("Cc"), "lead@acme.com");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(ask).toHaveBeenCalledWith(["Send this email exactly as written.", "", "To: owner@acme.com", "Cc: lead@acme.com", "Subject: Veltrix load is back", "", "The load is back."].join("\n"));
    expect(screen.getByText(/Asked Sonic to send it/)).toBeInTheDocument();
    expect(screen.getByLabelText("Body")).toBeDisabled();
  });

  it("FR-13: every catalog kind draws something readable", () => {
    const openFile = vi.fn();
    const kinds: Array<[string, Record<string, unknown>, string]> = [
      ["show_facts", { title: "Job 731", items: [{ label: "Owner", value: "Data eng" }, { label: "SLA", value: "07:30", tone: "good" }] }, "Data eng"],
      ["show_chart", { title: "Failures by day", type: "bar", labels: ["Mon", "Tue"], series: [{ name: "Failed", values: [2, 1] }, { name: "Succeeded", values: [5, 6] }], unit: "runs" }, "Failures by day"],
      ["show_chart", { title: "Minutes", type: "area", labels: ["Mon", "Tue"], series: [{ name: "Minutes", values: [20, 21] }] }, "Minutes"],
      ["show_progress", { title: "Run 900001223", state: "running", steps: [{ label: "land_check", state: "done", seconds: 14 }, { label: "load_sales", state: "running" }, { label: "refresh", state: "pending" }] }, "load_sales"],
      ["show_flow", { title: "Where it broke", steps: [{ label: "Landing", state: "done" }, { label: "Check", state: "failed" }, { label: "Load", state: "skipped" }, { label: "Mart", state: "stale" }, { label: "Board", state: "running" }, { label: "Email", state: "pending" }] }, "Where it broke"],
      ["show_records", { title: "Records changed", items: [{ system: "ServiceNow", id: "INC0031201", from: "New", to: "Resolved", verified: true, url: "https://sn.example/x" }, { system: "Jira", id: "DATAOPS-1854", to: "Commented", note: "RCA summary" }] }, "INC0031201"],
      ["show_notes", { title: "Worth knowing", items: [{ title: "Risk.", text: "More columns may come.", tone: "warning" }] }, "More columns may come."],
      ["show_document", { title: "Weekly brief", format: "deck", path: "brief.pptx", summary: "Six slides for the stand-up.", outline: [{ heading: "Headline", status: "done" }, { heading: "Risks", status: "draft" }, { heading: "Asks", status: "todo" }] }, "Six slides for the stand-up."],
      ["show_email", { to: ["a@b.example"], subject: "Recovered", body: "Back.", status: "sent" }, "Back."],
    ];
    for (const [tool, input, text] of kinds) {
      const { unmount } = render(draw(call(tool, input), { openFile }));
      expect(screen.getAllByText(text).length).toBeGreaterThan(0);
      unmount();
    }
    render(draw(call("show_document", { title: "Weekly brief", path: "brief.pptx" }), { openFile }));
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(openFile).toHaveBeenCalledWith("brief.pptx");
  });

  it("FR-14: the ticket card draws the ticket the server read, and says when it could not", () => {
    const ticket = call("show_ticket", { ticketId: "INC0031201", note: "The incident" }, "tu-ticket");
    const { rerender } = render(draw(ticket));
    expect(screen.getByRole("heading", { name: "Ticket" })).toBeInTheDocument();
    rerender(draw(ticket, {}, result("tu-ticket", { ticket: { ticketId: "OPS-1", number: "INC0031201", title: "Veltrix daily load failed", priority: "high", status: "open", source: "servicenow", assignee: null, agentFinding: "plan_type broke the check", link: "/tickets/OPS-1", updatedAt: "2026-10-11T08:00:00Z" } })));
    expect(screen.getByText("Veltrix daily load failed")).toBeInTheDocument();
    expect(screen.getByText("Unassigned")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open/ })).toHaveAttribute("href", "/tickets/OPS-1");
    rerender(draw(ticket, {}, result("tu-ticket", "Error: No ticket OPS-9 in this project", true)));
    expect(screen.getByText("No ticket OPS-9 in this project")).toBeInTheDocument();
  });

  it("FR-14: the runs card draws the tool result, not the model's input, and waits for it", () => {
    const runs = call("show_pipeline_runs", { pipelineId: "731", title: "Job 731", runs: [{ runId: "made-up" }] }, "tu-runs");
    const { rerender } = render(draw(runs));
    expect(screen.queryByText("made-up")).not.toBeInTheDocument();
    rerender(draw(runs, {}, result("tu-runs", { runs: [{ runId: "900001222", status: "failed", startTime: "2026-10-10T06:00:00Z", durationMs: 19000, failure: "schema mismatch: plan_type" }] })));
    expect(screen.getByText("900001222")).toBeInTheDocument();
    expect(screen.getByText("schema mismatch: plan_type")).toBeInTheDocument();
    expect(screen.queryByText("made-up")).not.toBeInTheDocument();
    rerender(draw(runs, {}, result("tu-runs", "Error: No runs of pipeline 731 in this project", true)));
    expect(screen.getByText("No runs of pipeline 731 in this project")).toBeInTheDocument();
  });
});
