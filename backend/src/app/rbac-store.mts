import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync, mkdirSync } from 'node:fs';
import { config, DATA_DIR } from '../config.mjs';
import { getPgPool } from '../storage/postgres.mjs';
import { ROLES, isRole } from './rbac.mjs';
import { httpError } from '../lib/util.mjs';

const USERS_FILE = process.env.OPS_RBAC_USERS_FILE
  ? path.resolve(process.env.OPS_RBAC_USERS_FILE)
  : path.join(DATA_DIR, 'config', 'rbac-users.json');

export type RbacRole = typeof ROLES[keyof typeof ROLES];
export type RbacUserRecord = {
  id: string;
  name: string;
  email: string;
  role: RbacRole;
  blocked: boolean;
  createdAt?: string | null;
  updatedAt?: string | null;
  updatedBy?: string | null;
};
export type RbacPersistenceData = { users: RbacUserRecord[] };
export interface RbacActor { id?: string; name?: string; }
export interface RbacIdentity { id?: string; name?: string; email?: string; roles?: string[]; [key: string]: unknown; }
interface RbacQueryPool {
  query<Row = Record<string, unknown>>(sql: string, values?: unknown[]): Promise<{ rows: Row[]; rowCount: number | null }>;
}
export interface RbacPersistence {
  load(): Promise<RbacPersistenceData>;
  putUser(record: RbacUserRecord, users: RbacUserRecord[]): Promise<void>;
  deleteUser(id: string, users: RbacUserRecord[]): Promise<void>;
}

function isValidRole(value: unknown): value is RbacRole { return isRole(value); }
function normalize(user: unknown): RbacUserRecord {
  if (!user || typeof user !== 'object') throw httpError(400, 'User payload is required');
  const payload = user as Record<string, unknown>;
  const id = String(payload.id || '').trim();
  if (!id) throw httpError(400, 'User id is required');
  if (id.length > 128) throw httpError(400, 'User id is too long');
  const role = payload.role || ROLES.VIEWER;
  if (!isValidRole(role)) throw httpError(400, `Invalid role: ${role}`);
  return {
    id,
    name: String(payload.name || id).trim().slice(0, 200),
    email: payload.email ? String(payload.email).trim().slice(0, 200) : '',
    role,
    blocked: Boolean(payload.blocked),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
async function readJson(file: string, fallback: unknown): Promise<unknown> {
  try {
    const raw = await fs.readFile(file, 'utf8');
    return raw.trim() ? JSON.parse(raw) : fallback;
  } catch (error) {
    if (isRecord(error) && error.code === 'ENOENT') return fallback;
    throw error;
  }
}
async function writeJson(file: string, value: unknown): Promise<void> {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(value, null, 2), 'utf8');
  await fs.rename(tmp, file);
}

// Where the directory is kept. Deployed stacks keep it in Postgres beside tasks and tickets
// (docs/DESIGN.md, Storage): on k8s a container's own files do not survive a restart, so the file
// silently undid every role change and deletion. Local runs and tests keep the JSON file.
export class FileRbacPersistence implements RbacPersistence {
  private readonly usersFile: string;
  constructor({ usersFile = USERS_FILE }: {usersFile?:string} = {}) { this.usersFile = usersFile; }
  async load(): Promise<RbacPersistenceData> {
    const usersDoc = await readJson(this.usersFile, { users: [] });
    return { users: isRecord(usersDoc) && Array.isArray(usersDoc.users) ? usersDoc.users as RbacUserRecord[] : [] };
  }
  async putUser(_record: RbacUserRecord, users: RbacUserRecord[]): Promise<void> { await writeJson(this.usersFile, { users }); }
  async deleteUser(_id: string, users: RbacUserRecord[]): Promise<void> { await writeJson(this.usersFile, { users }); }
}

// The one-time copy of the file directory into Postgres is marked by an `ops_rbac_meta` row with this
// fixed key (ADR 0003; migration 008 created the table). Claiming it is a single INSERT, so two pods
// booting together import once, and a directory that is later emptied on purpose is not refilled
// from the file baked into the image.
const FILE_IMPORT_KEY = 'rbac-file-import';

export class PostgresRbacPersistence implements RbacPersistence {
  private pool!: RbacQueryPool;
  private readonly file: RbacPersistence;
  constructor({ pool, file = new FileRbacPersistence() }: { pool?: RbacQueryPool; file?: RbacPersistence } = {}) { this.pool = pool!; this.file = file; }
  async load(): Promise<RbacPersistenceData> {
    this.pool ||= await getPgPool();
    await this.#importFileOnce();
    const users = (await this.pool.query<{data:RbacUserRecord}>('SELECT data FROM ops_rbac_users')).rows.map(row => row.data);
    return { users };
  }
  async #importFileOnce(): Promise<void> {
    const { users } = await this.file.load();
    const claimed = await this.pool.query('INSERT INTO ops_rbac_meta(key, at) VALUES ($1, now()) ON CONFLICT (key) DO NOTHING RETURNING key', [FILE_IMPORT_KEY]);
    if (!claimed.rowCount) return;
    for (const user of users) if (user?.id) await this.pool.query('INSERT INTO ops_rbac_users(id, data) VALUES ($1, $2::jsonb) ON CONFLICT (id) DO NOTHING', [String(user.id), JSON.stringify(user)]);
  }
  async putUser(record: RbacUserRecord): Promise<void> { await this.pool.query('INSERT INTO ops_rbac_users(id, data, updated_at) VALUES ($1, $2::jsonb, now()) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()', [record.id, JSON.stringify(record)]); }
  async deleteUser(id: string): Promise<void> { await this.pool.query('DELETE FROM ops_rbac_users WHERE id = $1', [id]); }
}

