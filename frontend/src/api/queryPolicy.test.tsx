import { QueryClient, QueryClientProvider, useQuery, focusManager, onlineManager } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import { manualQueryDefaults } from "./queryPolicy";
import { apiClient } from "./client";
import { jsonResponse, mockFetch } from "@/test/utils";

it("FR-1/3 stays idle through timers, focus and reconnect, and aborts obsolete reads", async () => {
  vi.useFakeTimers();
  const signals: AbortSignal[] = [];
  const fetchMock = mockFetch((_url, init) => {
    signals.push(init!.signal as AbortSignal);
    return signals.length === 1 ? jsonResponse({ name: "first" }) : new Promise((_resolve, reject) => init!.signal!.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError"))));
  });
  const client = new QueryClient({ defaultOptions: { queries: manualQueryDefaults } });
  function Page({ id }: { id: string }) {
    const query = useQuery({ queryKey: ["test", id], queryFn: ({ signal }) => apiClient.get<{ name: string }>(`/api/test/${id}`, { signal }) });
    return <span>{query.data?.name}</span>;
  }
  const view = render(<QueryClientProvider client={client}><Page id="one" /></QueryClientProvider>);
  try {
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(screen.getByText("first")).toBeInTheDocument();
    await act(async () => { focusManager.setFocused(false); onlineManager.setOnline(false); focusManager.setFocused(true); onlineManager.setOnline(true); await vi.advanceTimersByTimeAsync(120_000); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    view.rerender(<QueryClientProvider client={client}><Page id="two" /></QueryClientProvider>);
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("first")).not.toBeInTheDocument();
    view.unmount();
    expect(signals[1].aborted).toBe(true);
  } finally { client.clear(); focusManager.setFocused(undefined); onlineManager.setOnline(true); vi.useRealTimers(); }
});
