import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { jsonResponse, mockFetch, renderWithClient } from "@/test/utils";
import { PersonPicker } from "./PersonPicker";

// The list floats over its container: a Settings card clips with overflow-hidden, so the list must not live inside it.
describe("PersonPicker", () => {
  it("renders the matches outside a clipping container and adds the one picked", async () => {
    mockFetch((url) => (url.includes("/api/people?q=ol") ? jsonResponse({ items: [{ id: "olga", name: "Olga Ivanova", email: "olga@example.com" }] }) : jsonResponse({ items: [] })));
    const onPick = vi.fn();
    renderWithClient(<section aria-label="People" className="overflow-hidden"><PersonPicker placeholder="Add a person" onPick={onPick} /></section>);
    await userEvent.type(screen.getByRole("combobox", { name: "Add a person" }), "ol");
    const list = await screen.findByRole("listbox");
    expect(screen.getByRole("region", { name: "People" }).contains(list)).toBe(false);
    // Typing goes on in the input while the list is open.
    expect(screen.getByRole("combobox", { name: "Add a person" })).toHaveFocus();
    await userEvent.click(screen.getByRole("option", { name: /Olga Ivanova/ }));
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: "olga" }));
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });
});
