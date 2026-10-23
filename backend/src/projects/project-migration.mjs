import fs from 'node:fs/promises';
import path from 'node:path';
import { WORKSPACE_DIR } from '../config.mjs';
import { ensureDir, exists, readJson, writeJson } from '../lib/fs.mjs';
import { PILOT_ID } from './project-store.mjs';

// SPEC-projects-01 FR-42 (and FR-24): the filesystem side of "everything that exists today belongs to PILOT".
// Before this change one deployment was one workspace folder; now every project has `projects/<id>/` and the
// shared library has `library/{knowledge,skills}/`. This moves the old content into PILOT's folder, then moves
// the admin-added knowledge bases and uploaded skills to the library with a link back, so PILOT keeps seeing
// them as granted resources. It works the same for the file store and for Postgres: the files are in neither.
//
// Marker-guarded (`<WORKSPACE_DIR>/.projects-migrated`), crash-safe (a rename per item, never copy-then-delete;
// every step checks what is already done, so a run that stopped half way finishes on the next start) and run
// before anything reads the workspace or restores it from S3.

export const MIGRATED_MARKER = '.projects-migrated';
/** What sat directly in the workspace folder before projects. */
const LEGACY_ITEMS = ['operations.yaml', '.mcp.json', 'CLAUDE.md', 'knowledge', '.claude', 'workflows', 'tasks', 'templates', 'knowledge-uploads', 'source'];
const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;
const BASES_META = '.bases.json';
const DRAFTS_META = '.drafts.json';

async function lstatOrNull(file) { return fs.lstat(file).catch(() => null); }
async function readJsonOr(file, fallback) { try { return await readJson(file); } catch { return fallback; } }

/** A relative link from `place` to `target`; where links are not allowed the target is copied (a marked copy, see Workspace). */
async function linkBack(target, place) {
  await ensureDir(path.dirname(place));
  try { await fs.symlink(path.relative(path.dirname(place), target), place, 'dir'); }
  catch { await fs.cp(target, place, { recursive: true }); await fs.writeFile(path.join(place, '.grant-copy'), 'A copy of a shared library entry; changes are made in the library.\n', 'utf8'); }
}

/** Move `from` to `to` with a rename; false (and nothing changed) when `to` is taken or `from` is missing. */
async function moveIfFree(from, to) {
  if (!(await lstatOrNull(from)) || await lstatOrNull(to)) return false;
  await ensureDir(path.dirname(to));
  await fs.rename(from, to);
  return true;
}

/**
 * Admin-added knowledge bases (the ones `.bases.json` knows) and uploaded skills move from a project folder to the library,
 * with a link left behind. Idempotent: what is already in the library and linked is skipped. Returns the names now shared.
 */
