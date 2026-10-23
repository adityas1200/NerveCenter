import { apiClient } from "@/api/client";
import type { ApiList, ServiceNowIntegrationStatus, Ticket, UserIdentity } from "@/api/types";
import type { Task, TaskPermission } from "@/api/tasks";

/** Everything the Tickets screens ask the backend for, in one place. */

export type TicketScope = "active" | "closed" | "all";
export interface TicketListQuery {
  scope: TicketScope; limit: number; offset: number; sort: "priority" | "title" | "source" | "assignee" | "status" | "updated"; dir: "asc" | "desc";
  from?: string | null; to?: string | null; q?: string; priority?: string; appStatus?: string; assignee?: string; source?: string; resolved?: string | null; kind?: string | null; category?: string | null;
}
export interface TicketListPage {
  items: Ticket[];
  total: number;
  meta: { open: number; highOpen: number; waitingOnYou: number; closed: number; resolved: number; scoped: number;
    options: Record<"priority" | "status" | "assignee" | "source", string[]>; people: UserIdentity[] };
}

export interface CreateTicketRequest {
  title: string;
  description?: string;
  category?: string;
  type?: string;
  priority?: string;
  assignee?: UserIdentity | null;
  /** When false the orchestrator does not pick the ticket up automatically. */
  startTriage?: boolean;
}

export interface TicketPatch {
  title?: string;
  description?: string;
  priority?: string;
  status?: string;
  resolutionSummary?: string;
  assignee?: UserIdentity | null;
  collaborators?: UserIdentity[];
  visibility?: "project" | "private";
}

export interface TicketActivityItem {
  id: string;
  type: string;
  title: string;
  detail?: string | null;
  at: string;
  status?: string | null;
  actor?: UserIdentity | null;
  runId?: string | null;
  /** Where the change was also saved, e.g. "Saved as a work note in ServiceNow INC0031204". */
  source?: string | null;
}

export interface ServiceNowSyncFilters {
  assignmentGroup?: string;
  states?: string[];
  tag?: string;
  updatedSinceHours?: number;
  priorities?: string[];
  limit?: number;
  startTriage?: boolean;
}

export interface ServiceNowPreview {
  total: number;
  alreadyImported: number;
  sample: Array<{ number: string; short_description: string; priority?: string; state?: string }>;
}

export interface ServiceNowSyncResult {
  synced: number;
  total?: number;
  source: string;
  tickets?: Ticket[];
}

export type ServiceNowStatus = ServiceNowIntegrationStatus & { assignmentGroups?: string[] };

export interface JiraStatus { mode: "disabled" | "live" | string; configured: boolean; ready: boolean; site?: string | null; project?: string | null; reason?: string; defaultJql?: string }
export interface JiraSyncFilters { project?: string; jql?: string; updatedSinceHours?: number; limit?: number }
export interface JiraPreview { total: number; matched: number; alreadyImported: number; site: string; query: string; sample: Array<{ number: string; short_description: string; priority?: string; state?: string }> }
export interface JiraSyncResult { synced: number; total?: number; site: string; source: string; query: string; tickets?: Ticket[] }

const ticketPath = (id: string) => `/api/tickets/${encodeURIComponent(id)}`;

export const ticketsApi = {
  list: (query: TicketListQuery | TicketScope, signal?: AbortSignal) => {
    if (typeof query === "string") return apiClient.get<TicketListPage>(`/api/tickets?scope=${query}&limit=100&offset=0`, { signal });
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) if (value !== null && value !== undefined && value !== "") params.set(key, String(value));
    return apiClient.get<TicketListPage>(`/api/tickets?${params}`, { signal });
  },
  detail: (id: string, signal?: AbortSignal) => apiClient.get<Ticket>(ticketPath(id), { signal }),
  create: (input: CreateTicketRequest) => apiClient.post<Ticket>("/api/tickets", input),
  update: (id: string, patch: TicketPatch) => apiClient.patch<Ticket>(ticketPath(id), patch),
  comment: (id: string, body: string) => apiClient.post<{ ticketId: string; event: TicketActivityItem; sourceWrite?: Ticket["sourceWrite"] }>(`${ticketPath(id)}/comments`, { body }),
  activity: (id: string, signal?: AbortSignal) => apiClient.get<ApiList<TicketActivityItem>>(`${ticketPath(id)}/activity`, { signal }),
  /** Start the agent task for this ticket, or return the existing one. */
  /** Start the agent on the ticket, or continue its task with `prompt`. */
  investigate: (id: string, body: { prompt?: string; permission?: TaskPermission } = {}) => apiClient.post<{ task: Task; created: boolean; messaged?: boolean }>(`${ticketPath(id)}/investigate`, body),
  serviceNow: {
    status: (signal?: AbortSignal) => apiClient.get<ServiceNowStatus>("/api/integrations/servicenow/status", { signal }),
    preview: (filters: ServiceNowSyncFilters, signal?: AbortSignal) => apiClient.post<ServiceNowPreview>("/api/integrations/servicenow/preview", filters, { signal }),
    sync: (filters: ServiceNowSyncFilters) => apiClient.post<ServiceNowSyncResult>("/api/integrations/servicenow/sync", filters),
  },
  jira: {
    status: (signal?: AbortSignal) => apiClient.get<JiraStatus>("/api/integrations/jira/status", { signal }),
    preview: (filters: JiraSyncFilters, signal?: AbortSignal) => apiClient.post<JiraPreview>("/api/integrations/jira/preview", filters, { signal }),
    sync: (filters: JiraSyncFilters) => apiClient.post<JiraSyncResult>("/api/integrations/jira/sync", filters),
  },
};
