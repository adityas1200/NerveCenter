import { fireEvent, render, screen, within } from "@testing-library/react";
import { LineChart } from "./LineChart";

const labels = ["22 Sep", "23 Sep", "24 Sep", "25 Sep"];
const series = [
  { key: "raised", name: "Raised", color: "#94A3B8", values: [4, 6, 3, 5] },
  { key: "resolved", name: "Resolved", color: "#059669", values: [2, 5, 4, 6] },
];

describe("LineChart", () => {
  it("draws one line per series with an end dot and a hidden table of every value", () => {
    const { container } = render(<LineChart labels={labels} series={series} ariaLabel="Tickets: Raised, Resolved by Period" />);
    expect(screen.getByRole("img", { name: "Tickets: Raised, Resolved by Period" })).toBeInTheDocument();
    const lines = container.querySelectorAll("path[data-line]");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toHaveClass("chart-line");
    expect(lines[1]).toHaveAttribute("stroke", "#059669");
    expect(container.querySelectorAll("circle.chart-dot")).toHaveLength(2);
    expect(container.querySelectorAll("path.chart-area")).toHaveLength(0);

    const table = screen.getByTestId("chart-data");
    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(5);
    expect(rows[0]).toHaveTextContent("Raised");
    expect(rows[4]).toHaveTextContent("25 Sep");
    expect(within(rows[4]).getAllByRole("cell").map((cell) => cell.textContent)).toEqual(["5", "6"]);
  });

  it("fills under the line as an area and shows a crosshair with every value on hover", () => {
    const { container } = render(<LineChart labels={labels} series={series} variant="area" ariaLabel="Trend" titles={["Mon 22 Sep", "Tue 23 Sep", "Wed 24 Sep", "Thu 25 Sep"]} />);
    const areas = container.querySelectorAll("path.chart-area");
    expect(areas).toHaveLength(2);
    expect(areas[0]).toHaveAttribute("fill-opacity", "0.12");

    const hits = container.querySelectorAll("rect[fill='transparent']");
    expect(hits).toHaveLength(4);
    fireEvent.mouseEnter(hits[1]);
    const tooltip = screen.getByRole("tooltip");
    expect(tooltip).toHaveTextContent("Tue 23 Sep");
    expect(tooltip).toHaveTextContent("Raised6");
    expect(tooltip).toHaveTextContent("Resolved5");
    fireEvent.mouseLeave(hits[1]);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("thins axis labels so they never overlap and labels points when asked", () => {
    const long = Array.from({ length: 30 }, (_, index) => `2026-09-${String(index + 1).padStart(2, "0")}`);
    const { container } = render(<LineChart labels={long} series={[{ key: "n", name: "Finished", color: "#6366F1", values: long.map((_, index) => index) }]} ariaLabel="Finished" showValues />);
    // 600px host, 30 labels of ~61px each: roughly one in four survives, plus the last.
    const axis = Array.from(container.querySelectorAll("text")).filter((node) => node.textContent?.startsWith("2026-"));
    expect(axis.length).toBeGreaterThan(4);
    expect(axis.length).toBeLessThan(12);
    expect(axis[axis.length - 1]).toHaveTextContent("2026-09-30");
    expect(container.querySelectorAll("text.chart-label").length).toBe(axis.length);
  });

  it("says when there is nothing to draw", () => {
    render(<LineChart labels={["a", "b"]} series={[{ key: "n", name: "Count", color: "#000", values: [0, 0] }]} ariaLabel="Empty" />);
    expect(within(screen.getByRole("img")).getByText("No activity in this period")).toBeInTheDocument();
  });
});
