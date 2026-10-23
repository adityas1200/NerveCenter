import { apiClient } from "@/api/client";

/**
 * Connectors: the systems the agent and the data pages talk to. Each card is one entry in
 * operations.yaml `connections` (rendered to .mcp.json for the agent) plus, where the data
 * pages need a direct client, a managed connection profile. Secrets live in the secret store
 * and are only ever referenced as ${VAR}.
 */

export type ConnectorState = "not_connected" | "connected" | "error";
export type McpTransport = "stdio" | "http" | "sse";

/**
 * A connector can offer more than one way of connecting (Databricks: as a person, or as a service
 * principal). `when` names the settings a field or secret belongs to; the form shows and requires it
 * only while those settings hold, so the backend and the form agree on what is being asked for.
 */
export type ConnectorWhen = Record<string, string>;
export interface ConnectorChoice { value: string; label: string }
export interface ConnectorField { key: string; label: string; placeholder?: string; required?: boolean; env?: string; default?: string; choices?: ConnectorChoice[]; when?: ConnectorWhen }
export interface ConnectorSecret { key: string; label: string; env: string; required?: boolean; when?: ConnectorWhen }

/** Whether a field or secret applies to the settings currently entered in the form. */
export function fieldApplies(entry: { when?: ConnectorWhen }, settings: Record<string, string>): boolean {
  return Object.entries(entry.when ?? {}).every(([key, value]) => (settings[key] ?? "") === value);
}
/** The form's starting settings: what is saved, with each field's default filled in. */
export function withFieldDefaults(fields: ConnectorField[], settings: Record<string, string>): Record<string, string> {
  const values = { ...settings };
  for (const field of fields) if (field.default !== undefined && !(values[field.key] ?? "").trim()) values[field.key] = field.default;
  return values;
}
export interface ConnectorMcp { transport: McpTransport | string; command: string | null; args: string[]; url: string | null; env: string[]; enabled: boolean }
/** A section of operations.yaml that names this connection, e.g. identity → "Access requests". */
export interface ConnectorUse { section: string; label: string }
export type ConnectionKind = "mcp" | "api" | "cli" | "native" | "smtp";
export interface ConnectorTest { id: string; status: "connected" | "configured" | "failed" | string; message: string; testedAt: string }

export interface Connector {
  id: string;
  name: string;
  short?: string;
  description: string;
  usedBy?: string[];
  fields?: ConnectorField[];
  secrets?: ConnectorSecret[];
  kind: "catalog" | "custom";
  configured: boolean;
  /** workspace: saved through this form; environment: configured by deployment variables only. */
  source?: "workspace" | "environment" | null;
  state: ConnectorState;
  reason?: string | null;
  lastTest?: { status: string; message: string; testedAt?: string } | null;
  settings: Record<string, string>;
  secretsSet: string[];
  mcp: ConnectorMcp | null;
  /** How the agent reaches it: an MCP server, a plain REST API, a command-line tool, or a mail server. */
  connectionKind?: ConnectionKind | string;
  /** The catalog entry launches a default MCP server (email over SMTP does not). */
  hasMcpDefault?: boolean;
  /** Base URL, command or MCP URL, for custom connections. */
  endpoint?: string;
  /** Parts of the workspace that use it, from operations.yaml. */
  usedFor?: ConnectorUse[];
  /** operations.yaml knowledge.connection points at it. */
  knowledgeSource?: boolean;
  /** connectors: added on this page; operations: written into operations.yaml by setup or by hand. */
  origin?: "connectors" | "operations";
  updatedAt?: string | null;
}

export interface ConnectorSaveInput { settings: Record<string, string>; secrets: Record<string, string>; mcp?: { transport: McpTransport; command?: string; args?: string; url?: string } | null; enabled?: boolean }
export interface CustomMcpInput { title: string; transport: McpTransport; url?: string; command?: string; args?: string; env?: Record<string, string> }
/** Add connection: an MCP server, a REST API, or a command-line tool. Tokens and env values go to the secret store. */
export type CustomConnectionInput =
  | ({ kind?: "mcp"; description?: string } & CustomMcpInput)
  | { kind: "api"; title: string; description?: string; baseUrl: string; auth: "none" | "bearer"; token?: string; env?: Record<string, string> }
  | { kind: "cli"; title: string; description?: string; command: string; args?: string; env?: Record<string, string> }
  /** A git repository: link, branch and access token. Not marked as knowledge, it becomes the code-fix repository when none is set. */
  | { kind: "git"; title: string; description?: string; repository: string; branch?: string; token?: string; knowledge?: boolean };

export const connectorKeys = { all: ["connectors"] as const };

export const connectorsApi = {
  list: (signal?: AbortSignal) => apiClient.get<{ items: Connector[] }>("/api/connectors", { signal }),
  save: (id: string, input: ConnectorSaveInput) => apiClient.put<Connector>(`/api/connectors/${encodeURIComponent(id)}`, input),
  saveCustom: (input: CustomConnectionInput) => apiClient.post<Connector>("/api/connectors/custom", input),
  test: (id: string) => apiClient.post<ConnectorTest>(`/api/connectors/${encodeURIComponent(id)}/test`),
  remove: (id: string) => apiClient.delete<{ id: string; deleted: boolean }>(`/api/connectors/${encodeURIComponent(id)}`),
};

export const CONNECTION_KIND_LABEL: Record<string, string> = { mcp: "MCP server", api: "REST API", cli: "Command line", native: "Built in", smtp: "Mail server (SMTP)" };

export const CONNECTOR_STATE_LABEL: Record<ConnectorState, string> = { not_connected: "Not connected", connected: "Connected", error: "Needs attention" };
