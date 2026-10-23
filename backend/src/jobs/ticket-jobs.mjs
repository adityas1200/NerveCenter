import { resolveAutomaticSyncSettings } from '../sync/sync-settings.mjs';
import { errorText } from '../lib/errors.mjs';

const activeProject = project => project.kind === 'normal' && !project.archivedAt;

/** Durable ticket provider imports. Execution delegates only to importProject, which never starts Sonic. */
export function ticketJobSource({ store, ticketTasks, projects, workspaces, fallbackSeconds = 15, isAppActive = () => true, clock = () => Date.now(), log = console }) {
  return {
    maxAttempts: 3,
    async dueJobs({ at = clock() } = {}) {
      if (!isAppActive()) return [];
      const nowMs = at instanceof Date ? at.getTime() : Number(at);
      const due = [];
      for (const project of await projects.list()) {
        if (!activeProject(project)) continue;
        try {
          const workspace = await workspaces.for(project.id);
          const operations = await workspace.readOperations();
          if (operations?.sync?.enabled === false) continue;
          const intervalSeconds = resolveAutomaticSyncSettings(operations, fallbackSeconds, 'tickets').intervalSeconds;
          const latest = await store.latest(project.id, 'tickets');
          if (latest && ['queued', 'running'].includes(latest.state)) continue;
          const lastAt = latest ? Math.max(Date.parse(latest.dueAt), latest.finishedAt ? Date.parse(latest.finishedAt) : 0) : null;
          if (lastAt !== null && Number.isFinite(lastAt) && nowMs - lastAt < intervalSeconds * 1000) continue;
          due.push({ projectId: project.id, slot: String(latest ? Number(latest.slot) + 1 : 1), dueAt: new Date(nowMs).toISOString() });
        } catch (error) {
          log.error?.(`[scheduled-jobs] ticket due check failed for ${project.id}: ${errorText(error)}`);
        }
      }
      return due;
    },
    async execute(job) {
      const workspace = await workspaces.for(job.projectId);
      return ticketTasks.importProject(job.projectId, workspace);
    },
  };
}
