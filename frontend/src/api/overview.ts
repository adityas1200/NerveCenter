import { apiClient } from "./client";
import type { OverviewResponse, OverviewAttentionItem } from "./types";
import type { RangeBounds } from "@/lib/timeRange";
import type { TimeBucket } from "@/lib/timeBuckets";
import type { AgentLine, AgentToday } from "@/features/overview/agentLines";

export interface TicketOverview { generatedAt: string; ticketSummary: OverviewResponse["ticketSummary"]; agentResolved: Omit<NonNullable<OverviewResponse["agentResolved"]>, "items">; dqOpen: number; chart: { raised: number[]; resolved: number[]; dqResolved: number[] } }
export interface PipelineOverview { generatedAt: string; capability: { available: boolean; reason: string }; platform: string; counts: { succeeded: number; failed: number; missed: number; paused: number; other: number; total: number }; chart: { succeeded: number[]; failed: number[] } }
export interface DqOverview { generatedAt: string; configured: boolean; summary: { total: number; passed: number; warning: number; failed: number }; source: string | null }
export interface AgentOverview { generatedAt: string; today: AgentToday; lines: Record<"tickets" | "pipelines" | "dataQuality", AgentLine>; waiting: number }
export interface WorkOverview { generatedAt: string; items: OverviewAttentionItem[]; scope: "mine" | "team" }
export interface OverviewGroups { tickets: TicketOverview; pipelines: PipelineOverview; "data-quality": DqOverview; agent: AgentOverview; work: WorkOverview }

export function fetchOverviewGroup<K extends keyof OverviewGroups>(group: K, bounds: RangeBounds, buckets: TimeBucket[], signal: AbortSignal) {
  const params = new URLSearchParams();
  if (group !== "work") {
    if (bounds.from) params.set("from", bounds.from);
    if (bounds.to) params.set("to", bounds.to);
    if (group === "tickets" || group === "pipelines") params.set("buckets", JSON.stringify(buckets.map(b => [b.start, b.end])));
  }
  return apiClient.get<OverviewGroups[K]>(`/api/overview/${group}?${params}`, { signal }).then(data => ({ ...data, buckets }));
}
