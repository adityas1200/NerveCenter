# Code cleanup and security review

Branch: `codex/backend-typescript-express-migration`
Started: 2026-10-11
Scope: the 17 original review items plus follow-up items agreed during the review. This board records findings and decisions; behavior changes remain governed by `specs/` and accepted ADRs.

## How to use this board

Review items in order unless a dependency says otherwise. Record the current code and tests before changing behavior. Keep fixes in small, reviewable changes and add tests for critical paths. Existing tests are changed or removed only under the confirmation rule in `AI_CODE_GUIDELINES.md`. Update a row with the finding, decision, checks, and resulting commit or PR before marking it done.

Status: **queued**, **reviewing**, **in progress**, **decision needed**, or **done**. “Done” means the completion check has evidence, not merely that code exists.

| ID | Review item | Status | Completion check / next action |
| --- | --- | --- | --- |
| CR-01 | Guard access and queries to sensitive information | done | Project grant isolation, credential separation, error redaction, and the approved-view policy are implemented and covered by regression tests. Provider grant verification is tracked separately in CR-19. |
| CR-02 | Pagination and lazy loading in frontend, API, and SQL | done | Board SQL is provider bounded; route pages load on navigation. Tickets, tasks, and inbox now filter, order, count, and page in both stores; Postgres query paths ran against a disposable database. Frontend uses server totals and URL pages. |
| CR-03 | Remove low-value tests | done | Removed an exact route-count assertion and static tests that checked plugin prompt and skill wording. Kept the host-generated knowledge fallback test and critical permission, data, and error behavior tests. |
| CR-04 | Validate lockfiles and package manifests | done | Both lockfiles regenerate unchanged; every direct package has a current use. No manifest or lockfile edit is justified. Audit findings belong to CR-06. |
| CR-05 | Replace polling where events and scheduled jobs fit | done | Inventory found no configured provider webhook source. Keep cadence-based external fetches and the existing cron-expression routine scheduler; task updates already use SSE. Revisit webhook delivery when a provider event source and deployment contract exist. |
| CR-06 | Audit dependencies and fix critical vulnerabilities | done | Backend full audit: 0 findings. Frontend production: 3 low, 0 high/critical; full tree: 7 high, 2 moderate, 3 low, 0 critical. Patched packages and clean install passed the quality gates. Remaining development-tool findings need an owner waiver before merge. |
| CR-07 | Remove unjustified fallbacks and enforce strict development rules | done | Failed job and DQ reads now surface errors; failed setting removals remain open and show errors. Focused monitoring (17/17) and UI (2/2) regressions passed. Documented provider retries remain. |
| CR-08 | Prevent SQL injection in board queries | done | Reviewed the full board SQL path. Adversarial filter input stayed in provider bindings, and viewer preview was denied (focused board suite 9/9). No SQL interpolation gap found. |
| CR-09 | Require certificate-verified Postgres TLS in client deployments | done | Databricks customer deployments now require verified TLS, reject `OPS_PG_SSL=disable`, and ignore URL TLS overrides. Focused pool-option tests passed (2/2). Live Lakebase handshake remains a deployment check. |
| CR-10 | Standardize API input, output, and error contracts | done | Errors now have status-derived codes, invalid JSON is 400, oversized bodies are 413, and unexpected failures are generic 500s. Ticket, task, and knowledge input/state errors use explicit 4xx statuses. Direct success payloads remain intact; focused HTTP tests passed 23/23. |
| CR-11 | Disallow persistent connections | done | The user chose provider sessions as the boundary. Snowflake sessions close after each query; Databricks, Jira, and ServiceNow use timed request/response calls. The metadata Postgres pool and task SSE stay because they serve different purposes. |
| CR-12 | Move database schema creation into migrations | done | Added an idempotent 001 baseline for the core, RBAC, and secret tables. Stores no longer create business tables. A fresh Postgres schema passed 6/6 focused tests; a legacy schema probe preserved rows and sequence positions. |
| CR-13 | Add pre-commit test hooks | done | Replaced the inactive frontend hook with one root hook, installed it locally, fixed governance path checks, and removed Husky/lint-staged. It runs focused checks for staged critical paths; full suites remain in CI. |
| CR-14 | Measure frontend performance | done | Post-pagination production build: entry 211.22 kB gzip, Tickets route 13.46 kB gzip. Routes and Mermaid render are deferred; no measured interaction regression or justified bundle rewrite. Capture browser latency in the target deployment if users report slowness. |
| CR-15 | Migrate backend HTTP edge to Express | done | Implemented under [ADR 0003](../adr/0003-adopt-express-for-backend-http.md), [MIG-008](../migration-tickets/MIG-008-express-edge.md), and [MIG-009](../migration-tickets/MIG-009-route-groups-release.md). |
| CR-16 | Write a root README | done | Added accurate Node 22 backend/frontend quickstart, checks, hook installation, storage and credential notes, architecture, deployment, and spec/guardrail pointers. |
| CR-17 | Revisit the backlog | done | Removed stale access, cache, HTTP, and CI claims; retained verified gaps. Fixed strict IPv4 loopback parsing and protected raw task logs with `logs.view`, both with focused regressions. |
| CR-18 | Group provider-specific connector code | done | Moved Databricks, Snowflake, Jira, and ServiceNow clients into `backend/src/connectors/<provider>/` under ADR 0008. Updated imports, specs, and backend layout without changing API or storage behavior. Focused provider and endpoint tests passed 54/54. |
| CR-19 | Verify provider roles in each deployment | deployment gate | Evidence fields and the approval rule are in `docs/security/provider-data-access.md`. A data owner must inspect each live Databricks or Snowflake principal's effective grants and record the result before enabling its project profile; this checkout has no provider grant evidence. |
| CR-20 | Do not seed PILOT on a clean deployment | done | File and SQL migration 003 create PILOT only for legacy data; startup also restores it for a legacy workspace. Existing PILOT data stays intact. Clean-start, legacy migration, compiled-build, and disposable Postgres checks passed. |
| CR-21 | Make missing Data Quality DDL actionable | done | Empty DDL now returns a clear 400 and Analyze stays disabled until DDL is pasted. The route and UI regressions passed; backend 488/497 passed with 9 skipped, frontend 442/442 passed, and plugin validation and 56/56 tests passed. |
| CR-22 | Activate the LocalTest Data Quality result table | in progress | Saved `deploy_agent_testing.dq_control_commercial.dq_run_summary` with `run_completed_at` as execution time and the supplied warehouse ID, but left it paused. The old in-memory Databricks credential was lost during restart; re-enter and test it in LocalTest Connectors, then enable the table and verify a live read. The backend now runs with file-backed local secrets. |
| CR-23 | Standardize polling, scheduling, execution, and UI refresh | in progress | [Audit](polling-scheduling-audit.md), [ADRs 0010–0017](../adr/), and [phase plan](../plans/polling-scheduling-standardization.md) track the work. Phase 1 removed duplicate Data Quality refreshes and slowed idle agent-status polling. Phase 2 made GitHub and knowledge cadence project scoped. Phase 3 now queues scheduled GitHub, knowledge, ticket imports, monitoring fetches, and routine starts; Sonic restart recovery is conservative, and automatic ticket triage uses a durable Task key. Provider fetch timers are stopped, while local triage and detector cadences remain. Phase 4's ticket change feed and cache invalidation are implemented; other resources retain polling. Full backend with Postgres 558/558, frontend quality 452/452, compiled smoke 9/9, and focused overlap test 4/4 passed. Live traffic, provider-call, freshness, and process-kill measurements remain. |

