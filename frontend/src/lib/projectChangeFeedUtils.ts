import { refreshAfterWrite } from "@/lib/refreshAfterWrite";
import type { QueryClient, Query, QueryKey } from "@tanstack/react-query";
import { queryKeys } from "@/api/queryKeys";
import type { ProjectChangeHint } from "@/api/changes";

export const CHANGE_FALLBACK_POLL_MS = 30_000;
const TICKET_QUERY_ROOTS = [queryKeys.tickets.all, queryKeys.overview.all];

export function parseChangeHint(data: unknown): ProjectChangeHint | null {
  if (!data || typeof data !== "object") return null;
  const hint = data as Partial<ProjectChangeHint>;
  return typeof hint.projectId === "string" && typeof hint.resource === "string" && typeof hint.at === "string"
    ? hint as ProjectChangeHint
    : null;
}

function projectQuery(query: Query, projectId: string): boolean {
  return query.queryHash.startsWith(`[${JSON.stringify(projectId)},`);
}

function hasOwnPolling(query: Query): boolean {
  return query.observers.some((observer) => Boolean(observer.options.refetchInterval));
}

export function invalidateProjectQueries(queryClient: QueryClient, projectId: string) {
  return refreshAfterWrite(queryClient, {
    predicate: (query) => projectQuery(query, projectId) && TICKET_QUERY_ROOTS.some((root) => hasRoot(query.queryKey, root)),
  });
}

/** A delivery gap can affect any cached resource, so recovery refreshes all active queries in this project. */
export function invalidateAllProjectQueries(queryClient: QueryClient, projectId: string) {
  return refreshAfterWrite(queryClient, { predicate: (query) => projectQuery(query, projectId) });
}

export function refetchUnpolledProjectQueries(queryClient: QueryClient, projectId: string) {
  return queryClient.refetchQueries({
    predicate: (query) => projectQuery(query, projectId) && query.isActive() && !hasOwnPolling(query)
      && TICKET_QUERY_ROOTS.some((root) => hasRoot(query.queryKey, root)),
  }, { cancelRefetch: false });
}

function hasRoot(key: QueryKey, root: QueryKey): boolean {
  return root.every((part, index) => key[index] === part);
}
