import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { lazy, Suspense, useEffect } from "react";
import App from "@/App";
import { goTo, projectPath, useProjectSlug } from "@/lib/appRouterCore";
import { lastProject } from "@/lib/projectRoutes";
import { useMyProjects } from "@/lib/projectContext";

/**
 * SPEC-projects-03 FR-14: outside a project the app is Home, New project and the admin console; inside one (`/p/<id>/...`)
 * it is the whole app as before, under that project. Any other path is a link from before projects had URLs: it opens in
 * the project the person last used, or their first one.
 */
// Each is its own chunk, as the pages inside a project are, so opening one does not load the others.
const HomePage = lazy(() => import("@/features/home/HomePage").then(({ HomePage }) => ({ default: HomePage })));
const NewProjectPage = lazy(() => import("@/features/projects/NewProjectPage").then(({ NewProjectPage }) => ({ default: NewProjectPage })));
const AdminConsolePage = lazy(() => import("@/features/admin/AdminConsolePage").then(({ AdminConsolePage }) => ({ default: AdminConsolePage })));

export function Root() {
  const slug = useProjectSlug();
  if (slug) return <App />;
  return (
    <Suspense fallback={<Opening />}>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/new" element={<NewProjectPage />} />
        <Route path="/admin" element={<AdminConsolePage />} />
        <Route path="/admin/:tab" element={<AdminConsolePage />} />
        <Route path="*" element={<OldLink />} />
      </Routes>
    </Suspense>
  );
}

function Opening() {
  return <div role="status" className="min-h-screen bg-surface-base"><span className="sr-only">Opening</span></div>;
}

function OldLink() {
  const location = useLocation();
  const { data, isError } = useMyProjects();
  const usable = data?.items.filter((item) => item.role !== "open") ?? [];
  const saved = lastProject();
  const target = saved && data?.items.some((item) => item.id === saved) ? saved : usable[0]?.id ?? null;
  useEffect(() => {
    if (target) goTo(`${projectPath(target, location.pathname)}${location.search}${location.hash}`, { replace: true });
  }, [target, location.pathname, location.search, location.hash]);
  if (isError || (data && !target)) return <Navigate to="/" replace />;
  return <Opening />;
}
