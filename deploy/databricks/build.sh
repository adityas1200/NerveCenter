#!/usr/bin/env bash
# Stages NerveCenter as a Databricks App in deploy/databricks/.stage/:
#   package.json + dist/                the compiled backend (the platform runs npm install)
#   web/                                the built frontend, served by the backend
#   plugin/operations-fleet/            the agent plugin
#   app.yaml, requirements.txt          runtime config and Python deps
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
stage="$here/.stage"

rm -rf "$stage"
mkdir -p "$stage/plugin" "$stage/data"

echo "==> building frontend"
(
  cd "$repo/frontend"
  npm ci
  # Served from the app's root URL; the Apps proxy signs users in, so no SSO redirect.
  # VITE_API_BASE_URL must be "/", not empty: vite.config.ts treats an empty value as unset and fills it
  # from .env.defaults (/nervecenter), which sends every API call to a path the app doesn't serve.
  VITE_APP_BASE=/ VITE_API_BASE_URL=/ VITE_AUTH_MODE=platform VITE_AUTH_ENABLED=true VITE_AZURE_SSO_ENABLED=false npm run build
)
cp -R "$repo/frontend/dist" "$stage/web"

echo "==> staging backend"
(
  cd "$repo/backend"
  npm ci
  npm run typecheck
  npm run build
)
node - "$repo/backend/package.json" "$stage/package.json" <<'NODE'
const fs = require('node:fs');
const packageJson = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
delete packageJson.devDependencies;
fs.writeFileSync(process.argv[3], `${JSON.stringify(packageJson, null, 2)}\n`);
NODE
cp "$repo/backend/package-lock.json" "$stage/"
cp -R "$repo/backend/dist" "$stage/"
cp -R "$repo/backend/migrations" "$stage/"
cp -R "$repo/plugin/operations-fleet" "$stage/plugin/"
(cd "$stage" && node --input-type=module -e "await import('./migrations/006-project-access.mjs')")
find "$stage" -name '__pycache__' -type d -prune -exec rm -rf {} +
find "$stage" -name '.DS_Store' -delete

cp "$here/requirements.txt" "$stage/"
# Per-workspace values: LAKEBASE_INSTANCE_NAME (empty for Lakebase Autoscaling) and OPS_ADMIN_USER_IDS.
LAKEBASE_INSTANCE_NAME="${LAKEBASE_INSTANCE_NAME-nervecenter-db}" OPS_ADMIN_USER_IDS="${OPS_ADMIN_USER_IDS-}" python3 - "$here/app.yaml" "$stage/app.yaml" <<'PY'
import os, re, sys
text = open(sys.argv[1]).read()
for name in ("LAKEBASE_INSTANCE_NAME", "OPS_ADMIN_USER_IDS"):
    text = re.sub(rf'(- name: {name}\n\s+value: )"[^"]*"', lambda m: f'{m.group(1)}"{os.environ[name]}"', text)
open(sys.argv[2], "w").write(text)
PY

if [ "${NC_NO_VOLUME:-}" = "1" ]; then
  # Trial deploy without the UC volume: drop the env entry that references the volume resource.
  python3 - "$stage/app.yaml" <<'PY'
import re, sys
text = open(sys.argv[1]).read()
text = re.sub(r'  - name: OPS_VOLUME_PATH\n\s+valueFrom: workspace-volume\n', '', text)
open(sys.argv[1], "w").write(text)
PY
fi

echo "==> staged $(du -sh "$stage" | cut -f1) in $stage"
