import { ENV_DEFAULTS_FILE, applyEnvDefaults } from './env-defaults.mjs';
import { hydrateFromAwsSecrets } from './runtime-env.mjs';
import { errorText } from './lib/errors.mjs';
// Order matters: the platform's env wins, then the tracked .env.defaults, then Secrets Manager fills what is left.
{ const applied = applyEnvDefaults(); if (applied.length) console.log(`[env-defaults] applied ${applied.length} defaults from ${ENV_DEFAULTS_FILE}`); }
await hydrateFromAwsSecrets();
const { config, WORKSPACE_DIR } = await import('./config.mjs');
const { createWorkspaceSync } = await import('./workspace/workspace-sync.mjs');
const { ScheduledJobDispatcher } = await import('./jobs/scheduler.mjs');
const { githubJobSource } = await import('./jobs/github-jobs.mjs');
const { knowledgeJobSource } = await import('./jobs/knowledge-jobs.mjs');
const { routineJobSource } = await import('./jobs/routine-jobs.mjs');
const { monitoringJobSources } = await import('./jobs/monitoring-jobs.mjs');
const { ticketJobSource } = await import('./jobs/ticket-jobs.mjs');
const { migrateWorkspaceLayout } = await import('./projects/project-migration.mjs');

// FR-42: a workspace folder from before projects becomes projects/pilot/ plus the shared library, before the restore below
// decides what is missing and before any job starts.
await migrateWorkspaceLayout();

// Deployed instances keep the agent workspace in S3 or a volume: restore it (each project, the library, and a bucket
// written before projects into PILOT) before anything seeds a fresh one.
const workspaceSync = createWorkspaceSync({ dir: WORKSPACE_DIR });
if (workspaceSync) {
  try { const result = await workspaceSync.restore(); console.log(`[workspace-sync] ${result.restored ? `restored ${result.restored} files` : (result as typeof result & { skipped: string }).skipped}`); }
  catch (error) { console.error('[workspace-sync] restore failed, continuing with the local workspace:', (error as Error).message); }
}

const { createBackend } = await import('./bootstrap.mjs');
const { createApiServer } = await import('./api/server.mjs');

