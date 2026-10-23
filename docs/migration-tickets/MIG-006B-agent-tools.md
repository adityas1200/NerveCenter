# MIG-006B — Type agent tool boundary

- Status: done
- Parent: MIG-006
- Depends on: MIG-006A
- Decision: ADR 0002

## Scope

Convert `nervecenter-tools` to `.mts`. Type tool inputs, result cards, and permission decisions while preserving calls through the operations service and the existing approval boundary.

## Acceptance

- [x] Tool calls retain checked input and output types without bypassing access checks.
- [x] Existing tool permission and approval tests pass.
- [x] Typecheck, build, and focused tool checks pass; run full suites at the MIG-006 parent gate.

## Evidence

`backend/src/tasks/nervecenter-tools.mjs` was converted to `.mts`; source imports retain their `.mjs` specifiers. Tool input handlers use schema-inferred Zod types, collaborators and task/tool records have structural contracts, and permission decisions still run through `toolPermission` and `assertPermission` before handlers.

Checks: `npm run typecheck` passed. Focused tool/permission, project-scope, board and discovery suites passed 44/44. `npm run verify:build` passed, including compiled smoke tests 9/9. A sandboxed focused run hit the macOS `SecItemCopyMatching` crash; the same focused suites passed with listener access.
