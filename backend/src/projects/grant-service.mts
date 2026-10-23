import { httpError } from '../lib/util.mjs';
import { normalizeScope, routeItem, scopeOverlap, UNROUTED } from './ticket-routing.mjs';
import type { ProjectGrant, ProjectGrantType, ProjectRecord } from './project-store.mjs';

type Actor = { id?: string; type?: string; role?: string; appRole?: string } | null;
type GrantInput = { resourceType?: string; resourceId?: string; scope?: Record<string, unknown>; isDefault?: boolean };
type ProjectApi = {
  list(): Promise<ProjectRecord[]>;
  listGrants(id: string, type?: string): Promise<ProjectGrant[]>;
  putGrant(id: string, grant: GrantInput, actor?: Actor): Promise<ProjectGrant>;
  removeGrant(id: string, type: ProjectGrantType, resourceId: string, actor?: Actor): Promise<{ removed: boolean }>;
};
type Workspace = {
  applyLibraryGrants(input: { knowledge: string[]; skills: string[] }): Promise<{ collisions: string[]; missing: string[]; linked: string[]; removed: string[] }>;
  writeKnowledgeIndex(): Promise<unknown>;
  listKnowledgeFolders(): Promise<Array<{ name: string; title: string }>>;
  listCustomSkills(): Promise<Array<{ dir: string }>>;
  isGrantLink(kind: string, name: string): Promise<boolean>;
};
type Workspaces = { for(id: string): Promise<Workspace>; library(): Promise<Workspace & { listSkillNames(): Promise<string[]> }> };
type ConnectionApi = { list(): Promise<Array<{ id: string; name: string; provider: string; projectAdminsMayGrant?: boolean }>>; store: { get(id: string): Promise<{ provider: string; projectAdminsMayGrant?: boolean } | null> } };
type GrantLogger = Pick<Console, 'warn' | 'error'>;
type GrantAudit = (actor: Actor, action: string, target: string, details: Record<string, unknown>) => Promise<unknown> | unknown;

// Grants (SPEC-projects-01 FR-31..FR-35): which library resources (connections, knowledge bases, skills) a project may use.
// The rows live in the project store; this service adds what a row alone cannot do: put a knowledge base or a skill into the
// project's folder as a link (and take it out again), and refuse a grant that would break a rule. Everything that changes a
// grant goes through here, so the link on disk and the row in the store never disagree for long; a reconcile at boot makes
// them agree again after a crash or a restore.

const FOLDER_KIND: Partial<Record<ProjectGrantType, string>> = { knowledge: 'knowledge', skill: 'skills' };
const noun = (type: string) => (type === 'skill' ? 'skill' : type === 'knowledge' ? 'knowledge base' : 'connection');

export class GrantService {
  projects: ProjectApi; workspaces: Workspaces; connections: ConnectionApi | null; log: GrantLogger; audit: GrantAudit | null;
  constructor({ projects, workspaces, connections = null, log = console, audit = null }: { projects: ProjectApi; workspaces: Workspaces; connections?: ConnectionApi | null; log?: GrantLogger; audit?: GrantAudit | null }) { this.projects = projects; this.workspaces = workspaces; this.connections = connections; this.log = log; this.audit = audit; }

  /** Every project (not Unrouted) that has a grant of this resource. */
  async holders(type: ProjectGrantType, resourceId: string): Promise<Array<{ project: ProjectRecord; grant: ProjectGrant }>> {
    const holders: Array<{ project: ProjectRecord; grant: ProjectGrant }> = [];
    for (const project of await this.projects.list()) {
      if (project.kind !== 'normal') continue;
      const grant = (await this.projects.listGrants(project.id, type)).find(item => item.resourceId === resourceId);
      if (grant) holders.push({ project, grant });
    }
    return holders;
  }

  /**
   * Make the project's folder match its knowledge and skill grants: a link for each, none for anything not granted.
   * A grant whose library entry is gone is reported, not failed, so one bad row never stops the others.
   */
  async reconcileLinks(projectId: string) {
    const workspace = await this.workspaces.for(projectId);
    const grants = await this.projects.listGrants(projectId);
    const result = await workspace.applyLibraryGrants({
      knowledge: grants.filter(grant => grant.resourceType === 'knowledge').map(grant => grant.resourceId),
      skills: grants.filter(grant => grant.resourceType === 'skill').map(grant => grant.resourceId),
    });
    for (const name of result.collisions) this.log.warn?.(`[grants] project ${projectId}: ${name} is already the project's own, so the granted one is not linked`);
    for (const name of result.missing) this.log.warn?.(`[grants] project ${projectId}: ${name} is granted but not in the library`);
    if (result.linked.some(name => name.startsWith('knowledge/')) || result.removed.some(name => name.startsWith('knowledge/'))) await workspace.writeKnowledgeIndex();
    return result;
  }