## CR-20: clean project startup

`SPEC-projects-01` FR-51 records the new behavior. The clean file-store test and backend startup test confirm there is no PILOT project or workspace, and background sync accepts a project created after startup. Legacy migration tests still confirm old tickets, tasks, and inbox items remain under PILOT. The full backend suite passed 487/496 with 9 skipped; compiled smoke passed 9/9, frontend quality passed 441/441, and plugin validation and 56/56 plugin tests passed. The clean and legacy Postgres migration tests then passed 6/6 against a disposable local database.

For local verification, the previous runtime and workspace were moved to ignored `backend/data/local-backups/20261011-pre-clean-start/`. A fresh runtime showed no PILOT, and a disposable first project opened Overview, Tickets, and Tasks without browser errors. The normal local paths were then reset for a clean start. This is a local data reset; it does not delete PILOT from an existing deployed store.

The final local check found the frontend proxy reporting `ECONNREFUSED` while the backend was down; after restart, the proxied projects endpoint returned an empty list. Frontend quality passed 441/441 tests, and plugin validation and 56/56 tests passed. The backend full suite passed 486/496 with one failure and nine skipped: the existing latest-alert assertion is sensitive to two alerts receiving the same millisecond timestamp. Its focused file passed 4/4 on rerun. This alert ordering issue remains open outside CR-20.

