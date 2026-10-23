#!/bin/sh
set -eu

usage() {
  echo "Usage: $0 --component NAME [--profile FILE_OR_NAME] [--public-base-path PATH] [--env ENV] [--compose-file FILE] [--compose-directory DIR] [--health-url URL]" >&2
}

COMPONENT="${COMPONENT:-}"
DEPLOYMENT_PROFILE="${DEPLOYMENT_PROFILE:-}"
PUBLIC_BASE_PATH="${PUBLIC_BASE_PATH:-}"
APP_ENV_VALUE="${APP_ENV:-}"
COMPOSE_FILE_VALUE="${COMPOSE_FILE:-}"
COMPOSE_DIRECTORY="${COMPOSE_DIRECTORY:-}"
HEALTH_URL="${HEALTH_URL:-}"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --component) COMPONENT="${2:-}"; shift 2 ;;
    --profile) DEPLOYMENT_PROFILE="${2:-}"; shift 2 ;;
    --public-base-path) PUBLIC_BASE_PATH="${2:-}"; shift 2 ;;
    --env) APP_ENV_VALUE="${2:-}"; shift 2 ;;
    --compose-file) COMPOSE_FILE_VALUE="${2:-}"; shift 2 ;;
    --compose-directory) COMPOSE_DIRECTORY="${2:-}"; shift 2 ;;
    --health-url) HEALTH_URL="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage; exit 2 ;;
  esac
done

REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
HOST_ENV_FILE="$REPO_ROOT/deploy/aws/.env"
# Where the host file lived before the AWS files moved under deploy/aws/.
LEGACY_HOST_ENV_FILE="$REPO_ROOT/deploy/.env"

# Env loading — either-or (differs from siblings intentionally):
#   * host deploy/aws/.env with settings -> use it exclusively (sandbox / prod)
#   * host deploy/aws/.env absent, or one that sets nothing -> repo .env.defaults (dev)
# Real env vars from SSM RunCommand (ORIGINAL_ENV_KEYS) always win.
# Anything still blank is filled by runtime-env.mjs from AWS Secrets Manager.
# Rationale: sandbox's host env file pre-dates .env.defaults and is treated as
# the complete truth; mixing the two risks pulling dev-only keys (NC_DB_SCHEMA,
# OPS_SSO_SESSION_URL, JWT/SECRET) into sandbox and breaking existing projects.
ORIGINAL_ENV_KEYS="$(mktemp)"
{
  env | sed 's/=.*//'
  for key in COMPONENT DEPLOYMENT_PROFILE PUBLIC_BASE_PATH APP_ENV_VALUE COMPOSE_FILE_VALUE COMPOSE_DIRECTORY HEALTH_URL; do
    eval "value=\${$key:-}"
    if [ -n "$value" ]; then
      printf '%s\n' "$key"
    fi
  done
} | sort -u > "$ORIGINAL_ENV_KEYS"
trap 'rm -f "$ORIGINAL_ENV_KEYS"' EXIT

is_original_env_key() {
  grep -qx "$1" "$ORIGINAL_ENV_KEYS"
}

load_env_file() {
  env_file="$1"
  if [ ! -f "$env_file" ]; then
    return 0
  fi
  while IFS= read -r line || [ -n "$line" ]; do
    line="$(printf '%s' "$line" | sed 's/\r$//')"
    case "$line" in
      ""|\#*) continue ;;
    esac
    key="${line%%=*}"
    value="${line#*=}"
    key="$(printf '%s' "$key" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
    case "$key" in
      ""|[0-9]*|*[!A-Za-z0-9_]*) continue ;;
    esac
    if is_original_env_key "$key"; then
      continue
    fi
    value="$(printf '%s' "$value" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
    case "$value" in
      \"*) value="${value#\"}"; value="${value%\"}" ;;
      \'*) value="${value#\'}"; value="${value%\'}" ;;
    esac
    export "$key=$value"
  done < "$env_file"
}

# A deploy/aws/.env that sets nothing counts as absent. ci-deploy.sh copies
# deploy/aws/.env.example to deploy/aws/.env on any host that has none, and every line of
# the example is commented out, so that copy must not stop dev from using .env.defaults.
has_settings() {
  [ -f "$1" ] && grep -qE '^[[:space:]]*[A-Za-z_][A-Za-z0-9_]*=' "$1"
}

# One-time move for hosts configured before deploy/aws/ existed: the deploy preserves every .env
# at its old relative path, so a hand-made deploy/.env is still there. Carry it over once.
if ! has_settings "$HOST_ENV_FILE" && has_settings "$LEGACY_HOST_ENV_FILE"; then
  (umask 077 && cp -p "$LEGACY_HOST_ENV_FILE" "$HOST_ENV_FILE")
  echo "Copied host settings from $LEGACY_HOST_ENV_FILE to $HOST_ENV_FILE"
fi

if has_settings "$HOST_ENV_FILE"; then
  load_env_file "$HOST_ENV_FILE"
else
  load_env_file "$REPO_ROOT/.env.defaults"
fi

if [ -z "$COMPONENT" ]; then
  echo "ERROR: --component is required" >&2
  exit 2
fi

if [ -n "$DEPLOYMENT_PROFILE" ] && [ -f "$DEPLOYMENT_PROFILE" ]; then
  DEPLOYMENT_PROFILE="$(cd "$(dirname "$DEPLOYMENT_PROFILE")" && pwd)/$(basename "$DEPLOYMENT_PROFILE")"
fi

