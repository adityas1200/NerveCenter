import { apiClient } from "@/api/client";
import type { DataQualityAnalysis, DataQualityConfiguration, DataQualityMonitorResponse, DataQualityProvider } from "@/api/types";

export interface DataQualityAnalysisRequest {
  provider: string;
  catalog: string;
  schema: string;
  resultTable: string;
  warehouseId?: string | null;
  ddl: string;
  allowDataSample?: boolean;
}

export interface DataQualityWindow {
  /** Display label for the window; the backend echoes it back. */
  range: string;
  from?: string | null;
  to?: string | null;
}

/** One page of results and the filters behind it; the server filters and pages the stored results (SPEC-platform-11). */
export interface DataQualityPage { limit?: number; offset?: number; status?: string; severity?: string; table?: string; q?: string }
const pageBody = (page: DataQualityPage) => Object.fromEntries(Object.entries(page).filter(([, value]) => value !== undefined && value !== "" && value !== "all"));

function windowParams(window: DataQualityWindow): URLSearchParams {
  const params = new URLSearchParams({ range: window.range, limit: "100" });
  if (window.from) params.set("from", window.from);
  if (window.to) params.set("to", window.to);
  return params;
}

export const dataQualityApi = {
  providers: (signal?: AbortSignal) => apiClient.get<{ items: DataQualityProvider[] }>("/api/data-quality/providers", { signal }),
  /** `configuration` is the first enabled table (older callers); `tables` lists every result table. */
  config: (signal?: AbortSignal) => apiClient.get<{ configuration: DataQualityConfiguration | null; tables?: DataQualityConfiguration[] }>("/api/data-quality/config", { signal }),
  monitor: (window: DataQualityWindow, page: DataQualityPage = {}, signal?: AbortSignal) => {
    const params = windowParams(window);
    for (const [key, value] of Object.entries(pageBody(page))) params.set(key, String(value));
    return apiClient.get<DataQualityMonitorResponse>(`/api/data-quality/monitor?${params}`, { signal });
  },
  reconcile: (window: DataQualityWindow, page: DataQualityPage = {}) => apiClient.post<DataQualityMonitorResponse>("/api/data-quality/monitor/reconcile", { range: window.range, from: window.from ?? undefined, to: window.to ?? undefined, limit: 100, ...pageBody(page) }),
  analyze: (input: DataQualityAnalysisRequest) => apiClient.post<DataQualityAnalysis>("/api/data-quality/analyze", input),
  /** Create a result table (no id) or update the one with this id; an update may send only the fields that change. */
  save: (input: DataQualityConfiguration | (Partial<DataQualityConfiguration> & { id: string })) => apiClient.put<DataQualityConfiguration>("/api/data-quality/config", input),
  remove: (id: string) => apiClient.delete<{ id: string; deleted: boolean }>(`/api/data-quality/config/${encodeURIComponent(id)}`),
};
