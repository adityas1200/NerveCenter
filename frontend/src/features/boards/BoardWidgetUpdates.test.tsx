import { render, screen } from "@testing-library/react";
import type { BoardWidget, WidgetResult } from "@/api/boards";
import { WidgetCard } from "./BoardWidgets";

const metric: BoardWidget = { id: "m1", type: "metric", title: "Failed runs", size: "sm", note: null, source: { kind: "nervecenter", query: "x" } };
const result = (value: number): WidgetResult => ({ columns: ["Failed"], rows: [[value]], at: "2026-09-25T09:00:00Z" });

describe("WidgetCard updates", () => {
  it("lights up when its figures change under the same filters", () => {
    const view = render(<WidgetCard widget={metric} result={result(2)} dataKey="7d" />);
    expect(screen.queryByTestId("widget-updated")).not.toBeInTheDocument();
    view.rerender(<WidgetCard widget={metric} result={result(2)} dataKey="7d" />);
    expect(screen.queryByTestId("widget-updated")).not.toBeInTheDocument();
    view.rerender(<WidgetCard widget={metric} result={result(3)} dataKey="7d" />);
    expect(screen.getByTestId("widget-updated")).toHaveClass("widget-updated");
    expect(screen.getByLabelText("Failed: 3")).toBeInTheDocument();
  });

  it("stays quiet when the reader changed the filters", () => {
    const view = render(<WidgetCard widget={metric} result={result(2)} dataKey="7d" />);
    view.rerender(<WidgetCard widget={metric} result={result(9)} dataKey="30d" />);
    expect(screen.queryByTestId("widget-updated")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Failed: 9")).toBeInTheDocument();
  });
});