export COMPONENT DEPLOYMENT_PROFILE PUBLIC_BASE_PATH
if [ -n "$APP_ENV_VALUE" ]; then
  # Mirror ai-for-data / ai4dm: --env populates APP_ENV and BEACON_ENV only.
  # NC_ENVIRONMENT (nervecenter-specific) is intentionally left to whatever
  # host deploy/aws/.env sets (e.g. sandbox's "staging"), or unset on dev.
  export APP_ENV="$APP_ENV_VALUE"
  if ! is_original_env_key "BEACON_ENV"; then
    export BEACON_ENV="$APP_ENV_VALUE"
  fi
fi

if [ -z "$COMPOSE_FILE_VALUE" ]; then
  COMPOSE_FILE_VALUE="$REPO_ROOT/deploy/aws/docker-compose.yml"
fi

if [ ! -f "$COMPOSE_FILE_VALUE" ]; then
  echo "ERROR: docker compose file not found: $COMPOSE_FILE_VALUE" >&2
  exit 2
fi

if [ -z "$COMPOSE_DIRECTORY" ]; then
  COMPOSE_DIRECTORY="$(dirname "$COMPOSE_FILE_VALUE")"
fi

ensure_trusted_identity_token() {
  env_file="$COMPOSE_DIRECTORY/.env"
  if [ -n "${OPS_TRUSTED_IDENTITY_TOKEN:-}" ]; then
    return
  fi

  current_value=""
  if [ -f "$env_file" ]; then
    current_value="$(sed -n 's/^OPS_TRUSTED_IDENTITY_TOKEN=//p' "$env_file" | head -n 1 | tr -d '\r')"
  fi
  case "$current_value" in
    ""|replace-with-*|change-me|changeme) ;;
    *) export OPS_TRUSTED_IDENTITY_TOKEN="$current_value"; return ;;
  esac

  if command -v openssl >/dev/null 2>&1; then
    generated_value="$(openssl rand -hex 32)"
  elif command -v od >/dev/null 2>&1 && [ -r /dev/urandom ]; then
    generated_value="$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n')"
  else
    echo "ERROR: OPS_TRUSTED_IDENTITY_TOKEN is absent and no secure token generator is available" >&2
    exit 1
  fi

  export OPS_TRUSTED_IDENTITY_TOKEN="$generated_value"

  mkdir -p "$(dirname "$env_file")"
  umask 077
  if [ -f "$env_file" ] && grep -q '^OPS_TRUSTED_IDENTITY_TOKEN=' "$env_file"; then
    temp_file="$env_file.tmp.$$"
    awk -v token="$generated_value" 'BEGIN{replaced=0} /^OPS_TRUSTED_IDENTITY_TOKEN=/{if(!replaced){print "OPS_TRUSTED_IDENTITY_TOKEN=" token;replaced=1}next} {print} END{if(!replaced)print "OPS_TRUSTED_IDENTITY_TOKEN=" token}' "$env_file" > "$temp_file"
    mv "$temp_file" "$env_file"
  else
    temp_file="$env_file.tmp.$$"
    if [ -f "$env_file" ]; then
      cat "$env_file" > "$temp_file"
    else
      : > "$temp_file"
    fi
    printf '\nOPS_TRUSTED_IDENTITY_TOKEN=%s\n' "$generated_value" >> "$temp_file"
    mv "$temp_file" "$env_file"
  fi
  echo "Generated and persisted the internal trusted-identity credential in $env_file"
}

ensure_trusted_identity_token

COMPOSE_SERVICES="$(docker compose -f "$COMPOSE_FILE_VALUE" --project-directory "$COMPOSE_DIRECTORY" config --services)"
if printf '%s\n' "$COMPOSE_SERVICES" | grep -qx "$COMPONENT"; then
  TARGET_SERVICES="$COMPONENT"
elif [ "$COMPONENT" = "nervecenter" ]; then
  # The existing CodeBuild project deploys the repository as one aggregate
  # component. Keep that contract by rebuilding both Compose services.
  TARGET_SERVICES="$COMPOSE_SERVICES"
else
  echo "ERROR: no compose service named '$COMPONENT' in $COMPOSE_FILE_VALUE" >&2
  exit 2
fi

echo "Deploying service(s)=$(printf '%s' "$TARGET_SERVICES" | tr '\n' ' ') env=${APP_ENV:-unset} publicBase=${PUBLIC_BASE_PATH:-unset} profile=${DEPLOYMENT_PROFILE:-unset}"
docker compose -f "$COMPOSE_FILE_VALUE" --project-directory "$COMPOSE_DIRECTORY" config >/dev/null
# TARGET_SERVICES can contain both frontend and backend for the aggregate
# NerveCenter pipeline component, so intentional word splitting is required.
# shellcheck disable=SC2086
docker compose -f "$COMPOSE_FILE_VALUE" --project-directory "$COMPOSE_DIRECTORY" build $TARGET_SERVICES
# shellcheck disable=SC2086
docker compose -f "$COMPOSE_FILE_VALUE" --project-directory "$COMPOSE_DIRECTORY" up -d --force-recreate $TARGET_SERVICES

if [ -n "$HEALTH_URL" ]; then
  echo "Checking health: $HEALTH_URL"
  for attempt in $(seq 1 30); do
    if curl -fsS "$HEALTH_URL" >/dev/null; then
      echo "Health check passed"
      exit 0
    fi
    sleep 5
  done
  echo "ERROR: health check failed: $HEALTH_URL" >&2
  exit 1
fi

echo "Deploy completed for $(printf '%s' "$TARGET_SERVICES" | tr '\n' ' ')"
