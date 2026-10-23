#!/usr/bin/env bash
# AWS/EC2 deploy, git mode. Run by deploy/buildspec.yml when DEPLOY_PLATFORM=aws and
# AWS_DEPLOY_MODE=git: the host checkout pulls BRANCH_NAME and rebuilds with Docker Compose.
# Pipeline variables: COMPONENT, BRANCH_NAME, TARGET_INSTANCE_ID, TARGET_PATH, HEALTH_URL.
# The host checkout is switched to BRANCH_NAME, and both .env and .env.v2.local are read: naming one
# --env-file stops Compose loading .env on its own. Image builds take longer than 5 minutes, so the
# wait matches bundle mode.
set -e

# Resolved before any cd below.
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/ssm-wait.sh"

echo "Deploying $COMPONENT to $ENVIRONMENT via git pull + docker compose"

CMD_ID=$(aws ssm send-command \
  --document-name "AWS-RunShellScript" \
  --targets "Key=InstanceIds,Values=$TARGET_INSTANCE_ID" \
  --parameters 'commands=[
    "set -e",
    "export HOME=/root",
    "cd '"$TARGET_PATH"'",
    "git fetch origin '"$BRANCH_NAME"'",
    "git checkout -f -B '"$BRANCH_NAME"' origin/'"$BRANCH_NAME"'",
    "docker compose -p '"$COMPONENT"' --env-file .env --env-file .env.v2.local -f deploy/aws/docker-compose.yml -f deploy/aws/docker-compose.v2.override.yml up -d --build",
    "for i in $(seq 1 30); do curl -fsS '"$HEALTH_URL"' >/dev/null 2>&1 && echo HEALTHY && exit 0; sleep 5; done",
    "echo HEALTH_CHECK_FAILED >&2",
    "exit 1"
  ]' \
  --query "Command.CommandId" --output text)

echo "Command ID - $CMD_ID"

ssm_wait 180 "30 min"

echo "Time taken: $(( ( $(date +%s%3N) - CODEBUILD_START_TIME ) / 1000 )) seconds"
