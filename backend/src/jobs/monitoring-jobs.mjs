import { automationActive, effectiveAutomation, fetchSeconds } from '../monitoring/automation-settings.mjs';
import { errorText } from '../lib/errors.mjs';
import { forProject } from '../projects/project-bound.mjs';

const activeProject = project => project.kind === 'normal' && !project.archivedAt;
const jobSource = source => `monitoring:${source}`;

/** Register separate retryable fetch sources so pipeline and shared DQ cadences stay independent. */
export function monitoringJobSource({ store, monitoring, dataQualityService, projects, workspaces, source, isAppActive = () => true, clock = () => Date.now(), log = console }) {
  if (!['pipelines', 'dataQuality'].includes(source)) throw new TypeError('A monitoring job source must be pipelines or dataQuality');
  return {
      name: jobSource(source),
      maxAttempts: 3,
      async dueJobs({ at = clock() } = {}) {
        if (!isAppActive()) {
          // Projects with active automations remain monitored while the app is idle.
          const candidates = [];
          for (const project of await projects.list()) {
            if (!activeProject(project)) continue;
            try {
              const operations = await (await workspaces.for(project.id)).readOperations();
              if (operations?.sync?.enabled === false || !automationActive(effectiveAutomation(operations))) continue;
              candidates.push({ project, operations });
            } catch (error) { log.error?.(`[scheduled-jobs] monitoring due check failed for ${project.id}: ${errorText(error)}`); }
          }
          return dueFor(candidates, source, { store, dataQualityService, clock, at, log });
        }
        const candidates = [];
        for (const project of await projects.list()) {
          if (!activeProject(project)) continue;
          try {
            const operations = await (await workspaces.for(project.id)).readOperations();
            if (operations?.sync?.enabled === false) continue;
            candidates.push({ project, operations });
          } catch (error) { log.error?.(`[scheduled-jobs] monitoring due check failed for ${project.id}: ${errorText(error)}`); }
        }
        return dueFor(candidates, source, { store, dataQualityService, clock, at, log });
      },
      async execute(job) {
        const projectId = job.projectId;
        const operations = await (await workspaces.for(projectId)).readOperations().catch(() => ({}));
        if (!job.payload?.force && operations?.sync?.enabled === false) return { skipped: 'auto sync disabled' };
        if (!job.payload?.force && !isAppActive() && !automationActive(effectiveAutomation(operations))) return { skipped: 'app inactive' };
        return monitoring.fetchScheduledSource(projectId, job.payload?.source || source, { force: Boolean(job.payload?.force) });
      },
    };
}

export function monitoringJobSources(options) {
  return Object.fromEntries(['pipelines', 'dataQuality'].map(source => {
    const handler = monitoringJobSource({ ...options, source });
    return [handler.name, handler];
  }));
}

async function dueFor(candidates, source, { store, dataQualityService, clock, at, log }) {
  const nowMs = at instanceof Date ? at.getTime() : Number(at);
  const due = [];
  for (const { project, operations } of candidates) {
    try {
      if (source === 'dataQuality') {
        if (!dataQualityService) continue;
        const dq = await forProject(dataQualityService, project.id).catch(() => null);
        if (!dq || dq.ledgerProjectId !== project.id) continue;
      }
      const latest = await store.latest(project.id, jobSource(source));
      if (latest && ['queued', 'running'].includes(latest.state)) continue;
      const lastAt = latest ? Math.max(Date.parse(latest.dueAt), latest.finishedAt ? Date.parse(latest.finishedAt) : 0) : null;
      if (lastAt !== null && Number.isFinite(lastAt) && nowMs - lastAt < fetchSeconds(operations, source) * 1000) continue;
      due.push({ projectId: project.id, slot: String(latest ? Number(latest.slot) + 1 : 1), dueAt: new Date(nowMs).toISOString() });
    } catch (error) { log.error?.(`[scheduled-jobs] monitoring due check failed for ${project.id}/${source}: ${errorText(error)}`); }
  }
  return due;
}
