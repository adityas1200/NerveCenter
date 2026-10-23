import { act, render, screen } from "@testing-library/react";
import { ListToolbar } from "./ListToolbar";

describe("ListToolbar", () => {
  afterEach(() => { vi.restoreAllMocks(); Object.defineProperty(window, "scrollY", { value: 0, configurable: true }); });

  it("pins under the top bar and only draws its hairline once it is actually pinned", () => {
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => { callback(0); return 1; });
    render(<ListToolbar><input aria-label="Search things" /></ListToolbar>);
    const toolbar = screen.getByRole("textbox", { name: "Search things" }).closest("[data-list-toolbar]") as HTMLElement;
    expect(toolbar).toHaveClass("sticky", "top-14");
    expect(toolbar).not.toHaveAttribute("data-stuck");

    // Scrolled far enough that the toolbar sits against the 56px top bar.
    vi.spyOn(toolbar, "getBoundingClientRect").mockReturnValue({ top: 56 } as DOMRect);
    Object.defineProperty(window, "scrollY", { value: 400, configurable: true });
    act(() => { window.dispatchEvent(new Event("scroll")); });
    expect(toolbar).toHaveAttribute("data-stuck");

    // Back at the top of the page: unpinned, no line.
    vi.spyOn(toolbar, "getBoundingClientRect").mockReturnValue({ top: 120 } as DOMRect);
    Object.defineProperty(window, "scrollY", { value: 0, configurable: true });
    act(() => { window.dispatchEvent(new Event("scroll")); });
    expect(toolbar).not.toHaveAttribute("data-stuck");
  });

  it("paints the card surface inside a card and the page canvas on the page", () => {
    const { rerender } = render(<ListToolbar placement="card">x</ListToolbar>);
    expect(screen.getByText("x")).toHaveClass("bg-raised");
    rerender(<ListToolbar>x</ListToolbar>);
    expect(screen.getByText("x")).toHaveClass("bg-[var(--ops-surface)]");
  });
});
