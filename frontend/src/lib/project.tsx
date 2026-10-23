import { Fragment, useCallback, useEffect, useMemo, useRef, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { UNROUTED, onOtherProject, setCurrentProject } from "@/api/projects";
import { NoAccessPage } from "@/components/layout/NoProjectState";
import { appHistory, goTo, projectPath, projectSlugOf, useProjectSlug } from "@/lib/appRouterCore";
import { STORAGE_KEY, canOpen } from "@/lib/projectRoutes";
import { ProjectContext, useMyProjects, type ProjectContextValue } from "@/lib/projectContext";
import { ProjectChangeFeed } from "@/lib/ProjectChangeFeed";

/**
 * SPEC-projects-03 FR-14: the project comes from the URL. The provider sets the project header before anything under it
 * fetches, remounts the app when the project changes so nothing from the last one lingers, and turns away a project the
 * person cannot open. Outside a project (home, the admin console) it provides "no project".
 */
export function ProjectProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const slug = useProjectSlug();
  const { data, isLoading, isError } = useMyProjects();
  const projectId = slug;
  // The header must be right before the first request under this project goes out, so it is set during render.
  setCurrentProject(projectId);

  const previous = useRef(projectId);
  useEffect(() => {
    // Drop the old project's cache (its keys carry its id first, see projectQueryKeyHash); the new project's queries,
    // already started by the remounted children, stay.
    const old = previous.current;
    if (old && old !== projectId) queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== "auth" && query.queryHash.startsWith(`[${JSON.stringify(old)},`) });
    previous.current = projectId;
    if (slug && slug !== UNROUTED) { try { localStorage.setItem(STORAGE_KEY, slug); } catch { /* ignore storage failures */ } }
  }, [projectId, slug, queryClient]);

  // Switching keeps the page you are on (its first segment): Tickets in one project opens Tickets in the next.
  const setProject = useCallback((id: string) => {
    const local = appHistory.location.pathname;
    const inProject = projectSlugOf(local);
    const rest = inProject ? local.slice(local.indexOf(projectPath(inProject)) + projectPath(inProject).length) : "";
    const section = rest.split("/").filter(Boolean)[0];
    goTo(projectPath(id, section ? `/${section}` : ""));
  }, []);

  // FR-14 of SPEC-projects-01: a link into another of the person's projects switches to it.
  useEffect(() => onOtherProject((id) => { if (data?.items.some((item) => item.id === id && item.role !== "open")) setProject(id); }), [data, setProject]);

  const value = useMemo<ProjectContextValue>(() => {
    const project = data?.items.find((item) => item.id === projectId) ?? null;
    return {
      projectId,
      slug,
      project,
      projects: data?.items ?? [],
      isGlobalAdmin: Boolean(data?.all),
      unrouted: data?.unrouted ?? 0,
      visitor: project?.role === "open",
      setProject,
    };
  }, [data, projectId, slug, setProject]);

  if (!slug) return <ProjectContext.Provider value={value}><ProjectChangeFeed>{children}</ProjectChangeFeed></ProjectContext.Provider>;
  if (isLoading) return <div role="status" className="flex min-h-screen items-center justify-center bg-canvas"><span className="sr-only">Loading</span></div>;
  // The projects call failing (an older backend, a network blip) must not lock anyone out of a project URL they hold.
  if (!isError && !canOpen(slug, data)) return <NoAccessPage />;
  return <ProjectContext.Provider value={value}><ProjectChangeFeed><Fragment key={projectId ?? "none"}>{children}</Fragment></ProjectChangeFeed></ProjectContext.Provider>;
}
