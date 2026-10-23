import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolveAutomaticSyncSettings } from './sync-settings.mjs';
import { now, clean } from '../lib/util.mjs';
import { DEFAULT_PROJECT_ID, systemScope } from '../projects/project-access.mjs';

const exec = promisify(execFile);
const CLOSED = new Set(['MERGED', 'CLOSED']);
export const DEFAULT_INTEGRATION_SYNC_SECONDS = 15;

function repositoryParts(value) {
  const raw = clean(value).replace(/\.git$/i, '').replace(/\/+$/, '');
  const match = /(?:github\.com[/:])([^/]+)\/([^/]+)$/i.exec(raw) || /^([^/]+)\/([^/]+)$/.exec(raw);
  if (!match) throw new Error('source_control.repository must be a GitHub owner/repository or GitHub URL');
  return { slug: `${match[1]}/${match[2]}`, remote: `https://github.com/${match[1]}/${match[2]}.git`, folder: `${match[1]}-${match[2]}`.toLowerCase().replace(/[^a-z0-9-]+/g, '-') };
}

function safeSourcePath(workspace, configured, fallback) {
  const sourceRoot = path.resolve(workspace.dir, 'source');
  const target = path.resolve(workspace.dir, configured || path.join('source', fallback));
  if (target !== sourceRoot && !target.startsWith(`${sourceRoot}${path.sep}`)) throw new Error('source_control.path must stay inside the workspace source folder');
  return target;
}

function githubTicket(pr, repository, ticketId, existing = {}) {
  const state = clean(pr.state).toUpperCase();
  const status = state === 'MERGED' ? 'resolved' : state === 'CLOSED' ? 'closed' : pr.isDraft ? 'open' : 'in_progress';
  const changedAt = clean(pr.updatedAt) || now();
  // The existing ticket's events are not part of a patch; activity is appended, never set.
  const { activity: _events, ...kept } = existing;
  return {
    ...kept,
    ticketId,
    source: 'github', sourceRef: `${repository}#${pr.number}`, sourceKey: `github-pr:${repository}:${pr.number}`,
    externalReference: { system: 'github', sysId: String(pr.number), number: `PR #${pr.number}`, url: pr.url },
    title: pr.title || `Pull request #${pr.number}`,
    description: pr.body || existing.description || '', category: 'code_change', type: 'pull_request',
    priority: existing.priority || 'medium', status, visibility: existing.visibility === 'private' ? 'private' : 'project',
    tags: ['github', 'pull-request', ...(pr.isDraft ? ['draft'] : [])],
    creator: existing.creator || (pr.author?.login ? { type: 'user', id: pr.author.login, name: pr.author.login } : { type: 'system', id: 'github', name: 'GitHub' }),
    assignee: existing.assignee || null, requester: existing.requester || null, collaborators: existing.collaborators || [], workflowIds: existing.workflowIds || [],
    resolutionSummary: state === 'MERGED' ? 'Pull request merged in GitHub' : state === 'CLOSED' ? 'Pull request closed in GitHub' : null,
    closedAt: CLOSED.has(state) ? clean(pr.mergedAt || pr.closedAt || pr.updatedAt) || changedAt : null,
    taskId: existing.taskId || null, createdAt: existing.createdAt || clean(pr.createdAt) || changedAt, updatedAt: changedAt,
    metadata: { ...(existing.metadata || {}), github: { repository, number: Number(pr.number), state, draft: Boolean(pr.isDraft), head: pr.headRefName || null, base: pr.baseRefName || null, reviewDecision: pr.reviewDecision || null, checks: Array.isArray(pr.statusCheckRollup) ? pr.statusCheckRollup : [] } },
    // Activity is appended, never patched: only a new ticket starts with one.
    ...(existing.ticketId ? {} : { activity: [{ id: `github-pr-${pr.number}-created`, type: 'ticket.created', status: 'completed', title: 'Imported from GitHub', detail: pr.url || null, at: changedAt }] }),
  };
}

