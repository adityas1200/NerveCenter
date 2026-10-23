# Manual refresh verification — 2026-10-13

Implements [manual browser refresh](../specs/platform/manual-refresh.md) and the approved [notification contract](../specs/overview/notifications.md). Existing test changes were explicitly approved in chat.

## Behavior delivered

- Overview loads five independent source groups: tickets, pipelines, data quality, agent summary and work. Each has its own loading, freshness and failure state. Existing history windows and the legacy endpoint remain supported.
- Navigation and selection changes fetch the selected view. Refresh fetches its displayed data. Successful writes refresh affected active queries after any earlier read finishes; inactive caches become stale without fetching.
- Page polling, ticket-change subscriptions, focus/reconnect refresh and automatic retries are disabled. Task conversations use saved snapshots and manual refresh. Presence heartbeats are disabled; server jobs are unchanged, and presence-dependent synchronization may idle.
- Notification polling remains every 15 seconds: all-types counts while closed, all-types updates while open. Selected-tab drawer pages use cursors; update bursts drain sequentially, matching items are merged by ID, and older-page cursors are preserved. Near-bottom prefetch and virtualization handle long lists.
- Initial loads use skeletons; refresh retains content with busy indicators. Abort signals reach API reads. Repeated Refresh clicks reuse in-flight reads.

## Checks

| Check | Result |
| --- | --- |
| Frontend full unit suite | 108 files; 494 passed, 0 failed |
| Frontend governance, strict lint, typecheck and production build | Passed; build reports large-chunk warnings |
| Backend full `npm.cmd test` | 582 tests; 555 passed, 14 failed, 13 skipped |
| Backend notification/overview helper tests | 6 passed |
| Backend HTTP API suite | 14 passed |
| Backend typecheck and build | Passed |
| Notification focused frontend tests | 3 files; 10 passed |
| Write-refresh/Overview/agent focused tests | 3 files; 12 passed |

Frontend full quality command: `npm.cmd run quality:check --prefix frontend`. This runs governance, strict lint, typecheck, unit tests and production build. On this Windows host it uses `NODE_OPTIONS=--no-experimental-webstorage`, `VITEST_MAX_WORKERS=2` and `BREAKAGE_ALERT_ACK=ack`. The first avoids the host Node localStorage collision; two workers avoid oversubscribed test timing. The acknowledgment covers the approved behavior and dependency changes.

Full backend output: `backend-test-results-final.log`. Frontend final output: `frontend-quality-results-release.log`. Logs are local, ignored artifacts.

## Backend failures and baseline comparison

An isolated worktree at unchanged commit `42ec872e` was used to recheck failure cases. It was removed after comparison.

- Nine Windows path/symlink failures across `projects-agent`, `projects-scope` and `projects-workspaces` reproduced unchanged.
- Three `ticket-triage-idempotency` directory-cleanup races (`ENOTEMPTY`) reproduced unchanged.
- One task queue assertion receiving `[0, 1, 2]` instead of `[1, 2]` reproduced on repeated unchanged-baseline runs.
- One denied-approval task-state assertion failed in the full run (`running` instead of `waiting`), then passed targeted checks on both this branch and baseline. Its cause is not established.

Thus 13 of the 14 full-run failure cases reproduced on unchanged code. The backend suite is not green. These unrelated task/project tests were not weakened or skipped.

## Verification limits

No deployment was performed. Browser request behavior is covered locally by tests for idle/focus/reconnect silence, manual refresh, cancellation, notification cadence/pagination and loading/error states. The authenticated sandbox Network panel still needs checking after deployment to confirm pending calls do not accumulate in that environment.

Summary responses reduce browser payload and isolate source latency; they still aggregate existing bounded store reads on the server. This change does not add SQL indexes, database-side aggregates or a server cache. Notification counts likewise cover the existing source history windows.

## Follow-up: scheduled page refresh

The user subsequently requested [scheduled page refresh](../specs/platform/page-auto-refresh.md), superseding the manual-only page cadence above. `VITE_AUTO_REFRESH_SECONDS` defaults to 300, accepts custom positive integer seconds, and accepts zero to disable scheduling. It is embedded at frontend build time and passed through the AWS Docker/Compose build. Notification cadence and backend source sync are unchanged.

Page headers reuse their existing scoped Refresh action. The button shows a countdown, progress line and busy spinner; it waits for active reads/mutations, editing, dialogs, recent interaction and hidden tabs. Settings save footers, board edit state and unfinished conversation drafts protect unsaved work. Secondary item and drawer controls remain manual. Navigation cleans up old schedules; overdue intervals never replay in a burst.

- Focused refresh tests: **24 passed across 4 files**.
- Full frontend suite after the countdown change: **111 files, 510 passed, 0 failed**. Governance, strict lint, TypeScript checks and production build passed; build reports large-chunk warnings. Output: `frontend-quality-results-auto-refresh.log`.
- Targeted V8 coverage for the refresh control/scheduler/config: **98.64% statements, 96.55% branches, 100% functions, 100% lines**.
- Full backend rerun: **582 tests; 557 passed, 12 failed, 13 skipped**. Failures are nine Windows path/symlink cases, the task queue race, and two triage cleanup races; all were among cases reproduced at unchanged baseline. Output: `backend-test-results-auto-refresh.log`.
- Frontend production dependency audit: **3 low**, no moderate/high/critical findings. DOMPurify and KaTeX/Mermaid updates are follow-up dependency maintenance, not automatically applied in this change. Output: `frontend-audit-refresh.log`.

No deployment or live authenticated browser verification was performed. Build-size warnings and the backend failures remain disclosed for review.
