import path from 'node:path';

// SPEC-projects-01 phase 1 (FR-41, FR-43): the file-store twin of 003-projects.sql. Creates projects.json
// with Unrouted and, only when legacy rows need it, PILOT. Stamps old unscoped records with 'pilot'.
const PILOT = 'pilot';

const PILOT_PROJECT = { id: 'pilot', name: 'PILOT', slug: 'pilot', description: 'The workspace that existed before projects.', kind: 'normal' };
const UNROUTED_PROJECT = { id: 'unrouted', name: 'Unrouted', slug: 'unrouted', description: 'Imported items that match no project yet. Admins only.', kind: 'unrouted' };
const hasUnscoped = records => Object.values(records || {}).some(record => record && typeof record === 'object' && !record.projectId);

const stampAll = records => { let changed = false; for (const record of Object.values(records || {})) if (record && typeof record === 'object' && !record.projectId) { record.projectId = PILOT; changed = true; } return changed; };

async function rewrite(file, change, { exists, readJson, writeJson }) {
  if (!(await exists(file))) return;
  const document = await readJson(file);
  if (change(document)) await writeJson(file, document);
}

export async function up({ runtimeDir, files }) {
  const { exists, readJson, writeJson } = files;
  const projectsFile = path.join(runtimeDir, 'projects.json');
  const document = (await exists(projectsFile)) ? await readJson(projectsFile) : {};
  document.projects ||= {}; document.members ||= []; document.grants ||= [];
  const state = (await exists(path.join(runtimeDir, 'application-state.json'))) ? await readJson(path.join(runtimeDir, 'application-state.json')) : {};
  const tasks = (await exists(path.join(runtimeDir, 'tasks', 'index.json'))) ? await readJson(path.join(runtimeDir, 'tasks', 'index.json')) : {};
  const inbox = (await exists(path.join(runtimeDir, 'tasks', 'inbox.json'))) ? await readJson(path.join(runtimeDir, 'tasks', 'inbox.json')) : {};
  const profiles = (await exists(path.join(runtimeDir, 'connection-profiles.json'))) ? await readJson(path.join(runtimeDir, 'connection-profiles.json')) : {};
  const needsPilot = hasUnscoped(state.tickets) || hasUnscoped(state.settings?.boards) || state.settings?.dataQuality !== undefined || hasUnscoped(tasks.tasks) || hasUnscoped(inbox.items) || Object.keys(profiles.profiles || {}).length > 0;
  let changed = false;
  for (const project of [UNROUTED_PROJECT, ...(needsPilot ? [PILOT_PROJECT] : [])]) if (!document.projects[project.id]) { document.projects[project.id] = { ...project, archivedAt: null, createdAt: new Date().toISOString(), createdBy: 'migration' }; changed = true; }
  if (changed || !(await exists(projectsFile))) await writeJson(projectsFile, document);
  await rewrite(path.join(runtimeDir, 'application-state.json'), state => { const tickets = stampAll(state.tickets); const boards = stampAll(state.settings?.boards); return tickets || boards; }, files);
  await rewrite(path.join(runtimeDir, 'tasks', 'index.json'), index => stampAll(index.tasks), files);
  await rewrite(path.join(runtimeDir, 'tasks', 'inbox.json'), inbox => stampAll(inbox.items), files);
}
