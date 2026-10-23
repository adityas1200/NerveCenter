---
id: SPEC-tickets-06
title: Background integration sync (Databricks failures, knowledge, GitHub) and sync settings
status: implemented
area: tickets
owners: []
code:
  - backend/src/sync/integration-sync.mjs
  - backend/src/sync/sync-settings.mjs
  - backend/src/bootstrap.mjs
  - backend/src/main.mjs
  - backend/src/jobs/github-jobs.mjs
  - backend/src/jobs/knowledge-jobs.mjs
last_verified: 2026-10-12
---

# Background integration sync and sync settings

## Purpose
Keep NerveCenter current without anyone pressing a button: raise tickets for failed Databricks runs, keep git-backed knowledge bases fresh, mirror the configured GitHub repository into the workspace source folder and import its pull requests as tickets.

## Scope
- In scope: `IntegrationSyncService.poll` and its three jobs, the shared auto-sync switch and interval (`sync` section of `operations.yaml`).
- Out of scope: ServiceNow/Jira polling (SPEC-tickets-03/04; they share the same switch and interval but run in `TicketTaskService`), the Settings page UI.

## Actors and permissions
Runs as the system, only while the app is open (`presence.isActive()`). There is no HTTP endpoint for this service; settings are edited in Settings (admin).

## Requirements
- **FR-1** The service SHALL start unless env `OPS_INTEGRATION_SYNC=0`, check every `OPS_INTEGRATION_CHECK_SECONDS` (default 5), and run a first check 5 s after start. The app SHALL submit scheduled GitHub and knowledge checks through SPEC-platform-12 and SHALL stop their former automatic timer.
- **FR-2** A non-forced `poll()` SHALL return `{ skipped }` when the app is inactive (`app inactive`), a poll is running (`true`), no project's work is due (`interval not elapsed`), or every project has `sync.enabled === false` (`auto sync disabled`). A disabled project SHALL NOT block another project. `force: true` SHALL bypass these guards except the single-flight guard.
- **FR-3** Each active project's knowledge and GitHub due time SHALL be calculated independently from its `sync.<source>` cadence, then its shared `sync.intervalValue` x `sync.intervalUnit` or legacy `sync.interval_seconds`, then the source-specific server fallback. `sync.enabled` defaults to true. Settings SHALL be read on every check so changes apply without restart. GitHub and knowledge due slots SHALL survive a server restart in the scheduled job store. Shared knowledge bases SHALL follow ADR 0012's shared-base cadence.
- **FR-4** (Retired in the app 2026-10-06 by SPEC-tickets-07 FR-7: the app starts the sync with `databricksFailures: false`, and `pipelineFailed: ticket` opens these tickets instead. The job remains for a caller that asks for it.) The Databricks job SHALL read pipeline runs of the last 24 hours and, for each run on platform databricks with status `failed` that has no ticket with `sourceKey databricks:<pipelineId>:<runId>`, create a ticket (SPEC-tickets-01 FR-4) with `visibility: operators`, no assignee and creator `NerveCenter sync`; it SHALL return `{ checked, created }`.
- **FR-5** Each due project's knowledge job SHALL `sync` its git knowledge bases that have no pending or kept-but-unpushed changes, counting skipped and failed bases without aborting. A shared library base SHALL have one queued job across granting projects; two private bases with the same name in different projects SHALL remain independent.
- **FR-6** Each due project's GitHub job SHALL run only when that project's `operations.source_control.platform` is github and `repository` is set (accepts `owner/repo` or a GitHub URL); otherwise `{ skipped: 'GitHub source control is not configured' }`.
- **FR-7** The source mirror SHALL live under `<workspace>/source` (path outside it is rejected). A missing mirror SHALL be shallow-cloned from the default branch (default `main`); refuse if the folder exists without `.git`. An existing mirror SHALL be fetched with prune and fast-forwarded only when clean and on the default branch; a dirty or other-branch mirror is fetched but never merged.
- **FR-8** In a multi-project deployment, the GitHub token SHALL come only from that project's connector environment; a project without one SHALL skip GitHub sync without using a server-wide token or CLI login. The legacy single-project service may use process `GH_TOKEN` or `GITHUB_TOKEN`. A token used for git SHALL be passed as a Basic `http.extraHeader`, never in the remote URL.
- **FR-9** Pull requests (`gh pr list --state all --limit 100`) SHALL upsert project-visible tickets keyed `github-pr:<owner/repo>:<number>` within that project: OPEN draft -> open, OPEN -> in_progress, MERGED -> resolved, CLOSED -> closed; category `code_change`, type `pull_request`, tags `github`, `pull-request`, `draft`; existing assignee, priority, taskId, activity and creation date are preserved; creator is the PR author login. Result `{ checked, created, updated }`.
- **FR-10** In an explicit `poll()`, each job's error SHALL be captured in its own result key and SHALL NOT stop the other jobs. A scheduled GitHub error SHALL be recorded as a retry or failure in its job row.
- **FR-11** A project's GitHub credential and imported pull-request tickets SHALL stay in that project. Two projects configured for the same repository SHALL each retain their own ticket state and deduplicate its own subsequent imports.

