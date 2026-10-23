import { useQuery } from "@tanstack/react-query";
import { inboxApi, inboxKeys } from "@/api/inbox";
import { useProject } from "@/lib/projectContext";
import { needsAction } from "./inboxItems";
import { FRESH } from "@/api/queryPolicy";

/** Sidebar badge: how many items need a decision. */
export function useInboxPending(): number {
  // A visitor to an open project has no inbox there (SPEC-projects-03 FR-13).
  const { visitor } = useProject();
  const query = useQuery({ queryKey: inboxKeys.list({ status: "pending" }), queryFn: ({ signal }) => inboxApi.list({ status: "pending", limit: 200 }, signal), refetchInterval: false, staleTime: FRESH.badge, enabled: !visitor });
  return (query.data?.items ?? []).filter(needsAction).length;
}