export async function shareAdminContent({ root = WORKSPACE_DIR, projectId = PILOT_ID, log = console } = {}) {
  const base = path.resolve(root);
  const pilot = path.join(base, 'projects', projectId);
  const library = path.join(base, 'library');
  const result = { bases: [], skills: [] };
  const knowledgeDir = path.join(pilot, 'knowledge');
  const baseMeta = await readJsonOr(path.join(knowledgeDir, BASES_META), {});
  const draftMeta = await readJsonOr(path.join(knowledgeDir, DRAFTS_META), {});
  const libraryKnowledge = path.join(library, 'knowledge');
  const libraryBaseMeta = await readJsonOr(path.join(libraryKnowledge, BASES_META), {});
  const libraryDraftMeta = await readJsonOr(path.join(libraryKnowledge, DRAFTS_META), {});
  for (const name of Object.keys(baseMeta).filter(key => SLUG.test(key))) {
    const local = path.join(knowledgeDir, name); const shared = path.join(libraryKnowledge, name);
    const localStat = await lstatOrNull(local);
    if (localStat?.isDirectory()) await moveIfFree(local, shared);
    if (!(await lstatOrNull(shared))) continue; // the base was never on disk (a restore that lost it): nothing to share
    if (!(await lstatOrNull(local))) await linkBack(shared, local);
    libraryBaseMeta[name] = baseMeta[name]; delete baseMeta[name];
    for (const key of Object.keys(draftMeta)) if (key.startsWith(`${name}/`)) { libraryDraftMeta[key] = draftMeta[key]; delete draftMeta[key]; }
    // A base built from uploads keeps its uploaded documents next to it, in the library.
    await moveIfFree(path.join(pilot, 'knowledge-uploads', name), path.join(library, 'knowledge-uploads', name));
    result.bases.push(name);
  }
  if (result.bases.length) {
    await writeJson(path.join(libraryKnowledge, BASES_META), libraryBaseMeta);
    if (Object.keys(libraryDraftMeta).length) await writeJson(path.join(libraryKnowledge, DRAFTS_META), libraryDraftMeta);
    await writeJson(path.join(knowledgeDir, BASES_META), baseMeta);
    await writeJson(path.join(knowledgeDir, DRAFTS_META), draftMeta);
  }
  const skillsDir = path.join(pilot, '.claude', 'skills');
  for (const entry of await fs.readdir(skillsDir, { withFileTypes: true }).catch(() => [])) {
    if (!SLUG.test(entry.name)) continue;
    const local = path.join(skillsDir, entry.name); const shared = path.join(library, 'skills', entry.name);
    if (entry.isDirectory() && await exists(path.join(local, 'SKILL.md'))) await moveIfFree(local, shared);
    if (!(await lstatOrNull(shared))) continue;
    if (!(await lstatOrNull(local))) await linkBack(shared, local);
    result.skills.push(entry.name);
  }
  if (result.bases.length || result.skills.length) log.log?.(`[projects] shared library: ${result.bases.length} bases, ${result.skills.length} skills moved out of projects/${projectId}`);
  return result;
}

/**
 * Move the workspace into the per-project layout. Returns what moved: `{ skipped }` when it already ran, otherwise
 * `{ moved, bases, skills, conflicts }`. `bases` and `skills` are the names now in the library (the caller grants them to PILOT).
 */
export async function migrateWorkspaceLayout({ root = WORKSPACE_DIR, projectId = PILOT_ID, log = console } = {}) {
  const base = path.resolve(root);
  const marker = path.join(base, MIGRATED_MARKER);
  if (await exists(marker)) return { skipped: true, moved: [], bases: [], skills: [], conflicts: [] };
  await ensureDir(base);
  const pilot = path.join(base, 'projects', projectId);
  const result = { moved: [], bases: [], skills: [], conflicts: [] };

  // 1. The old content goes into PILOT's folder. An item PILOT's folder already has is left where it is and reported.
  for (const item of LEGACY_ITEMS) {
    const from = path.join(base, item); const to = path.join(pilot, item);
    if (!(await lstatOrNull(from))) continue;
    if (await moveIfFree(from, to)) result.moved.push(item);
    else { result.conflicts.push(item); log.warn?.(`[projects] ${item} is in the workspace root and in projects/${projectId}; the root copy was left alone`); }
  }

  // 2. What the admins added moves on to the library, linked back.
  const shared = await shareAdminContent({ root: base, projectId, log });
  Object.assign(result, shared);

  await writeJson(marker, { migratedAt: new Date().toISOString(), project: projectId, ...result });
  if (result.moved.length) log.log?.(`[projects] workspace moved into projects/${projectId}: ${result.moved.join(', ')}`);
  return result;
}

/**
 * Connector secrets were stored as `connectors/<connector>/<ENV>` for the one workspace. FR-24 qualifies them with the
 * project, `projects/<id>/connectors/<connector>/<ENV>`; the refs PILOT already has are copied to the new name (the old
 * value is kept, so a rollback still works) and the project's operations.yaml needs no change: it names env vars, not refs.
 */
export async function migrateConnectorSecretRefs({ secretStore, connectorRefs, projectId = PILOT_ID } = {}) {
  let copied = 0;
  for (const ref of connectorRefs) {
    const qualified = `projects/${projectId}/${ref}`;
    const present = secretStore.has ? await Promise.resolve(secretStore.has(qualified)).catch(() => false) : (await secretStore.get(qualified).catch(() => undefined)) !== undefined;
    if (present) continue;
    const value = await secretStore.get(ref).catch(() => undefined);
    if (value === undefined || value === null || value === '') continue;
    await secretStore.set(qualified, value); copied += 1;
  }
  return { copied };
}
