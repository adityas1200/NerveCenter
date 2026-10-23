#!/bin/sh
# What the combined image (the Dockerfile's last stage) runs. The TeamCity jobs for the API and the UI
# both build it with no --target, so the pod decides: NC_ROLE=ui, or a pod name containing
# -nervecenter-ui- (the UI Deployment's), serves the frontend. Anything else is the backend.
role="${NC_ROLE:-}"
if [ -z "$role" ]; then
  case "${HOSTNAME:-}" in
    *-nervecenter-ui-*) role=ui ;;
  esac
fi
if [ "$role" = ui ]; then
  echo "[entrypoint] role=ui (NC_ROLE=${NC_ROLE:-unset}, HOSTNAME=${HOSTNAME:-unset})"
  exec node dist/serve-ui.mjs
fi
exec npm start
