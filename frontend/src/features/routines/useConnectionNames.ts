import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useMe } from "@/auth/rbac";
import { connectorKeys, connectorsApi } from "@/api/connectors";
import { FRESH } from "@/api/queryPolicy";

/** Connector id → display name, from the same list the Connectors page shows. Empty until loaded, and for viewers (the list is not theirs to read; labels fall back to the id). */
export function useConnectionNames(enabled = true): Record<string, string> {
  const role = useMe().data?.role;
  const query = useQuery({ queryKey: connectorKeys.all, queryFn: ({ signal }) => connectorsApi.list(signal), staleTime: FRESH.long, enabled: enabled && !!role && role !== "viewer", retry: false });
  return useMemo(() => Object.fromEntries((query.data?.items ?? []).map((item) => [item.id, item.name])), [query.data?.items]);
}
