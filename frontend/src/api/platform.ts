import { apiClient } from "@/api/client";
import type { Pipeline } from "@/api/types";

/** One table or view on the connected data platform (Snowflake or Databricks Unity Catalog). */
export interface PlatformTable { id: string; name: string; schema?: string; database?: string; catalog?: string; platform?: string; kind?: string }

export const platformApi = {
  /** The pipeline inventory across connected platforms, newest run first. */
  pipelines: (limit = 500, signal?: AbortSignal) => apiClient.get<{ items: Pipeline[] }>(`/api/pipelines?limit=${limit}`, { signal }),
  /** Tables whose name matches `search`; errors when the platform has no catalog and schema set. */
  tables: (search: string, limit = 20, signal?: AbortSignal) => apiClient.get<{ items: PlatformTable[] }>(`/api/data-platform/tables?search=${encodeURIComponent(search)}&limit=${limit}`, { signal }),
};
