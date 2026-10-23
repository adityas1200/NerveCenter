import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { GRID_PAGE_SIZES, LIST_PAGE_SIZES, usePager } from "./usePager";

// SPEC-platform-11: page and size live in the URL, the default size stays out of it, and a filter change returns to page 1.
const ITEMS = Array.from({ length: 60 }, (_, index) => index + 1);

function Harness({ prefix, sizes }: { prefix?: string; sizes?: readonly number[] }) {
  const [filter, setFilter] = useState("all");
  const pager = usePager(ITEMS.length, { prefix, sizes, resetKey: filter });
  const location = useLocation();
  const shown = pager.slice(ITEMS);
  return (
    <div>
      <p data-testid="state">{`page ${pager.page} size ${pager.size} offset ${pager.offset} first ${shown[0]} count ${shown.length}`}</p>
      <p data-testid="search">{location.search}</p>
      <button type="button" onClick={() => pager.pagerProps.onChange(3)}>Page 3</button>
      <button type="button" onClick={() => pager.pagerProps.onChange(1)}>Page 1</button>
      <button type="button" onClick={() => pager.pagerProps.onSizeChange(25)}>Size 25</button>
      <button type="button" onClick={() => pager.pagerProps.onSizeChange(pager.pagerProps.sizes[0] as number)}>Smallest size</button>
      <button type="button" onClick={() => setFilter("open")}>Filter open</button>
    </div>
  );
}

const show = (path = "/list", props: { prefix?: string; sizes?: readonly number[] } = {}) => render(<MemoryRouter initialEntries={[path]}><Harness {...props} /></MemoryRouter>);
const state = () => screen.getByTestId("state").textContent;
const search = () => screen.getByTestId("search").textContent;

describe("usePager", () => {
  it("starts on page 1 at the smallest size with nothing in the URL", () => {
    show();
    expect(state()).toBe("page 1 size 10 offset 0 first 1 count 10");
    expect(search()).toBe("");
    expect(LIST_PAGE_SIZES).toEqual([10, 25, 50, 100]);
    expect(GRID_PAGE_SIZES).toEqual([12, 24, 48]);
  });

  it("reads the page and size from the URL, so a link lands on the same page", () => {
    show("/list?page=2&size=25");
    expect(state()).toBe("page 2 size 25 offset 25 first 26 count 25");
  });

  it("ignores a size outside the set and clamps a page past the end", () => {
    show("/list?page=99&size=7");
    expect(state()).toBe("page 6 size 10 offset 50 first 51 count 10");
  });

  it("writes the page to the URL and drops it again for page 1", async () => {
    show();
    await userEvent.click(screen.getByRole("button", { name: "Page 3" }));
    expect(search()).toBe("?page=3");
    expect(state()).toBe("page 3 size 10 offset 20 first 21 count 10");
    await userEvent.click(screen.getByRole("button", { name: "Page 1" }));
    expect(search()).toBe("");
  });

  it("keeps the default size out of the URL and returns to page 1 on a new size", async () => {
    show("/list?page=3");
    await userEvent.click(screen.getByRole("button", { name: "Size 25" }));
    expect(search()).toBe("?size=25");
    expect(state()).toBe("page 1 size 25 offset 0 first 1 count 25");
    await userEvent.click(screen.getByRole("button", { name: "Smallest size" }));
    expect(search()).toBe("");
  });

  it("returns to page 1 when the reset key changes, keeping the size", async () => {
    show("/list?page=3&size=25");
    expect(state()).toBe("page 3 size 25 offset 50 first 51 count 10");
    await userEvent.click(screen.getByRole("button", { name: "Filter open" }));
    expect(state()).toBe("page 1 size 25 offset 0 first 1 count 25");
    expect(search()).toBe("?size=25");
  });

  it("uses prefixed params beside another list", async () => {
    show("/list?page=4&draftsPage=2", { prefix: "drafts", sizes: GRID_PAGE_SIZES });
    expect(state()).toBe("page 2 size 12 offset 12 first 13 count 12");
    await userEvent.click(screen.getByRole("button", { name: "Page 3" }));
    const params = new URLSearchParams(search() ?? "");
    expect(params.get("draftsPage")).toBe("3");
    expect(params.get("page")).toBe("4");
    expect(state()).toBe("page 3 size 12 offset 24 first 25 count 12");
  });
});