export class IntegrationSyncService {
  constructor({ operationsService, store, workspace, knowledge, projects = null, envProvider = async () => ({}), runner = exec, intervalSeconds = Number(process.env.OPS_INTEGRATION_SYNC_SECONDS || DEFAULT_INTEGRATION_SYNC_SECONDS), checkSeconds = Number(process.env.OPS_INTEGRATION_CHECK_SECONDS || 5), knowledgeSeconds = Number(process.env.OPS_KNOWLEDGE_SYNC_SECONDS || DEFAULT_INTEGRATION_SYNC_SECONDS), githubSeconds = Number(process.env.OPS_GITHUB_SYNC_SECONDS || DEFAULT_INTEGRATION_SYNC_SECONDS), clock = () => Date.now(), isAppActive = () => true, log = console, databricksFailures = true, workspaces = null } = {}) {
    // `intervalSeconds` is only the fallback cadence for workspaces that have not chosen one in
    // Settings yet. The real cadence is read fresh from operations.yaml on every check (see
    // automaticSyncIntervalSeconds), so a user's choice takes effect without restarting the server.
    // `databricksFailures: false` when the monitoring service opens those tickets instead (SPEC-automations-01 FR-33, decision D4).
    Object.assign(this, { operationsService, store, workspace, knowledge, projects, envProvider, runner, intervalSeconds, checkSeconds, knowledgeSeconds, githubSeconds, clock, isAppActive, log, databricksFailures, workspaces });
    this.timer = null; this.running = false; this.lastDueAt = new Map();
  }

