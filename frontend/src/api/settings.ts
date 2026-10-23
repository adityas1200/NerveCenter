import { apiClient } from "@/api/client";
import type { DocumentsSettings } from "@/api/templates";
import type { TaskPermission } from "@/api/tasks";

/**
 * Settings are a form over the workspace's operations.yaml. The backend reads the whole file
 * and writes one section at a time; the plugin's skills read the same file.
 */

export interface TeamSettings { name?: string; timezone?: string; operator?: { name?: string; email?: string } }
/** How often automatic sync runs: a plain number in the unit the user picked, not a hardcoded interval. */
export type SyncIntervalUnit = "seconds" | "minutes" | "hours";
/** How often one source is fetched in the background (SPEC-platform-10). */
export interface SourceCadence { every: number; unit: SyncIntervalUnit }
export interface SyncSettings { enabled?: boolean; intervalValue?: number; intervalUnit?: SyncIntervalUnit; interval_seconds?: number; pipelines?: SourceCadence; dataQuality?: SourceCadence; tickets?: SourceCadence; knowledge?: SourceCadence; github?: SourceCadence; /** Days of run and check history kept. */ retainDays?: number; [key: string]: unknown }

/** One ticket source the poller reads. Stored under ticketing.app.sources (an app-only block the plugin ignores). */
export interface TicketSource {
  platform: string;
  connection?: string | null;
  filters?: { jql?: string; project?: string; assignmentGroup?: string; states?: string[]; priorities?: string[]; updatedSinceHours?: number; limit?: number; [key: string]: unknown };
  auto_create_tasks?: boolean;
  max_concurrent_tasks?: number;
  permission?: TaskPermission;
}

export interface TicketingSettings {
  platform?: string;
  connection?: string;
  scope?: { site?: string; project?: string; queue?: string; [key: string]: unknown };
  views?: Record<string, string>;
  fields?: { category?: string; approval?: string; environment?: string; [key: string]: unknown };
  states?: Record<string, string[]>;
  app?: { sources?: TicketSource[]; [key: string]: unknown };
  [key: string]: unknown;
}

export interface PlatformSettings {
  name: string;
  type: string;
  connection?: string;
  environments?: Record<string, { workspace?: string; account?: string; writable?: boolean; [key: string]: unknown }>;
  /**
   * `jobs` is either the plugin's free-text description of where runs come from (older workspaces)
   * or NerveCenter's job filter: names containing an include term are shown, exclude wins, empty include = all.
   */
  monitoring?: { jobs?: string | JobFilter; data_quality?: string; [key: string]: unknown };
  [key: string]: unknown;
}

export interface JobFilter { include?: string[]; exclude?: string[]; [key: string]: unknown }

export type PolicyValue = "allow" | "ask" | "deny" | "verified-only" | string;
/** operations.yaml `agent`: the Claude model every run uses and how hard it thinks (backend/src/tasks/agent-model.mjs). */
export type AgentModel = "fable" | "opus" | "sonnet" | "haiku";
export type AgentEffort = "low" | "medium" | "high" | "xhigh" | "max";
export interface AgentSettings { model?: AgentModel; effort?: AgentEffort; max_budget_usd?: number | null; [key: string]: unknown }

export type RuleEffect = "deny" | "ask" | "allow";
/**
 * One scoped rule, in the spirit of a statement in an AWS IAM policy document. `action` is a
 * policy category (or `*`), `resource` is `system:environment:type:name` with `*` wildcards.
 * The most restrictive matching rule wins; see backend/src/tasks/policy-rules.mjs.
 */
export interface PolicyRule { effect: RuleEffect; action: string; resource: string; description?: string }

export interface PolicySettings { default_write?: PolicyValue; email_send?: PolicyValue; privileged_access?: PolicyValue; production_changes?: PolicyValue; ticket_writes?: PolicyValue; workspace_changes?: PolicyValue; knowledge_drafts?: PolicyValue; ticket_close?: PolicyValue; external_recipients?: PolicyValue; rules?: PolicyRule[]; [key: string]: unknown }

/** Which optional feature sections (Pipelines, Data Quality, Boards, Routines, Skills, Knowledge)
 * are turned off workspace-wide: hidden from the sidebar and blocked at the route, not just hidden. */
export interface UiSettings { disabledSections?: string[] }

export interface Operations {
  team?: TeamSettings;
  sync?: SyncSettings;
  ticketing?: TicketingSettings;
  platforms?: PlatformSettings[];
  policy?: PolicySettings;
  connections?: Record<string, { kind?: string; transport?: string; enabled?: boolean; [key: string]: unknown }>;
  agent?: AgentSettings;
  ui?: UiSettings;
  documents?: DocumentsSettings;
  [key: string]: unknown;
}

export interface SettingsResponse {
  operations: Operations;
  validation: { errors: string[]; warnings: string[] };
  mcp: { mcpServers: Record<string, unknown> };
}

export type SettingsSection = "team" | "sync" | "ticketing" | "platforms" | "policy" | "knowledge" | "identity" | "source_control" | "documents" | "communication" | "agent" | "ui" | "automation";

export const settingsKeys = { all: ["settings"] as const };

export const settingsApi = {
  get: (signal?: AbortSignal) => apiClient.get<SettingsResponse>("/api/settings", { signal }),
  update: <T>(section: SettingsSection, value: T) => apiClient.put<T>(`/api/settings/${section}`, value),
};

/** The three answers the approval gate gives per category (backend/src/tasks/permission-policy.mjs). */
export const POLICY_OPTIONS: ReadonlyArray<{ value: PolicyValue; label: string }> = [
  { value: "allow", label: "Allow" },
  { value: "ask", label: "Ask" },
  { value: "deny", label: "Deny" },
];

