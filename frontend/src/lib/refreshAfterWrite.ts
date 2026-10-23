import type { InvalidateQueryFilters, QueryClient } from "@tanstack/react-query";

/** A successful write must not be hidden by a read that started before it. */
export async function refreshAfterWrite(client: QueryClient, filters: InvalidateQueryFilters) {
  const active = client.getQueryCache().findAll({ ...filters, type: "active" });
  await Promise.allSettled(active.map(query => query.promise));
  // Re-evaluate active observers after waiting: navigation may have closed the view.
  return client.invalidateQueries({ ...filters, refetchType: "active" }, { cancelRefetch: false });
}
