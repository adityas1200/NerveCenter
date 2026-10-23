# 0016. Move ticket imports and monitoring fetches to the scheduled-job dispatcher

- Status: accepted (2026-10-12, user approved)
- Date: 2026-10-12
- Related: `docs/adr/0011-own-durable-scheduled-job-queue.md`, `docs/adr/0013-sonic-task-ownership.md`, `specs/platform/scheduled-execution.md`, `specs/platform/scheduled-fetch-jobs.md`

## Context

GitHub and knowledge sync already use the shared scheduled-job dispatcher. Ticket imports and monitoring provider fetches still use process timers, so their due times are lost on restart and multiple dispatchers can perform the same fetch. Ticket polling also starts Sonic triage, and monitoring detection can start Sonic investigations; replaying either after an uncertain external action can create duplicate work. `POST /api/tickets/poll` and `POST /api/monitor/refresh` have existing permission, response, and synchronous completion contracts. The workspace sync timer remains tied to the one authoritative backend and local workspace.

## Decision

Register ticket-import and monitoring-fetch sources with the existing `ScheduledJobDispatcher`; add no queue, dependency, or migration. Use one durable due slot per project and source, derived from that project's existing cadence and the latest persisted job, with the existing active-app and `sync.enabled` gates. Shared Data Quality results have one job identity: the ledger-owning project.

Ticket import jobs call only the existing ServiceNow/Jira import operations and may retry up to three times with bounded backoff. Keep automatic triage as a separate, non-retrying operation after imports; never include `ensureTask`, `startTask`, or a task follow-up in a retryable import job. An uncertain Sonic start is terminal for that attempt and is not replayed automatically. Manual ticket polling remains a direct forced call with its current endpoint contract.

Monitoring jobs perform provider fetch and ledger writes only. Detection, alert routing, and any Sonic start remain outside retryable jobs and run after successful fetch completion on the existing detector cadence. Pipeline and Data Quality fetch due times remain independent per project/source. The manual monitoring refresh waits for its queued fetch work and detection to finish, then returns the existing `{ result, status }` response; its 30-second throttle and route permissions remain.

Stop each migrated provider-fetch timer in the same release. Retain only a local cadence for detector/triage work that does not poll providers. Keep workspace synchronization host-local under the one-backend ownership rule.

## Alternatives considered

- Queue the current combined ticket poll and monitoring `runProject()` calls: rejected because their retry paths can start Sonic work.
- Keep all current timers: rejected because due work is process-local and not coordinated.
- Add another queue or scheduling dependency: rejected because ADR-0011 already established the shared queue and file/Postgres stores.

## Consequences

Provider fetches gain persisted due slots, leases, and bounded retries. The implementation must separate provider reads from triage/detection and prove that failed or expired jobs cannot replay uncertain Sonic work. Manual API response shapes and per-project cadence remain stable. Rollback may restore the old provider timers while leaving queue history unused. Workspace sync and multi-instance Sonic ownership are unchanged.
