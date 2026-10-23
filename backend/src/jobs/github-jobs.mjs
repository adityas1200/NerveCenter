import { resolveAutomaticSyncSettings } from '../sync/sync-settings.mjs';
import { errorText } from '../lib/errors.mjs';

// The slot follows the preceding persisted job, rather than a wall-clock bucket. Two schedulers
// that observe the same latest row therefore submit the same unique key, even at a time boundary.
export function githubJobSource({ store, integrationSync, projects, workspaces, isAppActive = () => true, clock = () => Date.now(), log = console }) {
  return {
    maxAttempts: 3,
    async dueJobs({ at = clock() } = {}) {
      if (!isAppActive()) return [];
      const nowMs = at instanceof Date ? at.getTime() : Number(at);
      const due = [];
      for (const project of await projects.list()) {
        if (project.kind !== 'normal' || project.archivedAt) continue;
        try {
          const operations = await (await workspaces.for(project.id)).readOperations();
          if (operations?.sync?.enabled === false) continue;
          if (String(operations?.source_control?.platform || '').toLowerCase() !== 'github' || !String(operations?.source_control?.repository || '').trim()) continue;
          const seconds = resolveAutomaticSyncSettings(operations, integrationSync.githubSeconds, 'github').intervalSeconds;
          const latest = await store.latest(project.id, 'github');
          if (latest && ['queued', 'running'].includes(latest.state)) continue;
          const lastAt = latest ? Math.max(new Date(latest.dueAt).getTime(), latest.finishedAt ? new Date(latest.finishedAt).getTime() : 0) : null;
          if (lastAt !== null && Number.isFinite(lastAt) && nowMs - lastAt < seconds * 1000) continue;
          due.push({ projectId: project.id, slot: String(latest ? Number(latest.slot) + 1 : 1), dueAt: new Date(nowMs).toISOString() });
        } catch (error) { log.error?.(`[scheduled-jobs] GitHub due check failed for ${project.id}: ${errorText(error)}`); }
      }
      return due;
    },
    execute: job => integrationSync.runGithub(job.projectId),
  };
}
