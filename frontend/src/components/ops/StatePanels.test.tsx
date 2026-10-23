import { fireEvent, render, screen } from "@testing-library/react";
import { QueryState } from "./StatePanels";
import { RefreshButton } from "./RefreshButton";

describe("QueryState", () => {
  it("shows no stat tiles when a page asks for none, and six by default", () => {
    const { container, rerender } = render(<QueryState query={{ isPending: true, error: null }} tiles={0}>x</QueryState>);
    expect(container.querySelectorAll(".min-h-\\[124px\\]")).toHaveLength(0);
    rerender(<QueryState query={{ isPending: true, error: null }}>x</QueryState>);
    expect(container.querySelectorAll(".min-h-\\[124px\\]")).toHaveLength(6);
    rerender(<QueryState query={{ isPending: true, error: null }} tiles={3}>x</QueryState>);
    expect(container.querySelectorAll(".min-h-\\[124px\\]")).toHaveLength(3);
  });

  it("hides technical backend messages behind a Details disclosure", () => {
    render(<QueryState query={{ isPending: false, error: new Error("Databricks GET /api/2.2/jobs/runs/list failed (403): Invalid access token") }}>x</QueryState>);
    expect(screen.getByRole("alert")).toHaveTextContent("NerveCenter could not load this page.");
    expect(screen.getByText("Details")).toBeInTheDocument();
    expect(screen.getByText(/Invalid access token/)).toBeInTheDocument();
    expect(screen.getByText(/Invalid access token/).closest("details")).not.toHaveAttribute("open");
  });

  it("shows a plain message as it is", () => {
    render(<QueryState query={{ isPending: false, error: new Error("Routine not found") }}>x</QueryState>);
    expect(screen.getByRole("alert")).toHaveTextContent("Routine not found");
    expect(screen.queryByText("Details")).not.toBeInTheDocument();
  });

  it("treats socket errors and URLs as technical", () => {
    const { rerender } = render(<QueryState query={{ isPending: false, error: new Error("connect ECONNREFUSED 127.0.0.1:8787") }}>x</QueryState>);
    expect(screen.getByText("Details")).toBeInTheDocument();
    rerender(<QueryState query={{ isPending: false, error: new Error("See https://example.com/status") }}>x</QueryState>);
    expect(screen.getByText("Details")).toBeInTheDocument();
  });
});

describe("RefreshButton", () => {
  it("says when the data was last updated", async () => {
    render(<RefreshButton onClick={() => {}} updatedAt={Date.now() - 2 * 60_000} />);
    fireEvent.focus(screen.getByRole("button", { name: "Refresh" }));
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Updated 2m ago");
  });
  it("falls back to Refresh when the page has no data yet", async () => {
    render(<RefreshButton onClick={() => {}} updatedAt={0} />);
    fireEvent.focus(screen.getByRole("button", { name: "Refresh" }));
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Refresh");
  });
});
