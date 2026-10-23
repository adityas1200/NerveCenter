import { fireEvent, render, screen, within } from "@testing-library/react";
import { DonutChart } from "./DonutChart";

const series = [{ key: "count", name: "Count", color: "#6366F1", values: [3, 2, 1] }];
const labels = ["Critical", "High", "Low"];

describe("DonutChart", () => {
  it("draws one slice per label, the total in the centre and a hidden table with shares", () => {
    const { container } = render(<DonutChart labels={labels} series={series} colors={["#E11D48", "#F59E0B", "#059669"]} ariaLabel="Open tickets: Count by Priority" />);
    expect(screen.getByRole("img", { name: "Open tickets: Count by Priority" })).toBeInTheDocument();
    const slices = container.querySelectorAll("circle[data-slice]");
    expect(slices).toHaveLength(3);
    expect(slices[0]).toHaveAttribute("stroke", "#E11D48");
    expect(slices[0]).toHaveClass("chart-slice");
    expect(within(screen.getByRole("img")).getByText("6")).toBeInTheDocument();

    const table = screen.getByTestId("chart-data");
    expect(table).toHaveClass("sr-only");
    expect(within(table).getByRole("caption")).toHaveTextContent("Open tickets: Count by Priority");
    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(4);
    expect(rows[1]).toHaveTextContent("Critical");
    expect(rows[1]).toHaveTextContent("50%");

    // The legend names every slice with its value; hovering a slice shows label · value · percent.
    expect(screen.getByRole("button", { name: "High: 2, 33%" })).toBeInTheDocument();
    fireEvent.mouseEnter(slices[1]);
    expect(screen.getByRole("tooltip")).toHaveTextContent("High · 2 · 33%");
  });

  it("puts values on slices from 8% up when asked and folds extra slices into Other", () => {
    const many = Array.from({ length: 10 }, (_, index) => `Team ${index + 1}`);
    const { container } = render(<DonutChart labels={many} series={[{ key: "n", name: "Tickets", color: "#6366F1", values: [40, 30, 10, 5, 4, 3, 3, 2, 2, 1] }]} ariaLabel="Tickets by team" showValues variant="pie" />);
    const slices = container.querySelectorAll("circle[data-slice]");
    expect(slices).toHaveLength(8);
    expect(slices[7]).toHaveAttribute("data-slice", "Other");
    // 40, 30, 10 of 100 clear 8%; the 5% slice does not.
    const labelsOnSlices = Array.from(container.querySelectorAll("text.chart-label")).map((node) => node.textContent);
    expect(labelsOnSlices).toEqual(["40", "30", "10"]);
    // A pie has no centre total.
    expect(within(screen.getByRole("img")).queryByText("100")).not.toBeInTheDocument();
  });

  it("says when there is nothing to draw", () => {
    render(<DonutChart labels={["A", "B"]} series={[{ key: "n", name: "Count", color: "#000", values: [0, 0] }]} ariaLabel="Empty" emptyText="No tickets" />);
    expect(within(screen.getByRole("img")).getByText("No tickets")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
