# NerveCenter infra checklist

## The five slots

NerveCenter is two containers plus four places to keep things.

| Slot | What goes in it | Why we need it | AWS today |
|---|---|---|---|
| **Compute** | Web container (nginx + UI), app container (API, agent sessions, ticket poller, scheduler) | Agents run real tools (git, Python, LibreOffice), so we ship our own image | EC2 + Docker Compose, or EKS + Helm |
| **Sign-in** | User id, name, groups/roles | Roles, ticket ownership and approvals are per person | Azure SSO via `OPS_SSO_SESSION_URL` |
| **Tables** | `ops_tickets`, `ops_tasks`, `ops_task_events`, `ops_ticket_events`, `ops_inbox`, `ops_boards`, `ops_data_quality_configs` | Many users and tasks at once need safe, queryable state | RDS Postgres, own schema via `NC_DB_SCHEMA` |
| **Files** | `operations.yaml`, `knowledge/`, skills, routines, task outputs | Containers are disposable; the workspace is restored on boot and synced every minute | S3: `s3://<bucket>/<prefix>/workspace/` |
| **Secrets** | Claude API key, DB password, connector credentials | Credentials never sit in files; they're injected into agent sessions | Secrets Manager: `beacon/<env>/nervecenter` and `/common` |

The app also needs outbound HTTPS to the Claude API and to each connector.

**Other platforms.** Postgres runs anywhere, and sign-in works through any proxy that sets
trusted headers (`OPS_IDENTITY_MODE=trusted-gateway`). Files and Secrets only talk to S3 and AWS
Secrets Manager today. Anywhere else (UC Volumes, Blob, GCS, Key Vault, Vault) needs a small
adapter in `backend/src/workspace/workspace-sync.mjs` and `backend/src/secrets/secret-store.mts`.

## AWS setup

- [ ] **Compute:** EC2 with Docker, or an EKS namespace. The ALB routes to `PUBLIC_BASE_PATH`
      (`/apps/nervecenter` on sandbox, `/nervecenter` on dev/EKS)
- [ ] **Role** (instance profile or IRSA). Never set AWS access keys. The role needs:
  - [ ] `secretsmanager:GetSecretValue` / `ListSecrets` on `beacon/<env>/*`
  - [ ] `s3:GetObject` / `PutObject` / `ListBucket` on `<prefix>/workspace/*`
- [ ] **Tables:** RDS reachable (security group) and `NC_DB_SCHEMA` set
- [ ] **Files:** bucket + prefix set (`OPS_S3_BUCKET`, `OPS_S3_PREFIX`)
- [ ] **Secrets:** both groups populated (db_*, s3_bucket, `ANTHROPIC_API_KEY`). Key names are in
      `backend/src/runtime-env.mjs`
- [ ] **Sign-in:** `OPS_SSO_SESSION_URL`, `OPS_ADMIN_USER_IDS`, and `OPS_TRUSTED_IDENTITY_TOKEN`
      (the EC2 deploy script generates one if it's missing)
- [ ] **Push-triggered builds (optional):** a CodeStar connection, and a literal
      `codestar-connections:UseConnection` grant on the *caller*

## Connectors

Set up in **Settings → Connectors**. Secrets go to the secret store, never into
`operations.yaml`. Source of truth: `backend/src/connectors/connector-catalog.mjs`.

| Connector | Fields | Secrets | Used by |
|---|---|---|---|
| Databricks | `DATABRICKS_HOST`, warehouse id | PAT, or SP client id + secret | Pipelines, Data Quality, Tasks |
| Jira | `JIRA_URL`, `JIRA_USERNAME` | `JIRA_API_TOKEN` | Tickets, Tasks, Knowledge |
| ServiceNow | `SERVICENOW_INSTANCE_URL` | username + password | Tickets, Tasks |
| Snowflake | account, warehouse, database, schema, role | username + password | Pipelines, Data Quality, Tasks |
| Email (SMTP) | server, port, security, sender | username + password (optional) | Reports, notifications |
| Custom MCP | URL, or command + args | — | Anything |
| Git knowledge | repo URL per knowledge base | host git credentials | Knowledge |

- ServiceNow uses the `echelon-ai-labs/servicenow-mcp` GitHub package. The PyPI package named
  `servicenow-mcp` is unrelated and broken.
- The Databricks connector is SQL/Jobs access only. UC Volume data is reached through SQL.
- Git knowledge sync and push-triggered deploys share one credential store, so when it breaks,
  both break.

## Learned the hard way

1. **Never set AWS access keys.** A missing permission means fix the role.
2. **Test SMTP from the deploy host.** Cross-account routing can silently block port 25.
3. **Console-made CodeBuild projects can drop env vars.** Check with
   `aws codebuild batch-get-projects`.
4. **SSM `AWS-RunShellScript` has no `HOME`.** Start git steps with `export HOME=/root`.
5. **The EC2 deploy runs `git reset --hard` on the checkout.** Push right after you commit. To
   recover a lost commit, use `git reflog` + `git cherry-pick`.
6. **The EC2 instance role's inline policy is at the 10 KB cap.** Check which identity is failing
   before widening it.
7. **Several people push to `feature/nervecenter-ui-changes`.** When a push is rejected, fetch and
   rebase.
