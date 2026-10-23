import { act, fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { CommandPalette } from "./CommandPalette";
import { jsonResponse, meResponse, mockFetch, renderWithClient, testUsers } from "@/test/utils";

const ticket = { ticketId: "OPS-1", title: "Veltrix daily sales load failed", priority: "high", status: "open", externalReference: { number: "INC0031201" }, createdAt: "2026-09-25T08:00:00Z", updatedAt: "2026-09-25T08:00:00Z" };
const task = { id: "T-9", type: "adhoc", title: "Weekly report for brand leads", summary: "", status: "done", permission: "ask", context: {}, createdAt: "2026-09-25T08:00:00Z", updatedAt: "2026-09-25T09:00:00Z" };

function stub() {
  mockFetch((url) => {
    if (url.includes("/api/me")) return meResponse(testUsers.dev, "admin");
    if (url.includes("/api/settings")) return jsonResponse({});
    if (url.includes("/api/tickets")) return jsonResponse({ items: [ticket] });
    if (url.includes("/api/tasks")) return jsonResponse({ items: [task] });
    if (url.includes("/api/knowledge")) return jsonResponse({ items: [], mcp: {} });
    if (/\/api\/(boards|skills|routines)/.test(url)) return jsonResponse({ items: [] });
    throw new Error(`Unexpected request: ${url}`);
  });
}

function Where() {
  const location = useLocation();
  return <output data-testid="where" data-state={JSON.stringify(location.state ?? null)}>{location.pathname}</output>;
}

function Harness() {
  const [open, setOpen] = useState(false);
  return <CommandPalette open={open} onOpenChange={setOpen} theme="light" onThemeChange={() => undefined} />;
}

function renderPalette(path = "/tickets") {
  return renderWithClient(<MemoryRouter initialEntries={[path]}><Harness /><Where /></MemoryRouter>);
}

describe("CommandPalette", () => {
  beforeEach(stub);
  it("opens on Ctrl K with the next likely moves and every page", async () => {
    renderPalette();
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const box = await screen.findByRole("combobox", { name: "Search or run a command" });
    expect(box).toHaveFocus();
    expect(screen.getByRole("option", { name: /New task/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /^Boards/ })).toBeInTheDocument();
    expect(await screen.findByRole("option", { name: /Weekly report for brand leads/ })).toBeInTheDocument();
  });

  it("finds a ticket by its words and opens it with Enter", async () => {
    renderPalette();
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const box = await screen.findByRole("combobox");
    await userEvent.type(box, "veltrix");
    expect(await screen.findByRole("option", { name: /Veltrix daily sales load failed/ })).toHaveAttribute("aria-selected", "true");
    await userEvent.keyboard("{Enter}");
    expect(screen.getByTestId("where")).toHaveTextContent("/tickets/OPS-1");
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("finds a ticket by its source number and hands any words to a new task", async () => {
    renderPalette();
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const box = await screen.findByRole("combobox");
    await userEvent.type(box, "INC0031201");
    expect(await screen.findByRole("option", { name: /Veltrix daily sales load failed/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("option", { name: /Start a task/ }));
    expect(screen.getByTestId("where")).toHaveTextContent("/tasks/new");
    expect(screen.getByTestId("where")).toHaveAttribute("data-state", JSON.stringify({ prompt: "INC0031201" }));
  });

  it("starts a task on C and goes to a page on G then its letter, but not while typing", async () => {
    renderPalette("/");
    await act(async () => { fireEvent.keyDown(window, { key: "g" }); fireEvent.keyDown(window, { key: "b" }); });
    expect(screen.getByTestId("where")).toHaveTextContent("/boards");
    await act(async () => { fireEvent.keyDown(window, { key: "c" }); });
    expect(screen.getByTestId("where")).toHaveTextContent("/tasks/new");

    const field = document.createElement("input");
    document.body.appendChild(field);
    await act(async () => { fireEvent.keyDown(field, { key: "g" }); fireEvent.keyDown(field, { key: "t" }); });
    expect(screen.getByTestId("where")).toHaveTextContent("/tasks/new");
    field.remove();
  });
});
