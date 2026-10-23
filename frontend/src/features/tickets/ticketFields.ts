import type { Ticket } from "@/api/types";

/**
 * The few fields a business user filters and reads tickets by, normalised
 * once so the table, the filters and the URL agree.
 */

export const CLOSED_STATUSES = new Set(["closed", "resolved", "cancelled", "canceled", "archived"]);
export const isClosed = (ticket: Pick<Ticket, "status">) => CLOSED_STATUSES.has(String(ticket.status || "").toLowerCase());

export type SourceKey = "servicenow" | "jira" | "pipeline" | "data-quality" | "manual" | "other";

const DQ_SOURCES = new Set(["agentic-monitor", "data-quality", "dq", "monitor"]);

export function sourceKey(ticket: Ticket): SourceKey {
  const source = String(ticket.source || ticket.metadata?.source || "").toLowerCase();
  if (source === "servicenow" || ticket.externalReference?.system === "servicenow") return "servicenow";
  if (source === "jira" || ticket.externalReference?.system === "jira") return "jira";
  if (ticket.pipelineId || source === "pipeline" || source === "databricks" || source === "snowflake") return "pipeline";
  if (DQ_SOURCES.has(source) || ticket.context?.businessCheckId || String(ticket.category || "").toLowerCase() === "data_quality") return "data-quality";
  if (!source || source === "manual" || source === "demo-manual") return "manual";
  return "other";
}

export const SOURCE_LABEL: Record<SourceKey, string> = {
  servicenow: "ServiceNow",
  jira: "Jira",
  pipeline: "Pipeline",
  "data-quality": "Data quality check",
  manual: "Manual",
  other: "Other",
};

export const assigneeName = (ticket: Ticket): string | null => ticket.assignee?.name || ticket.assignee?.id || null;

export const humanize = (value?: string | null): string => {
  const text = String(value || "").replace(/[_-]+/g, " ").trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : "";
};

/** Business-facing categories offered when a person creates a ticket. */
export const TICKET_CATEGORIES: ReadonlyArray<{ value: string; label: string }> = [
  { value: "incident", label: "Something is broken" },
  { value: "access", label: "Access request" },
  { value: "data", label: "Data question" },
  { value: "change", label: "Change request" },
  { value: "task", label: "Task" },
];

/** Splits a comma-separated URL filter into a set; "all" or empty means no filter. */
export function parseFilter(value: string | null): Set<string> | null {
  if (!value || value === "all") return null;
  const parts = value.split(",").map((part) => part.trim().toLowerCase()).filter(Boolean);
  return parts.length ? new Set(parts) : null;
}
