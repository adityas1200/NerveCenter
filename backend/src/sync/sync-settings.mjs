import { fetchSeconds } from '../monitoring/automation-settings.mjs';

const UNIT_SECONDS = { seconds: 1, minutes: 60, hours: 3600 };

/**
 * Existing workspaces default to enabled and a 15-second cadence. `source` (tickets, knowledge, or GitHub) reads its
 * own cadence from `sync.<source>` first; without one the shared interval applies before the server default (FR-2).
 */
export function resolveAutomaticSyncSettings(operations = {}, fallbackSeconds = 15, source = null) {
  const own = source ? fetchSeconds(operations, source) : null;
  const value = Number(operations?.sync?.intervalValue);
  const perUnit = UNIT_SECONDS[operations?.sync?.intervalUnit];
  const modernSeconds = perUnit && value > 0 ? value * perUnit : null;
  const legacySeconds = Number(operations?.sync?.interval_seconds);
  const intervalSeconds = own || modernSeconds || (legacySeconds > 0 ? legacySeconds : null) || (fallbackSeconds > 0 ? fallbackSeconds : 15);
  return { enabled: operations?.sync?.enabled !== false, intervalSeconds };
}

export async function automaticSyncSettings(workspace, fallbackSeconds = 15, source = null) {
  return resolveAutomaticSyncSettings(await workspace.readOperations(), fallbackSeconds, source);
}

/**
 * How often automatic sync runs, in seconds. Set from Settings as a plain number in whatever unit
 * the user picked (seconds, minutes or hours). Older interval_seconds values remain readable.
 */
export async function automaticSyncIntervalSeconds(workspace, fallbackSeconds = 15) {
  return (await automaticSyncSettings(workspace, fallbackSeconds)).intervalSeconds;
}
