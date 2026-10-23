import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PAGE_SIZE, Pager, pageOf } from "./Pager";

describe("Pager", () => {
  it("slices ten items per page", () => {
    const items = Array.from({ length: 23 }, (_, index) => index + 1);
    expect(PAGE_SIZE).toBe(10);
    expect(pageOf(items, 1)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(pageOf(items, 3)).toEqual([21, 22, 23]);
  });

  it("renders nothing when everything fits on one page", () => {
    const { container } = render(<Pager page={1} total={8} onChange={() => undefined} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the visible range, numbered pages and previous/next controls", async () => {
    const onChange = vi.fn();
    render(<Pager page={2} total={23} onChange={onChange} noun="items" />);
    expect(screen.getByText("11–20 of 23 items")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "2" })).toHaveAttribute("aria-current", "page");
    await userEvent.click(screen.getByRole("button", { name: "3" }));
    expect(onChange).toHaveBeenCalledWith(3);
    await userEvent.click(screen.getByRole("button", { name: "Previous page" }));
    expect(onChange).toHaveBeenCalledWith(1);
  });

  it("collapses long ranges around the current page", () => {
    render(<Pager page={6} total={120} onChange={() => undefined} />);
    expect(screen.getAllByRole("button").map((button) => button.textContent).filter((text) => /^\d+$/.test(text || ""))).toEqual(["1", "5", "6", "7", "12"]);
    expect(screen.getAllByText("…")).toHaveLength(2);
  });
});
