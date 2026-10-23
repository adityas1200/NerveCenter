import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { apiClient } from "@/api/client";
import { takePlatformMe } from "@/auth-session";
import type { MeAccess } from "@/api/projects";
import { useProject } from "@/lib/projectContext";
import { FRESH } from "@/api/queryPolicy";
import { queryKeys } from "@/api/queryKeys";

export type Role = "admin" | "developer" | "viewer";

export type Permission =
  | "users.manage"
  | "roles.manage"
  | "security.manage"
  | "secrets.manage"
  | "connections.manage"
  | "settings.platform.manage"
  | "logs.view"
  | "projects.create"
  | "tickets.manage"
  | "tasks.manage"
  | "approvals.decide"
  | "routines.manage"
  | "boards.manage"
  | "skills.manage"
  | "knowledge.manage"
  | "connectors.use"
  | "project.settings"
  | "project.members"
  | "project.grants"
  | "knowledge.review"

export interface MeResponse {
  user: { id: string; name: string; email?: string; groups?: string[]; roles?: string[] };
  /** Inside a project, the role the project role works as (owner and developer: developer); elsewhere the app role. */
  role: Role;
  permissions: Permission[];
  /** The app role: admin, developer (may create projects) or viewer. */
  appRole?: Role;
  /** The role in the open project: owner, developer, viewer, admin (an app admin) or open (a visitor). */
  projectRole?: MeAccess["projectRole"];
}

const rbacQueryKey = ["auth", "me"] as const;

/**
 * Who the signed-in person is. Inside a project (SPEC-projects-03 FR-6) the role and permissions are the ones they hold
 * there, from `/api/me/access`, so every "can I" check in the app reads the project role; outside one they are the app's.
 */
export function useMe(): UseQueryResult<MeResponse> {
  // Under platform auth the sign-in check already fetched /api/me; start from that answer rather than asking twice.
  const app = useQuery<MeResponse>({ queryKey: rbacQueryKey, queryFn: ({ signal }) => apiClient.get<MeResponse>("/api/me", { signal }), initialData: () => takePlatformMe() as MeResponse | undefined, staleTime: FRESH.session, retry: false });
  const { projectId } = useProject();
  // Not an `auth` key: the project prefixes it, so each project keeps its own answer.
  const access = useQuery<MeAccess>({ queryKey: queryKeys.access, queryFn: ({ signal }) => apiClient.get<MeAccess>("/api/me/access", { signal }), enabled: Boolean(app.data && projectId), staleTime: FRESH.long, retry: false });
  if (!projectId || !app.data || access.isError) return app.data ? { ...app, data: { ...app.data, appRole: app.data.role } } as UseQueryResult<MeResponse> : app;
  if (!access.data) return { ...app, data: undefined, isLoading: true, isPending: true, isSuccess: false, status: "pending" } as UseQueryResult<MeResponse>;
  const data: MeResponse = { ...app.data, appRole: app.data.role, role: access.data.role as Role, permissions: access.data.permissions as Permission[], projectRole: access.data.projectRole };
  return { ...app, data } as UseQueryResult<MeResponse>;
}

/** An app admin. */
export function useIsAdmin(): boolean {
  const data = useMe().data;
  return (data?.appRole ?? data?.role) === "admin";
}

/** Whether the person holds `permission` where they are: in the open project, or in the app outside one. */
export function useCan(permission: Permission): boolean {
  const data = useMe().data;
  // An app admin holds every permission, in every project.
  return data?.role === "admin" || Boolean(data?.permissions?.includes(permission));
}
