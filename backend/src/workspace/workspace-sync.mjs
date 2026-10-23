import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.mjs';
import { ensureDir, exists, readJson, writeJson } from '../lib/fs.mjs';
import { S3ObjectStore, createObjectStore } from '../storage/object-store.mjs';
import { GRANT_COPY_MARKER } from './workspace.mjs';
import { shareAdminContent } from '../projects/project-migration.mjs';

// Keeps the agent workspace in an object store (S3, or a Unity Catalog volume on Databricks) so a redeployed or
// replaced container starts with the same files. Restore runs once at boot per project (and for the shared library)
// when that folder is not there; push runs on a timer and uploads what changed since the last push, deleting objects
// for files that were removed locally.
//
// The layout mirrors the disk (SPEC-projects-01 FR-23): `<prefix>/workspace/projects/<id>/...` for each project and
// `<prefix>/workspace/library/...` for the shared library, each with its own state file. `WorkspaceSync` is one such folder;
// `WorkspaceSyncSet` runs them all. A bucket written before projects holds the workspace directly under
// `<prefix>/workspace/`: restore puts those files into PILOT's folder.
//
// Excluded: cloned .git folders (a Git knowledge base is re-cloned from its URL), a project's source/ mirror (re-cloned
// from source_control after restart), node_modules, the sync state file, and grant links (a symlink is skipped, a copied
// grant is marked and skipped; both are made again from the grants at boot).

const STATE_FILE = '.nervecenter-sync.json';
const EXCLUDED_DIRS = new Set(['.git', 'node_modules', '__pycache__']);
const toPosix = value => value.split(path.sep).join('/');

export class WorkspaceSync {
  // `store` is any object store; `bucket`/`region`/`client` remain as shorthand for S3. `subPath` is the folder's place under
  // `<prefix>/workspace/` ('' for a workspace written before projects, `projects/<id>` or `library` otherwise).
  constructor({ dir, store, bucket, prefix = 'nervecenter', region, client, intervalMs = 60_000, log = console, subPath = '' }) {
    Object.assign(this, { dir, store: store || new S3ObjectStore({ bucket, region, client }), prefix: String(prefix || 'nervecenter').replace(/^\/+|\/+$/g, ''), intervalMs, log, subPath: String(subPath || '').replace(/^\/+|\/+$/g, '') });
    this.timer = null; this.busy = null;
  }
  get keyPrefix() { return `${this.prefix}/workspace/${this.subPath ? `${this.subPath}/` : ''}`; }
  get location() { return `${this.store.location}/${this.keyPrefix}`; }

  /** Every object under the folder's prefix: relative path -> { size, etag }. */
  async listRemote() {
    const items = new Map();
    for (const [key, meta] of await this.store.list(this.keyPrefix)) if (key.startsWith(this.keyPrefix)) items.set(key.slice(this.keyPrefix.length), meta);
    return items;
  }

  /** Download the whole folder when the local one has no operations.yaml yet (a project) or is not there (the library). */
  async restore({ force = false } = {}) {
    if (!force && await exists(path.join(this.dir, 'operations.yaml'))) return { restored: 0, skipped: 'local workspace already present' };
    const remote = await this.listRemote();
    if (!remote.size) return { restored: 0, skipped: 'nothing mirrored yet' };
    let restored = 0;
    for (const [relative] of remote) {
      if (!relative || relative.endsWith('/') || relative === STATE_FILE) continue;
      const body = await this.store.get(`${this.keyPrefix}${relative}`);
      const file = path.join(this.dir, ...relative.split('/'));
      await ensureDir(path.dirname(file)); await fs.writeFile(file, body); restored += 1;
    }
    await this.#saveState(await this.#snapshot());
    this.log.log?.(`[workspace-sync] restored ${restored} file${restored === 1 ? '' : 's'} from ${this.location}`);
    return { restored };
  }

