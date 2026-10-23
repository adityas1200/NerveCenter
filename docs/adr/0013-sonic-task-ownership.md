# 0013. Recover Sonic tasks without replaying uncertain work

- Status: accepted (2026-10-12, user approved conservative restart recovery)
- Date: 2026-10-12
- Related: ADR 0011, SPEC-tasks-01, SPEC-tasks-05

## Context

Deployments run one backend per workspace. `TaskRuntime` keeps `queuedRuns`, active runs, queued follow-up messages, and approval waiters in memory. A restart loses those queues. Boot recovery currently requeues a queued task from its last stored `user.message`, and resumes a running task with its saved SDK session once. A crash may happen after an external tool write succeeds but before its result is stored, so either recovery path can repeat a write. `WorkspaceSync` also requires one authoritative writer per prefix because each host pushes a local snapshot and deletes remote files it believes were removed.

## Decision

Keep one backend as the sole `TaskRuntime` and `WorkspaceSync` owner for each workspace. Do not add distributed task leases, cross-host command routing, or multi-host Sonic execution in this change; multi-instance Sonic is deferred to a separate ADR.

Make restart recovery conservative. Never automatically resume an interrupted SDK session or replay its last prompt. Mark interrupted runs `failed` with a clear restart/interruption error and retain their events, transcript, and Inbox items. Persist an accepted task's initial prompt and queued follow-up messages before returning the existing HTTP success response. Automatically start only a never-run task whose durable start command is still queued. If a process stops before a follow-up can run, retain it as unsent and require the person to explicitly resend or continue after reviewing the task. Do not silently discard it or infer that the last user message is the pending command.

Keep an approval that was still pending at restart visible and actionable. A decision already recorded when the process stops must not cause an automatic tool retry: require a fresh explicit continuation after the person reviews the task and its last events. Never claim that a possibly completed external write is exactly once; recovery must not repeat it automatically. Preserve task status vocabulary, event ordering and shapes, HTTP responses, and SSE frames/rendering (`event`, `delta`, `task`, keepalive); represent interruption through the existing failed status and error/event fields.

## Alternatives considered

- Resume/replay once after restart: convenient, but may repeat an external write with an unknown outcome.
- Add durable distributed task leases and route commands between hosts now: unnecessary for the confirmed single-backend deployment; workspace placement is not multi-host safe.
- Leave follow-ups only in memory: loses a message after HTTP success if the process stops before the next turn.

## Consequences

Requires durable representation of accepted but unsent follow-ups and a clear resend/continue action using existing task APIs/UI contracts. Approval decisions remain auditable, but an interrupted approved step needs a new human action. Multi-instance Sonic execution and shared/pinned workspace ownership require a separate approved ADR.

Critical tests: (1) a queued task never started before restart runs once; (2) a running task with a saved session is failed on recovery and its SDK/tool is not invoked; (3) a simulated crash after a write succeeds but before its result is stored does not replay that write; (4) a follow-up acknowledged before restart remains visible and is not lost or automatically sent; (5) pending approval remains actionable, while a previously decided approval does not retry its step until explicit continuation; (6) task HTTP shapes, persisted event sequence, SSE replay/live frames, and existing thread rendering remain compatible; (7) startup and shutdown use only the authoritative workspace sync writer.
