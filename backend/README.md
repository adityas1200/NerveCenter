# NerveCenter backend

Node 22 with an Express 5 HTTP entrypoint. One process serves the HTTP API, runs agent sessions with the Claude Agent SDK and the vendored `operations-fleet` plugin, synchronizes connected systems and fires routines. The existing route table still handles scope, permissions, request parsing, and response formatting. The design is in [`docs/DESIGN.md`](../docs/DESIGN.md).

## Run it

```bash
npm install
npm run build     # compile the backend once before start
npm start          # http://127.0.0.1:8787
npm run dev        # watch TypeScript and JavaScript source with tsx
npm test           # node --test, no external services needed
```

Local development uses files: tickets, tasks and inbox under `data/runtime/`, the agent workspace under `workspace/` (both untracked). Set `ANTHROPIC_API_KEY` to run real tasks and `OPS_SECRET_STORE=file` so connector credentials survive a restart (`data/runtime/secrets.json`; the default `memory` store forgets them). Run exactly one backend per workspace: approvals are resolved in the process that owns the task. Email needs either the Email connector saved in the app or `EMAIL_NOTIFICATIONS_ENABLED=true`, `EMAIL_PROVIDER=smtp`, `SMTP_HOST`, `SMTP_PORT` and `SMTP_USE_TLS` in this file; Connectors > Email > Test connects to the relay from this machine, which is the check to run before asking the agent to send anything. Deployed instances use Postgres, S3 and AWS Secrets Manager; see [`deploy/README.md`](../deploy/README.md).

A clean deployment starts with no normal project. Create the first project from Home. The `pilot` project is created only to retain data from the earlier single-workspace layout; existing PILOT projects are kept.

System URLs must be HTTPS; plain HTTP is accepted only for loopback addresses (127.0.0.1, localhost), which is how a local stub of Databricks, ServiceNow or Jira can stand in for the real system.

## How a task runs

1. A task is created from the Tasks page, the agent panel on any screen, a ticket (Investigate or the poller) or a routine.
2. `tasks/task-runtime.mts` starts a Claude Agent SDK session with `cwd` = the workspace, the plugin loaded, the plugin's orchestrator prompt appended, and a `canUseTool` gate.
3. The gate (`tasks/permission-policy.mts`) allows reads and writes inside `tasks/<id>/`; other writes become Inbox approvals (`ask`) or are denied (`read-only`).
4. Events are saved with the task; the browser reads them on opening, manual refresh, and after relevant user actions. The SSE endpoint remains available for compatible clients. The result and cost land on the task.

### Tested data fixes

`tasks/fix-service.mts` (SPEC-tasks-13, ADR 0020) gives Sonic a sandbox for SQL fixes: `create_fix_sandbox` clones a table into `fixes.sandbox.<platform>` from `operations.yaml`, `run_in_sandbox` runs one statement whose writes stay in that schema (`tasks/sql-scope.mts` checks it), and `propose_fix` measures the change on the copy: row counts, `EXCEPT` diffs, the checks, and up to three board widgets that read the table, run "Now" and "After fix". The proposal is the tool result in the task's events. `apply_fix` (a production change, so it asks) reads that stored proposal, refuses if the table moved since the test (Delta version, last altered, row count), runs the one statement, re-runs the checks and widgets, records `fixes` on the task, and drops the copy when verification passed. Boards read `fixes` to mark widgets "Fixed by Sonic". Without a `fixes.sandbox` entry the tools fail with a sentence saying what to add.

`get_board_widget_data` and the page selection's `detail` (SPEC-tasks-12) let Sonic read back exactly the widget, filters and point a person asked about.

## Browser reads

The browser uses scoped manual and scheduled page refresh, plus the notification bell's separate 15-second summary/updates poll. Public frontend build setting `VITE_AUTO_REFRESH_SECONDS` defaults to 300; zero disables scheduled page refresh. It is embedded by Vite and does not change backend synchronization cadence or require a backend config entry. Overview has separate ticket, pipeline, data-quality, agent and work summary endpoints under `/api/overview/`; the legacy combined endpoint remains supported. These summaries preserve existing store history windows and group calculations by source. They do not introduce new SQL indexes or database aggregates.

Browser presence heartbeats and task/change subscriptions are disabled under [the manual refresh spec](../specs/platform/manual-refresh.md). Server jobs remain configured as before; presence-dependent synchronization can become idle without a heartbeat.

## Layout

