import { apiClient } from "@/api/client";
import type { ConnectionProfile, ConnectionProviderStatus, ConnectionTemplate } from "@/api/types";

/** Managed connections (Databricks, ServiceNow, Snowflake) used by the data pages. */
export const connectionsApi = {
  templates: (signal?: AbortSignal) => apiClient.get<{ items: ConnectionTemplate[] }>("/api/connection-templates", { signal }),
  list: (signal?: AbortSignal) => apiClient.get<{ items: ConnectionProfile[] }>("/api/connections", { signal }),
  providerStatus: (signal?: AbortSignal) => apiClient.get<{ items: ConnectionProviderStatus[] }>("/api/connection-provider-status", { signal }),
  save: (body: Record<string, unknown>) => apiClient.post<ConnectionProfile>("/api/connections", body),
  test: (id: string) => apiClient.post<ConnectionProfile>(`/api/connections/${encodeURIComponent(id)}/test`),
  setDefault: (id: string) => apiClient.post<ConnectionProfile>(`/api/connections/${encodeURIComponent(id)}/set-default`),
  remove: (id: string) => apiClient.delete<{ deleted: boolean }>(`/api/connections/${encodeURIComponent(id)}`),
};
