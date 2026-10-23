import { apiClient } from "@/api/client";
import type { Role } from "@/auth/rbac";
import { ALL_PROJECTS, PROJECT_HEADER, type ProjectRole } from "@/api/projects";

/** A library connection as the admin console lists it. */
export interface LibraryConnection { id: string; name: string; provider: string; projectAdminsMayGrant?: boolean; enabled?: boolean }

export interface AdminUser {
  id: string;
  name: string;
  email?: string;
  role: Role;
  blocked: boolean;
  createdAt?: string | null;
  updatedAt?: string | null;
  updatedBy?: string | null;
  /** The projects they are in and their role there (SPEC-projects-03 FR-20). */
  projects?: Array<{ projectId: string; role: ProjectRole }>;
}

export interface RoleDefinition {
  id: Role;
  label: string;
  description: string;
}

const base = "/api/admin/rbac";

export const adminApi = {
  listUsers: (signal?: AbortSignal) => apiClient.get<{ items: AdminUser[] }>(`${base}/users`, { signal }).then((r) => r.items),
  upsertUser: (payload: Partial<AdminUser> & { id: string }) =>
    apiClient.post<AdminUser>(`${base}/users`, payload),
  setRole: (id: string, role: Role) =>
    apiClient.post<AdminUser>(`${base}/users/${encodeURIComponent(id)}/role`, { role }),
  block: (id: string, reason?: string) =>
    apiClient.post<AdminUser>(`${base}/users/${encodeURIComponent(id)}/block`, { reason }),
  unblock: (id: string) =>
    apiClient.post<AdminUser>(`${base}/users/${encodeURIComponent(id)}/unblock`),
  remove: (id: string) =>
    apiClient.delete<{ id: string; deleted: boolean }>(`${base}/users/${encodeURIComponent(id)}`),
  roles: (signal?: AbortSignal) => apiClient.get<{ items: RoleDefinition[] }>(`${base}/roles`, { signal }).then((r) => r.items),
  /** The whole connection library: an admin's every-project read of `/api/connections`. */
  connections: (signal?: AbortSignal) => apiClient.get<{ items: LibraryConnection[] }>("/api/connections", { ...({ headers: { [PROJECT_HEADER]: ALL_PROJECTS } }), signal }).then((r) => r.items),
  /** Whether project owners may grant a connection (FR-20). */
  setShareable: (id: string, projectAdminsMayGrant: boolean) => apiClient.patch<LibraryConnection>(`/api/connections/${encodeURIComponent(id)}`, { projectAdminsMayGrant }),
};
