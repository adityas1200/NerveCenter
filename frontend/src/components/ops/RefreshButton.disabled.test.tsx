import { act, fireEvent, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { renderWithClient } from "@/test/utils";
import { RefreshButton } from "./RefreshButton";

vi.mock("@/lib/autoRefresh", () => ({ AUTO_REFRESH_SECONDS: 0 }));

it("FR-1: zero disables the countdown and scheduled work, preserving manual refresh", async () => {
  vi.useFakeTimers();
  try {
    const refresh = vi.fn();
    renderWithClient(<MemoryRouter><RefreshButton autoRefresh onClick={refresh} /></MemoryRouter>);
    await act(async () => { await vi.advanceTimersByTimeAsync(600_000); });
    expect(refresh).not.toHaveBeenCalled();
    expect(screen.queryByText(/\d:\d\d/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(refresh).toHaveBeenCalledTimes(1);
  } finally { vi.useRealTimers(); }
});
