# MIG-006 — Type task runtime and bootstrap

- Status: done
- Depends on: MIG-005
- Decision: ADR 0002

## Scope

Convert bootstrap and Sonic task-runtime modules after their service contracts exist. Type session events, permission decisions, approval/resume state, and process startup without changing what an agent may access or how many jobs start.

Reviewable slices: [MIG-006A](MIG-006A-permission-policy.md) for permission policy, [MIG-006B](MIG-006B-agent-tools.md) for agent tools, [MIG-006C](MIG-006C-task-runtime.md) for the session runtime, and [MIG-006D](MIG-006D-bootstrap.md) for bootstrap and entrypoint.

## Acceptance

- [x] Permission checks, approval/resume, and task SSE behave as before in source and compiled execution.
- [x] One backend process owns each scheduler and task session; startup and shutdown paths typecheck.
- [x] Existing task tests and focused uncovered critical-path checks pass.

## Evidence

MIG-006A through MIG-006D passed focused policy (46), tool (44), task/stream (34), and startup/API (21) checks, each with 0 failures and 0 skips. The compiled backend smoke gate passed 9/9 after each slice. Parent gate: backend `npm test` 339 passed, 0 failed, 6 skipped (database URL unset); frontend `npm run quality:check` 382 passed, 0 failed and production build passed; plugin validator passed and 56 plugin tests passed, 0 failed. Emitted JavaScript review found no material change in policy, session, startup, or shutdown flow. A live external SDK session needs deployment credentials and is covered by the artifact gate where possible.
