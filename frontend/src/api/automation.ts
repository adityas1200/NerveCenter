import { apiClient } from "@/api/client";
import type { UserIdentity } from "@/api/types";

/**
 * What Sonic does on its own when something breaks (operations.yaml `automation`, SPEC-automations-01), the alerts that come of
 * it, and how fresh each source is (SPEC-platform-10). Mirrors backend/src/monitoring/automation-settings.mjs.
 */

export type AutomationTrigger = "pipelineFailed" | "pipelineLate" | "dqFailed";
export type AutomationAction = "off" | "ticket" | "task" | "task_and_ticket";
export type AutomationPermission = "read-only" | "policy";
export type TicketPlatformChoice = "auto" | "nervecenter" | "servicenow" | "jira";
export type TicketPriorityChoice = "auto" | "critical" | "high" | "medium" | "low";
export type RecoveryAction = "comment" | "resolve" | "none";
export type DqSeverity = "critical" | "high" | "medium" | "low" | "info";

export interface AutomationTicket { platform: TicketPlatformChoice; priority: TicketPriorityChoice; assignmentGroup: string; projectKey: string; issueType: string; onRecovery: RecoveryAction }
interface TriggerBase { action: AutomationAction; permission: AutomationPermission; playbook: string; ticket?: Partial<AutomationTicket> }
export type PipelineFailedSettings = TriggerBase & { platforms?: string[] };
export interface PipelineLateSettings extends TriggerBase { graceMinutes: number; lookbackHours: number; notStarted: boolean; missedSlots: boolean; longRunning: boolean; longRunningFactor: number }
export interface DqFailedSettings extends TriggerBase { minSeverity: DqSeverity; includeWarnings: boolean; tables: string[] }
export interface AutomationLimits { maxConcurrent: number; maxPerDay: number; cooldownMinutes: number; reopenHours: number }
export type AutomationOverride = Partial<{ pipelineFailed: Partial<PipelineFailedSettings>; pipelineLate: Partial<PipelineLateSettings>; dqFailed: Partial<DqFailedSettings> }>;

/** The automation with every default filled in. `legacy` means the project never saved one and runs the older rule. */
export interface AutomationConfig {
  enabled: boolean;
  legacy: boolean;
  limits: AutomationLimits;
  ticket: AutomationTicket;
  pipelineFailed: PipelineFailedSettings;
  pipelineLate: PipelineLateSettings;
  dqFailed: DqFailedSettings;
  overrides: { pipelines: Record<string, AutomationOverride>; tables: Record<string, AutomationOverride> };
  updatedBy: UserIdentity | null;
  updatedAt?: string | null;
}

export interface SourceStatus { everySeconds: number | null; lastFetchAt: string | null; nextFetchAt: string | null; lastError: string | null; sharedWith?: string }
export interface MonitoringStatus {
  sources: { pipelines: SourceStatus; dataQuality: SourceStatus };
  automation: { active: boolean; legacy: boolean; watchedWhenIdle: boolean; syncEnabled: boolean };
  openAlerts: number;
}

export type InvestigationStatus = "none" | "queued" | "started" | "waiting" | "finished" | "failed" | "suppressed";
export interface AlertOccurrence { key: string; at: string; kind: string; runId?: string | null; slot?: string | null; checkId?: string; checkName?: string; severity?: string; summary?: string | null }
export interface Alert {
  id: string;
  projectId: string;
  key: string;
  trigger: AutomationTrigger;
  status: "open" | "resolved";
  subject: { type: "pipeline" | "dq"; id: string; name: string; platform?: string; tableId?: string };
  occurrences: AlertOccurrence[];
  occurrenceCount: number;
  action: AutomationAction;
  openedAt: string;
  updatedAt: string;
  resolvedAt?: string | null;
  reopenedCount?: number;
  ticketId: string | null;
  ticket: { ticketId: string; number: string | null; system: string; url: string | null } | null;
  ticketError?: string | null;
  investigation: { status: InvestigationStatus; taskId?: string; reason?: string | null; permission?: AutomationPermission; startedAt?: string };
}

export const automationKeys = {
  all: ["automation"] as const,
  config: ["automation", "config"] as const,
  alerts: (filters: object) => ["automation", "alerts", filters] as const,
};

export const automationApi = {
  get: (signal?: AbortSignal) => apiClient.get<{ config: AutomationConfig | null; status: MonitoringStatus | null }>("/api/automation", { signal }),
  alerts: (params: { status?: "open" | "resolved" | "all"; trigger?: AutomationTrigger; subjectId?: string; limit?: number; offset?: number } = {}, signal?: AbortSignal) => {
    const query = new URLSearchParams(Object.entries(params).filter(([, value]) => value !== undefined && value !== "").map(([key, value]) => [key, String(value)]));
    return apiClient.get<{ items: Alert[]; total: number }>(`/api/alerts${query.size ? `?${query}` : ""}`, { signal });
  },
  /** Fetch now instead of waiting for the next pass; the server allows one every 30 seconds per project. */
  refresh: (sources?: Array<"pipelines" | "dataQuality">) => apiClient.post<{ status: MonitoringStatus }>("/api/monitor/refresh", sources ? { sources } : {}),
  resolve: (id: string) => apiClient.post<Alert>(`/api/alerts/${encodeURIComponent(id)}/resolve`, {}),
};

/** The one set of words for what each trigger does, used by Settings and the pages. */
export const ACTION_LABEL: Record<AutomationAction, string> = { off: "Off", task: "Investigate", ticket: "Ticket only", task_and_ticket: "Investigate and ticket" };
export const TRIGGER_LABEL: Record<AutomationTrigger, string> = { pipelineFailed: "Pipeline failed", pipelineLate: "Pipeline late or missed", dqFailed: "Data quality check failed" };
