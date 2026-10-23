import { hashKey, type QueryKey } from "@tanstack/react-query";
// A cycle with client.ts, which reads the current project from here; both only use each other inside functions.
import { apiClient } from "@/api/client";

/** SPEC-projects-01 FR-8, FR-37: the project every /api call is scoped to, sent as X-NerveCenter-Project. */
export const PROJECT_HEADER = "X-NerveCenter-Project";
/** The admins' every-project read scope, sent as the project header (the admin console's connection library). */
export const ALL_PROJECTS = "*";
export const UNROUTED = "unrouted";

/** Roles inside one project (SPEC-projects-03 FR-4). */
export type ProjectRole = "owner" | "developer" | "viewer";
/** A project card's colour (FR-17); none stored means one picked from the id. */
export type ProjectColor = "indigo" | "teal" | "amber" | "rose" | "sky" | "green";
export const PROJECT_COLORS: readonly ProjectColor[] = ["indigo", "teal", "amber", "rose", "sky", "green"];

export interface MyProject {
  id: string;
  name: string;
  slug: string;
  description?: string;
  color?: ProjectColor | null;
  open?: boolean;
  /** Your role there; `admin` for an app admin who is not a member, `open` for a visitor to an open project (FR-15). */
  role: ProjectRole | "admin" | "open";
  archived: boolean;
}

export interface MyProjectsResponse {
  items: MyProject[];
  /** True for global admins: they may also open "Unrouted". */
  all: boolean;
  unrouted?: number;
}

// Module state rather than context: the API client is plain functions, and the provider is the only writer.
let current: string | null = null;
export const getCurrentProject = () => current;
export const setCurrentProject = (id: string | null) => { current = id; };

// FR-14: a 403 naming another of the caller's projects; the provider decides whether to switch.
type Listener = (projectId: string) => void;
const listeners = new Set<Listener>();
export function onOtherProject(listener: Listener) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function notifyOtherProject(projectId: string) { for (const listener of listeners) listener(projectId); }

/** Every cached query belongs to a project, so one project's data is never shown under another. `auth` keys are per user, not per project. */
export function projectQueryKeyHash(queryKey: QueryKey): string {
  return hashKey(queryKey[0] === "auth" ? queryKey : [current ?? "", ...queryKey]);
}

/* ------------------------------------------------------------ Settings > Projects (SPEC-projects-02 FR-27) */

export interface Project { id: string; name: string; slug: string; description: string; kind: string; open?: boolean; color?: ProjectColor | null; archivedAt: string | null; createdAt: string; createdBy: string }
export interface ProjectMember { projectId: string; userId: string; role: ProjectRole; name?: string; email?: string; addedAt?: string; addedBy?: string }
export interface Person { id: string; name: string; email: string }
export type Autonomy = "read" | "ask" | "dev";
/** `POST /api/projects` (SPEC-projects-03 FR-18): the project and its setup in one call; the server checks it whole first. */
export interface NewProjectInput {
  id: string;
  name: string;
  description?: string;
  color?: ProjectColor;
  open?: boolean;
  copyFrom?: string;
  grants?: Array<{ resourceType: GrantType; resourceId: string; scope?: Record<string, string[]> }>;
  members?: Array<{ userId: string; role: ProjectRole }>;
  settings?: { model?: "sonnet" | "opus" | "fable" | "haiku"; autonomy?: Autonomy };
}
export interface MeAccess { projectId: string | null; access: "member" | "open" | "admin" | "all" | null; appRole: string; projectRole: ProjectRole | "admin" | "open" | null; role: string; permissions: string[] }
export type GrantType = "connection" | "knowledge" | "skill";
/** SPEC-projects-04: what anyone in a project may know about its own Anthropic key. Never the key itself. */
export interface ProjectApiKeyStatus { set: boolean; last4?: string; setBy?: string | null; setAt?: string | null; verified?: boolean }
export interface ProjectGrant { projectId: string; resourceType: GrantType; resourceId: string; scope?: Record<string, string[]>; isDefault?: boolean }
export interface Grantable {
  connections: Array<{ id: string; name: string; provider: string; projectAdminsMayGrant: boolean }>;
  knowledge: Array<{ id: string; name: string }>;
  skills: Array<{ id: string; name: string }>;
}

