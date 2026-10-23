import path from 'node:path';
import { RUNTIME_DIR, config } from '../config.mjs';
import { ensureDir, exists, readJson, writeJson } from '../lib/fs.mjs';
import { getPgPool, ensureControlSchema } from '../storage/postgres.mjs';
import { httpError, now } from '../lib/util.mjs';
import { PROJECT_ROLE_IDS, isProjectRole } from '../app/rbac.mjs';

// Projects, their members and their grants (SPEC-projects-01 FR-1..FR-7). This file stores and validates; who
// may see which project is decided in project-access.mjs and nowhere else. The tables are created by
// migrations/003-projects.sql (Postgres) and 003-projects.mjs (files); the file store keeps projects.json.

export const PILOT_ID = 'pilot';
export const UNROUTED_ID = 'unrouted';
export const PROJECT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,31}$/;
export const GRANT_TYPES = ['connection', 'knowledge', 'skill'];
// The card colours a project may have (SPEC-projects-03 FR-17); none stored means one picked from the id.
export const PROJECT_COLORS = ['indigo', 'teal', 'amber', 'rose', 'sky', 'green'];
const NEEDS_OWNER = 'A project needs an owner. Make someone else owner first.';
// A member row without a known role is a viewer, never more (FR-4).
export type ProjectRole = 'owner' | 'developer' | 'viewer';
export type ProjectGrantType = 'connection' | 'knowledge' | 'skill';

export interface ProjectRecord {
  id: string;
  name: string;
  slug: string;
  description: string;
  kind: string;
  open: boolean;
  color: string | null;
  archivedAt: string | null;
  createdAt: string;
  createdBy: string;
}

export interface ProjectMember {
  projectId: string;
  userId: string;
  role: ProjectRole;
  addedAt: string;
  addedBy: string;
}

export interface ProjectGrant {
  projectId: string;
  resourceType: ProjectGrantType;
  resourceId: string;
  scope: Record<string, unknown>;
  isDefault: boolean;
  createdAt: string;
}

export type ProjectPatch = Partial<Pick<ProjectRecord, 'name' | 'description' | 'open' | 'color' | 'archivedAt'>>;

/** Both persistence adapters implement the same project/member/grant contract. */
export interface ProjectPersistence {
  init(): Promise<void>;
  listProjects(): Promise<ProjectRecord[]>;
  getProject(id: string): Promise<ProjectRecord | null>;
  insertProject(project: ProjectRecord): Promise<ProjectRecord>;
  updateProject(id: string, patch: ProjectPatch): Promise<ProjectRecord>;
  listMembers(projectId: string): Promise<ProjectMember[]>;
  addMember(member: ProjectMember): Promise<ProjectMember>;
  setMemberRole(projectId: string, userId: string, role: ProjectRole): Promise<number>;
  ownerProjectIds(userId: string): Promise<string[]>;
  membershipsOf(userId: string): Promise<Array<{ projectId: string; role: ProjectRole }>>;
  removeMember(projectId: string, userId: string): Promise<number>;
  projectIdsForUser(userId: string): Promise<string[]>;
  listGrants(projectId: string, type?: string): Promise<ProjectGrant[]>;
  putGrant(grant: ProjectGrant): Promise<ProjectGrant>;
  removeGrant(projectId: string, type: string, resourceId: string): Promise<number>;
}

export interface ProjectActor {
  id?: string;
  type?: string;
  role?: string;
  appRole?: string;
}

interface ProjectUsers { find(userId: string): unknown; }
interface ProjectStoreOptions { persistence: ProjectPersistence; users?: ProjectUsers | null; }
interface NewProjectInput { id?: string; name?: string; color?: string | null; }
interface CreateProjectInput extends NewProjectInput { description?: string; open?: boolean; ownerUserIds?: string[] | null; adminUserIds?: string[] | null; }
interface UpdateProjectInput { name?: string; description?: string; color?: string | null; open?: boolean; }
interface GrantInput { resourceType?: string; resourceId?: string; scope?: Record<string, unknown>; isDefault?: boolean; }
interface MemberInput { userId?: string; role?: string; }

interface FileProjectDocument {
  projects: Record<string, ProjectRecord>;
  members: ProjectMember[];
  grants: ProjectGrant[];
}

