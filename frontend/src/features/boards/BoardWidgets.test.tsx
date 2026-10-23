import { render, screen, within } from "@testing-library/react";
import type { BoardWidget, WidgetResult, WidgetViz } from "@/api/boards";
import { WidgetCard, seriesColor, sliceColor } from "./BoardWidgets";

const AT = "2026-09-25T09:00:00Z";

const chart = (viz: WidgetViz, title = "Chart"): BoardWidget => ({ id: "w1", type: "chart", title, size: "md", note: null, source: { kind: "nervecenter", query: "x" }, viz });
const share: WidgetResult = { columns: ["Priority", "Count"], rows: [["Critical", 2], ["High", 5], ["Medium", 3], ["Low", 1]], at: AT };
const trend: WidgetResult = { columns: ["Period", "Raised", "Resolved"], rows: [["2026-09-23T00:00:00Z", 4, 2], ["2026-09-24T00:00:00Z", 6, 5], ["2026-09-25T00:00:00Z", 3, 4]], at: AT };

describe("BoardWidgets ChartBody", () => {
  it("draws a column chart by default", () => {
    const { container } = render(<WidgetCard widget={chart({ xColumn: "Period", seriesColumns: ["Raised", "Resolved"] }, "Tickets")} result={trend} />);
    expect(screen.getByRole("img", { name: "Tickets: Raised, Resolved by Period" })).toBeInTheDocument();
    expect(container.querySelectorAll("path.chart-col").length).toBeGreaterThan(0);
    expect(container.querySelectorAll("path[data-line]")).toHaveLength(0);
  });

  it("draws a donut from the first series with one slice per category and values when asked", () => {
    const { container } = render(<WidgetCard widget={chart({ chart: "donut", xColumn: "Priority", seriesColumns: ["Count"], showValues: true }, "Open tickets by priority")} result={share} />);
    expect(screen.getByRole("img", { name: "Open tickets by priority: Count by Priority" })).toBeInTheDocument();
    const slices = container.querySelectorAll("circle[data-slice]");
    expect(slices).toHaveLength(4);
    expect(slices[0]).toHaveAttribute("stroke", "#E11D48");
    expect(slices[1]).toHaveAttribute("stroke", "#F59E0B");
    expect(within(screen.getByRole("img")).getByText("11")).toBeInTheDocument();
    expect(Array.from(container.querySelectorAll("text.chart-label")).map((node) => node.textContent)).toEqual(["2", "5", "3", "1"]);
    // Donuts carry their own legend; the shared legend is not drawn as well.
    expect(screen.getByRole("list", { name: "Legend" })).toBeInTheDocument();
  });

  it("draws a pie without a centre total", () => {
    const { container } = render(<WidgetCard widget={chart({ chart: "pie", xColumn: "Priority", seriesColumns: ["Count"] })} result={share} />);
    expect(container.querySelectorAll("circle[data-slice]")).toHaveLength(4);
    expect(within(screen.getByRole("img")).queryByText("11")).not.toBeInTheDocument();
  });

  it("draws a line and an area from viz.chart", () => {
    const line = render(<WidgetCard widget={chart({ chart: "line", xColumn: "Period", seriesColumns: ["Raised", "Resolved"] })} result={trend} />);
    expect(line.container.querySelectorAll("path[data-line]")).toHaveLength(2);
    expect(line.container.querySelectorAll("path.chart-area")).toHaveLength(0);
    line.unmount();
    const area = render(<WidgetCard widget={chart({ chart: "area", xColumn: "Period", seriesColumns: ["Raised"] })} result={trend} />);
    expect(area.container.querySelectorAll("path[data-line]")).toHaveLength(1);
    expect(area.container.querySelectorAll("path.chart-area")).toHaveLength(1);
  });

  it("draws horizontal bars from viz.chart = bar", () => {
    const { container } = render(<WidgetCard widget={chart({ chart: "bar", xColumn: "Priority", seriesColumns: ["Count"], showValues: true })} result={share} />);
    expect(container.querySelectorAll("path[data-bar]")).toHaveLength(4);
    expect(Array.from(container.querySelectorAll("text.chart-label")).map((node) => node.textContent)).toEqual(["2", "5", "3", "1"]);
  });

  it("shows a shimmer while the data is on the way", () => {
    render(<WidgetCard widget={chart({ chart: "line" })} result={undefined} />);
    expect(screen.getByTestId("widget-shimmer")).toHaveClass("board-shimmer");
  });
});

describe("BoardWidgets MetricBody", () => {
  it("draws a sparkline under the last value with the delta since the first when asked", () => {
    const widget: BoardWidget = { id: "m", type: "metric", title: "Finished", size: "sm", note: null, source: { kind: "nervecenter", query: "tasks.agent_activity" }, viz: { sparkline: true } };
    const result: WidgetResult = { columns: ["Period", "Finished"], rows: [["2026-09-23T00:00:00Z", 2], ["2026-09-24T00:00:00Z", 4], ["2026-09-25T00:00:00Z", 5]], at: AT };
    render(<WidgetCard widget={widget} result={result} />);
    expect(screen.getByLabelText("Finished: 5, +3 since the start of the period")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Finished over the period" })).toBeInTheDocument();
    expect(screen.getByTestId("metric-delta")).toHaveTextContent("+3");
    expect(screen.getByTestId("metric-delta")).toHaveClass("text-ink-5");
  });

  it("keeps the plain cells when sparkline is off or the shape does not fit", () => {
    const widget: BoardWidget = { id: "m", type: "metric", title: "Finished", size: "sm", note: null, source: { kind: "nervecenter", query: "tasks.agent_activity" }, viz: { sparkline: true } };
    const result: WidgetResult = { columns: ["Period", "Finished", "Changes"], rows: [["2026-09-23T00:00:00Z", 2, 1], ["2026-09-24T00:00:00Z", 4, 2]], at: AT };
    render(<WidgetCard widget={widget} result={result} />);
    expect(screen.queryByTestId("metric-delta")).not.toBeInTheDocument();
  });
});

describe("palette", () => {
  it("colours by what a name means, then steps through the palette in a fixed order", () => {
    expect(seriesColor("Failed", 0)).toBe("#E11D48");
    expect(seriesColor("Resolved", 1)).toBe("#059669");
    expect(seriesColor("Overdue", 2)).toBe("#F59E0B");
    expect(seriesColor("Raised", 1)).toBe("#94A3B8");
    expect(seriesColor("Anything", 0)).toBe("#6366F1");
    expect(seriesColor("Second", 1)).toBe("#64748B");
    expect(seriesColor("Third", 2)).toBe("#7C3AED");
    expect(seriesColor("Slow", 1)).not.toBe("#059669");
    expect(sliceColor("Critical", 0)).toBe("#E11D48");
    expect(sliceColor("Medium", 2)).toBe("#6366F1");
    expect(sliceColor("Other", 5)).toBe("#94A3B8");
  });
});
