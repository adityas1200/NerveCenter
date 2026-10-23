#!/usr/bin/env bash
# Databricks App deploy. Run by deploy/buildspec.yml when DEPLOY_PLATFORM=databricks.
#
# Stages the app from the repository's frontend/, backend/ and plugin/ (build.sh), then deploys the
# bundle in this folder (databricks.yml, which ships app.yaml) and starts the app.
#
# Pipeline variables:
#   DATABRICKS_HOST                               workspace URL
#   DATABRICKS_CLIENT_ID, DATABRICKS_CLIENT_SECRET service principal OAuth (or DATABRICKS_TOKEN)
#   DATABRICKS_BUNDLE_TARGET                      bundle target in databricks.yml (default dev)
#   BUNDLE_VAR_volume                             catalog.schema.volume for the workspace mirror
#   BUNDLE_VAR_<name>                             any other databricks.yml variable, e.g. app_name
#   LAKEBASE_INSTANCE_NAME, OPS_ADMIN_USER_IDS    stamped into app.yaml by build.sh
#   DATABRICKS_CLI_VERSION                        optional, pins the CLI install (e.g. 0.260.0)
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
target="${DATABRICKS_BUNDLE_TARGET:-dev}"

missing=""
[ -n "${DATABRICKS_HOST:-}" ] || missing="$missing DATABRICKS_HOST"
[ -n "${BUNDLE_VAR_volume:-}" ] || missing="$missing BUNDLE_VAR_volume"
if [ -z "${DATABRICKS_TOKEN:-}" ] && { [ -z "${DATABRICKS_CLIENT_ID:-}" ] || [ -z "${DATABRICKS_CLIENT_SECRET:-}" ]; }; then
  missing="$missing DATABRICKS_CLIENT_ID+DATABRICKS_CLIENT_SECRET(or DATABRICKS_TOKEN)"
fi
if [ -n "$missing" ]; then
  echo "ERROR: missing pipeline variables:$missing" >&2
  exit 2
fi

node_major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
if [ "$node_major" -lt 20 ]; then
  echo "ERROR: Node 20+ is required to build the frontend (found ${node_major}); use a newer build image" >&2
  exit 2
fi

if ! command -v databricks >/dev/null 2>&1; then
  echo "==> installing the Databricks CLI"
  ref="main"
  [ -n "${DATABRICKS_CLI_VERSION:-}" ] && ref="v${DATABRICKS_CLI_VERSION#v}"
  curl -fsSL "https://raw.githubusercontent.com/databricks/setup-cli/${ref}/install.sh" | sh
fi
databricks --version

bash "$here/build.sh"

cd "$here"
echo "==> deploying bundle target '$target' to $DATABRICKS_HOST"
databricks bundle validate -t "$target"
databricks bundle deploy -t "$target"
databricks bundle run nervecenter -t "$target"

if [ -n "${CODEBUILD_START_TIME:-}" ]; then
  echo "Time taken: $(( ( $(date +%s%3N) - CODEBUILD_START_TIME ) / 1000 )) seconds"
fi