/** The routing filter each ticket or pipeline provider is split by (backend ticket-routing.mjs FILTER_FIELD). */
export const FILTER_FIELD: Record<string, { field: string; label: string }> = {
  jira: { field: "projectKeys", label: "Jira project keys" },
  servicenow: { field: "assignmentGroups", label: "Assignment groups" },
  databricks: { field: "jobInclude", label: "Job names containing" },
};

// Owner routes check the header against the project in the path, so calls about one project send it, whatever is open.
const about = (id: string) => ({ headers: { [PROJECT_HEADER]: id } });
const path = (id: string, rest = "") => `/api/projects/${encodeURIComponent(id)}${rest}`;

export const projectsApi = {
  list: (signal?: AbortSignal) => apiClient.get<{ items: Project[] }>("/api/projects", { signal }),
  create: (input: NewProjectInput) => apiClient.post<Project>("/api/projects", input),
  rename: (id: string, name: string) => apiClient.patch<Project>(path(id), { name }, about(id)),
  update: (id: string, patch: { description?: string; color?: ProjectColor | null; open?: boolean }) => apiClient.patch<Project>(path(id), patch, about(id)),
  /** What a new project could be granted (the create flow). */
  grantableForNew: (signal?: AbortSignal) => apiClient.get<Grantable>("/api/projects/grantable", { signal }),
  people: (query: string, signal?: AbortSignal) => apiClient.get<{ items: Person[] }>(`/api/people?q=${encodeURIComponent(query)}`, { signal }),
  access: (signal?: AbortSignal) => apiClient.get<MeAccess>("/api/me/access", { signal }),
  setArchived: (id: string, archived: boolean) => apiClient.post<Project>(path(id, archived ? "/archive" : "/unarchive"), undefined, about(id)),
  members: (id: string, signal?: AbortSignal) => apiClient.get<{ items: ProjectMember[] }>(path(id, "/members"), { ...(about(id)), signal }),
  addMember: (id: string, userId: string, role: ProjectRole = "viewer") => apiClient.post<ProjectMember>(path(id, "/members"), { userId, role }, about(id)),
  setRole: (id: string, userId: string, role: ProjectRole) => apiClient.patch(path(id, `/members/${encodeURIComponent(userId)}`), { role }, about(id)),
  removeMember: (id: string, userId: string) => apiClient.delete(path(id, `/members/${encodeURIComponent(userId)}`), undefined, about(id)),
  grants: (id: string, signal?: AbortSignal) => apiClient.get<{ items: ProjectGrant[] }>(path(id, "/grants"), { ...(about(id)), signal }),
  grantable: (id: string, signal?: AbortSignal) => apiClient.get<Grantable>(path(id, "/grantable"), { ...(about(id)), signal }),
  grant: (id: string, input: { resourceType: GrantType; resourceId: string; scope?: Record<string, string[]>; isDefault?: boolean }) => apiClient.put<ProjectGrant>(path(id, "/grants"), input, about(id)),
  revoke: (id: string, type: GrantType, resourceId: string) => apiClient.delete(path(id, `/grants/${type}/${encodeURIComponent(resourceId)}`), undefined, about(id)),
  apiKey: (id: string, signal?: AbortSignal) => apiClient.get<ProjectApiKeyStatus>(path(id, "/api-key"), { ...(about(id)), signal }),
  /** App admins only (SPEC-projects-04 FR-3). */
  setApiKey: (id: string, apiKey: string) => apiClient.put<ProjectApiKeyStatus>(path(id, "/api-key"), { apiKey }, about(id)),
  removeApiKey: (id: string) => apiClient.delete<ProjectApiKeyStatus>(path(id, "/api-key"), undefined, about(id)),
};

/** How each role reads, for selects and badges. */
export const ROLE_LABEL: Record<MyProject["role"], string> = { owner: "Owner", developer: "Developer", viewer: "Viewer", admin: "Admin", open: "View only" };
