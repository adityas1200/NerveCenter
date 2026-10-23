import { httpError } from '../lib/util.mjs';
import { PROJECT_ID_PATTERN } from './project-store.mjs';

// A service that works on one project's files or connections, built once per project (SPEC-projects-01
// FR-19). Callers hand over the request scope or a project id; there is no instance that serves every project.
export class PerProject {
  constructor(factory) { this.factory = factory; this.cache = new Map(); }
  /** The project's instance. A scope that spans projects (the admin All view) has no single project and is refused. */
  async for(project) {
    const id = projectIdOf(project);
    let built = this.cache.get(id);
    if (!built) {
      built = Promise.resolve().then(() => this.factory(id));
      this.cache.set(id, built);
      built.catch(() => this.cache.delete(id));
    }
    return built;
  }
}

/** The project id a scope or a plain id names. */
export function projectIdOf(project) {
  const id = typeof project === 'string' ? project : project?.projectId;
  if (id === 'ALL' || project?.all) throw httpError(403, 'Project required');
  if (!PROJECT_ID_PATTERN.test(String(id || ''))) throw httpError(403, 'This work has no project.');
  return id;
}

/** `dep.for(project)` for a per-project service; any other object is used as it is (one fixed instance, as a test supplies). */
export async function forProject(dep, project) {
  if (!(dep instanceof PerProject)) return dep;
  // The admin All view has no project; a registry may name what stands in for it (`whenAll`, e.g. a catalog with no connections).
  if (project?.all && typeof dep.whenAll === 'function') return dep.whenAll();
  return dep.for(project);
}

/**
 * Run a background job once per active project (FR-39), in turn. A project that is archived, or the reserved Unrouted one, is
 * skipped; an error in one project is logged with its id and never stops the next. Without a project store only PILOT is run.
 */
export async function forEachActiveProject(projects, job, { log = console, name = '' } = {}) {
  const label = name || 'job';
  const list = projects ? await projects.list() : [{ id: 'pilot', kind: 'normal', archivedAt: null }];
  const results = [];
  for (const project of list) {
    if (project.kind !== 'normal' || project.archivedAt) continue;
    try { results.push({ projectId: project.id, value: await job(project) }); }
    catch (error) { log.error?.(`[${label}] project ${project.id} failed:`, error?.message || error); results.push({ projectId: project.id, error: error?.message || String(error) }); }
  }
  return results;
}
