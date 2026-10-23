import { config } from './config.mjs';
import { trustSystemCertificates } from './lib/tls.mjs';
import { createSecretStore } from './secrets/secret-store.mjs';
import { createConnectionProfileStore } from './connections/connection-profile-store.mjs';
import { ConnectionService } from './connections/connection-service.mjs';
import { DataPlatformCatalog } from './platform/data-platform-catalog.mjs';
import { DataQualityService } from './data-quality/data-quality-service.mjs';
import { ServiceNowService } from './connectors/servicenow/servicenow-service.mjs';
import { JiraService } from './connectors/jira/jira-service.mjs';
import { Connectors, connectorSecretNames } from './connectors/connector-service.mjs';
import { createOperationsStore } from './app/operations-store.mjs';
import { OperationsService } from './app/operations-service.mjs';
import { createRbacStore, setRbacStore } from './app/rbac-store.mjs';
import { ensureControlSchema } from './storage/postgres.mjs';
import { WorkspaceRegistry } from './workspace/workspace.mjs';
import { createTaskStore } from './tasks/task-store.mjs';
import { AGENT_NAME, TaskRuntime } from './tasks/task-runtime.mjs';
import { createAppTools } from './tasks/nervecenter-tools.mjs';
import { BoardService } from './boards/board-service.mjs';
import { FixService } from './tasks/fix-service.mjs';
import { TicketTaskService } from './tasks/ticket-tasks.mjs';
import { Routines } from './routines/routine-scheduler.mjs';
import { SkillService } from './skills/skill-service.mjs';
import { TemplateService } from './documents/template-service.mjs';
import { KnowledgeService } from './knowledge/knowledge-service.mjs';
import { IntegrationSyncService } from './sync/integration-sync.mjs';
import { AppPresence } from './app/app-presence.mjs';
import { applyFileMigrations } from './storage/file-migrations.mjs';
import { createProjectStore, PILOT_ID } from './projects/project-store.mjs';
import { PerProject } from './projects/project-bound.mjs';
import { GrantService } from './projects/grant-service.mjs';
import { projectRoleOf } from './projects/project-access.mjs';
import { setProjectRoleResolver } from './tasks/agent-access.mjs';
import { migrateConnectorSecretRefs, migrateWorkspaceLayout } from './projects/project-migration.mjs';
import { ProjectApiKeys } from './projects/project-api-keys.mjs';
import { createMonitorStore } from './monitoring/monitor-store.mjs';
import { createJobStore } from './jobs/job-store.mjs';
import { AlertService } from './monitoring/alert-service.mjs';
import { MonitoringService } from './monitoring/monitoring-service.mjs';
import { ChangeFeed } from './events/change-feed.mjs';
import { WORKSPACE_DIR, RUNTIME_DIR } from './config.mjs';
import path from 'node:path';
import fs from 'node:fs/promises';

trustSystemCertificates();

function assertBackendConfig() {
  if (config.environment !== 'production') return;
  if (!['trusted-gateway', 'central-sso', 'databricks-apps'].includes(config.identityMode)) throw new Error('Production requires trusted-gateway, central-sso or databricks-apps identity');
  // Not fatal: identity.mjs rejects every request until the token is set, so the pod can stay up and report it.
  if (config.identityMode === 'trusted-gateway' && !config.trustedIdentityToken) console.warn('[bootstrap] OPS_TRUSTED_IDENTITY_TOKEN is not set; every request will be rejected until it is');
  if (config.corsOrigin === '*') throw new Error('Production requires an explicit OPS_CORS_ORIGIN');
  if (!['aws', 'postgres'].includes(config.secretStore)) throw new Error('Production requires OPS_SECRET_STORE=aws or postgres');
  if (config.secretStore === 'postgres' && config.metadataStore !== 'postgres') throw new Error('OPS_SECRET_STORE=postgres needs the postgres metadata store');
  if (config.secretStore === 'postgres' && !config.secretEncryptionKey) throw new Error('OPS_SECRET_STORE=postgres requires OPS_SECRET_ENCRYPTION_KEY');
  if (!config.internalServiceToken) throw new Error('Production requires OPS_INTERNAL_SERVICE_TOKEN');
}