  /** Upload files that changed since the last push; delete objects for files that disappeared. */
  async push() {
    if (this.busy) return this.busy;
    this.busy = (async () => {
      const previous = await this.#loadState(); const current = await this.#snapshot();
      let uploaded = 0; let deleted = 0;
      for (const [relative, stat] of Object.entries(current)) {
        const before = previous[relative];
        if (before && before.size === stat.size && before.mtimeMs === stat.mtimeMs) continue;
        await this.store.put(`${this.keyPrefix}${relative}`, await fs.readFile(path.join(this.dir, ...relative.split('/'))), contentType(relative));
        uploaded += 1;
      }
      for (const relative of Object.keys(previous)) {
        if (current[relative]) continue;
        await this.store.delete(`${this.keyPrefix}${relative}`); deleted += 1;
      }
      await this.#saveState(current);
      if (uploaded || deleted) this.log.log?.(`[workspace-sync] ${this.subPath || 'workspace'}: pushed ${uploaded} change${uploaded === 1 ? '' : 's'}, removed ${deleted}`);
      return { uploaded, deleted };
    })().finally(() => { this.busy = null; });
    return this.busy;
  }

  start() { if (this.timer) return; this.timer = setInterval(() => this.push().catch(error => this.log.error?.('[workspace-sync] push failed', error.message)), this.intervalMs); this.timer.unref?.(); }
  async stop({ flush = true } = {}) { if (this.timer) clearInterval(this.timer); this.timer = null; if (flush) await this.push().catch(error => this.log.error?.('[workspace-sync] final push failed', error.message)); }

  async #snapshot() {
    const files = {};
    const walk = async (current, relative) => {
      const entries = await fs.readdir(current, { withFileTypes: true }).catch(() => []);
      // A copied grant (the fallback where links are not allowed) is the library's, not this project's.
      if (relative && entries.some(entry => entry.name === GRANT_COPY_MARKER)) return;
      for (const entry of entries) {
        const rel = relative ? `${relative}/${entry.name}` : entry.name;
        if (entry.isDirectory()) { if (EXCLUDED_DIRS.has(entry.name) || (!relative && entry.name === 'source')) continue; await walk(path.join(current, entry.name), rel); }
        else if (entry.isFile() && rel !== STATE_FILE) { const stat = await fs.stat(path.join(current, entry.name)); files[toPosix(rel)] = { size: stat.size, mtimeMs: Math.round(stat.mtimeMs) }; }
      }
    };
    await walk(this.dir, '');
    return files;
  }
  async #loadState() { try { return (await readJson(path.join(this.dir, STATE_FILE)))?.files || {}; } catch { return {}; } }
  async #saveState(files) { await writeJson(path.join(this.dir, STATE_FILE), { pushedAt: new Date().toISOString(), files }); }
}

/**
 * The whole workspace folder: one `WorkspaceSync` per project folder and one for the library. Restore looks at what the
 * bucket holds, so a project that exists only in the bucket (a replaced container) comes back too.
 */