interface ProjectPgPool {
  query<T = Record<string, unknown>>(text: string, values?: readonly unknown[]): Promise<{ rows: T[]; rowCount: number }>;
}

const roleOfRow = (member: { role?: string } | null | undefined): ProjectRole => {
  const role = member?.role;
  return role && isProjectRole(role) ? role as ProjectRole : 'viewer';
};

const cleanText = (value: unknown, max: number): string => String(value ?? '').trim().slice(0, max);
const appRoleOf = (actor?: ProjectActor | null): string | null => actor?.appRole || actor?.role || null;
const sameUser = (left: unknown, right: unknown): boolean => String(left).toLowerCase() === String(right).toLowerCase();

const projectOf = (row: ProjectRecord): ProjectRecord => ({ id: row.id, name: row.name, slug: row.slug, description: row.description || '', kind: row.kind, open: row.open === true, color: row.color && PROJECT_COLORS.includes(row.color) ? row.color : null, archivedAt: row.archivedAt ?? null, createdAt: row.createdAt, createdBy: row.createdBy });

/* ------------------------------------------------------------------ persistence */

export class FileProjectPersistence implements ProjectPersistence {
  file: string;
  private queue: Promise<void>;
  constructor(file = path.join(RUNTIME_DIR, 'projects.json')) { this.file = file; this.queue = Promise.resolve(); }
  async init(): Promise<void> { await ensureDir(path.dirname(this.file)); }
  async #read(): Promise<FileProjectDocument> { const doc = (await exists(this.file)) ? await readJson(this.file) : {}; return { projects: doc.projects || {}, members: doc.members || [], grants: doc.grants || [] }; }
  async #change<T>(task: (doc: FileProjectDocument) => T | Promise<T>): Promise<T> { const prior = this.queue; let release!: () => void; this.queue = new Promise<void>(resolve => { release = resolve; }); await prior; try { const doc = await this.#read(); const result = await task(doc); await writeJson(this.file, doc); return result; } finally { release(); } }
  async listProjects(): Promise<ProjectRecord[]> { return Object.values((await this.#read()).projects).map(projectOf); }
  async getProject(id: string): Promise<ProjectRecord | null> { const row = (await this.#read()).projects[id]; return row ? projectOf(row) : null; }
  async insertProject(project: ProjectRecord): Promise<ProjectRecord> { return this.#change(doc => { doc.projects[project.id] = { ...project }; return projectOf(project); }); }
  async updateProject(id: string, patch: ProjectPatch): Promise<ProjectRecord> { return this.#change(doc => { doc.projects[id] = { ...doc.projects[id], ...patch }; return projectOf(doc.projects[id]); }); }
  async listMembers(projectId: string): Promise<ProjectMember[]> { return (await this.#read()).members.filter(member => member.projectId === projectId).map(member => ({ ...member, role: roleOfRow(member) })); }
  async addMember(member: ProjectMember): Promise<ProjectMember> { return this.#change(doc => { if (!doc.members.some(item => item.projectId === member.projectId && sameUser(item.userId, member.userId))) doc.members.push({ ...member }); return member; }); }
  async setMemberRole(projectId: string, userId: string, role: ProjectRole): Promise<number> { return this.#change(doc => { const member = doc.members.find(item => item.projectId === projectId && sameUser(item.userId, userId)); if (member) member.role = role; return member ? 1 : 0; }); }
  async ownerProjectIds(userId: string): Promise<string[]> { return [...new Set((await this.#read()).members.filter(member => sameUser(member.userId, userId) && member.role === 'owner').map(member => member.projectId))]; }
  async membershipsOf(userId: string): Promise<Array<{ projectId: string; role: ProjectRole }>> { return (await this.#read()).members.filter(member => sameUser(member.userId, userId)).map(member => ({ projectId: member.projectId, role: roleOfRow(member) })); }
  async removeMember(projectId: string, userId: string): Promise<number> { return this.#change(doc => { const before = doc.members.length; doc.members = doc.members.filter(item => !(item.projectId === projectId && sameUser(item.userId, userId))); return before - doc.members.length; }); }
  async projectIdsForUser(userId: string): Promise<string[]> { return [...new Set((await this.#read()).members.filter(member => sameUser(member.userId, userId)).map(member => member.projectId))]; }
  async listGrants(projectId: string, type?: string): Promise<ProjectGrant[]> { return (await this.#read()).grants.filter(grant => grant.projectId === projectId && (!type || grant.resourceType === type)); }
  async putGrant(grant: ProjectGrant): Promise<ProjectGrant> { return this.#change(doc => { doc.grants = doc.grants.filter(item => !(item.projectId === grant.projectId && item.resourceType === grant.resourceType && item.resourceId === grant.resourceId)); doc.grants.push({ ...grant }); return grant; }); }
  async removeGrant(projectId: string, type: string, resourceId: string): Promise<number> { return this.#change(doc => { const before = doc.grants.length; doc.grants = doc.grants.filter(item => !(item.projectId === projectId && item.resourceType === type && item.resourceId === resourceId)); return before - doc.grants.length; }); }
}

const PROJECT_COLUMNS = 'id, name, slug, description, kind, open, color, archived_at AS "archivedAt", created_at AS "createdAt", created_by AS "createdBy"';
function iso(value: Date | string): string;
function iso(value: Date | string | null | undefined): string | null;
function iso(value: Date | string | null | undefined): string | null { return value instanceof Date ? value.toISOString() : value ?? null; }
interface ProjectPgRow extends Omit<ProjectRecord, 'createdAt' | 'archivedAt'> { createdAt: Date | string; archivedAt: Date | string | null; }
interface ProjectPgMember extends Omit<ProjectMember, 'addedAt'> { addedAt: Date | string; }
interface ProjectPgGrant extends Omit<ProjectGrant, 'createdAt'> { createdAt: Date | string; }
const fromPg = (row: ProjectPgRow): ProjectRecord => projectOf({ ...row, archivedAt: iso(row.archivedAt), createdAt: iso(row.createdAt) });

export class PostgresProjectPersistence implements ProjectPersistence {
  pool!: ProjectPgPool;
  constructor(pool?: ProjectPgPool) { this.pool = pool!; }
  async init(): Promise<void> { this.pool ||= await getPgPool(); await ensureControlSchema(this.pool); }
  async listProjects(): Promise<ProjectRecord[]> { const { rows } = await this.pool.query<ProjectPgRow>(`SELECT ${PROJECT_COLUMNS} FROM ops_projects ORDER BY created_at, id`); return rows.map(fromPg); }
  async getProject(id: string): Promise<ProjectRecord | null> { const { rows } = await this.pool.query<ProjectPgRow>(`SELECT ${PROJECT_COLUMNS} FROM ops_projects WHERE id=$1`, [id]); return rows[0] ? fromPg(rows[0]) : null; }
  async insertProject(p: ProjectRecord): Promise<ProjectRecord> { const { rows } = await this.pool.query<ProjectPgRow>(`INSERT INTO ops_projects(id,name,slug,description,kind,open,color,created_at,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING ${PROJECT_COLUMNS}`, [p.id, p.name, p.slug, p.description, p.kind, p.open === true, p.color ?? null, p.createdAt, p.createdBy]); return fromPg(rows[0]); }
  async updateProject(id: string, patch: ProjectPatch): Promise<ProjectRecord> {
    const { rows } = await this.pool.query<ProjectPgRow>(`UPDATE ops_projects SET name=COALESCE($2,name), description=COALESCE($3,description), archived_at=CASE WHEN $4::boolean THEN $5::timestamptz ELSE archived_at END, open=COALESCE($6,open), color=CASE WHEN $7::boolean THEN $8 ELSE color END WHERE id=$1 RETURNING ${PROJECT_COLUMNS}`, [id, patch.name ?? null, patch.description ?? null, 'archivedAt' in patch, patch.archivedAt ?? null, typeof patch.open === 'boolean' ? patch.open : null, 'color' in patch, patch.color ?? null]);
    return fromPg(rows[0]);
  }
  async listMembers(projectId: string): Promise<ProjectMember[]> { const { rows } = await this.pool.query<ProjectPgMember>(`SELECT project_id AS "projectId", user_id AS "userId", role, added_at AS "addedAt", added_by AS "addedBy" FROM ops_project_members WHERE project_id=$1 ORDER BY added_at, user_id`, [projectId]); return rows.map(row => ({ ...row, role: roleOfRow(row), addedAt: iso(row.addedAt) })); }
  async addMember(m: ProjectMember): Promise<ProjectMember> { await this.pool.query('INSERT INTO ops_project_members(project_id,user_id,added_at,added_by,role) SELECT $1,$2,$3,$4,$5 WHERE NOT EXISTS (SELECT 1 FROM ops_project_members WHERE project_id=$1 AND lower(user_id)=lower($2))', [m.projectId, m.userId, m.addedAt, m.addedBy, m.role]); return m; }
  async setMemberRole(projectId: string, userId: string, role: ProjectRole): Promise<number> { const { rowCount } = await this.pool.query('UPDATE ops_project_members SET role=$3 WHERE project_id=$1 AND lower(user_id)=lower($2)', [projectId, userId, role]); return rowCount; }
  async ownerProjectIds(userId: string): Promise<string[]> { const { rows } = await this.pool.query<{ project_id: string }>("SELECT DISTINCT project_id FROM ops_project_members WHERE lower(user_id)=lower($1) AND role='owner'", [userId]); return rows.map(row => row.project_id); }
  async membershipsOf(userId: string): Promise<Array<{ projectId: string; role: ProjectRole }>> { const { rows } = await this.pool.query<{ projectId: string; role: string }>('SELECT project_id AS "projectId", role FROM ops_project_members WHERE lower(user_id)=lower($1)', [userId]); return rows.map(row => ({ projectId: row.projectId, role: roleOfRow(row) })); }
  async removeMember(projectId: string, userId: string): Promise<number> { const { rowCount } = await this.pool.query('DELETE FROM ops_project_members WHERE project_id=$1 AND lower(user_id)=lower($2)', [projectId, userId]); return rowCount; }
  async projectIdsForUser(userId: string): Promise<string[]> { const { rows } = await this.pool.query<{ project_id: string }>('SELECT DISTINCT project_id FROM ops_project_members WHERE lower(user_id)=lower($1)', [userId]); return rows.map(row => row.project_id); }
  async listGrants(projectId: string, type?: string): Promise<ProjectGrant[]> { const { rows } = await this.pool.query<ProjectPgGrant>('SELECT project_id AS "projectId", resource_type AS "resourceType", resource_id AS "resourceId", scope, is_default AS "isDefault", created_at AS "createdAt" FROM ops_project_grants WHERE project_id=$1 AND ($2::text IS NULL OR resource_type=$2) ORDER BY created_at, resource_id', [projectId, type || null]); return rows.map(row => ({ ...row, createdAt: iso(row.createdAt) })); }
  async putGrant(g: ProjectGrant): Promise<ProjectGrant> { await this.pool.query('INSERT INTO ops_project_grants(project_id,resource_type,resource_id,scope,is_default,created_at) VALUES($1,$2,$3,$4::jsonb,$5,$6) ON CONFLICT (project_id,resource_type,resource_id) DO UPDATE SET scope=EXCLUDED.scope,is_default=EXCLUDED.is_default', [g.projectId, g.resourceType, g.resourceId, JSON.stringify(g.scope || {}), Boolean(g.isDefault), g.createdAt]); return g; }
  async removeGrant(projectId: string, type: string, resourceId: string): Promise<number> { const { rowCount } = await this.pool.query('DELETE FROM ops_project_grants WHERE project_id=$1 AND resource_type=$2 AND resource_id=$3', [projectId, type, resourceId]); return rowCount; }
}

/* --------------------------------------------------------------------- the store */

export class ProjectStore {
  persistence!: ProjectPersistence;
  users!: ProjectUsers | null;
  // `users` is the RBAC directory (`find(id)` -> record or null); without one any id is accepted (tests, single-user).
  constructor({ persistence, users = null }: Partial<ProjectStoreOptions> = {}) { Object.assign(this, { persistence, users }); }

  /** SPEC-projects-03 FR-3: members are people who have signed in; any of them may hold any project role. */
  #checkUser(userId: string, { requireUser = false }: { requireUser?: boolean } = {}): void {
    if (!this.users || !requireUser) return;
    if (!this.users.find(userId)) throw httpError(400, `${userId} is not a user of this app.`);
  }
  #role(role: string): ProjectRole { if (!isProjectRole(role)) throw httpError(400, `role must be one of ${PROJECT_ROLE_IDS.join(', ')}.`); return role as ProjectRole; }
  // FR-7: only an app admin may leave a project without an explicit owner (app admins are owners of every project anyway).
  async #keepAnOwner(projectId: string, member: ProjectMember, nextRole: ProjectRole | null, actor?: ProjectActor | null): Promise<void> {
    if (member.role !== 'owner' || nextRole === 'owner' || appRoleOf(actor) === 'admin' || actor?.type === 'system') return;
    const owners = (await this.persistence.listMembers(projectId)).filter(item => item.role === 'owner');
    if (owners.length <= 1) throw httpError(400, NEEDS_OWNER);
  }
  async init(): Promise<this> { await this.persistence.init(); return this; }

  list(): Promise<ProjectRecord[]> { return this.persistence.listProjects(); }
  get(id: string): Promise<ProjectRecord | null> { return this.persistence.getProject(String(id || '')); }
  async require(id: string): Promise<ProjectRecord> { const project = await this.get(id); if (!project) throw httpError(404, `Unknown project: ${id}`); return project; }

  /** Checks a create request without writing anything (SPEC-projects-03 FR-18 validates the whole request first). */
  async checkNew({ id, name, color = null }: NewProjectInput = {}): Promise<{ projectId: string; cleanName: string }> {
    const projectId = String(id || '').trim();
    if (!PROJECT_ID_PATTERN.test(projectId)) throw httpError(400, 'A project id is 2 to 32 characters: lowercase letters, digits and hyphens, starting with a letter or digit.');
    // `unrouted` is the admins' queue and `all` the admins' All view in project URLs (SPEC-projects-03 FR-14).
    if ([UNROUTED_ID, 'all'].includes(projectId)) throw httpError(409, `The project id ${projectId} is reserved.`);
    const cleanName = cleanText(name, 80); if (!cleanName) throw httpError(400, 'A project needs a name.');
    if (color !== null && color !== undefined && !PROJECT_COLORS.includes(color)) throw httpError(400, `color must be one of ${PROJECT_COLORS.join(', ')}.`);
    const projects = await this.list();
    if (projects.some(project => project.id === projectId)) throw httpError(409, `A project with id ${projectId} already exists.`);
    if (projects.some(project => project.name.toLowerCase() === cleanName.toLowerCase())) throw httpError(409, `A project named ${cleanName} already exists.`);
    return { projectId, cleanName };
  }
  /** Members of a create request, checked up front: existing people, known roles (FR-18). */
  checkMembers(members: MemberInput[] = []): Array<{ userId: string; role: ProjectRole }> {
    if (!Array.isArray(members)) throw httpError(400, 'members must be a list.');
    return members.map(item => { const userId = cleanText(item?.userId, 128); if (!userId) throw httpError(400, 'A member needs a user id.'); this.#checkUser(userId, { requireUser: true }); return { userId, role: this.#role(item?.role || 'developer') }; });
  }

  async create({ id, name, description = '', color = null, open = false, ownerUserIds = null, adminUserIds = null }: CreateProjectInput = {}, actor?: ProjectActor | null): Promise<ProjectRecord> {
    const { projectId, cleanName } = await this.checkNew({ id, name, color });
    const project = await this.persistence.insertProject({ id: projectId, name: cleanName, slug: projectId, description: cleanText(description, 400), kind: 'normal', open: open === true, color: color || null, archivedAt: null, createdAt: now(), createdBy: actor?.id || 'system' });
    // SPEC-projects-03 FR-5: the creator becomes its owner, or the owners an app admin names (`adminUserIds` is the older name).
    const named = Array.isArray(ownerUserIds) && ownerUserIds.length ? ownerUserIds : Array.isArray(adminUserIds) && adminUserIds.length ? adminUserIds : null;
    if (named) { for (const userId of named) await this.addMember(projectId, userId, actor, { role: 'owner', requireUser: true }); }
    else if (actor?.id && actor.type !== 'system') await this.addMember(projectId, actor.id, actor, { role: 'owner' });
    return project;
  }

  // The id never changes (FR-1); the name, description, colour and open flag do. Who may change which is the route's call.
  async update(id: string, { name, description, color, open }: UpdateProjectInput = {}, actor?: ProjectActor | null): Promise<ProjectRecord> {
    const project = await this.require(id); const patch: ProjectPatch = {};
    if (name !== undefined) {
      const cleanName = cleanText(name, 80); if (!cleanName) throw httpError(400, 'A project needs a name.');
      if ((await this.list()).some(other => other.id !== project.id && other.name.toLowerCase() === cleanName.toLowerCase())) throw httpError(409, `A project named ${cleanName} already exists.`);
      patch.name = cleanName;
    }
    if (description !== undefined) patch.description = cleanText(description, 400);
    if (color !== undefined) { if (color !== null && !PROJECT_COLORS.includes(color)) throw httpError(400, `color must be one of ${PROJECT_COLORS.join(', ')}.`); patch.color = color; }
    if (open !== undefined && Boolean(open) !== project.open) {
      if (project.kind !== 'normal') throw httpError(409, 'Only a normal project can be opened to everyone.');
      patch.open = Boolean(open);
    }
    if (!Object.keys(patch).length) return project;
    const updated = await this.persistence.updateProject(project.id, patch);
    return updated;
  }

  // Archive only, never delete (FR-6), so ids on old rows never dangle. The reserved project stays open (FR-2).
  async setArchived(id: string, archived: boolean, actor?: ProjectActor | null): Promise<ProjectRecord> {
    const project = await this.require(id);
    if (project.kind === 'unrouted') throw httpError(409, 'The unrouted project cannot be archived.');
    if (Boolean(project.archivedAt) === Boolean(archived)) return project;
    const updated = await this.persistence.updateProject(project.id, { archivedAt: archived ? now() : null });
    return updated;
  }

  /* ---- members: a (project, user, role) row; role is owner, developer or viewer (SPEC-projects-03 FR-4). */
  async listMembers(id: string): Promise<ProjectMember[]> { await this.require(id); return this.persistence.listMembers(id); }
  async addMember(id: string, userId: string, actor?: ProjectActor | null, { role = 'developer', requireUser = false }: { role?: string; requireUser?: boolean } = {}): Promise<ProjectMember> {
    const checkedRole = this.#role(role);
    const project = await this.require(id); const user = cleanText(userId, 128);
    if (project.kind === 'unrouted') throw httpError(409, 'The unrouted project does not take members.');
    if (!user) throw httpError(400, 'A member needs a user id.');
    if (project.archivedAt) throw httpError(409, 'This project is archived and read-only.');
    this.#checkUser(user, { requireUser });
    const existing = (await this.persistence.listMembers(project.id)).find(member => sameUser(member.userId, user));
    if (existing) return existing;
    const member = await this.persistence.addMember({ projectId: project.id, userId: user, role: checkedRole, addedAt: now(), addedBy: actor?.id || 'system' });
    return member;
  }
  async removeMember(id: string, userId: string, actor?: ProjectActor | null): Promise<{ projectId: string; userId: string; removed: boolean }> {
    const project = await this.require(id);
    if (project.archivedAt) throw httpError(409, 'This project is archived and read-only.');
    const member = (await this.persistence.listMembers(project.id)).find(item => sameUser(item.userId, userId));
    if (member) await this.#keepAnOwner(project.id, member, null, actor);
    const removed = await this.persistence.removeMember(project.id, userId);
    return { projectId: project.id, userId: String(userId), removed: removed > 0 };
  }
  // Replace the whole member list (PUT): `[{userId, role}]`, or plain ids as developers. Adds first so nobody is briefly locked out.
  async setMembers(id: string, members: Array<string | MemberInput>, actor?: ProjectActor | null): Promise<ProjectMember[]> {
    if (!Array.isArray(members)) throw httpError(400, 'members must be a list.');
    await this.require(id);
    const wanted = [...new Map(members.map(item => (typeof item === 'object' && item ? { userId: String(item.userId || '').trim(), role: item.role || 'developer' } : { userId: String(item).trim(), role: 'developer' })).filter(item => item.userId).map(item => [item.userId.toLowerCase(), item])).values()];
    for (const item of wanted) this.#role(item.role);
    for (const item of wanted) { const added = await this.addMember(id, item.userId, actor, { role: item.role, requireUser: true }); if (added.role !== item.role) await this.setMemberRole(id, item.userId, item.role, actor); }
    for (const member of await this.persistence.listMembers(id)) if (!wanted.some(item => sameUser(item.userId, member.userId))) await this.removeMember(id, member.userId, actor);
    return this.listMembers(id);
  }
  /** FR-7: change a member's role. The last explicit owner stays unless an app admin changes it. */
  async setMemberRole(id: string, userId: string, role: string, actor?: ProjectActor | null): Promise<ProjectMember> {
    const checkedRole = this.#role(role);
    const project = await this.require(id);
    if (project.archivedAt) throw httpError(409, 'This project is archived and read-only.');
    const member = (await this.persistence.listMembers(project.id)).find(item => sameUser(item.userId, userId));
    if (!member) throw httpError(404, `${userId} is not a member of ${project.name}.`);
    if (member.role === role) return member;
    await this.#keepAnOwner(project.id, member, checkedRole, actor);
    await this.persistence.setMemberRole(project.id, member.userId, checkedRole);
    return { ...member, role: checkedRole };
  }
  ownerProjectIds(userId?: string | null): Promise<string[]> { return userId ? this.persistence.ownerProjectIds(String(userId)) : Promise.resolve([]); }
  /** Every project a person is in, with their role there (the admin console's People tab). */
  membershipsOf(userId?: string | null): Promise<Array<{ projectId: string; role: ProjectRole }>> { return userId ? this.persistence.membershipsOf(String(userId)) : Promise.resolve([]); }
  async memberRole(id: string, userId?: string | null): Promise<ProjectRole | null> { const member = userId ? (await this.persistence.listMembers(id)).find(item => sameUser(item.userId, userId)) : null; return member ? roleOfRow(member) : null; }
  // The ids of the projects a user belongs to. Deciding what that means for a request is project-access.mjs.
  memberProjectIds(userId?: string | null): Promise<string[]> { return this.persistence.projectIdsForUser(String(userId || '')); }

  /* ---- grants (data model only in phase 1; routing and overlap rules arrive with FR-27, FR-31) */
  async listGrants(id: string, type?: string): Promise<ProjectGrant[]> { await this.require(id); return this.persistence.listGrants(id, type); }
  async putGrant(id: string, { resourceType, resourceId, scope = {}, isDefault = false }: GrantInput = {}, actor?: ProjectActor | null): Promise<ProjectGrant> {
    const project = await this.require(id);
    if (project.kind === 'unrouted') throw httpError(409, 'The unrouted project does not take grants.');
    if (project.archivedAt) throw httpError(409, 'This project is archived and read-only.');
    if (resourceType === undefined || !GRANT_TYPES.includes(resourceType)) throw httpError(400, `resourceType must be one of ${GRANT_TYPES.join(', ')}.`);
    const resource = cleanText(resourceId, 200); if (!resource) throw httpError(400, 'A grant needs a resourceId.');
    const grant = await this.persistence.putGrant({ projectId: project.id, resourceType: resourceType as ProjectGrantType, resourceId: resource, scope: scope && typeof scope === 'object' ? scope : {}, isDefault: Boolean(isDefault), createdAt: now() });
    return grant;
  }
  async removeGrant(id: string, type: string, resourceId: string, actor?: ProjectActor | null): Promise<{ projectId: string; resourceType: string; resourceId: string; removed: boolean }> {
    const project = await this.require(id);
    if (project.archivedAt) throw httpError(409, 'This project is archived and read-only.');
    const removed = await this.persistence.removeGrant(project.id, type, resourceId);
    return { projectId: project.id, resourceType: type, resourceId, removed: removed > 0 };
  }
}

export async function createProjectStore({ users = null }: Omit<ProjectStoreOptions, 'persistence'> = {}): Promise<ProjectStore> {
  const persistence = config.metadataStore === 'postgres' ? new PostgresProjectPersistence() : new FileProjectPersistence();
  return new ProjectStore({ persistence, users }).init();
}
