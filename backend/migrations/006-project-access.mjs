import path from 'node:path';

// SPEC-projects-03 FR-23: the file-store twin of 006-project-access.sql. Project roles become owner, developer and viewer:
// `admin` becomes `owner`; `member` becomes `viewer` for someone stored as an app viewer and `developer` for everyone else,
// so nobody gains or loses a right they had. Projects gain `open` (false) and `color` (none). A second run changes nothing.
const usersFile = dataDir => (process.env.OPS_RBAC_USERS_FILE ? path.resolve(process.env.OPS_RBAC_USERS_FILE) : path.join(dataDir, 'config', 'rbac-users.json'));

export async function up({ runtimeDir, files, dataDir }) {
  const { exists, readJson, writeJson } = files;
  const projectsFile = path.join(runtimeDir, 'projects.json');
  if (!(await exists(projectsFile))) return;
  const doc = await readJson(projectsFile);
  const users = (await exists(usersFile(dataDir))) ? await readJson(usersFile(dataDir)) : {};
  const viewers = new Set((Array.isArray(users?.users) ? users.users : []).filter(user => user?.role === 'viewer').map(user => String(user.id).toLowerCase()));
  let changed = false;
  for (const member of doc.members || []) {
    if (member.role === 'admin') { member.role = 'owner'; changed = true; }
    else if (member.role === 'member' || !member.role) { member.role = viewers.has(String(member.userId).toLowerCase()) ? 'viewer' : 'developer'; changed = true; }
  }
  for (const project of Object.values(doc.projects || {})) {
    if (typeof project.open !== 'boolean') { project.open = false; changed = true; }
    if (!('color' in project)) { project.color = null; changed = true; }
  }
  if (changed) await writeJson(projectsFile, doc);
}