/** Mirrors POLICY_DEFAULTS in backend/src/tasks/permission-policy.mjs plus the two plugin-level rules. */
export const POLICY_DEFAULTS: PolicySettings = { default_write: "allow", email_send: "ask", privileged_access: "ask", production_changes: "ask", ticket_writes: "ask", workspace_changes: "ask", knowledge_drafts: "allow", ticket_close: "verified-only", external_recipients: "deny" };

/** policy.ticket_close, a rule the plugin's agent follows itself. */
export const CLOSURE_OPTIONS: ReadonlyArray<{ value: PolicyValue; label: string }> = [
  { value: "verified-only", label: "Verified only" },
  { value: "any", label: "Any time" },
];

/** policy.external_recipients, a rule the plugin's agent follows itself. */
export const RECIPIENT_OPTIONS: ReadonlyArray<{ value: PolicyValue; label: string }> = [
  { value: "allow", label: "Allow" },
  { value: "deny", label: "Deny" },
];

/* ---------------------------------------------------------------- policy rules */

export const RULE_EFFECT_OPTIONS: ReadonlyArray<{ value: RuleEffect; label: string; help: string }> = [
  { value: "deny", label: "Deny", help: "Never, whatever else says otherwise" },
  { value: "ask", label: "Ask", help: "Pause for a person first" },
  { value: "allow", label: "Allow", help: "Go ahead without asking" },
];

/** The categories a rule can narrow, mirroring POLICY_CATEGORIES in permission-policy.mjs. */
export const RULE_ACTION_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "*", label: "Anything" },
  { value: "production_changes", label: "Production changes" },
  { value: "privileged_access", label: "Access changes" },
  { value: "ticket_writes", label: "Ticket changes" },
  { value: "email_send", label: "Sending email" },
  { value: "workspace_changes", label: "Workspace setup" },
  { value: "knowledge_drafts", label: "Knowledge drafts" },
  { value: "default_write", label: "Routine changes" },
];

/** The first segment of a resource: which system the call goes to. */
export const RULE_SYSTEM_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "*", label: "Any system" },
  { value: "databricks", label: "Databricks" },
  { value: "snowflake", label: "Snowflake" },
  { value: "jira", label: "Jira" },
  { value: "servicenow", label: "ServiceNow" },
  { value: "email", label: "Email" },
  { value: "workspace", label: "Workspace files" },
];

/** The third segment: what kind of thing the rule is about. */
export const RULE_TYPE_OPTIONS: ReadonlyArray<{ value: string; label: string; placeholder: string }> = [
  { value: "*", label: "Anything", placeholder: "*" },
  { value: "job", label: "Job", placeholder: "customer_orders_*" },
  { value: "table", label: "Table", placeholder: "gold.*" },
  { value: "pipeline", label: "Pipeline", placeholder: "*" },
  { value: "cluster", label: "Cluster", placeholder: "*" },
  { value: "warehouse", label: "Warehouse", placeholder: "*" },
  { value: "ticket", label: "Ticket", placeholder: "SEC-*" },
  { value: "recipient", label: "Recipient", placeholder: "*@example.com" },
  { value: "file", label: "File", placeholder: "knowledge/*" },
];

export const EMPTY_RULE: PolicyRule = { effect: "deny", action: "production_changes", resource: "*:*:*:*" };

/** A resource string split into the four parts the editor shows; missing parts read as `*`. */
export function splitResource(resource: string): { system: string; environment: string; type: string; name: string } {
  const parts = String(resource ?? "").split(":").map((part) => part.trim());
  while (parts.length < 4) parts.push("*");
  const [system, environment, type, name] = parts;
  return { system: system || "*", environment: environment || "*", type: type || "*", name: name || "*" };
}

/** The four parts back into `system:environment:type:name`, with trailing `*` segments dropped for readability. */
export function joinResource({ system, environment, type, name }: { system: string; environment: string; type: string; name: string }): string {
  const parts = [system || "*", environment || "*", type || "*", name || "*"];
  while (parts.length > 1 && parts[parts.length - 1] === "*") parts.pop();
  return parts.join(":");
}

/** Mirrors AGENT_DEFAULTS in backend/src/tasks/agent-model.mjs. */
export const AGENT_DEFAULTS: Required<Pick<AgentSettings, "model" | "effort">> = { model: "sonnet", effort: "high" };

export const AGENT_MODEL_OPTIONS: ReadonlyArray<{ value: AgentModel; label: string; help: string; effort: boolean }> = [
  // Each runs the newest model of its family (backend/src/tasks/agent-model.mjs).
  { value: "fable", label: "Fable", help: "Most capable, for the hardest investigations. Costs the most", effort: true },
  { value: "opus", label: "Opus", help: "Very capable. Slower, costs more", effort: true },
  { value: "sonnet", label: "Sonnet", help: "Balances depth, speed and cost", effort: true },
  { value: "haiku", label: "Haiku", help: "Fastest, costs the least", effort: false },
];

export const AGENT_EFFORT_OPTIONS: ReadonlyArray<{ value: AgentEffort; label: string; help: string }> = [
  { value: "low", label: "Low", help: "Answers fast with little thinking" },
  { value: "medium", label: "Medium", help: "Some thinking before each step" },
  { value: "high", label: "High", help: "Thinks each step through" },
  { value: "xhigh", label: "Extra high", help: "Deeper thinking for the hardest problems" },
  { value: "max", label: "Max", help: "Thinks as long as it needs. Slowest, costs the most" },
];
