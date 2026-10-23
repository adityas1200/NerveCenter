import path from 'node:path';
import { exists, readJson, writeJson } from './file-io.js';

// ADR 0004: the file-store twin of 009-per-project-settings.sql. In application-state.json the shared `settings`
// map gives way to `boards` (by id, each with its projectId; none means PILOT) and `dataQuality` (by project:
// `dataQuality` was PILOT's, `dataQuality:<id>` another project's). A key it does not know stops the migration,
// so nothing is dropped unread. Once `settings` is gone a second run changes nothing.
const DQ = 'dataQuality';

export async function up({ runtimeDir }) {
  const file = path.join(runtimeDir, 'application-state.json');
  if (!(await exists(file))) return;
  const doc = await readJson(file);
  if (!doc?.settings || typeof doc.settings !== 'object') return;
  const { settings, ...rest } = doc;
  const unknown = Object.keys(settings).filter(key => key !== 'boards' && key !== DQ && !key.startsWith(`${DQ}:`));
  if (unknown.length) throw new Error(`application-state.json settings holds keys migration 009 does not move: ${unknown.join(', ')}`);
  const boards = { ...(rest.boards || {}) };
  for (const [id, board] of Object.entries(settings.boards || {})) {
    if (board && typeof board === 'object' && !boards[id]) boards[id] = { ...board, projectId: board.projectId || 'pilot' };
  }
  const dataQuality = { ...(rest.dataQuality || {}) };
  for (const [key, value] of Object.entries(settings)) {
    const projectId = key === DQ ? 'pilot' : key.startsWith(`${DQ}:`) ? key.slice(DQ.length + 1) : null;
    if (projectId && !(projectId in dataQuality)) dataQuality[projectId] = value;
  }
  await writeJson(file, { ...rest, boards, dataQuality });
}