export async function createBackend() {
  assertBackendConfig();
  // Schema and migrations before any store reads: the RBAC store's first query needs ops_rbac_meta, which only
  // migration 008 creates (ADR 0003). Postgres runs them again when the operations store opens; both are idempotent.
  if (config.metadataStore === 'postgres') await ensureControlSchema();
  else await applyFileMigrations(); // the file store's twin of the SQL migrations (FR-44)
  const rbacStore = await createRbacStore();
  setRbacStore(rbacStore);
  // FR-42: the workspace folder becomes projects/pilot/ plus the shared library, before anything reads or restores it. Marker-guarded, so a no-op after the first start.
  await migrateWorkspaceLayout();
  const projectStore = await createProjectStore({ users: config.identityMode === 'single-user' ? null : rbacStore });
  // FR-51: a legacy workspace can arrive from local disk or a restore even when the stores have no rows.
  const legacyPilotDir = path.join(WORKSPACE_DIR, 'projects', PILOT_ID);
  if (!(await projectStore.get(PILOT_ID)) && (await fs.readdir(legacyPilotDir).catch(() => [])).length) {
    await projectStore.create({ id: PILOT_ID, name: 'PILOT' }, { id: 'migration', type: 'system' });
  }
  const hasPilot = Boolean(await projectStore.get(PILOT_ID));
  // SPEC-projects-03 FR-8: an app role change leaves project roles alone; the app role does not cap them.
  // FR-22: work started for someone (routines, ticket tasks) is held by their role in that project.
  setProjectRoleResolver((user: unknown, projectId: string) => projectRoleOf({ store: projectStore, user: user as Parameters<typeof projectRoleOf>[0]['user'], projectId }));
  const secretStore = createSecretStore();
  const connectionProfileStore = await createConnectionProfileStore();
  // SPEC-projects-01 FR-32/FR-33: provider reads must resolve a grant in the requesting project.
  const connectionService = new ConnectionService({ store: connectionProfileStore, secretStore, projects: projectStore });
  const dataPlatform = new PerProject((id: string) => new DataPlatformCatalog({ connectionService: connectionService.forProject(id) } as unknown as ConstructorParameters<typeof DataPlatformCatalog>[0]));
  const operationsStore = await createOperationsStore();
  // FR-32/FR-41: import deployment credentials once into PILOT's granted library. The persistent
  // marker prevents a deleted env profile from silently returning after a restart.
  const envImportRef = 'connections/env-profile-import-state';
  await connectionService.importEnvProfiles({
    state: {
      get: async () => { const value = await secretStore.get(envImportRef); return value ? JSON.parse(value) as { providers: string[] } : null; },
      set: async value => { await secretStore.set(envImportRef, JSON.stringify(value)); },
    },
    ticketStore: operationsStore,
    pilotId: hasPilot ? PILOT_ID : null,
  });
  // The ledger the background fetch writes and the pages read (ADR-0002).
  const monitorStore = await createMonitorStore();
  const jobStore = await createJobStore();
  // One workspace per project (FR-19) and the shared library (FR-31); `workspace` below is the registry, never a single folder.
  const workspace = new WorkspaceRegistry();
  const pilotWorkspace = hasPilot ? await workspace.for(PILOT_ID) : null;
  const library = await workspace.library();
  const taskStore = await createTaskStore();
  const grants = new GrantService({ projects: projectStore, workspaces: workspace, connections: connectionService } as unknown as ConstructorParameters<typeof GrantService>[0]);
  const connectors = new Connectors({ workspace, secretStore, connectionService, grants } as unknown as ConstructorParameters<typeof Connectors>[0]);
  // PILOT's existing links to the library become its grants; then every project's links follow its grants.
  if (hasPilot) await grants.grantExistingLinks(PILOT_ID).catch(error => console.warn('[grants] PILOT grants not recorded:', error?.message || error));
  await grants.reconcileAll();
  // FR-24: connector secrets are project-qualified; PILOT's existing ones are copied to the new names.
  if (pilotWorkspace) await migrateConnectorSecretRefs({ secretStore, connectorRefs: connectorSecretNames(await pilotWorkspace.readOperations().catch(() => ({}))), projectId: PILOT_ID } as unknown as Parameters<typeof migrateConnectorSecretRefs>[0]).catch(error => console.warn('[connectors] secret refs not migrated:', error?.message || error));
  // SPEC-projects-04: every run bills to its project's own key, and does not start without one.
  const projectApiKeys = new ProjectApiKeys({ secretStore });
  const runtime = new TaskRuntime({ store: taskStore, workspace, projects: projectStore, env: async task => (await connectors.for(task)).envForTasks(), apiKey: task => projectApiKeys.require(task.projectId) });
  const serviceNow = new PerProject((id: string) => new ServiceNowService({ secretStore, connectionService: connectionService.forProject(id) }));
  const jira = new PerProject((id: string) => new JiraService({ secretStore, connectionService: connectionService.forProject(id) }));
  const dataQualityService = new PerProject((id: string) => new DataQualityService({ store: operationsStore, connectionService: connectionService.forProject(id), projectId: id, monitorStore } as unknown as ConstructorParameters<typeof DataQualityService>[0]));
  const operationsService = new OperationsService({ store: operationsStore, dataPlatform, dataQualityService, serviceNow, jira, connectionService, projects: projectStore, grants, monitorStore } as unknown as ConstructorParameters<typeof OperationsService>[0]);
  const changeFeed = new ChangeFeed();
  operationsService.onChangeHint = hint => changeFeed.publish(hint);
  const presence = new AppPresence();
  const isAppActive = () => presence.isActive();
  const ticketTasks = new TicketTaskService({ store: operationsStore, runtime, operationsService, workspace: pilotWorkspace, projects: projectStore, workspaces: workspace, isAppActive } as unknown as ConstructorParameters<typeof TicketTaskService>[0]);
  // Per-project routines, skills, templates and knowledge: each project gets its own instance over its own workspace (FR-19).
  const routines = new Routines({ workspace, runtime, projects: projectStore, stateFileFor: (id: string) => (id === PILOT_ID ? path.join(RUNTIME_DIR, 'routines-state.json') : path.join(RUNTIME_DIR, `routines-state-${id}.json`)) } as unknown as ConstructorParameters<typeof Routines>[0]);
  const skills = new PerProject(async (id: string) => new SkillService({ workspace: await workspace.for(id), library, onShared: ({ name }) => grants.recordShared(id, 'skill', name), onUnshare: ({ name }) => grants.releaseForDelete(id, 'skill', name) }));
  const templates = new PerProject(async (id: string) => new TemplateService({ workspace: await workspace.for(id) }));
  const knowledge = new PerProject(async (id: string) => { const service = new KnowledgeService({ workspace: await workspace.for(id), secretStore, runtime, library, onShared: ({ name }: {name:string}) => grants.recordShared(id, 'knowledge', name) } as unknown as ConstructorParameters<typeof KnowledgeService>[0]); service.onUnshare = ({ name }) => grants.releaseForDelete(id, 'knowledge', name); return service; });
  const knowledgeDrafts = new PerProject(async (id: string) => (await knowledge.for(id)).drafts);
  // Failed Databricks runs become tickets through the monitoring service's pipelineFailed trigger now, not this job (SPEC-automations-01 FR-33).
  const integrationSync = new IntegrationSyncService({ operationsService, store: operationsStore, workspace: pilotWorkspace, workspaces: workspace, knowledge, projects: projectStore, envProvider: async (projectId: string) => (await connectors.for(projectId)).envForTasks(), isAppActive, databricksFailures: false } as unknown as ConstructorParameters<typeof IntegrationSyncService>[0]);
  const alerts = new AlertService({ store: monitorStore, operationsService, ticketTasks, runtime });
  const monitoring = new MonitoringService({ store: monitorStore, operationsService, dataQualityService, workspaces: workspace, projects: projectStore, alerts, isAppActive } as unknown as ConstructorParameters<typeof MonitoringService>[0]);
  operationsService.taskStore = taskStore as unknown as typeof operationsService.taskStore;
  operationsService.workspace = workspace;
  operationsService.backfillSignatures().catch(error => console.warn('[tickets] signature backfill failed:', error?.message || error));
  operationsService.onTicketChange = (ticketId, event) => ticketTasks.noteTicketChange(ticketId, event).catch(() => {});
  // The agent reads and acts on NerveCenter's own data through these tools.
  // Boards: dashboards people build with the agent and publish for the team. Never seeded: a deleted board must stay deleted across deploys.
  const boards = new BoardService({ store: operationsStore, operationsService, dataQualityService, taskStore, workspace, connectionService, dataPlatform } as unknown as ConstructorParameters<typeof BoardService>[0]);
  // Tested fixes run their SQL through the boards' connections and keep their proposals in task events (SPEC-tasks-13).
  const fixes = new FixService({ boards, workspace, dataPlatform, taskStore } as unknown as ConstructorParameters<typeof FixService>[0]);
  runtime.appTools = createAppTools({ operationsService, dataQualityService, taskStore, routines, rbacStore, boards, fixes, connectors, knowledge, workspaces: workspace, knowledgeDrafts, projects: projectStore, agentName: AGENT_NAME } as unknown as Parameters<typeof createAppTools>[0]) as unknown as typeof runtime.appTools;
  return { monitorStore, jobStore, alerts, monitoring, changeFeed, rbacStore, projectStore, projectApiKeys, secretStore, connectionProfileStore, connectionService, dataPlatform, operationsStore, workspace, library, grants, taskStore, runtime, ticketTasks, integrationSync, presence, routines, connectors, skills, templates, knowledge, serviceNow, jira, dataQualityService, operationsService, boards };
}
