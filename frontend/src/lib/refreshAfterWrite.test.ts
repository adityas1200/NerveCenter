import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { refreshAfterWrite } from "./refreshAfterWrite";

it("waits for an old read, then fetches the write result once for the visible view", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let release!: (value: string) => void;
  const read = vi.fn().mockImplementationOnce(() => new Promise<string>(resolve => { release = resolve; })).mockResolvedValue("after write");
  const observer = new QueryObserver(client, { queryKey: ["tickets", "visible"], queryFn: read });
  const unsubscribe = observer.subscribe(() => undefined);
  client.setQueryData(["tickets", "hidden"], "cached");
  const refresh = refreshAfterWrite(client, { queryKey: ["tickets"] });
  expect(read).toHaveBeenCalledTimes(1);
  release("before write");
  await refresh;
  expect(read).toHaveBeenCalledTimes(2);
  expect(observer.getCurrentResult().data).toBe("after write");
  expect(client.getQueryState(["tickets", "hidden"])?.isInvalidated).toBe(true);
  expect(client.getQueryData(["tickets", "hidden"])).toBe("cached");
  unsubscribe(); client.clear();
});
