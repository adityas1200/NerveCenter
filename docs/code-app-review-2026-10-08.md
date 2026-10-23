# NerveCenter code and application review

**Reviewed:** 8 October 2026 on `zs-sandbox`  
**Status:** Draft  
**Scope:** Backend, frontend, plugin, configuration, deployment, CI, specs, and docs

This is the developer action list from the supplied 18 items, `specs/BACKLOG.md`, and the code review. Source IDs (`U`, `B`, `N`) are kept so each item can be traced to the original review. An unchecked item may already have partial work; check the note beside it before starting. Each change still follows `AI_CODE_GUIDELINES.md`, including spec or ADR approval when behavior or storage changes.

## P0 — Resolve before production approval

- [ ] **Rotate and remove exposed values** (`U-01`, `B-02`). Replace secret-like values in tracked `.env.defaults`, keep them out of container layers, and inject real values at runtime. Rotate any values that may have been exposed; removing a file does not revoke them. Add a secret scan to the release gate.
- [ ] **Resolve critical and high dependency findings** (`U-12`, `N-01`). Upgrade or replace affected packages and verify compatibility. For any finding that remains, record an owner, reason, expiry date, and follow-up ticket for the risk waiver.
- [ ] **Make route permissions explicit** (`U-02`, `B-01`, `B-03`, `N-02`; partial). Remove regex-based `ADMIN_ROUTES` fallback, declare permissions on every route, and fail closed when metadata is missing. Test connector, secret-status, connection-test, DQ-analyze, and board-preview routes across app roles, project roles, membership, and ownership.
- [ ] **Close the agent permission bypass** (`B-06`, `N-03`). Evaluate mandatory scoped denies before user-selected `allow`; replace heuristic command classification where it can grant broad access. Test the same write with allowed and denied scopes, including temporary approvals.
- [ ] **Isolate board queries** (`U-02`, `B-05`, `N-04`). Accept only approved read-only query shapes, reject multiple statements, use read-only database credentials, and enforce result limits and timeouts. Test rejected writes and unsafe SQL.
- [ ] **Harden connection and browser boundaries** (`U-04`, `B-05`). Require verified Postgres TLS, centralize URL and loopback checks, reject local/file Git sources in production, and add appropriate browser security headers. Test rejected unsafe endpoints and TLS configurations.
- [ ] **Make readiness trustworthy** (`B-08`, `N-05`; partial). Separate liveness from readiness. Readiness must fail when required auth, storage, migrations, or secret loading is unsafe or unavailable; verify deployment checks use it.

## P1 — Make behavior and releases reliable

