import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/api/client";
import { queryKeys } from "@/api/queryKeys";
import { FRESH } from "@/api/queryPolicy";

/** `/api/meta` needs no identity, so the sign-in page can read it before anyone is signed in. */
export const metaApi = {
  get: (signal?: AbortSignal) => apiClient.get<{ adminContacts?: string[] }>("/api/meta", { signal }),
};

/** Admin emails to ask for access (SPEC-platform-09 FR-9); empty while loading or when the call fails. */
export function useAdminContacts(): string[] {
  const { data } = useQuery({ queryKey: queryKeys.meta.all, queryFn: ({ signal }) => metaApi.get(signal), retry: false, staleTime: FRESH.session });
  return data?.adminContacts ?? [];
}
