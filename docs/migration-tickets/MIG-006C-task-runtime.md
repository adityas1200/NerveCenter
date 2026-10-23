# MIG-006C — Type Sonic task runtime

- Status: done
- Parent: MIG-006
- Depends on: MIG-006B
- Decision: ADR 0002

## Scope

Convert `task-runtime` to `.mts`. Type session events, approval and resume state, task store collaboration, and SSE events without changing task policy or the SDK session lifecycle.

## Acceptance

- [x] Source and compiled task sessions keep permission, approval/resume, and SSE behavior.
- [x] Task runtime and stream tests pass; only uncovered critical paths gain a focused test.
- [x] Typecheck, build, and focused task and stream checks pass; run full suites at the MIG-006 parent gate.

## Evidence

`cd backend && npm run typecheck -- --pretty false` passed. Focused check `node --import tsx --import ./tests/test-environment.mjs --test --test-concurrency=1 tests/tasks.test.mjs tests/task-edit.test.mjs tests/agent-cards.test.mjs tests/agent-access.test.mjs tests/projects-agent.test.mjs` passed: 34 tests, 0 failed, 0 skipped. `npm run verify:build` passed typecheck/build and compiled smoke checks: 9 tests, 0 failed, 0 skipped. Runtime review confirmed the emitted `.mjs` keeps the existing session, permission, approval/resume, and stream flow; type-only assertions were erased. Full suites remain for the MIG-006 parent gate.