- [ ] **Standardize API validation and errors** (`U-06`, `U-10`, `B-08`, `N-06`). Validate input and content type at the route edge, enforce upload limits, return stable status and error codes, and add request IDs and redacted structured logs. Test invalid input and document the API contract.
- [ ] **Protect streams and outbound requests** (`U-10`, `N-07`). Handle file-stream source errors, bound SSE lifetime and backpressure, stop work on disconnect, and give outbound Snowflake REST calls an abort timeout. Test failure and disconnect paths.
- [ ] **Finish the migration-only schema path** (`U-07`; partial). Move remaining inline table creation out of `backend/src/storage/postgres.mjs`. Verify fresh install, upgrade, rerun, migration locking, and file/Postgres parity.
- [ ] **Use bounded pagination** (`U-03`, `B-11`; partial). Define page or cursor, maximum size, stable ordering, and totals or truncation for tickets, tasks, inbox, and monitoring reads. Add UI pager states and tests for limits and ordering.
- [ ] **Prevent lost settings updates** (`B-09`, `B-13`; partial). Validate the complete settings document before writing. Add version or conflict checks for shared S3/workspace data, including connector and Jira scope changes; test concurrent edits and removal.
- [ ] **Fix runtime defects in small PRs** (`B-10`, `B-11`, `B-12`, `B-14`, `B-15`, `B-17`). Give each area its own contract tests: Databricks method calls; pipeline/DQ filters and cache keys; routine scheduling; ticket and ServiceNow state mapping; overview/notification accuracy; and SMTP authentication/TLS checks. Show unavailable metrics as unavailable instead of hard-coded values.
- [ ] **Persist queued work and decisions** (`B-16`). Specify restart behavior first, then make queued tasks and parked decisions durable in both file and Postgres stores. Test restart recovery.
- [ ] **Verify secret-store persistence** (`B-07`; partial). Confirm each deployment uses a persistent secret store and fails safely if that store cannot start. Retain the existing credential cleanup on connection removal and test both paths.
- [ ] **Enforce one release gate on Node 22** (`U-08`, `U-11`, `B-18`, `N-08`, `N-12`; partial). Remove silent test skips and bypasses; run backend, frontend, and plugin checks plus build, docs, dependency audit, secret scan, and migration guard. Publish pass/fail/skip counts and coverage. Local tooling must also select or reject the wrong Node version.
- [ ] **Make container builds traceable** (`U-09`). Use explicit backend and frontend image targets, remove hostname-based role inference, pin or review base images, and publish safe version and SBOM information. Verify each image starts only its intended service.
- [ ] **Prevent duplicate writes** (`U-13`, `N-09`). Add server-side idempotency or uniqueness for selected task, message, sync, and other repeatable commands. Test repeated clicks, retries, and replay.
- [ ] **Make secret deletion recoverable** (`N-10`). Use a recovery window by default; keep immediate deletion for an explicit, audited emergency path. Test both paths.
- [ ] **Make deployment recoverable** (`U-15`, `N-11`; partial). Add a deployment lock and immutable release ID, verify backups and restore, and automate rollback on failed readiness. Add metrics and an incident runbook; test overlapping and failed deploys.

## P2 — Improve maintainability after the release blockers

- [ ] **Measure frontend performance and tighten types** (`U-05`, `U-13`, `U-17`, `N-13`; partial). Set a bundle budget, then lazy-load expensive routes and libraries where measurements justify it. Enable frontend `strictNullChecks` and `noImplicitAny` incrementally with an error baseline. Keep the backend on Node 22 `.mjs` as required by `AI_CODE_GUIDELINES.md`; use runtime schemas, JSDoc, and stable DTO contracts where useful.
- [ ] **Refresh developer docs and specs** (`U-16`, `B-19`, `N-14`). Add a root README; correct E2E commands, frontend links, API and plugin inventories, and outdated agent/permission descriptions. Reconcile spec status with implemented behavior.
- [ ] **Close real test gaps** (`B-20`, `N-15`; partial). Recheck the backlog against current coverage, add tests for uncovered requirements, and remove Unix-only path and symlink assumptions from Windows-supported tests. Keep coverage and result counts visible in CI.

**Already addressed or guidance, not separate defect tickets:** The board cache key now includes user and project context (`B-04`); retain a regression test. Authentication already has a typed frontend module (`U-14`); verify consistency instead of rewriting it. Apply focused refactoring during the relevant fixes (`U-18`). Do not convert the backend to TypeScript (`U-05`, `U-17`).

## Verification snapshot

The test and plugin checks below were run on 9 October 2026 for this document edit. Dependency audit counts are from the 8 October review. This is **not** a release pass.

| Check | Recorded result |
|---|---|
| Backend `npm test` | 449 passed, 10 failed, 7 skipped (466 total). Failures include Windows symlink/junction and path assumptions; the monitoring-description test also failed. |
| Frontend `npm run quality:check` | Governance, lint, and typecheck passed; unit tests: 391 passed, 28 failed (419 total). The host ran Node 25.2.1 and Vitest reported a localStorage warning; rerun on required Node 22 before classifying the failures. Build was not reached. |
| Plugin validator | Passed: 1 plugin, 19 skills, 1 orchestrator. |
| Plugin unit tests | 56 passed, 0 failed. |
| Backend production dependency audit | 1 critical, 3 high, 4 moderate. |
| Frontend dependency audit | 5 high, 2 low. |

**Suggested order:** P0 security and readiness, then the P1 release gate and reliability fixes, then P2 documentation, performance, and coverage. Assign an owner and a small PR to each checklist item. Production approval depends on closing or formally waiving P0 findings and passing the authoritative Node 22 gate.
