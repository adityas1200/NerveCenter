import { lazy, Suspense, type ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
import { NotFoundPage } from "@/components/layout/NotFoundPage";
import { useSectionEnabled } from "@/lib/appSections";

/** A section switched off in Settings → Workspace → Sections is not just hidden from the sidebar -
 * it is blocked here too, the same way a non-admin is sent away from an admin-only page. */
function SectionRoute({ section, children }: { section: string; children: ReactNode }) {
  const enabled = useSectionEnabled(section);
  if (!enabled) return <Navigate to="/" replace />;
  return <>{children}</>;
}

const OverviewPage = lazy(() => import("@/features/overview/OverviewPage").then(({ OverviewPage }) => ({ default: OverviewPage })));
const BoardsPage = lazy(() => import("@/features/boards/BoardsPage").then(({ BoardsPage }) => ({ default: BoardsPage })));
const BoardPage = lazy(() => import("@/features/boards/BoardPage").then(({ BoardPage }) => ({ default: BoardPage })));
const MonitorPage = lazy(() => import("@/features/monitor/MonitorPage").then(({ MonitorPage }) => ({ default: MonitorPage })));
const DataQualityPage = lazy(() => import("@/features/data-quality/DataQualityPage").then(({ DataQualityPage }) => ({ default: DataQualityPage })));
const TicketsPage = lazy(() => import("@/features/tickets/TicketsPage").then(({ TicketsPage }) => ({ default: TicketsPage })));
const TasksPage = lazy(() => import("@/features/tasks/TasksPage").then(({ TasksPage }) => ({ default: TasksPage })));
const NewTaskPage = lazy(() => import("@/features/tasks/NewTaskPage").then(({ NewTaskPage }) => ({ default: NewTaskPage })));
const TaskPage = lazy(() => import("@/features/tasks/TaskPage").then(({ TaskPage }) => ({ default: TaskPage })));
const InboxPage = lazy(() => import("@/features/inbox/InboxPage").then(({ InboxPage }) => ({ default: InboxPage })));
const RoutinesPage = lazy(() => import("@/features/routines/RoutinesPage").then(({ RoutinesPage }) => ({ default: RoutinesPage })));
const RoutineDetailPage = lazy(() => import("@/features/routines/RoutineDetailPage").then(({ RoutineDetailPage }) => ({ default: RoutineDetailPage })));
const ConnectorsPage = lazy(() => import("@/features/connectors/ConnectorsPage").then(({ ConnectorsPage }) => ({ default: ConnectorsPage })));
const SkillsPage = lazy(() => import("@/features/skills/SkillsPage").then(({ SkillsPage }) => ({ default: SkillsPage })));
const KnowledgePage = lazy(() => import("@/features/knowledge/KnowledgePage").then(({ KnowledgePage }) => ({ default: KnowledgePage })));
const SettingsPage = lazy(() => import("@/features/settings/SettingsPage").then(({ SettingsPage }) => ({ default: SettingsPage })));

function Loading() {
  return <div role="status" aria-label="Loading page" className="rounded-2xl border border-line bg-raised p-6"><div className="h-5 w-40 animate-pulse rounded bg-ink-1/10" /></div>;
}

export default function App() {
  return (
    <AppShell>
      <Suspense fallback={<Loading />}><Routes>
        <Route path="/" element={<OverviewPage />} />
        <Route path="/boards" element={<SectionRoute section="boards"><BoardsPage /></SectionRoute>} />
        <Route path="/boards/:boardId" element={<SectionRoute section="boards"><BoardPage /></SectionRoute>} />
        <Route path="/monitor" element={<SectionRoute section="pipelines"><MonitorPage /></SectionRoute>} />
        <Route path="/data-quality" element={<SectionRoute section="data-quality"><DataQualityPage /></SectionRoute>} />
        <Route path="/tickets" element={<TicketsPage />} />
        <Route path="/tickets/:ticketId" element={<TicketsPage />} />
        <Route path="/tasks" element={<TasksPage />} />
        <Route path="/tasks/new" element={<NewTaskPage />} />
        <Route path="/tasks/:taskId" element={<TaskPage />} />
        <Route path="/inbox" element={<InboxPage />} />
        <Route path="/routines" element={<SectionRoute section="routines"><RoutinesPage /></SectionRoute>} />
        <Route path="/routines/:name" element={<SectionRoute section="routines"><RoutineDetailPage /></SectionRoute>} />
        <Route path="/approvals" element={<Navigate to="/inbox" replace />} />
        <Route path="/skills" element={<SectionRoute section="skills"><SkillsPage /></SectionRoute>} />
        <Route path="/skills/:skillId" element={<SectionRoute section="skills"><SkillsPage /></SectionRoute>} />
        <Route path="/knowledge" element={<SectionRoute section="knowledge"><KnowledgePage /></SectionRoute>} />
        <Route path="/knowledge/:name" element={<SectionRoute section="knowledge"><KnowledgePage /></SectionRoute>} />
        <Route path="/connectors" element={<ConnectorsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/data-platform" element={<Navigate to="/monitor" replace />} />
        <Route path="/admin" element={<Navigate to="/settings" replace />} />
        <Route path="/workbench" element={<Navigate to="/tickets" replace />} />
        <Route path="/workbench/:ticketId" element={<LegacyTicketRedirect />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes></Suspense>
    </AppShell>
  );
}

function LegacyTicketRedirect() {
  const ticketId = window.location.pathname.split("/").filter(Boolean)[1];
  return <Navigate to={ticketId ? `/tickets/${ticketId}` : "/tickets"} replace />;
}
