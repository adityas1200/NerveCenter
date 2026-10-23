// Entry point for the UI role of the combined image: static frontend only, no backend services.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENV_DEFAULTS_FILE, applyEnvDefaults } from './env-defaults.mjs';
import { createUiServer } from './ui/ui-server.mjs';

// PUBLIC_BASE_PATH comes from the platform, else from the tracked .env.defaults (dev: /nervecenter).
{ const applied = applyEnvDefaults(); if (applied.length) console.log(`[env-defaults] applied ${applied.length} defaults from ${ENV_DEFAULTS_FILE}`); }

const HERE = path.dirname(fileURLToPath(import.meta.url));
const root = process.env.UI_DIST_DIR || path.resolve(HERE, '..', 'ui-dist');
const basePath = process.env.PUBLIC_BASE_PATH || '';
const port = Number(process.env.PORT || 8787);

createUiServer({ root, basePath }).listen(port, '0.0.0.0', () => console.log(`NerveCenter UI listening on http://0.0.0.0:${port} (base=${basePath || '/'}, root=${root})`));
