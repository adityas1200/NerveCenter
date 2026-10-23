import { act, fireEvent, render, screen } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement, ReactNode } from "react";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestQueryClient } from "@/test/utils";
import { RefreshButton } from "./RefreshButton";

vi.mock("@/lib/autoRefresh", () => ({ AUTO_REFRESH_SECONDS: 10 }));
const tick = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };
const router = (child: ReactNode) => <MemoryRouter>{child}</MemoryRouter>;
function renderWithClient(ui: ReactElement) {
  const client = createTestQueryClient();
  return { ...render(ui, { wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> }), client };
}

describe("SPEC-platform-page-auto-refresh FR-2/3/4", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it("counts down, uses the latest handler, and resets after manual refresh", async () => {
    const old = vi.fn(); const latest = vi.fn();
    const view = renderWithClient(router(<RefreshButton autoRefresh onClick={old} />));
    expect(screen.getByText("0:10")).toBeVisible();
    await tick(9000);
    expect(old).not.toHaveBeenCalled();
    view.rerender(router(<RefreshButton autoRefresh onClick={latest} />));
    await tick(1000);
    expect(latest).toHaveBeenCalledTimes(1);
    expect(old).not.toHaveBeenCalled();
    await tick(4000);
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(latest).toHaveBeenCalledTimes(2);
    expect(screen.getByText("0:10")).toBeVisible();
    await tick(9000);
    expect(latest).toHaveBeenCalledTimes(2);
    await tick(1000);
    expect(latest).toHaveBeenCalledTimes(3);
  });

  it("waits for busy reads and starts a full interval after completion", async () => {
    const refresh = vi.fn();
    const view = renderWithClient(router(<RefreshButton autoRefresh busy onClick={refresh} />));
    await tick(30000);
    expect(refresh).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Refresh" })).toBeDisabled();
    view.rerender(router(<RefreshButton autoRefresh onClick={refresh} />));
    await tick(9000);
    expect(refresh).not.toHaveBeenCalled();
    await tick(1000);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("defers through hidden tabs, mutations and dialogs without catch-up bursts", async () => {
    const refresh = vi.fn();
    const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    const view = renderWithClient(router(<RefreshButton autoRefresh onClick={refresh} />));
    await tick(60000);
    expect(refresh).not.toHaveBeenCalled();
    expect(screen.getByText("Paused")).toBeVisible();
    let finish!: () => void;
    const mutation = view.client.getMutationCache().build(view.client, { mutationFn: () => new Promise<void>(resolve => { finish = resolve; }) });
    let promise!: Promise<unknown>;
    await act(async () => { promise = mutation.execute(undefined); });
    hidden.mockReturnValue(false);
    await tick(1000);
    expect(refresh).not.toHaveBeenCalled();
    view.rerender(router(<><RefreshButton autoRefresh onClick={refresh} /><div role="dialog" aria-label="Edit" /></>));
    await act(async () => { finish(); await promise; });
    await tick(1000);
    expect(refresh).not.toHaveBeenCalled();
    view.rerender(router(<RefreshButton autoRefresh onClick={refresh} />));
    await tick(1000);
    expect(refresh).toHaveBeenCalledTimes(1);
    await tick(9000);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("protects focused fields and unsaved edits after blur, then waits for quiet", async () => {
    const refresh = vi.fn();
    const ui = (dirty: boolean) => router(<><RefreshButton autoRefresh onClick={refresh} /><input aria-label="Draft" /><div data-auto-refresh-block={dirty} /></>);
    const view = renderWithClient(ui(true));
    screen.getByLabelText("Draft").focus();
    await tick(10000);
    expect(refresh).not.toHaveBeenCalled();
    screen.getByLabelText("Draft").blur();
    await tick(10000);
    expect(refresh).not.toHaveBeenCalled();
    view.rerender(ui(false));
    fireEvent.keyDown(document.body, { key: "Escape" });
    await tick(4000);
    expect(refresh).not.toHaveBeenCalled();
    await tick(1000);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("resets on selection changes, stops on unmount, and leaves secondary controls manual", async () => {
    const refresh = vi.fn(); const secondary = vi.fn();
    function Page() {
      const navigate = useNavigate();
      return <><RefreshButton autoRefresh onClick={refresh} /><RefreshButton onClick={secondary} /><button onClick={() => navigate("/tickets?status=open")}>Filter</button></>;
    }
    const view = renderWithClient(router(<Page />));
    await tick(9000);
    fireEvent.click(screen.getByText("Filter"));
    await tick(9000);
    expect(refresh).not.toHaveBeenCalled();
    await tick(1000);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(secondary).not.toHaveBeenCalled();
    view.unmount();
    await tick(30000);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
