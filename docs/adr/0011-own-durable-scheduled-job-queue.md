# 0011. Own a small Postgres queue for scheduled work

- Status: accepted (2026-10-11, user approved Postgres queue and bounded routine catch-up)
- Date: 2026-10-11
- Related: ADR 0010, CR-23, `docs/plans/polling-scheduling-standardization.md`

## Context

Routine, monitoring, ticket, integration, and workspace timers currently execute work in their own process. Their local busy flags do not coordinate two servers, and most due times disappear on restart. We already use Postgres and forward-only app migrations; local file mode runs one backend. Phase 3 needs durable claims without changing provider clients, routine cron expressions, manual-refresh responses, or project permissions.

## Decision

Use the existing `pg` dependency and app migration chain for an `ops_scheduled_jobs` table and one claim lease per project. A scheduler only records due jobs with a unique project/source/slot key; a worker atomically claims a due row with `FOR UPDATE SKIP LOCKED`, runs the existing service method, and acknowledges it with a matching lease token. Expired leases become claimable again. Renew the lease during long provider reads. Cap work at one scheduled provider job per project; jobs for different projects may run concurrently. Local file mode gets the same job states and due-key deduplication with one process, without a multi-process guarantee.

Retry read-only provider fetches and idempotent imports up to three attempts with bounded backoff. Record terminal failures for operators. Do not automatically replay Sonic turns or ambiguous external writes. On restart, enqueue at most the latest missed slot per routine, record older missed slots as skipped, and never launch more than one catch-up routine per project at once. Manual Refresh now keeps its current permission and synchronous response contract while the route waits for the queued job to finish. Move one timer family at a time and disable its old timer in the same release.

The implementation will add migration `012-scheduled-jobs.sql` and a file-mode twin, a small job store and dispatcher under `backend/src/jobs/`, and startup wiring. Queue rows are operational run history, with a bounded retention policy added before deployment. Phase 3b must separately decide Sonic ownership, approval/message routing, and workspace/session placement before task runs use the queue.

## Alternatives considered

- **pg-boss:** supplies retries and cron, but its first start creates its own schema, adding migration and file-mode integration work beyond this queue ([documentation](https://pgboss.io/introduction)).
- **Graphile Worker:** supplies retries and cron, but manages a separate schema and recommends a shadow table for app-specific run history ([schema documentation](https://worker.graphile.org/docs/schema), [CLI documentation](https://worker.graphile.org/docs/cli/run)).
- **Keep process timers:** leaves duplicate claims and lost due work after restarts.

## Consequences

We own claim, lease renewal, retry, cleanup, and concurrency code and must test two-worker races and crash recovery against Postgres. Job keys make scheduled submission idempotent, but no queue can make external writes exactly once after a worker crashes. A failed rollout can switch a timer family back to its existing path; forward-only queue tables may remain unused. This ADR does not authorize multi-instance Sonic sessions.
