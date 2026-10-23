# Spec index

Specs reverse-engineered from the code on 2026-10-03, plus later approved changes. See [BACKLOG.md](BACKLOG.md) for known gaps.


## automations

| ID | Spec | Status | FRs |
|---|---|---|---|
| SPEC-automations-01 | [Automations: Sonic investigates failed, late and missed pipelines and failed DQ checks](automations/auto-investigation.md) | implemented | 42 |

## boards

| ID | Spec | Status | FRs |
|---|---|---|---|
| SPEC-boards-02 | [Board widget sources (NerveCenter, SQL, text)](boards/board-widget-sources.md) | implemented | 11 |
| SPEC-boards-01 | [Boards: model, permissions and HTTP API](boards/boards-model-and-api.md) | implemented | 14 |
| SPEC-boards-03 | [Boards pages (list, board view, live build, widgets)](boards/boards-ui.md) | implemented | 10 |

## connectors

| ID | Spec | Status | FRs |
|---|---|---|---|
| SPEC-connectors-03 | [Connection profiles and provider resolution](connectors/connection-profiles.md) | implemented | 15 |
| SPEC-connectors-01 | [Connector catalog and connector cards](connectors/connector-catalog.md) | implemented | 12 |
| SPEC-connectors-02 | [Connector save, custom connections, remove, test, and agent environment](connectors/connector-service.md) | implemented | 18 |
| SPEC-connectors-07 | [Connectors page and dialogs (frontend)](connectors/connectors-ui.md) | implemented | 15 |
| SPEC-connectors-06 | [Email (SMTP) connector](connectors/email-smtp-connector.md) | implemented | 11 |
| SPEC-connectors-05 | [Endpoint rules, TLS trust and error redaction helpers](connectors/endpoint-and-tls.md) | implemented | 10 |
| SPEC-connectors-04 | [Secret store and secret-handling guarantees](connectors/secret-store.md) | implemented | 14 |

## data-quality

| ID | Spec | Status | FRs |
|---|---|---|---|
| SPEC-data-quality-03 | [DDL analysis and column mapping (with optional agent assist)](data-quality/ddl-mapping.md) | implemented | 9 |
| SPEC-data-quality-02 | [Data quality monitor and Data Quality page](data-quality/dq-monitor.md) | implemented | 16 |
| SPEC-data-quality-01 | [Data quality result-table configuration](data-quality/dq-result-tables.md) | implemented | 9 |

## knowledge

| ID | Spec | Status | FRs |
|---|---|---|---|
| SPEC-knowledge-07 | [Weekly knowledge pass and digest](knowledge/weekly-knowledge-pass.md) | implemented | 6 |
| SPEC-knowledge-06 | [Knowledge evals and journeys](knowledge/knowledge-evals.md) | implemented | 8 |
| SPEC-knowledge-05 | [Teach moments (corrections saved as drafts)](knowledge/teach-moments.md) | implemented | 6 |
| SPEC-knowledge-04 | [Typed links between knowledge pages and the knowledge map](knowledge/knowledge-links-and-map.md) | implemented | 13 |
| SPEC-knowledge-03 | [Knowledge setup (interview guide, transcripts into knowledge)](knowledge/knowledge-setup.md) | implemented | 11 |
| SPEC-knowledge-02 | [Git knowledge base folder selection and inspect](knowledge/git-folder-selection.md) | implemented | 10 |
| SPEC-knowledge-01 | [Knowledge bases (Git and local)](knowledge/knowledge-bases.md) | implemented | 17 |

## overview

| ID | Spec | Status | FRs |
|---|---|---|---|
| SPEC-overview-02 | [Notifications (/api/notifications and the bell)](overview/notifications.md) | implemented | 15 |
| SPEC-overview-01 | [Overview page and /api/overview](overview/overview-page.md) | implemented | 12 |

## pipelines

