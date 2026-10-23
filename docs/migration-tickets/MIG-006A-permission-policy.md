# MIG-006A — Type task permission policy

- Status: done
- Parent: MIG-006
- Depends on: MIG-005
- Decision: ADR 0002

## Scope

Convert `permission-policy` to `.mts`. Type permission categories, role caps, approval decisions, and session environment without widening tool access.

## Acceptance

- [x] Permission inputs and decisions have checked types; unknown tools stay changes.
- [x] Existing role, write denial, and approval tests pass.
- [x] Typecheck, build, and focused policy checks pass; run full suites at the MIG-006 parent gate.

## Evidence

`backend/src/tasks/permission-policy.mjs` was converted to `.mts`; imports retain their emitted `.mjs` paths. Permission categories, policy inputs, resource metadata, and decisions now have checked types. Unknown NerveCenter and external tools remain classified as changes.

Checks: `npm run typecheck` passed. Focused suites (`agent-access`, `policy-rules`, `permission-shell`, `tasks`, `knowledge-drafts`) passed 46/46. `npm run verify:build` passed, including compiled smoke tests 9/9.
