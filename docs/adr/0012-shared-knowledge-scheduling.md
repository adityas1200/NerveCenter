# 0012. Schedule shared knowledge sync by base identity

- Status: accepted (2026-10-12, user approved shared-base queue identity and cadence)
- Date: 2026-10-12
- Related: ADR 0011, `specs/tickets/integration-sync.md` (SPEC-tickets-06 FR-3, FR-5)

## Context

Knowledge sync still runs from each process's integration timer. Its in-poll `sharedKnowledgeSeen` set prevents duplicate shared-base sync only within one poll. ADR 0011's queue deduplicates and limits concurrency by project, so different projects or server instances can still sync the same library clone concurrently. Project auto-sync switches and knowledge cadences govern when work is due. Git sync skips pending changes, and the manual knowledge sync route is synchronous with its current response and permission behavior. Local file mode runs one backend and cannot coordinate separate processes.

## Decision

Move scheduled Git knowledge sync to the ADR 0011 dispatcher. Use one synthetic queue project identity per shared library base (`library:<base>`), source `knowledge`, and the existing unique `(project_id, source, slot)` key. A shared base has one due clock and one active queue lane: schedule it when any non-archived project granting that base has auto sync enabled and its configured knowledge cadence is due. One successful shared sync refreshes that base for every grant. Private bases retain project identities and their independent project cadences. Thus the shared-base cadence follows the fastest eligible grant, matching the current poll's behavior of syncing a shared base when any due project reaches it.

Derive the next shared slot from the latest job for that synthetic identity. Skip enqueue when that base already has a queued or running job. Concurrent schedulers observing the same latest slot submit the same next slot, and the queue's existing unique key resolves the race. Store the base identity in the payload and execute through the shared library knowledge service. The worker checks pending and kept-but-unpushed changes immediately before sync and records a skip; the service's existing `sync()` checks remain authoritative.

Manual `POST /api/knowledge/:name/sync` continues to call the current service directly with its existing response and authorization. Disable the old knowledge timer in the same release. No queue schema or migration change is required. File mode keeps its documented single-process guarantee.

## Alternatives considered

- Keep the process timer and in-poll set: cannot coordinate processes or survive restart.
- Use project identities for shared jobs: different projects can enqueue concurrent jobs for one library clone.
- Add a queue coordination-key column: duplicates the exclusion already provided by a synthetic project identity.

## Consequences

Tests must cover shared-base deduplication and contention, fastest eligible grant cadence and auto-sync gating, independent private bases, pending and kept local changes, lease expiry recovery, file mode, and unchanged manual route response and authorization. Queue retries and cleanup remain those of ADR 0011. Rollback can disable the knowledge dispatcher and restore the existing timer.
