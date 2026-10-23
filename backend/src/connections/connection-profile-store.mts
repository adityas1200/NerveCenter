import path from 'node:path';
import { RUNTIME_DIR, config } from '../config.mjs';
import { ensureDir, exists, readJson, writeJson } from '../lib/fs.mjs';
import { getPgPool } from '../storage/postgres.mjs';
import { clone } from '../lib/util.mjs';

export interface ConnectionProfile {
  id: string;
  provider: string;
  name?: string;
  config?: Record<string, string>;
  enabled?: boolean;
  isDefault?: boolean;
  credentialSource?: string;
  secretRef?: string;
  lastTest?: Record<string, unknown> | null;
  [key: string]: unknown;
}

export interface ConnectionProfileDocument {
  profiles?: Record<string, ConnectionProfile>;
}

interface ConnectionProfileQueryPool {
  query<Row = Record<string, unknown>>(sql: string, values?: unknown[]): Promise<{ rows: Row[]; rowCount: number | null }>;
}

export interface ConnectionProfilePersistence {
  init(): Promise<void>;
  list(): Promise<ConnectionProfile[]>;
  get(id: string): Promise<ConnectionProfile | null>;
  put(profile: ConnectionProfile): Promise<ConnectionProfile>;
  delete(id: string): Promise<boolean>;
}

class FileConnectionProfileStore implements ConnectionProfilePersistence {
  private readonly file: string;

  constructor(file = path.join(RUNTIME_DIR, 'connection-profiles.json')) { this.file = file; }
  async init(): Promise<void> { await ensureDir(path.dirname(this.file)); if (!(await exists(this.file))) await writeJson(this.file, { profiles: {} }); }
  async #read(): Promise<ConnectionProfileDocument> { return readJson(this.file); }
  async #write(state: ConnectionProfileDocument): Promise<void> { await writeJson(this.file, state); }
  async list(): Promise<ConnectionProfile[]> { const state = await this.#read(); return Object.values(state.profiles || {}).sort((a, b) => String(a.name).localeCompare(String(b.name))).map(profile => clone(profile)); }
  async get(id: string): Promise<ConnectionProfile | null> { const state = await this.#read(); return state.profiles?.[id] ? clone(state.profiles[id]) : null; }
  async put(profile: ConnectionProfile): Promise<ConnectionProfile> { const state = await this.#read(); state.profiles ||= {}; state.profiles[profile.id] = clone(profile); await this.#write(state); return clone(profile); }
  async delete(id: string): Promise<boolean> { const state = await this.#read(); if (!state.profiles?.[id]) return false; delete state.profiles[id]; await this.#write(state); return true; }
}

class PostgresConnectionProfileStore implements ConnectionProfilePersistence {
  private pool!: ConnectionProfileQueryPool;

  constructor(pool?: ConnectionProfileQueryPool) { this.pool = pool!; }
  async init(): Promise<void> {
    this.pool ||= await getPgPool();
  }
  async list(): Promise<ConnectionProfile[]> { const { rows } = await this.pool.query<{ data: ConnectionProfile }>("SELECT data FROM ops_connection_profiles ORDER BY data->>'name', id"); return rows.map(row => row.data); }
  async get(id: string): Promise<ConnectionProfile | null> { const { rows } = await this.pool.query<{ data: ConnectionProfile }>('SELECT data FROM ops_connection_profiles WHERE id=$1', [id]); return rows[0]?.data || null; }
  async put(profile: ConnectionProfile): Promise<ConnectionProfile> { const { rows } = await this.pool.query<{ data: ConnectionProfile }>(`INSERT INTO ops_connection_profiles(id,provider,data,updated_at) VALUES($1,$2,$3::jsonb,now()) ON CONFLICT(id) DO UPDATE SET provider=EXCLUDED.provider,data=EXCLUDED.data,updated_at=now() RETURNING data`, [profile.id, profile.provider, JSON.stringify(profile)]); return rows[0].data; }
  async delete(id: string): Promise<boolean> { const result = await this.pool.query('DELETE FROM ops_connection_profiles WHERE id=$1', [id]); return (result.rowCount ?? 0) > 0; }
}

export async function createConnectionProfileStore(): Promise<ConnectionProfilePersistence> {
  const store: ConnectionProfilePersistence = config.metadataStore === 'postgres' ? new PostgresConnectionProfileStore() : new FileConnectionProfileStore();
  await store.init();
  return store;
}