export class WorkspaceSyncSet {
  constructor({ root, store, bucket, prefix = 'nervecenter', region, client, intervalMs = 60_000, log = console }) {
    this.root = path.resolve(root); this.log = log; this.intervalMs = intervalMs;
    this.options = { store: store || new S3ObjectStore({ bucket, region, client }), prefix, log, intervalMs };
    this.timer = null; this.busy = null; this.units = new Map();
    this.base = new WorkspaceSync({ dir: this.root, ...this.options });
  }
  get location() { return `${this.options.store.location}/${this.base.keyPrefix}`; }
  #unit(subPath) {
    let unit = this.units.get(subPath);
    if (!unit) { unit = new WorkspaceSync({ dir: path.join(this.root, ...subPath.split('/')), ...this.options, subPath }); this.units.set(subPath, unit); }
    return unit;
  }

  /** Which folders the bucket has: project ids, whether the library is there, and the keys written before projects. */
  async #remoteLayout() {
    const keys = [...(await this.base.listRemote()).keys()];
    const projects = new Set(); let library = false; const legacy = [];
    for (const key of keys) {
      const [head, id] = key.split('/');
      if (head === 'projects' && id) projects.add(id);
      else if (head === 'library') library = true;
      else legacy.push(key);
    }
    return { projects: [...projects].sort(), library, legacy };
  }

  /** Restore what is missing locally: each project whose operations.yaml is absent, the library when it is not there, and a pre-projects bucket into PILOT. */
  async restore() {
    const layout = await this.#remoteLayout();
    const result = { restored: 0, projects: [], library: false, legacy: 0 };
    for (const id of layout.projects) {
      const done = await this.#unit(`projects/${id}`).restore();
      if (done.restored) { result.restored += done.restored; result.projects.push(id); }
    }
    if (layout.library && !(await exists(path.join(this.root, 'library')))) {
      const done = await this.#unit('library').restore({ force: true });
      if (done.restored) { result.restored += done.restored; result.library = true; }
    }
    // A bucket from before projects: the files are the old workspace, so they become PILOT's (FR-42), unless PILOT already has its own.
    if (layout.legacy.length && !(await exists(path.join(this.root, 'projects', 'pilot', 'operations.yaml')))) {
      const pilot = path.join(this.root, 'projects', 'pilot');
      for (const relative of layout.legacy) {
        if (!relative || relative.endsWith('/') || relative === STATE_FILE) continue;
        const file = path.join(pilot, ...relative.split('/'));
        await ensureDir(path.dirname(file)); await fs.writeFile(file, await this.options.store.get(`${this.base.keyPrefix}${relative}`)); result.legacy += 1;
      }
      await shareAdminContent({ root: this.root, log: this.log });
      result.restored += result.legacy; result.projects.push('pilot');
      this.log.log?.(`[workspace-sync] restored ${result.legacy} file${result.legacy === 1 ? '' : 's'} written before projects into projects/pilot`);
    }
    if (!result.restored) result.skipped = layout.projects.length || layout.library || layout.legacy.length ? 'local workspace already present' : 'nothing mirrored yet';
    return result;
  }

  async #folders() {
    const subs = [];
    for (const entry of await fs.readdir(path.join(this.root, 'projects'), { withFileTypes: true }).catch(() => [])) if (entry.isDirectory()) subs.push(`projects/${entry.name}`);
    if (await exists(path.join(this.root, 'library'))) subs.push('library');
    return subs;
  }

  /** Push every folder; one that fails does not stop the others. */
  async push() {
    if (this.busy) return this.busy;
    this.busy = (async () => {
      const total = { uploaded: 0, deleted: 0 };
      for (const sub of await this.#folders()) {
        try { const done = await this.#unit(sub).push(); total.uploaded += done.uploaded; total.deleted += done.deleted; }
        catch (error) { this.log.error?.(`[workspace-sync] ${sub} push failed`, error.message); }
      }
      return total;
    })().finally(() => { this.busy = null; });
    return this.busy;
  }
  start() { if (this.timer) return; this.timer = setInterval(() => this.push().catch(error => this.log.error?.('[workspace-sync] push failed', error.message)), this.intervalMs); this.timer.unref?.(); }
  async stop({ flush = true } = {}) { if (this.timer) clearInterval(this.timer); this.timer = null; if (flush) await this.push().catch(error => this.log.error?.('[workspace-sync] final push failed', error.message)); }
}

function contentType(relative) {
  if (/\.(md|markdown)$/i.test(relative)) return 'text/markdown; charset=utf-8';
  if (/\.(ya?ml)$/i.test(relative)) return 'application/yaml';
  if (/\.json$/i.test(relative)) return 'application/json';
  if (/\.(txt|csv|log)$/i.test(relative)) return 'text/plain; charset=utf-8';
  return 'application/octet-stream';
}

/** From config: null when no object store is configured (local development). */
export function createWorkspaceSync({ dir, intervalMs } = {}) {
  const store = createObjectStore();
  if (!store) return null;
  return new WorkspaceSyncSet({ root: dir, store, prefix: config.s3Prefix, intervalMs: intervalMs || Number(process.env.OPS_WORKSPACE_SYNC_SECONDS || 60) * 1000 });
}
