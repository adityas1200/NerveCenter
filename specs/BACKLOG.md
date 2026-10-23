# Gap backlog

Collected from the specs and reconciled against the current code on 2026-10-11. Items marked **Recheck** have not been fully verified. Confirm before fixing, and fix by editing the spec first. Spec paths are relative to `specs/`.

## P0 Security
1. **Recheck authorization exceptions.** Route-level permissions are enforced in the backend, including `logs.view` on raw task logs (CR-17). Confirm the remaining permission-mode behavior before recording a security gap. (platform/rbac, tasks/inbox-approvals, routines/routine-management, tickets/ticket-lifecycle)
2. **`.env.defaults` is tracked and holds real-looking secrets** (`OPS_SECRET_ENCRYPTION_KEY`, `OPS_TRUSTED_IDENTITY_TOKEN`, admin ids). Confirmed present in git. Rotate and remove. (platform/configuration-environment)
3. **Remaining endpoint and data controls:** recheck custom API and MCP URL validation and production restrictions on local Git paths. The shared RDS path still lacks certificate verification. Board SQL uses parameter bindings, but effective provider grants must be checked in each deployment (CR-19). Strict 127/8 loopback parsing was fixed in CR-17. (connectors/endpoint-and-tls, knowledge/*, platform/storage-migrations, boards/board-widget-sources)
4. **Recheck permission policy:** classification is regex-based; verify scoped deny behavior for task modes and whether approvals remain limited to the exact tool step. (tasks/permission-policy)
5. **Secrets lifecycle:** default store is `memory` (silent loss on restart); deleting a connection leaves credentials behind. (connectors/secret-store)

## P1 Correctness
- **File store opens one events file per listed ticket, all at once.** With about 20,000 tickets `listTickets` fails with `EMFILE` (too many open files) on Windows, so local runs of the ticket list and the legacy overview crash at that size. Postgres is unaffected. Found while benchmarking ADR 0021; the grouped Overview endpoints no longer open these files. (`backend/src/app/operations-store.mts` `#withActivityMany`)
- **CI never runs the Postgres tests.** `NC_TEST_DATABASE_URL` is not set in `deploy/ci-test.sh` or `deploy/buildspec.yml`, so every `*-postgres.test.mjs` and the Postgres cases in `overview-ticket-counts.test.mjs` skip themselves. The SQL in ADR 0021 was checked on PGlite only.
- `OPS_MAX_UPLOAD_BYTES` is exposed in configuration but raw task-file serving uses a hard-coded 20 MiB cap. Recheck whether request-body and zip limits should share this setting. (platform/http-conventions)
- Settings writes validate only `agent`/`policy`; bad `connections` write leaves `operations.yaml` changed and `.mcp.json` failing; S3 sync last-writer-wins. (platform/settings-workspace)
- `DataPlatformService` calls Databricks methods that do not exist (`collectRcaEvidence`, `retriggerPipeline`, `getRemediationResult`). (pipelines/data-platform-catalog)
- **Recheck** monitor claims: job filtering for detail/history routes, run cap and page query cache key. `reconciliationErrors` is still returned as `{}`. (pipelines/pipeline-monitor, data-quality/dq-monitor)
- **Recheck** scheduler catch-up, overlap, cron day-of-month/weekday semantics, and `on_failure` behavior. The `list_routines` response now reads `lastRun.taskId`. (routines/*)
- `mergeOperations` overwrites Jira `ticketing.scope`; connector removal leaves seeded `operations.yaml` sections. (connectors/connector-service)
- Ticket creation still strips `startTriage` without starting triage. **Recheck** archived-ticket filtering; ServiceNow `Resolved` maps to `closed` per the source-sync spec, so treat that as a behavior decision rather than an assumed defect. (tickets/*)
- Overview returns hard-coded zeros for workflows/schedules/SLA/RCA; "Waiting on you" differs between Overview and Tickets; notifications never emit DQ or ServiceNow-outage items and read state is browser-only. (overview/*)
- In-memory message queue and parked decisions lost on restart. (tasks/task-runtime)
- Email: bare `SMTP_HOST` means port 25 plain vs form default starttls/587; Test does not check credentials. (connectors/email-smtp-connector)
- Backend and frontend checks run in `deploy/ci-test.sh`; the repository hook is installed per clone with `git config --local core.hooksPath .githooks`. The path-prefix governance checks were corrected in CR-13. (platform/quality-gates)

## P2 Docs drift (update DESIGN.md or the code)
- **Recheck** design-doc drift: default task permission, task-log authorization, API route inventory, connector names and setup affordance, plugin skill count, and agent-name configuration. Confirm each against current code before treating it as open. (docs/DESIGN.md)

## P3 Test coverage (specs mark these FRs "none")
**Recheck** coverage before adding tests: the suite now includes RBAC route/store tests, secret-store and TLS tests, migration tests, routine tests, inbox pagination, ticket sync/page, monitoring, and overview UI coverage. Identify remaining untested requirements in each spec rather than relying on this old aggregate list.

## Planned features
Not gaps in existing behaviour. Each needs a spec before any code.

- **Tested fixes, next steps (SPEC-tasks-13 known gaps).** Preview widgets at the reader's filters, not only the board defaults; watch the target for a while after a fix (a pipeline may rewrite it) and turn the board marker amber when the check fails again; detect Snowflake changes that keep `lastAlteredAt` and the row count (a checksum of the key columns); point picking for heatmap, funnel and gantt widgets (SPEC-tasks-12).

- **Synthetic edge-case data checks for pipeline fixes.** Sonic generates edge-case datasets (nulls, duplicates, schema drift, empty partitions, type overflow, late data) from a table's DDL and runs the pipeline's transform against them, to test a proposed fix before applying it.
  - Deployment target is AWS, so the checks would most likely run in the container environment (sandboxed, local Spark, DuckDB or similar), not by writing to a client catalog.
  - Status: on hold by owner decision 2026-10-04.
  - Depends on the `find_similar_tickets` work.
- **Agent shell sandbox per project (SPEC-projects-01 FR-47).** Run Sonic's Bash under the Agent SDK sandbox, with reads and writes limited to the project workspace, so one project's task cannot read another project's folder. Until then, projects are isolated in the API, the agent tools and the file tools (path guard), but not at the shell.
  - AWS (EC2 + Compose): install `bubblewrap` and `socat` in the backend image and give the backend container `security_opt: [seccomp=unconfined]`. Set `failIfUnavailable: true` and `allowUnsandboxedCommands: false`. Verify on the host that `cat ../<other-project>/x` fails from a project task.
  - Databricks Apps: no control over container security options, so the sandbox is assumed unavailable. Decide between a soft boundary (shell on) and shell off for project tasks.
  - The sandbox's network proxy may break `ssh` git remotes and drivers that ignore proxy variables; test before enabling.
  - Status: deferred by owner decision 2026-10-04.
