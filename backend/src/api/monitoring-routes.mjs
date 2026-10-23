import { route, scoped } from '../lib/router.mjs';
import { forProject } from '../projects/project-bound.mjs';
import { effectiveAutomation } from '../monitoring/automation-settings.mjs';

// Automations and alerts (SPEC-automations-01 FR-37..FR-40) and "Refresh now" (SPEC-platform-10 FR-6). The settings themselves are
// saved through PUT /api/settings/automation and /api/settings/sync, which need project.settings (an owner).
const num = (value, fallback) => { const n = Number(value); return Number.isFinite(n) && n >= 0 ? n : fallback; };

export function monitoringRoutes({ monitoring, monitorStore, alerts, workspace }) {
  if (!monitoring || !monitorStore) return [];
  return scoped('project', [
    route('GET', '/api/automation', async ({ scope }) => {
      if (scope.all) return { config: null, status: null };
      const operations = await (await forProject(workspace, scope)).readOperations().catch(() => ({}));
      return { config: effectiveAutomation(operations), status: await monitoring.status(scope.projectId) };
    }),
    route('GET', '/api/alerts', async ({ url: { searchParams: q }, scope }) => monitorStore.listAlerts(scope.all ? scope.projectIds || null : [scope.projectId], { status: q.get('status') || undefined, trigger: q.get('trigger') || undefined, subjectId: q.get('subjectId') || undefined, taskId: q.get('taskId') || undefined, limit: Math.max(1, Math.min(200, num(q.get('limit'), 25))), offset: num(q.get('offset'), 0) })),
    // Any project member may ask for fresh data; the service allows one refresh per project every 30 seconds.
    route('POST', '/api/monitor/refresh', async ({ body, scope }) => { if (scope.all) return { skipped: 'Choose a project to refresh' }; const b = await body(); const sources = Array.isArray(b?.sources) ? b.sources.filter(item => ['pipelines', 'dataQuality'].includes(item)) : undefined; return { result: await monitoring.refresh(scope.projectId, sources?.length ? { sources } : {}), status: await monitoring.status(scope.projectId) }; }, '*'),
    route('POST', '/api/alerts/:id/resolve', async ({ params: { id }, user, scope }) => alerts.resolveById(scope.projectId, id, user), 'tickets.manage'),
  ]);
}