## CR-01: evidence and provider policy

- The route guard in `backend/src/app/rbac.mjs` checks write permissions and project roles. `backend/tests/rbac-routes.test.mjs` exercises viewer denials. The older “viewer writes are not enforced” note in `specs/platform/rbac.md` appears stale and needs reconciliation during this review.
- `backend/src/boards/board-service.mts` restricts preview and data discovery to board builders, requires SQL widgets to start with `SELECT`, rejects semicolons and listed write verbs, and caps returned rows at 200. Published board data is available to project readers through `backend/src/api/board-routes.mjs`.
- **Fixed in this review:** project reads previously used a global connection even when the request named a project. `ConnectionService` now has the project store, and provider clients, board SQL, table discovery, data-quality reads, and Sonic data-quality tools use the requesting project's grants. A project with no grant cannot resolve another project's credential. The new HTTP regression test covers two granted projects and one ungranted project.
- **Fixed in this review:** the Connectors form previously saved every project's managed provider under the same profile id. A later save could overwrite the earlier project's credentials. Managed profiles now have a project-qualified id, are granted to that project, and are revoked and removed when that project's connector is deleted. The HTTP regression test verifies that deleting one leaves the other intact.
- **Fixed in this review:** startup now imports deployment-environment credentials as a managed profile granted to PILOT (SPEC-projects-01 FR-32/FR-41). A persistent import marker keeps a profile an admin removed from reappearing on a later import. The focused regression covers the import and removal paths.
- Board SQL has no table or column allowlist. A permitted `SELECT` can read any data its **project-granted credential** can access. The returned-row cap limits response size, not which data can be read. The approved-view provider role is the chosen boundary; CR-19 tracks verification of the actual grants.
- Sonic's `query_data` tool calls that board preview and returns up to 50 raw rows to the agent. `backend/src/tasks/task-runtime.mts` records tool results as task events. Sensitive values allowed by a project's platform credential can therefore enter task history; the row cap does not redact them.
- **Fixed in this review:** `plainError` in `backend/src/boards/board-service.mts` returned unrecognized provider errors without redaction. It now uses the shared `errorText` redactor before returning a board error. `backend/tests/board-error-redaction.test.mjs` proves that fake password and token values do not reach readers.
- `specs/connectors/secret-store.md` documents a status-probe gap; current route tests appear to close some viewer probes. Confirm the implemented behavior and update stale spec gaps as part of the evidence review.

**Decision recorded:** use read-only provider roles limited to approved views, with one project grant per usable profile. See [provider data access](../security/provider-data-access.md). This keeps data classification and row/column permissions at the provider. The backend cannot prove that a role is limited to approved views; CR-19 requires a data owner to check effective grants in each deployment.

## CR-02: pagination finding to verify