  /** At boot: every project's links follow its grants. */
  /** What a project could be granted, for the grants editor (SPEC-projects-02 FR-27): library bases and skills, and connections with their safeguard flag. */
  async grantable() {
    const library = await this.workspaces.library();
    const connections = this.connections ? await this.connections.list() : [];
    return {
      connections: connections.map(item => ({ id: item.id, name: item.name, provider: item.provider, projectAdminsMayGrant: Boolean(item.projectAdminsMayGrant) })),
      knowledge: (await library.listKnowledgeFolders()).map(item => ({ id: item.name, name: item.title })),
      skills: (await library.listSkillNames()).map(name => ({ id: name, name })),
    };
  }

  async reconcileAll() {
    const done = [];
    for (const project of await this.projects.list()) { if (project.kind !== 'normal') continue; try { done.push({ projectId: project.id, ...await this.reconcileLinks(project.id) }); } catch (error) { this.log.error?.(`[grants] project ${project.id}:`, (error as { message?: unknown }).message); } }
    return done;
  }

  /**
   * The migration moved a project's knowledge bases and skills to the library and left links; those links are grants the
   * migration did not record (FR-41). Record them, once. A link that has no row is the only case this acts on, so a
   * grant an admin removed later (which also removes the link) is never brought back.
   */
  async grantExistingLinks(projectId: string): Promise<string[]> {
    const workspace = await this.workspaces.for(projectId);
    const granted = new Set((await this.projects.listGrants(projectId)).map(grant => `${grant.resourceType}:${grant.resourceId}`));
    const added: string[] = [];
    const sources: Array<[ProjectGrantType, string, Array<string | undefined>]> = [['knowledge', 'knowledge', (await workspace.listKnowledgeFolders()).map(item => item.name)], ['skill', 'skills', (await workspace.listCustomSkills()).map(item => item.dir.split(/[\\/]/).pop())]];
    for (const [type, kind, names] of sources) {
      for (const name of names) {
        if (granted.has(`${type}:${name}`) || !(await workspace.isGrantLink(kind, name as string))) continue;
        await this.projects.putGrant(projectId, { resourceType: type, resourceId: name as string }, { id: 'migration' }); added.push(`${type}/${name}`);
      }
    }
    return added;
  }

  /** A base or skill was just added to the library from this project's request: grant it here (the current UI has no grants screen yet). */
  async recordShared(projectId: string, type: ProjectGrantType, name: string, actor: Actor = null) {
    await this.projects.putGrant(projectId, { resourceType: type, resourceId: name }, actor);
  }

  /**
   * Deleting a library entry: refused while another project holds a grant (FR-34). The deleting project's own grant is
   * released with it, so the current UI's Delete button keeps working until the Projects tab manages grants.
   */
  async releaseForDelete(projectId: string, type: ProjectGrantType, name: string, actor: Actor = null) {
    const others = (await this.holders(type, name)).filter(holder => holder.project.id !== projectId);
    if (others.length) throw httpError(409, `${name} is still granted to ${others.map(holder => holder.project.name).join(', ')}. Remove those grants first.`);
    await this.projects.removeGrant(projectId, type, name, actor).catch(() => {});
  }