const backend = await createBackend();
// Not just an S3-restore concern: any Git base can lose its .git (volume swap, manual edit, etc), so this always runs.
{
  let reconciled = 0;
  for (const project of await backend.projectStore.list()) {
    if (project.kind !== 'normal') continue;
    const done = await (await backend.knowledge.for(project.id)).reconcileGitBases().catch((error: unknown) => { console.error(`[knowledge] git base reconcile failed for ${project.id}:`, (error as Error).message); return { reconciled: 0 }; });
    reconciled += done.reconciled;
  }
  if (reconciled) console.log(`[knowledge] re-cloned ${reconciled} git knowledge base${reconciled === 1 ? '' : 's'} restored without .git`);
}
// OPS_RECOVER_ON_BOOT=0 for a read-mostly stack sharing its schema with another backend: recovery would take over that backend's in-flight tasks.
const recovered = process.env.OPS_RECOVER_ON_BOOT !== '0' ? await backend.runtime.recoverAfterRestart() : { failed: [], requeued: [], resumed: [] };
if (recovered.failed.length || recovered.requeued.length || recovered.resumed.length) console.log(`[tasks] after restart: ${recovered.resumed.length} resumed (${recovered.resumed.join(', ')}), ${recovered.requeued.length} queued again (${recovered.requeued.join(', ')}), ${recovered.failed.length} closed (${recovered.failed.join(', ')})`);
const server = createApiServer(backend);
if (process.env.OPS_RECOVER_ON_BOOT !== '0') backend.ticketTasks.backfillReports().then(({ updated }) => { if (updated) console.log(`[ticket-tasks] mirrored reports onto ${updated} tickets`); }).catch((error: unknown) => console.error('[ticket-tasks] report backfill failed', error));
if (process.env.OPS_TICKET_POLLING !== '0') backend.ticketTasks.start();
const jobs = new ScheduledJobDispatcher({ store: backend.jobStore } as unknown as ConstructorParameters<typeof ScheduledJobDispatcher>[0]);
jobs.registerSource('monitoring:manual', {
  dueJobs: async () => [], maxAttempts: 1,
  execute: async (job: { projectId: string; payload?: { source?: string } }) => backend.monitoring.fetchScheduledSource(job.projectId, job.payload?.source, { force: true }),
} as unknown as Parameters<typeof jobs.registerSource>[1]);
backend.monitoring.setManualFetch(async (projectId: string, source: string) => {
  const job = await jobs.runNow({ source: 'monitoring:manual', projectId, payload: { source, force: true } } as unknown as Parameters<typeof jobs.runNow>[0]);
  if (job.state === 'succeeded') return job.result;
  if (job.state === 'skipped') return { skipped: job.error || 'The source is not eligible' };
  return { error: job.error || 'The source could not be refreshed' };
});
let jobsTimer: ReturnType<typeof setInterval> | null = null;
let jobsCleanupTimer: ReturnType<typeof setInterval> | null = null;
let jobsInitialTimer: ReturnType<typeof setTimeout> | null = null;
if (process.env.OPS_INTEGRATION_SYNC !== '0' || process.env.OPS_ROUTINES !== '0' || process.env.OPS_MONITORING !== '0' || process.env.OPS_TICKET_POLLING !== '0') {
  if (process.env.OPS_INTEGRATION_SYNC !== '0') {
    jobs.registerSource('github', githubJobSource({ store: backend.jobStore, integrationSync: backend.integrationSync, projects: backend.projectStore, workspaces: backend.workspace, isAppActive: () => backend.presence.isActive() }));
    jobs.registerSource('knowledge', knowledgeJobSource({ store: backend.jobStore, integrationSync: backend.integrationSync, projects: backend.projectStore, workspaces: backend.workspace, isAppActive: () => backend.presence.isActive() }));
  }
  if (process.env.OPS_ROUTINES !== '0') jobs.registerSource('routine', routineJobSource({ routines: backend.routines, store: backend.jobStore }));
  if (process.env.OPS_MONITORING !== '0') for (const [name, handler] of Object.entries(monitoringJobSources({ store: backend.jobStore, monitoring: backend.monitoring, dataQualityService: backend.dataQualityService, projects: backend.projectStore, workspaces: backend.workspace, isAppActive: () => backend.presence.isActive() }))) jobs.registerSource(name, handler);
  if (process.env.OPS_TICKET_POLLING !== '0') jobs.registerSource('tickets', ticketJobSource({ store: backend.jobStore, ticketTasks: backend.ticketTasks, projects: backend.projectStore, workspaces: backend.workspace, fallbackSeconds: backend.ticketTasks.pollSeconds, isAppActive: () => backend.presence.isActive() }));
  const tickJobs = () => jobs.tick().catch((error: Error) => console.error('[jobs] tick failed:', errorText(error)));
  jobsTimer = setInterval(tickJobs, Math.max(1, Number(process.env.OPS_INTEGRATION_CHECK_SECONDS || 5)) * 1000);
  jobsTimer.unref?.();
  jobsInitialTimer = setTimeout(tickJobs, 5000);
  jobsInitialTimer.unref?.();
  jobsCleanupTimer = setInterval(() => jobs.cleanup().catch((error: Error) => console.error('[jobs] cleanup failed:', errorText(error))), 60_000);
  jobsCleanupTimer.unref?.();
}
// The background fetch and the auto-investigation detector (SPEC-platform-10, SPEC-automations-01).
if (process.env.OPS_MONITORING !== '0') backend.monitoring.start();
if (workspaceSync) workspaceSync.start();
server.listen(config.port, config.host, () => console.log(`NerveCenter backend listening on http://${config.host}:${config.port} (identity=${config.identityMode}, store=${config.metadataStore}, workspace=${WORKSPACE_DIR}${workspaceSync ? `, synced to ${workspaceSync.location}` : ''})`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { if (jobsTimer) clearInterval(jobsTimer); if (jobsInitialTimer) clearTimeout(jobsInitialTimer); if (jobsCleanupTimer) clearInterval(jobsCleanupTimer); backend.ticketTasks.stop(); backend.integrationSync.stop(); backend.routines.stop(); backend.monitoring.stop(); if (workspaceSync) await workspaceSync.stop(); server.close(() => process.exit(0)); });