## Scenarios
### S1 Idempotent poll
- **Given** one failed Databricks run, one clean git knowledge base and a repo with two PRs **When** the poll runs twice **Then** the second run creates nothing and updates the PR tickets only.
### S2 Dirty mirror
- **Given** local edits in the mirror **When** the poll runs **Then** it fetches and reports `dirty: true` but does not merge.
### S3 Inactive app
- **When** `isAppActive()` is false **Then** the scheduled poll is skipped; a forced poll runs.
### S4 Interval
- **Given** interval 1 minute **Then** a check 10 s after a run returns `interval not elapsed`.

## Interfaces
- No HTTP route. Entry points: `IntegrationSyncService.poll({force})` for explicit callers, scheduled GitHub `runGithub(projectId)` through `githubJobSource`, and scheduled knowledge `runKnowledge(projectId, name)` through `knowledgeJobSource`.
- Config: workspace `operations.yaml` keys `sync.enabled`, `sync.intervalValue`, `sync.intervalUnit`, `sync.knowledge`, `sync.github`, legacy `sync.interval_seconds`, `source_control.{platform,repository,default_branch,path}`. Env: `OPS_INTEGRATION_SYNC`, `OPS_INTEGRATION_SYNC_SECONDS`, `OPS_KNOWLEDGE_SYNC_SECONDS`, `OPS_GITHUB_SYNC_SECONDS`, `OPS_INTEGRATION_CHECK_SECONDS`, `GH_TOKEN`/`GITHUB_TOKEN`.
- Commands: `git clone|status|fetch|branch|merge`, `gh pr list`.

## Non-functional constraints
- Timeouts: clone/fetch/merge 180 s, status and branch 30 s, `gh` 120 s with a 16 MB buffer.
- Source path cannot escape the workspace; token is not logged or written to the remote.

## Known gaps / deviations
- Only Databricks failures are auto-ticketed; Snowflake or other platform failures are not.
- Failed-run detection uses status `failed` exactly, unlike ticket creation which also accepts error/timedout/canceled.
- Only the first 100 pull requests are imported; older PRs are never refreshed.
- GitHub PR state mapping edge cases (draft vs open) are covered by the existing integration test; provider authentication against a live GitHub repository remains a deployment check.

## Traceability
| Requirement | Code | Test |
|---|---|---|
| FR-1 | `backend/src/main.mts`, `backend/src/jobs/github-jobs.mjs`, `backend/src/jobs/knowledge-jobs.mjs` | `backend/tests/scheduled-github-jobs.test.mjs`; `backend/tests/scheduled-knowledge-jobs.test.mjs` |
| FR-2, FR-3 | `backend/src/sync/integration-sync.mjs` `poll`; `backend/src/sync/sync-settings.mjs`; `backend/src/jobs/github-jobs.mjs`; `backend/src/jobs/knowledge-jobs.mjs` | `backend/tests/integration-sync.test.mjs`; `backend/tests/integration-sync-project-scheduling.test.mjs`; `backend/tests/scheduled-github-jobs.test.mjs`; `backend/tests/scheduled-knowledge-jobs.test.mjs` |
| FR-4 | `backend/src/sync/integration-sync.mjs:91-103` | `backend/tests/integration-sync.test.mjs:60` |
| FR-5 | `backend/src/sync/integration-sync.mjs` `runKnowledge`, `#syncKnowledgeProject`; `backend/src/jobs/knowledge-jobs.mjs` | `backend/tests/integration-sync.test.mjs`; `backend/tests/integration-sync-project-scheduling.test.mjs`; `backend/tests/scheduled-knowledge-jobs.test.mjs` |
| FR-6, FR-8 | `backend/src/sync/integration-sync.mjs` `#syncGithub` | `backend/tests/integration-sync.test.mjs`; `backend/tests/integration-sync-project-scheduling.test.mjs` |
| FR-7 | `backend/src/sync/integration-sync.mjs:20-26`, `:134-150` | `backend/tests/integration-sync.test.mjs:44`, `:111` |
| FR-9 | `backend/src/sync/integration-sync.mjs` `githubTicket`, `#syncPullRequests` | `backend/tests/integration-sync.test.mjs` |
| FR-10 | `backend/src/sync/integration-sync.mjs` `poll` | `backend/tests/integration-sync-project-scheduling.test.mjs` |
| FR-11 | `backend/src/sync/integration-sync.mjs` `#syncGithub`, `#syncPullRequests` | `backend/tests/integration-sync-project-scheduling.test.mjs` |

## Open questions
- Should Snowflake failures and ServiceNow/Jira share one sync service?