| ID | Spec | Status | FRs |
|---|---|---|---|
| SPEC-pipelines-06 | [Data platform catalog and provider contract](pipelines/data-platform-catalog.md) | implemented | 8 |
| SPEC-pipelines-04 | [Databricks read-only client (auth, jobs, runs, SQL, Unity Catalog)](pipelines/databricks-platform.md) | implemented | 11 |
| SPEC-pipelines-02 | [Pipeline health verdict, schedule parsing and typical duration](pipelines/pipeline-health.md) | implemented | 7 |
| SPEC-pipelines-03 | [Pipeline job include/exclude filter](pipelines/pipeline-job-filter.md) | implemented | 7 |
| SPEC-pipelines-01 | [Pipeline monitor (Pipelines page and /api/monitor)](pipelines/pipeline-monitor.md) | implemented | 16 |
| SPEC-pipelines-05 | [Snowflake read-only service and metadata provider](pipelines/snowflake-platform.md) | implemented | 10 |
| SPEC-pipelines-07 | [Pipeline auto-RCA (read-only RCA on failed, delayed and missed runs)](pipelines/pipeline-auto-rca.md) | deprecated (superseded by SPEC-automations-01) | 23 |

## platform

| ID | Spec | Status | FRs |
|---|---|---|---|
| SPEC-platform-16 | [Overview timestamp placement and cookie session recovery](platform/overview-and-session-recovery.md) | approved (renewal blocked) | 6 |
| SPEC-platform-05 | [Configuration, environment loading, /health and /api/meta](platform/configuration-environment.md) | implemented | 9 |
| SPEC-platform-07 | [HTTP server conventions (routing, errors, CORS, body and upload limits)](platform/http-conventions.md) | implemented | 9 |
| SPEC-platform-01 | [Identity and authentication modes](platform/identity-auth.md) | implemented | 12 |
| SPEC-platform-03 | [App presence and heartbeat](platform/presence.md) | implemented | 6 |
| SPEC-platform-08 | [Quality gates and delivery guardrails](platform/quality-gates.md) | implemented | 9 |
| SPEC-platform-02 | [Roles, permissions and admin-only routes](platform/rbac.md) | implemented | 13 |
| SPEC-platform-04 | [Settings and agent workspace (operations.yaml, MCP config, S3 sync)](platform/settings-workspace.md) | implemented | 13 |
| SPEC-platform-06 | [Storage backends and database migrations](platform/storage-migrations.md) | implemented | 9 |
| SPEC-platform-09 | [Sign-in page (replaces the automatic redirect to the SSO login)](platform/sign-in-page.md) | implemented | 9 |
| SPEC-platform-10 | [Per-project fetch cadence and the background fetch](platform/fetch-cadence.md) | implemented | 12 |
| SPEC-platform-11 | [Pagination for every long list](platform/pagination.md) | implemented | 4 |
| SPEC-platform-12 | [Durable scheduled execution](platform/scheduled-execution.md) | implemented | 8 |
| SPEC-platform-14 | [Durable ticket and monitoring fetch schedules](platform/scheduled-fetch-jobs.md) | implemented | 9 |
| SPEC-platform-13 | [Project change hints for UI refresh](platform/project-change-hints.md) | implemented | 6 |
| SPEC-platform-15 | [Page navigation cues, action placement and complete filtering](platform/page-navigation-and-complete-filtering.md) | draft | 8 |

## projects

| ID | Spec | Status | FRs |
|---|---|---|---|
| SPEC-projects-01 | [Projects (scoping layer over the whole app)](projects/projects.md) | draft | 43 |
| SPEC-projects-02 | [Project roles (project admin and member), project creation and private tickets](projects/project-roles.md) | draft | 29 |
| SPEC-projects-03 | [Owner, developer and viewer in every project, open projects, the home page and the admin console](projects/project-access-and-home.md) | implemented | 23 |

## routines

| ID | Spec | Status | FRs |
|---|---|---|---|
| SPEC-routines-01 | [Cron parsing and routine scheduler tick](routines/cron-scheduler.md) | implemented | 11 |
| SPEC-routines-02 | [Routines (create, edit, run, test, pause, check)](routines/routine-management.md) | implemented | 15 |
| SPEC-routines-03 | [Durable scheduled routine starts](routines/durable-scheduling.md) | implemented | 6 |

