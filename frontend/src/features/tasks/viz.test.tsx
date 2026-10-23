import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { TaskEvent } from "@/api/tasks";
import { componentFrom, type Component } from "./cards/blocks";
import { ComponentView } from "./cards/BlockCard";
import { TaskActionsContext } from "./cards/taskActions";

// SPEC-tasks-10 FR-25: the richer visualisations, drawn from a tool call's input.
let seq = 0;
const call = (name: string, input: Record<string, unknown>): TaskEvent => { seq += 1; return { id: `e${seq}`, taskId: "T-1", seq, at: "2026-10-11T09:00:00Z", type: "tool.use", name: `mcp__nervecenter__${name}`, input: JSON.stringify(input), toolUseId: `tu${seq}` } as TaskEvent; };
const done = (use: TaskEvent): TaskEvent => ({ ...use, id: `${use.id}r`, type: "tool.result", content: JSON.stringify({ shown: true }) } as TaskEvent);
function draw(name: string, input: Record<string, unknown>, ask = vi.fn()) {
  const use = call(name, input);
  const component = componentFrom(use, done(use)) as Component;
  return render(<MemoryRouter><TaskActionsContext.Provider value={{ ask, canAsk: true }}><ComponentView component={component} taskId="T-1" /></TaskActionsContext.Provider></MemoryRouter>);
}

describe("FR-25 visualisations", () => {
  it("a heatmap shades by value in one hue, reads zero as empty and names every cell", () => {
    draw("show_heatmap", { title: "Failed runs by job and day", scale: "high_is_bad", unit: "runs", columns: ["10 Oct", "11 Oct"], rows: [{ label: "veltrix", values: [22, 31] }, { label: "corvana", values: [0, null] }] });
    expect(screen.getByRole("heading", { name: "Failed runs by job and day" })).toBeInTheDocument();
    expect(screen.getByLabelText("veltrix · 11 Oct: 31 runs")).toHaveStyle({ color: "rgb(255, 255, 255)" });
    expect(screen.getByLabelText("corvana · 10 Oct: 0 runs")).toHaveClass("bg-surface-subtle");
    expect(screen.getByLabelText("corvana · 11 Oct: no data")).toHaveClass("border-dashed");
    expect(screen.getByText("darker is worse")).toBeInTheDocument();
  });

  it("gauges take their state from the value against the target, in words as well as colour", () => {
    draw("show_gauges", { items: [
      { label: "SLA met", value: 88, max: 100, target: 95, unit: "%" },
      { label: "Freshness", value: 20, max: 72, target: 24, unit: "h", higherIsBetter: false },
      { label: "DQ pass rate", value: 70, max: 100, target: 90, unit: "%" },
    ] });
    expect(screen.getByRole("img", { name: "SLA met: 88% of 100%, target 95%" })).toBeInTheDocument();
    expect(screen.getByText("Near target")).toBeInTheDocument();
    expect(screen.getByText("On target")).toBeInTheDocument();
    expect(screen.getByText("Off target")).toBeInTheDocument();
  });

  it("a funnel shows what each stage lost and what reached the end", () => {
    draw("show_funnel", { title: "Veltrix rows", unit: "rows", stages: [{ label: "Landed", value: 1000 }, { label: "Passed contract", value: 900, note: "plan_type" }, { label: "Loaded", value: 900 }] });
    expect(screen.getByText(/−100 rows \(10%\)/)).toBeInTheDocument();
    expect(screen.getByText(/90.0% of landed reached loaded/)).toBeInTheDocument();
  });

  it("a gantt stacks runs that overlapped, marks the SLA and lets a bar ask about itself", () => {
    const ask = vi.fn();
    draw("show_gantt", { title: "Runs on 11 Oct", lanes: [
      { label: "payer_formulary_load", bars: [{ start: "2026-10-11T14:26:00Z", end: "2026-10-11T15:40:00Z", state: "warning" }, { start: "2026-10-11T14:31:00Z", end: "2026-10-11T15:00:00Z", state: "failed", ask: "Why did run B fail?" }] },
      { label: "corvana", bars: [{ start: "2026-10-11T08:03:00Z", end: "2026-10-11T08:24:00Z", state: "ok" }, { start: "bad date", state: "ok" }] },
    ], markers: [{ at: "2026-10-11T09:30:00Z", label: "Brand SLA 09:30", tone: "bad" }] }, ask);
    expect(screen.getByText("Brand SLA 09:30")).toBeInTheDocument();
    expect(screen.getByText("Stacked bars ran at the same time")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /corvana: Succeeded, 11 Oct 08:03 to 11 Oct 08:24 \(21m\)/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /payer_formulary_load: Failed.*Ask about it/ }));
    expect(ask).toHaveBeenCalledWith("Why did run B fail?");
  });

  it("a donut chart and metric trends draw from the same tools", () => {
    draw("show_chart", { title: "Failures by cause", type: "donut", labels: ["Schema change", "Timeout"], series: [{ name: "Failures", values: [53, 1] }] });
    expect(screen.getAllByText("Schema change").length).toBeGreaterThan(0);
    draw("show_metrics", { items: [{ label: "Failed runs", value: 61, trend: [1, 0, 2, 22, 32], tone: "bad" }] });
    expect(screen.getByRole("img", { name: "Failed runs trend: 1, 0, 2, 22, 32" })).toBeInTheDocument();
  });

  it("new kinds sit in a composed view like any other block", () => {
    draw("show_view", { title: "Platform health", blocks: [
      { kind: "gauges", width: "half", items: [{ label: "SLA met", value: 99, max: 100, target: 95, unit: "%" }] },
      { kind: "heatmap", width: "half", title: "Null rate", columns: ["Mon"], rows: [{ label: "npi", values: [0.4] }] },
    ] });
    expect(screen.getByRole("heading", { name: "Platform health" })).toBeInTheDocument();
    expect(screen.getByText("On target")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Null rate" })).toBeInTheDocument();
  });
});
