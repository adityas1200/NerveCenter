import path from 'node:path';

// SPEC-projects-01 phase 2 (FR-25, FR-32, FR-41): the file-store twin of 004-ticket-connection.sql. Stamps every ticket
// with the connection it came through (the default profile of its provider, else '') and grants every existing
// connection profile to PILOT with no scope filter, keeping the profile a read used as its default. A ticket that
// already has a connectionId and a grant that already exists are left alone, so a second run changes nothing.
const PILOT = 'pilot';

const enabled = profile => profile.enabled !== false;
const byName = (a, b) => String(a.name).localeCompare(String(b.name));

/** The profile a provider read picked before projects: the flagged default among enabled ones, else the first by name. */
function defaultProfiles(profiles) {
  const result = {};
  for (const profile of [...profiles].sort(byName).filter(enabled)) {
    const current = result[profile.provider];
    if (!current || (profile.isDefault && !current.isDefault)) result[profile.provider] = profile;
  }
  return result;
}

export async function up({ runtimeDir, files }) {
  const { exists, readJson, writeJson } = files;
  const profilesFile = path.join(runtimeDir, 'connection-profiles.json');
  const profiles = (await exists(profilesFile)) ? Object.values((await readJson(profilesFile)).profiles || {}) : [];
  const defaults = defaultProfiles(profiles);

  const stateFile = path.join(runtimeDir, 'application-state.json');
  if (await exists(stateFile)) {
    const state = await readJson(stateFile); let changed = false;
    for (const ticket of Object.values(state.tickets || {})) {
      if (!ticket || typeof ticket !== 'object' || typeof ticket.connectionId === 'string') continue;
      ticket.connectionId = defaults[ticket.source]?.id || ''; changed = true;
    }
    if (changed) await writeJson(stateFile, state);
  }

  if (!profiles.length) return;
  const projectsFile = path.join(runtimeDir, 'projects.json');
  const document = (await exists(projectsFile)) ? await readJson(projectsFile) : { projects: {}, members: [], grants: [] };
  document.grants ||= []; let changed = false;
  for (const profile of profiles) {
    if (document.grants.some(grant => grant.projectId === PILOT && grant.resourceType === 'connection' && grant.resourceId === profile.id)) continue;
    document.grants.push({ projectId: PILOT, resourceType: 'connection', resourceId: profile.id, scope: {}, isDefault: enabled(profile) && defaults[profile.provider]?.id === profile.id, createdAt: new Date().toISOString() }); changed = true;
  }
  if (changed) await writeJson(projectsFile, document);
}
