import { createContext, useContext } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/api/client";
import type { MyProject, MyProjectsResponse } from "@/api/projects";
import { FRESH } from "@/api/queryPolicy";

export const myProjectsKey = ["auth", "projects"] as const;

export interface ProjectContextValue {
  /** The project id or `unrouted`; null outside a project (home, the admin console). */
  projectId: string | null;
  /** The project in the URL; null outside a project. */
  slug: string | null;
  project: MyProject | null;
  projects: MyProject[];
  /** A global admin: may open Unrouted. */
  isGlobalAdmin: boolean;
  unrouted: number;
  /** Visiting an open project you are not in: view only (SPEC-projects-03 FR-12). */
  visitor: boolean;
  setProject: (id: string) => void;
}

export const ProjectContext = createContext<ProjectContextValue | null>(null);

export function useMyProjects() {
  return useQuery<MyProjectsResponse>({ queryKey: myProjectsKey, queryFn: ({ signal }) => apiClient.get<MyProjectsResponse>("/api/me/projects", { signal }), staleTime: FRESH.long, retry: false });
}

const outside: ProjectContextValue = { projectId: null, slug: null, project: null, projects: [], isGlobalAdmin: false, unrouted: 0, visitor: false, setProject: () => {} };

/** The current project. Outside the provider (unit tests of one component) it reads as no project. */
export function useProject(): ProjectContextValue {
  return useContext(ProjectContext) ?? outside;
}