export class RbacStore {
  persistence: RbacPersistence;
  users: Map<string, RbacUserRecord>;
  loaded: boolean;
  declare onRoleChange?: (record: RbacUserRecord, actor?: RbacActor | null) => Promise<unknown> | unknown;
  constructor({ persistence }: { persistence?: RbacPersistence } = {}) {
    this.persistence = persistence || (config.metadataStore === 'postgres' ? new PostgresRbacPersistence() : new FileRbacPersistence());
    this.users = new Map();
    this.loaded = false;
  }

  async init(): Promise<void> {
    if (this.loaded) return;
    const { users } = await this.persistence.load();
    for (const entry of users) {
      if (entry?.id) this.users.set(String(entry.id), { updatedAt: null, updatedBy: null, createdAt: null, ...entry });
    }
    await this.#seedDefaults();
    this.loaded = true;
  }

  // Insert bootstrap admins (config.seedAdmins) that are missing from the store.
  // Existing entries are never overwritten, so UI edits (role changes, blocks,
  // renames) persist. Deleted defaults get re-seeded on the next boot.
  async #seedDefaults(): Promise<void> {
    const seeds = Array.isArray(config.seedAdmins) ? config.seedAdmins : [];
    if (!seeds.length) return;
    const now = new Date().toISOString();
    for (const seed of seeds) {
      const id = String(seed?.id || '').trim();
      if (!id || this.users.has(id)) continue;
      const record = {
        id,
        name: String(seed.name || id).slice(0, 200),
        email: seed.email ? String(seed.email).slice(0, 200) : '',
        role: ROLES.ADMIN,
        blocked: false,
        createdAt: now,
        updatedAt: now,
        updatedBy: 'seed',
      };
      this.users.set(id, record);
      await this.#saveUser(record);
    }
  }

  // The file adapter rewrites the whole list; Postgres writes only the one row.
  async #saveUser(record: RbacUserRecord): Promise<void> { await this.persistence.putUser(record, [...this.users.values()]); }
  async #deleteUser(id: string): Promise<void> { await this.persistence.deleteUser(id, [...this.users.values()]); }

  get(id: string): RbacUserRecord | null { return this.users.get(String(id)) || null; }
  /** Case-insensitive lookup, the way project membership compares ids. */
  find(id: string): RbacUserRecord | null { const key = String(id || '').toLowerCase(); return this.get(id) || [...this.users.values()].find(user => user.id.toLowerCase() === key) || null; }
  list(): RbacUserRecord[] { return [...this.users.values()].sort((a, b) => a.id.localeCompare(b.id)); }

  async upsert(payload: unknown, actor?: RbacActor | null): Promise<RbacUserRecord> {
    const record = normalize(payload);
    const existing = this.users.get(record.id);
    const now = new Date().toISOString();
    const merged = { ...(existing || { createdAt: now }), ...record, updatedAt: now, updatedBy: actor?.id || null };
    this.users.set(record.id, merged);
    await this.#saveUser(merged);
    if (existing && existing.role !== merged.role) await this.onRoleChange?.(merged, actor);
    return merged;
  }

  async setRole(id: string, role: unknown, actor?: RbacActor | null): Promise<RbacUserRecord> {
    if (!isValidRole(role)) throw httpError(400, `Invalid role: ${role}`);
    const existing = this.users.get(String(id));
    if (!existing) throw httpError(404, 'User not found');
    if (existing.role === role) return existing;
    const merged = { ...existing, role, updatedAt: new Date().toISOString(), updatedBy: actor?.id || null };
    this.users.set(existing.id, merged);
    await this.#saveUser(merged);
    await this.onRoleChange?.(merged, actor);
    return merged;
  }

  async setBlocked(id: string, blocked: unknown, actor?: RbacActor | null, reason?: string): Promise<RbacUserRecord> {
    const existing = this.users.get(String(id));
    if (!existing) throw httpError(404, 'User not found');
    const next = Boolean(blocked);
    if (existing.blocked === next) return existing;
    const merged = { ...existing, blocked: next, updatedAt: new Date().toISOString(), updatedBy: actor?.id || null };
    this.users.set(existing.id, merged);
    await this.#saveUser(merged);
    return merged;
  }

  async remove(id: string, actor?: RbacActor | null): Promise<boolean> {
    const existing = this.users.get(String(id));
    if (!existing) return false;
    this.users.delete(existing.id);
    await this.#deleteUser(existing.id);
    return true;
  }

  // Used by identity.mjs to overlay stored role / blocked flag onto the resolved user.
  overlay(user: RbacIdentity | null | undefined): RbacIdentity | null | undefined {
    if (!user?.id) return user;
    const entry = this.users.get(String(user.id));
    if (!entry) return user;
    return { ...user, storedRole: entry.role, blocked: entry.blocked === true, storedName: entry.name };
  }

  // Auto-provision on first authenticated request so the directory always
  // reflects who has actually signed in. IdP role hints seed the initial role.
  async provisionIfMissing(user: RbacIdentity | null | undefined): Promise<RbacUserRecord | null> {
    if (!user?.id) return null;
    const id = String(user.id);
    const roles = (user.roles || []).map((role) => String(role || '').trim().toLowerCase());
    const adminByEnv = config.adminUserIds.includes(id);
    const adminByRole = roles.includes(String(config.adminRole || '').toLowerCase()) || roles.includes(ROLES.ADMIN);
    const developerByRole = roles.includes(ROLES.DEVELOPER);
    // Auto-promote existing entries that match the bootstrap admin list — covers
    // the case where a default admin logged in before being added to adminUserIds
    // and got auto-provisioned as developer.
    if (this.users.has(id)) {
      const existing = this.users.get(id)!;
      let dirty = false;
      if (adminByEnv && existing.role !== ROLES.ADMIN && !existing.blocked) {
        existing.role = ROLES.ADMIN;
        existing.updatedAt = new Date().toISOString();
        existing.updatedBy = 'auto-promote';
        dirty = true;
      }
      // Backfill name/email on subsequent logins so entries stored before the
      // identity layer exposed email pick it up on next sign-in.
      const nextName = String(user.name || existing.name || id).slice(0, 200);
      const nextEmail = user.email ? String(user.email).slice(0, 200) : (existing.email || '');
      if (nextName && nextName !== existing.name) { existing.name = nextName; dirty = true; }
      if (nextEmail && nextEmail !== existing.email) { existing.email = nextEmail; dirty = true; }
      if (dirty) await this.#saveUser(existing);
      return existing;
    }
    const now = new Date().toISOString();
    const record = {
      id,
      name: String(user.name || id).slice(0, 200),
      email: user.email ? String(user.email).slice(0, 200) : '',
      // SPEC-projects-03 FR-1: everyone starts as a viewer unless the admin list or the IdP says otherwise.
      role: adminByEnv || adminByRole ? ROLES.ADMIN : developerByRole ? ROLES.DEVELOPER : ROLES.VIEWER,
      blocked: false,
      createdAt: now,
      updatedAt: now,
      updatedBy: 'auto-provision',
    };
    this.users.set(id, record);
    await this.#saveUser(record);
    return record;
  }
}

let currentStore: RbacStore | null = null;
export function setRbacStore(store: RbacStore | null): void { currentStore = store; }
export function getRbacStore(): RbacStore | null { return currentStore; }

export async function createRbacStore(): Promise<RbacStore> {
  const store = new RbacStore();
  await store.init();
  return store;
}

// Configuration passthrough (used by the /api/admin/rbac/roles endpoint).
export const ROLE_DEFINITIONS = Object.freeze([
  {
    id: ROLES.ADMIN,
    label: 'Admin',
    description: 'Runs the app: people, connections, every project. Full control.',
  },
  {
    id: ROLES.DEVELOPER,
    label: 'Developer',
    description: 'Can create projects. What they do inside a project comes from their role there.',
  },
  {
    id: ROLES.VIEWER,
    label: 'Viewer',
    description: 'Everyone starts here. Sees the projects they are added to and the open ones.',
  },
]);

;
;
