// Applies the repo's tracked .env.defaults inside the container, the way ai_for_data and
// zsnexos do. The image carries it at /app/.env.defaults (see deploy/aws/Dockerfile).
//
// On k8s nothing else reads that file: there is no deploy-component.sh and no compose
// env_file, only the Deployment's ConfigMap and Secret. So without this, dev would run
// on none of its defaults.
//
// Only variables that are completely unset are filled. Anything the platform set wins,
// including a deliberate blank: sandbox sets NC_DB_SCHEMA= on purpose, and compose already
// passes .env.defaults through env_file, so on compose hosts this changes nothing.
// Secrets Manager hydration (runtime-env.mjs) runs afterwards and fills what is still missing.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ENV_DEFAULTS_FILE = path.resolve(HERE, '..', '.env.defaults');

/** KEY=VALUE lines, parsed like deploy/aws/ec2/deploy-component.sh: comments and blanks skipped, one pair of quotes stripped. */
export function parseEnvDefaults(text) {
  const entries = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const at = line.indexOf('=');
    if (at <= 0) continue;
    const key = line.slice(0, at).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = line.slice(at + 1).trim();
    if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) value = value.slice(1, -1);
    entries.push([key, value]);
  }
  return entries;
}

/** Fill unset variables from the defaults file. Returns the keys applied, never their values. */
export function applyEnvDefaults({ file = ENV_DEFAULTS_FILE, env = process.env } = {}) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return []; }
  const applied = [];
  for (const [key, value] of parseEnvDefaults(text)) {
    if (env[key] !== undefined) continue;
    env[key] = value;
    applied.push(key);
  }
  return applied;
}
