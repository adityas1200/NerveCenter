import { act, fireEvent, render, screen } from "@testing-library/react";
import { AppErrorBoundary } from "./AppErrorBoundary";

function Boom(): never {
  throw new Error("Kaboom");
}

describe("AppErrorBoundary", () => {
  afterEach(() => vi.restoreAllMocks());

  it("shows a clean dialog instead of the page when a child throws while rendering", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(<AppErrorBoundary><Boom /></AppErrorBoundary>);
    expect(screen.getByRole("heading", { name: "Something went wrong" })).toBeInTheDocument();
    fireEvent.click(screen.getByText("Technical details"));
    expect(screen.getByText(/Kaboom/)).toBeInTheDocument();
  });

  it("renders children normally when nothing has failed", () => {
    render(<AppErrorBoundary><p>All good</p></AppErrorBoundary>);
    expect(screen.getByText("All good")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Something went wrong" })).not.toBeInTheDocument();
  });

  it("also catches an error thrown outside React's render cycle (a stray window error event)", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(<AppErrorBoundary><p>All good</p></AppErrorBoundary>);
    expect(screen.getByText("All good")).toBeInTheDocument();
    act(() => { window.dispatchEvent(new ErrorEvent("error", { error: new Error("Outside React"), message: "Outside React" })); });
    expect(screen.getByRole("heading", { name: "Something went wrong" })).toBeInTheDocument();
  });

  it("reloads the page from the Reload button", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const reload = vi.fn();
    const originalLocation = window.location;
    Object.defineProperty(window, "location", { configurable: true, value: { ...originalLocation, reload } });
    render(<AppErrorBoundary><Boom /></AppErrorBoundary>);
    fireEvent.click(screen.getByRole("button", { name: "Reload page" }));
    expect(reload).toHaveBeenCalled();
    Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
  });
});
