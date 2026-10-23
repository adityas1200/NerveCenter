#!/usr/bin/env bash
# AWS/EC2 deploy, bundle mode. Run by deploy/buildspec.yml when DEPLOY_PLATFORM=aws (the default).
#
# Zips the repository, ships it to the EC2 host through S3, swaps it in atomically (keeping every
# host .env), then rebuilds the Compose service(s) with deploy/aws/ec2/deploy-component.sh.
# Pipeline variables: COMPONENT, ENVIRONMENT, BUCKET_NAME, TARGET_INSTANCE_ID, TARGET_PATH, and
# optionally HEALTH_URL, PUBLIC_BASE_PATH, DEPLOYMENT_PROFILE. See deploy/aws/README.md.
set -e

# Resolved before any cd below.
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/ssm-wait.sh"

echo "Deploying full repository for $COMPONENT to $ENVIRONMENT"
rm -rf /tmp/deploy-staging
mkdir -p /tmp/deploy-staging
cp -r . /tmp/deploy-staging/
cd /tmp/deploy-staging && rm -f component.zip && zip -r component.zip . -x component.zip && cd -

aws s3 cp /tmp/deploy-staging/component.zip s3://$BUCKET_NAME/$ENVIRONMENT/$COMPONENT/diff-staging/component.zip

PROFILE_ARG=""
if [ -n "${DEPLOYMENT_PROFILE:-}" ]; then
  PROFILE_ARG="--profile ${DEPLOYMENT_PROFILE}"
fi
PUBLIC_BASE_PATH_ARG=""
if [ -n "${PUBLIC_BASE_PATH:-}" ]; then
  PUBLIC_BASE_PATH_ARG="--public-base-path ${PUBLIC_BASE_PATH}"
fi

CMD_ID=$(aws ssm send-command \
  --document-name "AWS-RunShellScript" \
  --targets "Key=InstanceIds,Values=$TARGET_INSTANCE_ID" \
  --parameters 'commands=[
    "set -e",
    "TS=$(date +%Y%m%d%H%M%S)",
    "BASE='"$TARGET_PATH"'",
    "WORKDIR=/tmp/repo-deploy-'"$COMPONENT"'",
    "BACKUP_DIR=$(dirname '"$TARGET_PATH"')/backups/'"$COMPONENT"'/$TS",
    "rm -rf $WORKDIR && mkdir -p $WORKDIR && cd $WORKDIR",
    "aws s3 cp s3://'"$BUCKET_NAME"'/'"$ENVIRONMENT"'/'"$COMPONENT"'/diff-staging/component.zip .",
    "rm -rf staged && mkdir staged && unzip -o component.zip -d staged",
    "ENV_KEEP_DIR=$WORKDIR/env-keep",
    "rm -rf $ENV_KEEP_DIR && mkdir -p $ENV_KEEP_DIR",
    "if [ -d $BASE ]; then cd $BASE && find . -type f -name .env -print | while IFS= read -r rel; do mkdir -p $ENV_KEEP_DIR/$(dirname $rel); cp -p $rel $ENV_KEEP_DIR/$rel; done && cd $WORKDIR; fi",
    "find staged -type f -name .env -delete",
    "if [ -d $BASE ]; then cd $BASE && find . -type f -name .env.example -print | while IFS= read -r example; do env_file=$(dirname $example)/.env; if [ ! -f $env_file ]; then cp -p $example $env_file; fi; done && cd $WORKDIR; fi",
    "> /tmp/diff-check-'"$COMPONENT"'.txt",
    "diff -rq -x .env $BASE staged >> /tmp/diff-check-'"$COMPONENT"'.txt 2>&1 || true",
    "if [ ! -s /tmp/diff-check-'"$COMPONENT"'.txt ]; then echo NO_CHANGES - skipping; exit 0; fi",
    "mkdir -p $BACKUP_DIR",
    "if [ -d $BASE ]; then cp -a $BASE/. $BACKUP_DIR/; fi",
    "tar -czf /tmp/backup-'"$COMPONENT"'-$TS.tar.gz -C $(dirname $BACKUP_DIR) $TS",
    "aws s3 cp /tmp/backup-'"$COMPONENT"'-$TS.tar.gz s3://'"$BUCKET_NAME"'/'"$ENVIRONMENT"'/'"$COMPONENT"'/backups/backup-$TS.tar.gz || echo WARN backup upload failed - continuing",
    "NEW_BASE=$BASE.new-$TS",
    "OLD_BASE=$BASE.old-$TS",
    "rm -rf $NEW_BASE $OLD_BASE",
    "mv staged $NEW_BASE",
    "if [ -d $BASE ]; then mv $BASE $OLD_BASE; fi",
    "if ! mv $NEW_BASE $BASE; then if [ -d $OLD_BASE ]; then mv $OLD_BASE $BASE; fi; exit 1; fi",
    "rm -rf $OLD_BASE",
    "if [ -d $ENV_KEEP_DIR ]; then cp -a $ENV_KEEP_DIR/. $BASE/; fi",
    "cd $BASE && find . -type f -name .env.example -print | while IFS= read -r example; do env_file=$(dirname $example)/.env; if [ ! -f $env_file ]; then cp -p $example $env_file; fi; done && cd $WORKDIR",
    "cd $(dirname $BACKUP_DIR) && ls -1t | tail -n +2 | xargs -r rm -rf",
    "rm -f /tmp/backup-'"$COMPONENT"'-$TS.tar.gz",
    "echo Deploy completed for '"$COMPONENT"'",
    "cd $BASE",
    "HEALTH_URL='"${HEALTH_URL:-}"' /bin/sh deploy/aws/ec2/deploy-component.sh --component '"$COMPONENT"' '"$PROFILE_ARG"' '"$PUBLIC_BASE_PATH_ARG"' --env '"$ENVIRONMENT"' --compose-file deploy/aws/docker-compose.yml",
    "echo Rebuild and restart complete for '"$COMPONENT"'"
  ]' \
  --query "Command.CommandId" --output text)

echo "Command ID - $CMD_ID"

ssm_wait 180 "30 min"

echo "Time taken: $(( ( $(date +%s%3N) - CODEBUILD_START_TIME ) / 1000 )) seconds"
