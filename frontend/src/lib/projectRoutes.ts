import { UNROUTED, type MyProjectsResponse } from "@/api/projects";

// Which project a URL names and whether this person may open it (SPEC-projects-03 FR-14). Used by ProjectProvider and Root.
export const STORAGE_KEY = "nc-project";

/** The project a person last worked in, for old links without one (SPEC-projects-03 FR-14). */
export function lastProject(): string | null {
  try { return localStorage.getItem(STORAGE_KEY); } catch { return null; }
}

/** Whether `slug` names a project this person may open: theirs, an open one, or for an app admin any one plus Unrouted. */
export function canOpen(slug: string, data: MyProjectsResponse | undefined): boolean {
  if (!data) return false;
  if (data.all && slug === UNROUTED) return true;
  return data.items.some((item) => item.id === slug);
}

