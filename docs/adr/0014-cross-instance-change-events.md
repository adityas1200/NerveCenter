# 0014. Broadcast project change hints in one process

- Status: accepted (2026-10-12, user approved one-instance change hints)
- Date: 2026-10-12
- Related: ADR 0010, ADR 0011, `specs/tasks/task-runtime.md`

## Context

The deployment currently runs exactly one backend instance per workspace. The task stream at `GET /api/tasks/:id/events` replays stored task events by per-task `seq`, then subscribes to process-local runtime emitters for events, deltas and task snapshots. Its frames and rendering contract are established. Other pages poll independently, while TanStack Query keys already identify cached resources. ADR 0010 calls for project-authorized, resource-keyed UI hints and bounded visible-page polling during a disconnect.

## Decision

Add a separate, in-process, project-scoped change-hint broadcaster for non-task resource updates. An authenticated SSE endpoint authorizes the selected project on connection and emits only resource type/id hints with a timestamp; it carries no provider data, task transcript content, or write instructions. A small allowlist maps resource types to stable TanStack Query key roots, which the client invalidates. Keep the broadcaster memory-only and scoped to the current one-instance-per-workspace deployment.

The client owns one project-scoped connection above individual pages. On any disconnect or reconnect, invalidate active queries for the current project so they refetch authoritative state and close any delivery gap. While disconnected, visible queries use bounded polling with background polling disabled. Do not add persistent event storage, PostgreSQL notifications, or a new dependency.

Keep `TaskPage`, `TaskThread`, `useTaskStream`, and `/api/tasks/:id/events` unchanged: task event replay, `after` sequence, `event`/`task`/`delta` frames, partial output, snapshots, and rendering remain as they are. This generic hint feed does not replace or merge with task SSE.

## Alternatives considered

- Durable replay and cross-instance delivery: unnecessary for the confirmed single-instance deployment; requires a separate storage and write-path design.
- Poll every resource endpoint continuously: preserves page-specific timing gaps and duplicates requests.
- Reuse task SSE: couples generic invalidation to task authorization and risks its ordered output contract.

## Consequences

Hints can be lost during a connection interruption; reconnect invalidation/refetch and visible fallback polling restore current state, with bounded staleness. Memory use and delivery work scale with connected clients, so test cleanup, heartbeat, and bounded polling behavior. No schema or migration changes are needed. If deployment expands to multiple backend instances per workspace, in-process delivery is insufficient; evaluate durable replay and cross-instance notification in a new ADR before changing the design.

Test project isolation and denied streams, targeted query invalidation, reconnect/refetch after missed hints, disconnect polling limits including hidden tabs, subscriber cleanup, and preservation of task SSE frame and rendering behavior. Benchmark connected-client fanout and hint-to-refetch latency at expected workspace load.
