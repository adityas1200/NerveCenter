import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { act, render } from "@testing-library/react";
import { changesApi } from "@/api/changes";
import { ProjectChangeFeed } from "./ProjectChangeFeed";
import { PresenceHeartbeat } from "@/PresenceHeartbeat";
import { createTestQueryClient } from "@/test/utils";

// Human-approved replacement of the previous automatic-invalidation contract.
it("does not open a project stream, heartbeat, or fallback poll", async () => {
  vi.useFakeTimers();
  const stream = vi.spyOn(changesApi, "stream");
  const read = vi.fn(async () => "ready");
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  const client = createTestQueryClient();
  function Page() { useQuery({ queryKey: ["overview"], queryFn: read }); return null; }
  const view = render(<QueryClientProvider client={client}><ProjectChangeFeed><PresenceHeartbeat /><Page /></ProjectChangeFeed></QueryClientProvider>);
  try {
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
    expect(read).toHaveBeenCalledTimes(1);
    expect(stream).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  } finally { view.unmount(); client.clear(); vi.useRealTimers(); vi.restoreAllMocks(); }
});
