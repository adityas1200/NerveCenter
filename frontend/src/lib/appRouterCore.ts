import { createContext, useContext } from "react";
import { UNSAFE_createBrowserHistory } from "react-router-dom";

/**
 * SPEC-projects-03 FR-14: the URL decides the project. `/p/<project>/...` is the app inside one project, and everything
 * else (`/` home, `/new`, `/admin`) is outside any project. Inside a project the router's basename becomes
 * `<base>/p/<project>`, so the app's own links (`/tickets`, `/boards/b-1`) stay as they are and land in the project.
 * Leaving the project (home, another project, the admin console) goes through `goTo`, which moves the browser history
 * itself; the basename follows the new address. `AppRouter` (appRouter.tsx) renders the router.
 */

export const appHistory = UNSAFE_createBrowserHistory({ v5Compat: true });
/** The deployment's path prefix (Vite `base`), without a trailing slash. */
export const APP_BASE = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

/** The project segment of a browser path, or null outside any project. */
export function projectSlugOf(pathname: string): string | null {
  const local = APP_BASE && pathname.startsWith(APP_BASE) ? pathname.slice(APP_BASE.length) : pathname;
  const match = /^\/p\/([a-z0-9][a-z0-9-]{1,31})(?:\/|$)/.exec(local);
  return match ? match[1] : null;
}

/** The path a project page lives at, for `goTo` or a plain anchor. `rest` starts with a slash. */
export const projectPath = (slug: string, rest = "") => `/p/${slug}${rest === "/" ? "" : rest}`;

/** Moves to a path outside the current project's basename (home, admin, another project). */
export function goTo(path: string, { replace = false } = {}) {
  const href = `${APP_BASE}${path.startsWith("/") ? path : `/${path}`}`;
  if (replace) appHistory.replace(href); else appHistory.push(href);
}

export const SlugContext = createContext<string | null>(null);
/** The project in the URL, or null outside one. */
export const useProjectSlug = () => useContext(SlugContext);
