import { fireEvent, render, screen, within } from "@testing-library/react";
import { BarChart } from "./BarChart";

const labels = ["veltrix_daily", "corvana_load", "hcp_master"];

describe("BarChart", () => {
  it("draws one bar per label, the labels on the left and a hidden table", () => {
    const { container } = render(<BarChart labels={labels} series={[{ key: "runs", name: "Runs", color: "#6366F1", values: [12, 7, 3] }]} ariaLabel="Runs by pipeline" />);
    expect(screen.getByRole("img", { name: "Runs by pipeline" })).toBeInTheDocument();
    const bars = container.querySelectorAll("path[data-bar]");
    expect(bars).toHaveLength(3);
    expect(bars[0]).toHaveClass("chart-bar");
    expect(bars[0]).toHaveAttribute("fill", "#6366F1");
    // Labels sit left of the bars, anchored to their right edge; no values until asked.
    const label = Array.from(container.querySelectorAll("text")).find((node) => node.textContent === "corvana_load");
    expect(label).toHaveAttribute("text-anchor", "end");
    expect(container.querySelectorAll("text.chart-label")).toHaveLength(0);

    const rows = within(screen.getByTestId("chart-data")).getAllByRole("row");
    expect(rows).toHaveLength(4);
    expect(rows[1]).toHaveTextContent("veltrix_daily");
    expect(rows[1]).toHaveTextContent("12");
  });

  it("groups several series per label, shows values when asked and lists them on hover", () => {
    const series = [
      { key: "ok", name: "Succeeded", color: "#059669", values: [10, 6, 2] },
      { key: "bad", name: "Failed", color: "#E11D48", values: [1, 2, 0] },
    ];
    const { container } = render(<BarChart labels={labels} series={series} ariaLabel="Runs" showValues />);
    // 3 labels × 2 series; a zero-length bar keeps its place so counts stay honest.
    expect(container.querySelectorAll("path[data-bar]")).toHaveLength(6);
    expect(container.querySelectorAll("path.chart-bar")).toHaveLength(5);
    expect(Array.from(container.querySelectorAll("text.chart-label")).map((node) => node.textContent)).toEqual(["10", "1", "6", "2", "2", "0"]);

    const hits = container.querySelectorAll("rect[fill='transparent']");
    fireEvent.mouseEnter(hits[1]);
    const tooltip = screen.getByRole("tooltip");
    expect(tooltip).toHaveTextContent("corvana_load");
    expect(tooltip).toHaveTextContent("Succeeded6");
    expect(tooltip).toHaveTextContent("Failed2");
  });

  it("says when there is nothing to draw", () => {
    render(<BarChart labels={labels} series={[{ key: "n", name: "Count", color: "#000", values: [0, 0, 0] }]} ariaLabel="Empty" emptyText="No runs" />);
    expect(within(screen.getByRole("img")).getByText("No runs")).toBeInTheDocument();
  });
});