  async #provider(connectionId: string): Promise<string> {
    const profile = await this.connections?.store.get(connectionId);
    if (!profile) throw httpError(404, `Connection ${connectionId} not found.`);
    return profile.provider;
  }

  /**
   * Grant a resource to a project (FR-31). A connection grant's filter is cleaned for its provider and refused when it would
   * catch the same items as another project's grant of that connection (FR-27); one default per provider per project (FR-32).
   */
  /**
   * Checks a grant without writing it, and returns its cleaned filter: a connection only when shareable or the caller is an app
   * admin, with a filter that overlaps no other project's (FR-27). `inLibrary` also requires a base or skill to exist, for a
   * project being created (SPEC-projects-03 FR-18), where nothing may be written until every grant is known to be good.
   */
  async check(projectId: string, { resourceType, resourceId, scope = {} }: GrantInput = {}, { globalAdmin = true, inLibrary = false }: { globalAdmin?: boolean; inLibrary?: boolean } = {}) {
    if (!['connection', 'knowledge', 'skill'].includes(resourceType as string)) throw httpError(400, 'resourceType must be connection, knowledge or skill.');
    if (!String(resourceId || '').trim()) throw httpError(400, 'A grant needs a resourceId.');
    const grantType = resourceType as ProjectGrantType;
    const grantId = resourceId as string;
    if (grantType !== 'connection') {
      if (inLibrary) {
        const library = await this.workspaces.library();
        const names = grantType === 'knowledge' ? (await library.listKnowledgeFolders()).map(item => item.name) : await library.listSkillNames();
        if (!names.includes(grantId)) throw httpError(404, `There is no ${noun(grantType)} ${grantId} in the library.`);
      }
      return { provider: null, clean: {} };
    }
    const provider = await this.#provider(grantId);
    // SPEC-projects-02 FR-15: an owner grants only connections an app admin marked shareable.
    if (!globalAdmin && !(await this.connections!.store.get(grantId))?.projectAdminsMayGrant) throw httpError(403, 'A global admin must grant this connection');
    const clean = normalizeScope(provider, scope);
    for (const { project, grant } of await this.holders('connection', grantId)) {
      if (project.id === projectId) continue;
      const overlap = scopeOverlap(provider, clean, grant.scope);
      if (overlap) throw httpError(409, `This filter overlaps ${project.name}'s grant of ${resourceId} (${overlap.mine} and ${overlap.theirs}). Narrow one of them first.`);
    }
    return { provider, clean };
  }

  async grant(projectId: string, { resourceType, resourceId, scope = {}, isDefault = false }: GrantInput = {}, actor: Actor = null, { globalAdmin = true }: { globalAdmin?: boolean } = {}) {
    const grantType = resourceType as ProjectGrantType;
    const { provider, clean } = await this.check(projectId, { resourceType, resourceId, scope }, { globalAdmin });
    if (resourceType === 'connection') {
      if (isDefault) for (const other of await this.projects.listGrants(projectId, 'connection')) {
        if (other.resourceId === resourceId || !other.isDefault) continue;
        if ((await this.connections!.store.get(other.resourceId))?.provider === provider) await this.projects.putGrant(projectId, { ...other, isDefault: false }, actor);
      }
    }
    const grant = await this.projects.putGrant(projectId, { resourceType, resourceId, scope: clean, isDefault: Boolean(isDefault) }, actor);
    if (FOLDER_KIND[grantType]) await this.reconcileLinks(projectId);
    return grant;
  }

  /** Saving a connection already granted elsewhere may not change its provider: the grants' filters are provider-specific. */
  async checkConnection(connectionId: string, provider: string) {
    const current = await this.connections?.store.get(connectionId);
    if (!current || !provider || current.provider === provider) return;
    const holders = await this.holders('connection', connectionId);
    if (holders.length) throw httpError(409, `${connectionId} is granted to ${holders.map(holder => holder.project.name).join(', ')}; its provider cannot change.`);
  }
  put(projectId: string, grant: GrantInput, actor: Actor = null) { return this.grant(projectId, grant, actor); }

  async revoke(projectId: string, resourceType: ProjectGrantType, resourceId: string, actor: Actor = null, { globalAdmin = true }: { globalAdmin?: boolean } = {}) {
    if (!globalAdmin && resourceType === 'connection' && !(await this.connections?.store.get(resourceId))?.projectAdminsMayGrant) throw httpError(403, 'A global admin must change this grant');
    const { removed } = await this.projects.removeGrant(projectId, resourceType, resourceId, actor);
    if (!removed) throw httpError(404, `${projectId} has no grant of that ${noun(resourceType)}.`);
    if (FOLDER_KIND[resourceType]) await this.reconcileLinks(projectId);
    return { projectId, resourceType, resourceId, removed: true };
  }

  /** The project an imported item belongs to, by the filters of the projects holding its connection (FR-26). */
  async route(connectionId: string, provider: string, item: Record<string, unknown>) {
    const holders = (await this.holders('connection', connectionId)).filter(holder => !(holder.project as ProjectRecord & { archived?: boolean }).archived).map(({ project, grant }) => ({ projectId: project.id, scope: grant.scope }));
    const routed = routeItem(provider, holders, item);
    return routed.projectId === UNROUTED ? { ...routed, projectId: 'unrouted' } : routed;
  }

  linkKind(type: ProjectGrantType) { return FOLDER_KIND[type]; }
  describe(type: ProjectGrantType) { return noun(type); }
}
