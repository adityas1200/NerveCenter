import { render, screen } from "@testing-library/react";
import type { BoardWidget, WidgetResult, WidgetViz } from "@/api/boards";
import { barState, ganttFrom, heatmapFrom } from "./BoardViz";
import { WidgetCard } from "./BoardWidgets";

// SPEC-boards-03 FR-11 (drawing) over SPEC-boards-02 FR-12 and FR-13 (the viz fields).
const AT = "2026-10-11T09:00:00Z";
const widget = (type: BoardWidget["type"], viz: WidgetViz, title = "Widget", size: BoardWidget["size"] = "lg"): BoardWidget => ({ id: "w1", type, title, size, note: null, source: { kind: "nervecenter", query: "x" }, viz });

const fails: WidgetResult = { columns: ["Pipeline", "10/10", "10/11"], rows: [["veltrix_sales_daily_load", 22, 31], ["corvana_sales_daily", 0, null]], at: AT };
const runs: WidgetResult = { columns: ["Pipeline", "Run", "Status", "Started", "Ended"], rows: [
  ["payer_formulary_load", "A", "Succeeded", "2026-10-11T14:26:00Z", "2026-10-11T15:40:00Z"],
  ["payer_formulary_load", "B", "Failed", "2026-10-11T14:31:00Z", "2026-10-11T15:00:00Z"],
  ["corvana_sales_daily", "C", "Running", "2026-10-11T08:03:00Z", null],
], at: AT };

describe("FR-11 board visualisations", () => {
  it("a heatmap widget shades failed runs by pipeline and day, reads day buckets as dates and names every cell", () => {
    render(<WidgetCard widget={widget("chart", { chart: "heatmap", xColumn: "Pipeline", scale: "high_is_bad", unit: "runs" }, "Failed runs")} result={fails} />);
    expect(screen.getByLabelText("veltrix_sales_daily_load · 11 Oct: 31 runs")).toHaveStyle({ color: "rgb(255, 255, 255)" });
    expect(screen.getByLabelText("corvana_sales_daily · 10 Oct: 0 runs")).toHaveClass("bg-surface-subtle");
    expect(screen.getByLabelText("corvana_sales_daily · 11 Oct: no data")).toHaveClass("border-dashed");
    expect(screen.getByText("darker is worse")).toBeInTheDocument();
    // The widget card carries the title; the visual does not draw a second frame.
    expect(screen.getAllByRole("heading", { name: "Failed runs" })).toHaveLength(1);
  });

  it("a heatmap pivots long rows when pivotColumn is set", () => {
    const block = heatmapFrom({ columns: ["Job", "Day", "Fails"], rows: [["a", "Mon", 1], ["a", "Tue", 2], ["b", "Tue", 5]] }, { pivotColumn: "Day", xColumn: "Job" }, "t");
    expect(block?.columns).toEqual(["Mon", "Tue"]);
    expect(block?.rows).toEqual([{ label: "a", values: [1, 2] }, { label: "b", values: [null, 5] }]);
  });

  it("a funnel widget shows what each stage lost and what reached the end", () => {
    const rows: WidgetResult = { columns: ["Stage", "Rows"], rows: [["Landed", 1000], ["Passed contract", 900], ["Loaded", 900]], at: AT };
    render(<WidgetCard widget={widget("chart", { chart: "funnel", unit: "rows" }, "Veltrix rows")} result={rows} />);
    expect(screen.getByText(/−100 rows \(10%\)/)).toBeInTheDocument();
    expect(screen.getByText(/90.0% of landed reached loaded/)).toBeInTheDocument();
  });

  it("a gantt widget lays runs from pipelines.runs on a UTC axis, stacks overlaps and says each state in words", () => {
    render(<WidgetCard widget={widget("chart", { chart: "gantt", labelColumn: "Run" }, "Runs today")} result={runs} />);
    expect(screen.getByRole("img", { name: /payer_formulary_load · B: Failed, 11 Oct 14:31 to 11 Oct 15:00 \(29m\)/ })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /corvana_sales_daily · C: Running, .*still going/ })).toBeInTheDocument();
    expect(screen.getByText("Stacked bars ran at the same time")).toBeInTheDocument();
    expect(screen.getByText("Times in UTC")).toBeInTheDocument();
    expect(ganttFrom({ columns: ["Pipeline"], rows: [["a"]] })).toBeNull();
    expect(["Timed out", "Succeeded", "Missed", "Queued", "Skipped"].map(barState)).toEqual(["failed", "ok", "warning", "running", "skipped"]);
  });

  it("a metric with a gauge draws a ring against its target with the state in words", () => {
    const sla: WidgetResult = { columns: ["SLA met"], rows: [[88]], at: AT };
    render(<WidgetCard widget={widget("metric", { gauge: { max: 100, target: 95, higherIsBetter: true }, suffix: "%" }, "SLA", "sm")} result={sla} />);
    expect(screen.getByRole("img", { name: "SLA met: 88% of 100%, target 95%" })).toBeInTheDocument();
    expect(screen.getByText("Near target")).toBeInTheDocument();
  });

  it("rows that do not fit the kind give a plain sentence, not a broken chart", () => {
    const text: WidgetResult = { columns: ["Stage"], rows: [["Landed"]], at: AT };
    const { rerender } = render(<WidgetCard widget={widget("chart", { chart: "heatmap" }, "H")} result={text} />);
    expect(screen.getByText("No numeric columns to shade")).toBeInTheDocument();
    rerender(<WidgetCard widget={widget("chart", { chart: "funnel" }, "F")} result={text} />);
    expect(screen.getByText("A funnel needs at least two stages with a count")).toBeInTheDocument();
    rerender(<WidgetCard widget={widget("chart", { chart: "gantt" }, "G")} result={text} />);
    expect(screen.getByText("No runs with a start time in this period")).toBeInTheDocument();
  });
});

describe("FR-11 crowded timelines", () => {
  it("a pile-up of concurrent runs stays six rows tall and says the rest overlap", () => {
    const rows = Array.from({ length: 40 }, (_, index) => ["payer_formulary_load", `r${index}`, "Running", `2026-10-11T08:${String(index).padStart(2, "0")}:00Z`, "2026-10-11T15:00:00Z"]);
    render(<WidgetCard widget={widget("chart", { chart: "gantt" }, "Runs")} result={{ columns: ["Pipeline", "Run", "Status", "Started", "Ended"], rows, at: AT }} />);
    expect(screen.getByText("Over 6 at once overlap in place")).toBeInTheDocument();
    const tops = new Set(screen.getAllByRole("img").filter((node) => node.getAttribute("aria-label")?.startsWith("payer")).map((node) => (node as HTMLElement).style.top));
    expect(tops.size).toBe(6);
  });

  it("a gauge is named by its row, not its column", () => {
    render(<WidgetCard widget={widget("metric", { valueColumn: "Count", gauge: { max: 10, target: 9, higherIsBetter: true } }, "Pipelines", "sm")} result={{ columns: ["Health", "Count"], rows: [["Succeeded", 6], ["Failed", 2]], at: AT }} />);
    expect(screen.getByRole("img", { name: "Succeeded: 6 of 10, target 9" })).toBeInTheDocument();
  });
});
