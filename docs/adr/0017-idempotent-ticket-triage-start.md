# 0017. Give automatic ticket triage one durable Task key

- Status: accepted (2026-10-12, user approved)
- Date: 2026-10-12
- Related: ADR 0013, ADR 0015, ADR 0016, SPEC-platform-14

## Context

ADR 0016 separates retryable ticket imports from Sonic triage. Today `ensureTask()` creates a Task and then writes its ID onto the Ticket. A process can stop between those writes. The next local triage pass sees no `ticket.taskId` and may start another Sonic Task. A process-local set cannot close this restart gap. ADR 0016's no-new-migration assumption is therefore insufficient for automatic triage without replaying an uncertain start.

## Decision

Add a forward-only migration with a unique partial Postgres index on `(project_id, context.ticket.autoTriageKey)` in Task JSON; file mode uses the existing exclusive task-index lock. Reuse the atomic scheduled-Task create path from ADR 0015 for automatic ticket triage, with a stable key made from the project and ticket ID. When a Ticket has no `taskId`, look up an existing Task by that key and link it before considering a new start. Only the automatic read-only triage path gets this key; a person's explicit Investigate action keeps its current behavior. A cancelled automatic triage Task is not started again automatically; a person may explicitly start a new Task.

Keep provider imports in the retryable job. The local triage pass reads only stored candidate tickets and uses the durable key; a repeated pass may relink a Task but cannot create another for the same ticket. The uncertain Sonic turn itself follows ADR 0013 and is never automatically resumed.

## Alternatives considered

- Process-local claim set: lost on restart.
- Scan recent Tasks without an index: cannot reliably find an older Task and does not arbitrate two starts.
- Disable automatic triage: changes a visible product behavior.

## Consequences

Migration 014 and a small file/Postgres task-store lookup are required. Existing Tasks and manual investigations remain valid. A cancelled automatic triage Task requires a person to restart deliberately. Tests cover concurrent Task creation, a crash after creation but before Ticket linkage, restart relinking, cancellation, and manual Investigate.