`BoardService.#runSql` previously sliced to 200 only after the provider returned all rows. It now sends Databricks Statement Execution `row_limit: 200` ([provider documentation](https://docs.databricks.com/api/statement-execution/v1/statement-execution)) and wraps Snowflake board SQL in an outer `LIMIT 200` ([provider documentation](https://docs.snowflake.com/en/sql-reference/constructs/limit)). The API retains its 200-row backstop. `board-query-limit.test.mjs` failed before the change and now verifies both provider boundaries. A row bound does not guarantee a cheap query: an aggregate or sort can still scan more input.

The larger list gap was in tickets, tasks, and inbox. Their pages now request bounded server pages with deterministic ordering. Filters and search run before paging; totals and ticket facets cover the full authorized scope. The existing unpaged API forms still serve other consumers, while the list pages use the paged contract.

The page contracts preserve ticket counts, filter options, private-ticket visibility, and sort orders. Tasks place waiting and running work ahead of historical work. Inbox collapses repeated notifications before paging, replaces Approve all with explicit cross-page selection, and marks all eligible notifications read in the authorized scope. Approval statistics also traverse all pages rather than stopping at the old cap.

### CR-02 design decisions, 2026-10-11

- Lists remain live while a person browses. Use deterministic ordering with a unique ID tie breaker; refreshes may move rows between offset pages. A fixed browsing snapshot is not required.
- Replace Inbox "Approve all" with explicit selection of approvals the person has reviewed. Confirmation shows the exact selected count. "Mark all read" may cover every eligible item in the current authorized project scope.
- Preserve current case-insensitive substring search and its existing ticket and task fields. Apply search before totals and pagination.
- Ticket stat tiles and filter options cover the full accessible scope; the table receives a separate exact filtered total. Private tickets the caller cannot view contribute to neither.
- Task list order remains waiting, then running or queued, then historical tasks across the full result set. Within each group, order by newest update and use ID to break ties.
- No fixed 100,000-record or subsecond performance target was accepted. The team is small and moderate latency is acceptable; code structure is the priority. Do not silently cap history by age or row count; records remain reachable until an explicit archive, delete, or agreed retention policy removes them.
- Keep both file and Postgres metadata stores for CR-02 under the same list contract. Decide whether to consolidate metadata storage across the app as a separate architecture change; agent workspace files are a separate concern.
- Inbox approval selection persists across pages within one project and filter, shows the selected count, and clears when project or filter changes. Recheck permission and pending status before applying each selection. Stop on the first failure, report completed approvals and untouched selections, then refresh.
- Apply Inbox filters and newest-notification-per-task collapse before counting and paging. The pending approvals/questions count remains full-scope and separate.
- Keep the current `approvals.decide` route permission for project developers and owners and app admins; viewers may read. Correct the older Inbox spec's contradictory permission text.

These decisions were recorded in [SPEC-platform-11](../../specs/platform/pagination.md) and the affected list specs before implementation. The list and store changes use existing patterns; no snapshot layer, generic query framework, new dependency, or arbitrary performance target was added.

Implementation is covered by [SPEC-platform-11](../../specs/platform/pagination.md) FR-5/FR-6 and the affected list specs. No schema, dependency, or generic paging framework was added. Inbox displays task IDs in links so it does not load a separate capped task list just to resolve titles.

## CR-03: low-value test cleanup

The agent-context suites asserted exact prompt sentences, making editorial changes fail tests without checking agent behavior. The static orchestrator wording suite was removed, along with the duplicate monitoring-skill wording check. The generated `knowledgeLines` fallback tests remain, as do runtime behavior, authorization, data isolation, and failure-path tests.

Frontend route pages now use dynamic imports with a shared loading state. The production build emits separate page chunks; the shared entry is still 674.70 kB before compression, so CR-14 will measure the remaining startup cost after list pagination is complete.

## CR-18: provider module boundary

Before CR-18, provider clients were split across `backend/src/platform/`, `backend/src/jira/`, and `backend/src/servicenow/`. They now live in `backend/src/connectors/{databricks,snowflake,jira,servicenow}/`; the old provider paths have no tracked files. Shared connection profiles, secret storage, and connector orchestration remain in their cross-provider services. ADR 0008 chose `backend/src/connectors/` rather than the proposed `backend/connectors/` because `backend/src` is the TypeScript build root. The move changed no API or stored-data contract.

## CR-03: test cleanup

The route-scope test no longer pins the exact route count; it still checks every route's scope and write permission. The static tests for sentences in the orchestrator and monitoring skill were removed because they prove only wording, not that an agent follows the instruction. The `knowledgeLines` test remains because it checks generated host output for both tool modes. This is a test-only cleanup; the plugin content and runtime behavior did not change.

## CR-05: polling and scheduled work

Ticket import, integration and knowledge sync, and pipeline/data-quality monitoring read external state on configured cadences. There is no webhook receiver or provider event configuration in this checkout, so a new event path would need authentication, delivery retries, deduplication, and deployment setup. Moving these reads to system cron would still poll the same sources and would bypass the current per-project cadence, active-user gate, and single-flight checks unless those controls were rebuilt. The existing routine scheduler already evaluates cron expressions and records the last fired minute. Task execution pushes events over SSE; its keepalive and the browser presence heartbeat are connection/activity signals, not repeated data fetches.

Decision for this review: keep the current scheduled external reads and the task event stream. Browser list refresh remains limited to open pages; a shared event stream across tickets, inbox, routines, monitoring, and boards is a separate feature because it needs authorized publication and subscription across those domains. No new polling path or dependency was added. Revisit provider webhooks after the first source is configured to send authenticated events.

## CR-06: dependency audit

The initial backend production audit found 4 high and 4 moderate package records. Upgrading `adm-zip` to 0.6.1 and `snowflake-sdk` to 3.4.0 removed the direct ZIP and transitive TOML findings. The lockfile now resolves patched MCP SDK, `fast-uri`, Hono, `ip-address`, and Moment versions without adding them as direct dependencies. The final backend audit, including development dependencies, reports 0 findings. The backend suite passed: 470 tests, 0 failures, 8 database-dependent skips.

The initial frontend production audit found 5 high and 2 low package records. Mermaid's Chevrotain dependency pinned vulnerable `lodash-es`; a narrow override resolves all of its paths to 4.18.1. The production audit now reports 3 low records and 0 high or critical. The full frontend audit initially found 4 critical, 12 high, 5 moderate, and 3 low records. Vitest and its coverage package now use the aligned patched 4.1.11 releases; the required Testing Library DOM peer is explicit, and Handlebars is overridden to 4.7.10. Compatible transitive patches for `brace-expansion`, `js-yaml`, and `source-map-js` reduced the full audit to 7 high, 2 moderate, 3 low, and 0 critical at the final check. The remaining high records trace to `braces` 3.0.3 through development tools; its published 3.x line has no patched release in the current registry. Replacing those tools, including Tailwind 3, would be a separate major migration. Keep this visible for an owner risk decision before merge. The frontend quality gate passed after the updates, and a clean `npm ci` reproduced the lockfile.

## CR-08: board SQL injection review

Board builders author the SQL statement; readers may only supply filter values. `normaliseWidget` accepts one read-only `SELECT`, and provider calls reject multiple statements. The filter template is evaluated only inside named parameter values, which Databricks sends separately from the statement and Snowflake sends as positional bindings. Provider role restrictions from CR-01 still determine which approved views the statement can read. A focused regression passed with a filter containing a quote, predicate, semicolon, and `DROP TABLE`: neither provider's SQL text contained that value, both received it only as a binding, and a viewer could not preview SQL. No injectable interpolation was found in this path.

## CR-07: strict failure handling

An individual Databricks job history error previously became an empty list. Monitoring could then write a partial snapshot and move the incremental cursor past missing history. The job error now reaches the provider diagnostic, and monitoring rejects any snapshot with failed provider diagnostics before writing runs, inventory, or a new cursor. The last error remains visible. A regression covers partial Databricks failure alongside a healthy Snowflake result, unchanged cursor, and recovery on the next pass. Data-quality detection now reports a failed table listing through its existing error result instead of treating it as zero tables.

The result-table and pipeline settings removal dialogs previously closed after a failed mutation. They now close only after a successful call; the action toast and dialog report the failure. The shared dialog handles a rejected confirmation without leaving an unhandled promise. Focused regressions passed for both removal paths. Documented provider retries and visible ticket fallbacks remain in place.

## CR-09: customer Postgres TLS

All Postgres stores use `getPgPool()`. The customer Databricks deployment is identified by the existing `OPS_PLATFORM=databricks` platform setting. Its pool now requires TLS certificate verification and rejects `OPS_PG_SSL=disable`. It builds discrete connection fields so a URL's `sslmode` or `sslrootcert` cannot replace the verified TLS options, as [node-postgres documents](https://node-postgres.com/features/ssl). Node's default trust roots are used; a private CA may be provided through `NODE_EXTRA_CA_CERTS` before process start. The shared RDS path retains its current policy and is recorded as a known gap in SPEC-platform-06. The two focused option tests pass; a live Lakebase connection has not been attempted in this workspace.

## CR-10: HTTP contract

Every JSON error response with an `error` field now includes a stable status-derived `code`; 5xx replies hide internal messages. The request reader distinguishes malformed JSON (400) from an oversized body (413), and the HTTP edge treats untyped errors as 500. The API logs a bounded, redacted error summary. Validation in ticket, knowledge, and task workflows now uses explicit 400, 404, or 409 statuses for caller mistakes and state conflicts. Direct success response bodies remain unchanged. The focused HTTP route suite passed 23/23, and the frontend API client contract passed 2/2.

## CR-11: connection lifecycle

The user defined the prohibition as persistent provider sessions. Snowflake creates and destroys a connection for each query; the Databricks, Jira, and ServiceNow adapters use request/response calls with timeouts. The SMTP probe destroys its socket after testing. No provider session remains open for reuse. The shared Postgres metadata pool is bounded and idle connections expire; task SSE stays open only while a browser is watching a task so it can deliver events and partial output. Neither is a provider session. The current provider transport already meets this rule, so no code change is needed.

## CR-12: migration ownership

`001-control-schema.sql` now owns the base tickets, tasks, inbox, RBAC users, and secrets tables, their sequences, and indexes. Migration 004 already owns connection profiles. `ensureControlSchema` now runs only the ordered migration chain; the stores no longer issue business DDL. Configured schema creation and the migration ledger remain bootstrap prerequisites. The focused Postgres suite passed 6/6 on a fresh schema and repeat boot. An upgrade probe on a legacy schema retained seeded ticket/task rows and sequence positions while recording 001. The temporary database was removed.

## CR-13: commit checks

The repository hook lives at `.githooks/pre-commit` and is active in this checkout through `core.hooksPath`. It runs branch/test guardrails and staged docs/breakage checks for every commit. Staged backend or frontend source invokes typechecks, with lint and focused tests for API, authorization, storage, task, and changed test paths; plugin edits invoke its validator. Husky and lint-staged are no longer needed. Shell syntax, staged filename handling, docs and breakage gates, frontend typecheck, and the focused client contract passed. The full frontend quality gate also passed after the hook change.

## CR-14: frontend bundle baseline

The production build after CR-02 transformed 4,346 modules. The shared entry is 674.85 kB raw / 211.22 kB gzip and CSS is 141.46 / 24.41 kB. The Tickets route is 42.98 / 13.46 kB, Tasks is 8.35 / 3.55 kB, and Inbox is 15.79 / 5.87 kB. Every page route uses `React.lazy`; Mermaid is imported only when a diagram appears. Its `mermaid.core` (167.02 kB gzip) and ELK layout (451.15 kB gzip) chunks are large but deferred. List data is now requested in bounded pages. This build measures transfer size, not browser render time or target-network latency. No further code split is justified from these results alone; measure an affected interaction in the target deployment before narrowing Mermaid diagram support or changing the shared bundle.

## Evidence so far

- CR-04: `npm install --package-lock-only --ignore-scripts --offline --no-audit --no-fund` in temporary copies reproduced both committed lockfiles byte for byte. Direct dependency usage and backend Express type resolution were checked. No files changed.
- CR-01 redaction fix: the new focused test failed before the change and passed afterward. Focused board suite: 14 passed, 0 failed, 0 skipped; backend typecheck passed. The first restricted board-suite run crashed a native test worker before assertions; the rerun with local system access passed.
- CR-01 project isolation: `project-provider-isolation.test.mjs` exposed a cross-project connection list and a managed-profile collision before the fixes. Focused connector/project tests passed 11/11. Final backend gate: 466 passed, 0 failed, 7 skipped (database URL unset). Frontend quality check: 419 passed and production build passed. Plugin validator and 56 unit tests passed.
- CR-02 board SQL: focused board/Databricks tests passed 14/14 and backend typecheck passed. Final backend gate after the SQL and environment-import fixes: 469 passed, 0 failed, 7 skipped (database URL unset). A later focused connector/project rerun passed 11/11 after removing a swallowed profile-save error.
- CR-02 route loading: frontend quality check passed with 419 unit tests, lint, typecheck, governance, and production build. A follow-up loading-state polish is covered by the App route tests and the final quality gate.
- CR-03: focused agent-context tests passed, 6 passed, 0 failed, 0 skipped, after removing duplicate FR-8 coverage and loosening brittle exact-prose assertions. The knowledge helper import now follows the source's `.mts` extension.
- Latest full gate: backend 469 passed, 0 failed, 7 skipped (database URL unset); frontend quality check passed with 419 unit tests and a production build; plugin validator passed and 56 plugin tests passed.
- CR-02/CR-03 full gate: backend 483 passed, 0 failed, 0 skipped with a disposable Postgres database, including the new ticket, task, and inbox query test; frontend quality check passed with 424 unit tests and a production build; plugin validator passed and 56 plugin tests passed. The same backend suite without a database had 475 passed, 0 failed, 7 skipped. The database container was removed after the run.
- CR-15: the rebased migration gate recorded backend 470/470 with Postgres, frontend 419/419, plugin 56/56, and compiled smoke 9/9 in [MIG-010](../migration-tickets/MIG-010-upstream-rebase.md).
- Final review gate, 2026-10-11: backend 479 passed, 0 failed, 8 skipped without a database URL; compiled smoke 9/9; frontend 428/428 plus lint, typecheck, governance, and production build; plugin validator passed and 56/56 tests passed. Backend full dependency audit: 0 findings. Frontend production audit: 3 low, 0 moderate/high/critical; full dependency audit: 7 high, 2 moderate, 3 low, 0 critical. CR-19 remains a live-deployment grant check.