```
src/
  api/            HTTP routes: server.mjs plus task, routine, connector and library (skills, knowledge) routes
  app/            tickets, overview, RBAC
  tasks/          task store, runtime (SDK sessions), permission policy, ticket poller, ui-catalog.mjs (Sonic's components, SPEC-tasks-10)
  routines/       cron parsing and the scheduler (routines are plugin workflows/*.yaml)
  workspace/      the agent workspace: operations.yaml, .mcp.json rendering, skills and knowledge helpers, S3 sync
  connectors/     shared connector catalog/service plus databricks/, snowflake/, jira/, servicenow/ provider clients
  knowledge/      Git knowledge bases (clone, sync, browse)
  sync/           background Databricks, GitHub source, pull-request and knowledge synchronization
  skills/         custom skill uploads (zip into .claude/skills)
  connections/    managed connection profiles used by the data pages (Databricks, Snowflake, ServiceNow, Jira)
  platform/ data-quality/   platform coordination and data-quality helpers
  storage/ secrets/                            Postgres pool and schema, secret store (memory or AWS)
tests/            node:test suites, one temp workspace per file
../plugin/operations-fleet/   vendored plugin; every session loads it (see ../plugin/SOURCE.md)
```

## Configuration

Everything client-specific lives in the workspace's `operations.yaml`, edited by Settings and Connectors in the UI and by the plugin's `setup` skill. Environment variables cover the deployment only: identity mode, stores, model, concurrency, poll intervals. `deploy/aws/.env.example` lists them.

In a Databricks customer deployment, Postgres requires TLS and verifies the server certificate. `OPS_PG_SSL=disable` is rejected there. Node's trusted CAs are used by default; if Lakebase uses a private CA, mount its PEM bundle and set `NODE_EXTRA_CA_CERTS` before starting the backend. Other deployment paths retain their current `OPS_PG_SSL` behavior while their CA setup is reviewed.

`fixes.sandbox` (optional) names the schema per platform where Sonic tests data fixes on copies; see `docs/operations.example.yaml`.

Secrets never enter `operations.yaml`. Connector secrets are stored as `connectors/<id>/<ENV>` and injected into agent sessions as environment variables; `.mcp.json` carries `${ENV}` references that Claude Code expands.

## Automatic synchronization

- Jira and ServiceNow tickets are imported on each project's `sync.tickets` cadence, with `OPS_TICKET_POLL_SECONDS` as the fallback (120 seconds in the tracked local defaults). `OPS_TICKET_POLLING=0` disables scheduled imports and automatic triage.
- Databricks pipeline runs and data-quality results follow their project source cadences through monitoring; the older failure scanner in integration sync is disabled by the app.
- Clean Git knowledge bases sync on each project's `sync.knowledge` cadence, or the shared interval, then `OPS_KNOWLEDGE_SYNC_SECONDS` (15 seconds by default). Bases with uncommitted changes are left untouched.
- A configured GitHub source repository is cloned under its project's `source/`, then fetched on that project's `sync.github` cadence, or the shared interval, then `OPS_GITHUB_SYNC_SECONDS` (15 seconds by default). Each project needs its own GitHub connector token; without one it skips GitHub sync. A clean default-branch mirror is fast-forwarded. Pull requests and their checks become project-scoped tickets with stable source keys.
- `OPS_INTEGRATION_SYNC=0` disables GitHub and knowledge background synchronization. Manual refresh and sync actions remain available.
- Settings > Workspace > Automatic sync is admin-only. Auto sync is each project's master switch, and Sync every is the fallback cadence for Jira, GitHub and knowledge. Optional `sync.github` and `sync.knowledge` values use `{ every, unit }` with a 30-second to 24-hour interval. When auto sync is off for one project, that project's scheduled calls are skipped without stopping other projects; manual sync remains available.
- When Auto sync is on, a visible browser sends a heartbeat every 30 seconds. After `OPS_SYNC_IDLE_SECONDS` without one (90 seconds by default), background calls are skipped until somebody returns. Set it to `0` to keep polling continuously; manual Jira sync is never blocked by the idle gate.

The GitHub connector stores its token in the secret store and requires `git` and `gh`; both are installed in the backend images. The disposable `workspace/source/` mirror is excluded from S3 workspace backup and is cloned again after a restart.

Scheduled GitHub, knowledge, ticket imports, monitoring fetches, and cron routine starts use the scheduled-job store (ADRs 0011–0017): Postgres in deployments and `data/runtime/jobs/jobs.json` locally. A project/source/slot has one durable job; shared knowledge bases use one `library:<base>` queue identity across granting projects. A worker leases it, retries eligible provider work up to three times, and keeps seven days of terminal run history. Automatic ticket triage, monitoring detection, and Sonic execution remain outside retryable provider jobs. Manual sync and refresh APIs keep their existing response paths.

## Roles

Admin: everything, including Settings, Connectors, Knowledge and Skills writes, task logs. Developer: create tasks, chat, approve, read everything. Users are registered on first sign-in; `OPS_ADMIN_USER_IDS` seeds admins.
