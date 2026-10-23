import { resolveAutomaticSyncSettings } from '../sync/sync-settings.mjs';
import { errorText } from '../lib/errors.mjs';

const activeProject = project => project.kind === 'normal' && !project.archivedAt;

/** Durable scheduled jobs for private Git bases and shared library bases. */
export function knowledgeJobSource({ store, integrationSync, projects, workspaces, isAppActive = () => true, clock = () => Date.now(), log = console }) {
  return {
    maxAttempts: 3,
    async dueJobs({ at = clock() } = {}) {
      if (!isAppActive()) return [];
      const nowMs = at instanceof Date ? at.getTime() : Number(at);
      const candidates = new Map();
      for (const project of await projects.list()) {
        if (!activeProject(project)) continue;
        try {
          const workspace = await workspaces.for(project.id);
          const operations = await workspace.readOperations();
          if (operations?.sync?.enabled === false) continue;
          const intervalSeconds = resolveAutomaticSyncSettings(operations, integrationSync.knowledgeSeconds, 'knowledge').intervalSeconds;
          const service = await integrationSync.knowledge.for(project.id);
          const bases = (await service.list()).items || [];
          for (const base of bases) {
            if (base.kind !== 'git') continue;
            const shared = Boolean(base.shared);
            const projectId = shared ? `library:${base.name}` : project.id;
            const key = shared ? projectId : `project:${project.id}`;
            const prior = candidates.get(key);
            if (prior) {
              if (shared && prior.intervalSeconds > intervalSeconds) prior.intervalSeconds = intervalSeconds;
              if (!shared) prior.bases.push(base.name);
              continue;
            }
            candidates.set(key, { projectId, slotProjectId: projectId, grantProjectId: project.id, bases: [base.name], shared, intervalSeconds });
          }
        } catch (error) {
          log.error?.(`[scheduled-jobs] knowledge due check failed for ${project.id}: ${errorText(error)}`);
        }
      }

      const due = [];
      for (const candidate of candidates.values()) {
        try {
          const latest = await store.latest(candidate.slotProjectId, 'knowledge');
          if (latest && ['queued', 'running'].includes(latest.state)) continue;
          const lastAt = latest ? Math.max(Date.parse(latest.dueAt), latest.finishedAt ? Date.parse(latest.finishedAt) : 0) : null;
          if (lastAt !== null && Number.isFinite(lastAt) && nowMs - lastAt < candidate.intervalSeconds * 1000) continue;
          due.push({
            projectId: candidate.projectId,
            slot: String(latest ? Number(latest.slot) + 1 : 1),
            dueAt: new Date(nowMs).toISOString(),
            payload: { bases: candidate.bases, shared: candidate.shared, grantProjectId: candidate.grantProjectId },
          });
        } catch (error) {
          log.error?.(`[scheduled-jobs] knowledge due check failed for ${candidate.projectId}: ${errorText(error)}`);
        }
      }
      return due;
    },
    async execute(job) {
      if (job.payload?.shared) return integrationSync.runKnowledge(job.payload.grantProjectId, job.payload.bases?.[0], { shared: true });
      const results = {};
      const failures = [];
      for (const base of job.payload?.bases || []) {
        try { results[base] = await integrationSync.runKnowledge(job.projectId, base); }
        catch (error) { failures.push(`${base}: ${errorText(error)}`); }
      }
      if (failures.length) throw new Error(`Knowledge sync failed for ${failures.join('; ')}`);
      return results;
    },
  };
}
