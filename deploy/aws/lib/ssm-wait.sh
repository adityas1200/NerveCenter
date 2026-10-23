# Sourced by ci-deploy.sh and ci-deploy-git.sh. Not run directly.
#
# ssm_wait <max_polls> <label>
#   Polls the SSM command in $CMD_ID on $TARGET_INSTANCE_ID every 10 seconds, at most <max_polls>
#   times (<label> is only used in the progress line, e.g. "30 min"). Prints the final status and
#   the command output, and exits the calling script with 1 unless the command succeeded.
ssm_wait() {
  local max_polls="$1" label="$2" i STATUS FINAL_STATUS

  echo "Polling SSM command status (up to $label)..."
  for i in $(seq 1 "$max_polls"); do
    STATUS=$(aws ssm get-command-invocation \
      --command-id "$CMD_ID" \
      --instance-id "$TARGET_INSTANCE_ID" \
      --query "Status" --output text 2>/dev/null || echo "Pending")
    echo "  [$i] status: $STATUS"
    case "$STATUS" in
      Success) break ;;
      Failed|Cancelled|TimedOut) break ;;
      *) sleep 10 ;;
    esac
  done

  FINAL_STATUS=$(aws ssm get-command-invocation --command-id "$CMD_ID" --instance-id "$TARGET_INSTANCE_ID" --query "Status" --output text)
  echo "Final deploy status: $FINAL_STATUS"
  echo "=== STDOUT ==="
  aws ssm get-command-invocation --command-id "$CMD_ID" --instance-id "$TARGET_INSTANCE_ID" --query "StandardOutputContent" --output text
  if [ "$FINAL_STATUS" != "Success" ]; then
    echo "=== STDERR ==="
    aws ssm get-command-invocation --command-id "$CMD_ID" --instance-id "$TARGET_INSTANCE_ID" --query "StandardErrorContent" --output text
    exit 1
  fi
}