  start({ github = true } = {}) {
    if (this.timer || !(this.checkSeconds > 0)) return;
    // The timer just checks readiness at a fine grain; poll() itself decides, from the user's
    // configured interval, whether enough time has actually passed to do the (expensive) sync work.
    const timerSources = github ? undefined : ['knowledge'];
    const pollTimer = () => this.poll(timerSources ? { sources: timerSources } : {}).catch(error => this.log.error('[integration-sync] poll failed', error));
    this.timer = setInterval(pollTimer, this.checkSeconds * 1000);
    this.timer.unref?.();
    setTimeout(pollTimer, 5000).unref?.();
  }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }

  async poll({ force = false, sources = ['knowledge', 'github'] } = {}) {
    if (!force && !this.isAppActive()) return { skipped: 'app inactive' };
    if (this.running) return { skipped: true };
    this.running = true;
    try {
      const projectIds = await this.#projectIds();
      if (!projectIds.length) return { skipped: 'no projects' };
      const at = this.clock();
      const projects = {};
      const sharedKnowledgeSeen = new Set();
      let disabledCount = 0;
      for (const projectId of projectIds) {
        let workspace;
        let operations;
        try {
          workspace = this.workspaces ? await this.workspaces.for(projectId) : this.workspace;
          operations = await workspace.readOperations();
        } catch (error) { projects[projectId] = { error: error.message }; continue; }
        const settings = resolveAutomaticSyncSettings(operations, this.intervalSeconds);
        if (!force && !settings.enabled) { projects[projectId] = { skipped: 'auto sync disabled' }; disabledCount += 1; continue; }
        const output = {};
        for (const source of sources) {
          const configured = resolveAutomaticSyncSettings(operations, source === 'knowledge' ? this.knowledgeSeconds : this.githubSeconds, source);
          const key = `${projectId}:${source}`;
          const lastAt = this.lastDueAt.get(key);
          if (!force && lastAt !== undefined && at - lastAt < configured.intervalSeconds * 1000) continue;
          try {
            if (source === 'knowledge') output.knowledge = await this.#syncKnowledgeProject(projectId, sharedKnowledgeSeen);
            else output.github = await this.#syncGithub(projectId, workspace, operations);
          } catch (error) { output[source] = { error: error.message }; }
          this.lastDueAt.set(key, at);
        }
        if (this.databricksFailures) {
          const key = `${projectId}:databricks`;
          const cadence = settings;
          const lastAt = this.lastDueAt.get(key);
          if (force || lastAt === undefined || at - lastAt >= cadence.intervalSeconds * 1000) {
            output.databricks = await this.#syncDatabricksFor(projectId).catch(error => ({ error: error.message }));
            this.lastDueAt.set(key, at);
          }
        }
        projects[projectId] = output;
      }
      if (disabledCount === projectIds.length) return { skipped: 'auto sync disabled' };
      if (Object.values(projects).every(result => !Object.keys(result).length)) return { skipped: 'interval not elapsed' };
      return projectIds.length === 1 ? (projects[projectIds[0]] || {}) : { projects };
    } finally { this.running = false; }
  }

  /** Active projects; without a project store only PILOT (SPEC-projects-01 FR-39). */
  async #projectIds() { return this.projects ? (await this.projects.list()).filter(project => project.kind === 'normal' && !project.archivedAt).map(project => project.id) : [DEFAULT_PROJECT_ID]; }

  /** Run one durable GitHub job without relying on this process's cadence map. */
  async runGithub(projectId, { force = false } = {}) {
    if (!force && !this.isAppActive()) return { skipped: 'app inactive' };
    const active = await this.#projectIds();
    if (!active.includes(projectId)) return { skipped: 'project inactive' };
    const workspace = this.workspaces ? await this.workspaces.for(projectId) : this.workspace;
    const operations = await workspace.readOperations();
    if (!force && !resolveAutomaticSyncSettings(operations, this.intervalSeconds).enabled) return { skipped: 'auto sync disabled' };
    return this.#syncGithub(projectId, workspace, operations);
  }

  /** Run one durable knowledge sync. Shared bases are re-resolved through an active grant at run time. */
  async runKnowledge(projectId, name, { shared = false, force = false } = {}) {
    if (!this.knowledge) return { skipped: 'knowledge unavailable' };
    if (!force && !this.isAppActive()) return { skipped: 'app inactive' };
    const active = await this.#projectIds();
    const candidates = shared ? active : [projectId];
    let selected = null;
    for (const candidateId of candidates) {
      if (!active.includes(candidateId)) continue;
      const workspace = this.workspaces ? await this.workspaces.for(candidateId) : this.workspace;
      const operations = await workspace.readOperations();
      if (!force && !resolveAutomaticSyncSettings(operations, this.knowledgeSeconds, 'knowledge').enabled) continue;
      const knowledge = typeof this.knowledge.for === 'function' ? await this.knowledge.for(candidateId) : this.knowledge;
      const base = (await knowledge.list()).items?.find(item => item.name === name && item.kind === 'git');
      if (!base || Boolean(base.shared) !== shared) continue;
      selected = { knowledge, base };
      break;
    }
    if (!selected) return { skipped: shared ? 'no active project grants this shared base' : 'project inactive or auto sync disabled' };

    // Check both the user-facing draft count and the working tree just before sync. KnowledgeService.sync
    // repeats these checks and also protects kept commits that have not reached their upstream.
    if (selected.base.pendingChanges) return { skipped: 'pending knowledge changes' };
    if (typeof selected.knowledge.pendingChanges === 'function' && (await selected.knowledge.pendingChanges(name)).length) {
      return { skipped: 'pending knowledge changes' };
    }
    try { return await selected.knowledge.sync(name); }
    catch (error) {
      if ((error.statusCode === 409 || error.status === 409) && /^Not synced:/.test(error.message || '')) {
        return { skipped: 'pending or kept knowledge changes' };
      }
      throw error;
    }
  }

  // Each project scans the pipelines its own granted connection sees, so a failure becomes that project's ticket.
  async #syncDatabricksFor(projectId) {
    const from = new Date(this.clock() - 24 * 60 * 60 * 1000).toISOString();
    const scope = systemScope(projectId);
    const monitor = await this.operationsService.monitor({ limit: 1000, runLimit: 10, range: 'Last 24 hours', from, scope });
    const failed = (monitor.recentRuns || []).filter(run => run.platform === 'databricks' && run.status === 'failed');
    let created = 0;
    for (const run of failed) {
      const key = `databricks:${run.pipelineId}:${run.runId}`;
      if (await this.store.findTicketBySourceKey?.(key)) continue;
      await this.operationsService.createTicket({ pipelineId: String(run.pipelineId), runId: String(run.runId), platform: 'databricks', visibility: 'project', assignee: null, creator: { type: 'system', id: 'nervecenter-sync', name: 'NerveCenter sync' }, scope });
      created += 1;
    }
    return { checked: failed.length, created };
  }

  async #syncKnowledgeProject(projectId, sharedSeen) {
    if (!this.knowledge) return { skipped: 'knowledge unavailable' };
    const result = { checked: 0, synced: 0, skipped: 0, failed: [] };
    const knowledge = typeof this.knowledge.for === 'function' ? await this.knowledge.for(projectId) : this.knowledge;
    const bases = (await knowledge.list()).items || [];
    for (const base of bases.filter(item => item.kind === 'git')) {
      // Library grant links resolve to one shared clone; private bases with matching names do not.
      const identity = base.shared ? `shared:${base.name}` : `project:${projectId}:${base.name}`;
      if (base.shared && sharedSeen.has(identity)) { result.skipped += 1; continue; }
      if (base.shared) sharedSeen.add(identity);
      result.checked += 1;
      if (base.pendingChanges) { result.skipped += 1; continue; }
      try { await knowledge.sync(base.name); result.synced += 1; }
      catch (error) { result.failed.push({ name: base.name, error: error.message }); }
    }
    return result;
  }

  async #syncGithub(projectId, workspace, operations) {
    const source = operations.source_control || {};
    if (clean(source.platform).toLowerCase() !== 'github' || !clean(source.repository)) return { skipped: 'GitHub source control is not configured' };
    const repository = repositoryParts(source.repository); const branch = clean(source.default_branch) || 'main';
    const target = safeSourcePath(workspace, clean(source.path), repository.folder);
    const connectorEnv = await this.envProvider(projectId);
    const env = { ...process.env };
    // Global credentials cannot cross project boundaries; legacy single-project setups may still use them.
    if (this.projects) { delete env.GH_TOKEN; delete env.GITHUB_TOKEN; }
    Object.assign(env, connectorEnv);
    if (!env.GH_TOKEN && env.GITHUB_TOKEN) env.GH_TOKEN = env.GITHUB_TOKEN;
    const token = clean(env.GH_TOKEN || env.GITHUB_TOKEN);
    if (this.projects && !token) return { skipped: 'GitHub credential is not configured for this project' };
    const gitEnv = token ? { ...env, GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'http.extraHeader', GIT_CONFIG_VALUE_0: `Authorization: Basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}` } : env;
    const code = await this.#syncSource({ repository, branch, target, env: gitEnv, workspace });
    const pullRequests = await this.#syncPullRequests({ repository: repository.slug, env, projectId });
    return { repository: repository.slug, code, pullRequests };
  }

  async #syncSource({ repository, branch, target, env, workspace }) {
    const gitDir = path.join(target, '.git');
    const exists = await fs.access(gitDir).then(() => true, () => false);
    if (!exists) {
      const existingFiles = await fs.readdir(target).catch(() => []);
      if (existingFiles.length) throw new Error(`Source mirror ${path.relative(workspace.dir, target)} exists without Git metadata; move or remove it before automatic cloning`);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await this.runner('git', ['clone', '--quiet', '--depth', '1', '--branch', branch, repository.remote, target], { env, windowsHide: true, timeout: 180_000 });
      return { action: 'cloned', path: path.relative(workspace.dir, target).replaceAll('\\', '/') };
    }
    const status = await this.runner('git', ['-C', target, 'status', '--porcelain'], { env, windowsHide: true, timeout: 30_000 });
    await this.runner('git', ['-C', target, 'fetch', '--quiet', '--prune', 'origin'], { env, windowsHide: true, timeout: 180_000 });
    const current = await this.runner('git', ['-C', target, 'branch', '--show-current'], { env, windowsHide: true, timeout: 30_000 });
    const dirty = Boolean(clean(status.stdout));
    if (!dirty && clean(current.stdout) === branch) await this.runner('git', ['-C', target, 'merge', '--quiet', '--ff-only', `origin/${branch}`], { env, windowsHide: true, timeout: 180_000 });
    return { action: dirty || clean(current.stdout) !== branch ? 'fetched' : 'fast-forwarded', dirty, branch: clean(current.stdout), path: path.relative(workspace.dir, target).replaceAll('\\', '/') };
  }

  async #syncPullRequests({ repository, env, projectId }) {
    const fields = 'number,title,body,state,isDraft,url,author,createdAt,updatedAt,closedAt,mergedAt,headRefName,baseRefName,reviewDecision,statusCheckRollup';
    const response = await this.runner('gh', ['pr', 'list', '--repo', repository, '--state', 'all', '--limit', '100', '--json', fields], { env, windowsHide: true, timeout: 120_000, maxBuffer: 16 * 1024 * 1024 });
    let prs; try { prs = JSON.parse(response.stdout || '[]'); } catch { throw new Error('GitHub CLI returned invalid pull-request JSON'); }
    if (!Array.isArray(prs)) throw new Error('GitHub CLI returned an invalid pull-request list');
    const connectionId = `github:${projectId}`;
    let created = 0; let updated = 0;
    for (const pr of prs) {
      if (!Number.isInteger(Number(pr.number))) continue;
      const key = `github-pr:${repository}:${pr.number}`;
      let existing = await this.store.findTicketBySourceKey?.(key, connectionId) || null;
      if (!existing) {
        const legacy = await this.store.findTicketBySourceKey?.(key, '');
        if (legacy?.projectId === projectId) existing = legacy;
      }
      if (existing) {
        await this.store.updateTicket(existing.ticketId, githubTicket(pr, repository, existing.ticketId, existing));
        await this.operationsService?.publishTicketChange?.(existing.ticketId);
        updated += 1;
      } else {
        const ticketId = await this.store.nextTicketId();
        await this.store.createTicket({ ...githubTicket(pr, repository, ticketId), projectId, connectionId });
        await this.operationsService?.publishTicketChange?.(ticketId);
        created += 1;
      }
    }
    return { checked: prs.length, created, updated };
  }
}

export {  repositoryParts, safeSourcePath };