## skills

| ID | Spec | Status | FRs |
|---|---|---|---|
| SPEC-skills-02 | [operations-fleet plugin contract with the app](skills/operations-fleet-plugin.md) | implemented | 9 |
| SPEC-skills-01 | [Skills library (browse, upload, remove)](skills/skills-library.md) | implemented | 11 |

## tasks

| ID | Spec | Status | FRs |
|---|---|---|---|
| SPEC-tasks-07 | [Agent panel and "Ask Sonic"](tasks/agent-panel.md) | implemented | 10 |
| SPEC-tasks-04 | [Agent tools (in-process NerveCenter MCP server)](tasks/agent-tools.md) | implemented | 11 |
| SPEC-tasks-05 | [Inbox and approvals (approve, deny, answer, read)](tasks/inbox-approvals.md) | implemented | 15 |
| SPEC-tasks-03 | [Permission policy (write gating, categories, scoped rules, grants)](tasks/permission-policy.md) | implemented | 16 |
| SPEC-tasks-01 | [Task runtime (lifecycle, events, streaming, sessions, edit and resume)](tasks/task-runtime.md) | implemented | 25 |
| SPEC-tasks-06 | [Tasks UI (list, New task, task page, thread, live stream)](tasks/tasks-ui.md) | implemented | 18 |
| SPEC-tasks-02 | [Ticket tasks (one task per ticket, triage poller, mirroring)](tasks/ticket-tasks.md) | implemented | 13 |
| SPEC-tasks-08 | [Agent context at session start (skills shown, knowledge first, unslop on every reply, skill routing)](tasks/agent-context.md) | implemented | 10 |
| SPEC-tasks-09 | [Task files live in the Details sheet, not in the thread](tasks/shared-files.md) | implemented | 3 |
| SPEC-tasks-10 | [One-thread task page and Sonic's component catalog (generative UI)](tasks/generative-ui.md) | implemented | 23 |
| SPEC-tasks-11 | [Attach files and images to a message](tasks/chat-attachments.md) | implemented | 11 |
| SPEC-tasks-12 | [Ask Sonic about what you see (widgets, chart points, rows, screenshots)](tasks/ask-about-this.md) | implemented | 10 |
| SPEC-tasks-13 | [Tested fixes (sandbox, preview, approve, apply, verify)](tasks/tested-fixes.md) | implemented | 19 |

## tickets

| ID | Spec | Status | FRs |
|---|---|---|---|
| SPEC-tickets-06 | [Background integration sync (Databricks failures, knowledge, GitHub) and sync settings](tickets/integration-sync.md) | implemented | 10 |
| SPEC-tickets-01 | [Ticket lifecycle (list, create, view, update, comment, activity)](tickets/ticket-lifecycle.md) | implemented | 16 |
| SPEC-tickets-04 | [ServiceNow and Jira ticket import, status and write-back](tickets/ticket-source-sync.md) | implemented | 11 |
| SPEC-tickets-02 | [Ticket status view, agent view and ticket dashboard](tickets/ticket-status-and-dashboard.md) | implemented | 8 |
| SPEC-tickets-03 | [Ticket to task: automatic triage, Investigate and ticket polling](tickets/ticket-triage-polling.md) | implemented | 13 |
| SPEC-tickets-05 | [Tickets page (list, filters, quick view, create, sync dialogs)](tickets/tickets-page.md) | implemented | 12 |
| SPEC-tickets-07 | [Tickets NerveCenter opens in ServiceNow and Jira, and keeps up to date](tickets/external-ticket-create.md) | implemented | 7 |

| SPEC-platform-manual-refresh | [Manual browser refresh](platform/manual-refresh.md) | implemented | 6 |
| SPEC-platform-page-auto-refresh | [Scheduled page refresh](platform/page-auto-refresh.md) | implemented | 4 |
| SPEC-platform-15 | [Page navigation cues, action placement and complete filtering](platform/page-navigation-and-complete-filtering.md) | implemented | 8 |
