import path from 'node:path';

// SPEC-projects-02 FR-1, FR-23: the file-store twin of 005-project-roles.sql. Members without a role become `member`;
// tickets with the old `operators` visibility become `project`. A second run changes nothing.
export async function up({ runtimeDir, files }) {
  const { exists, readJson, writeJson } = files;
  const projectsFile = path.join(runtimeDir, 'projects.json');
  if (await exists(projectsFile)) {
    const doc = await readJson(projectsFile); let changed = false;
    for (const member of doc.members || []) if (!member.role) { member.role = 'member'; changed = true; }
    if (changed) await writeJson(projectsFile, doc);
  }
  const stateFile = path.join(runtimeDir, 'application-state.json');
  if (await exists(stateFile)) {
    const state = await readJson(stateFile); let changed = false;
    for (const ticket of Object.values(state.tickets || {})) if (ticket.visibility === 'operators') { ticket.visibility = 'project'; changed = true; }
    if (changed) await writeJson(stateFile, state);
  }
}
