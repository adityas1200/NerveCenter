# MIG-005D1 — Type board service

- Status: done
- Parent: MIG-005D
- Depends on: MIG-005C
- Decision: ADR 0002

## Scope

Convert `board-service` to `.mts`. Type board definitions, data queries, workspace collaboration, and return values while preserving published board shape and access checks.

## Acceptance

- [x] Inputs, records, and collaborators have checked types without domain-record `any`.
- [x] Existing board tests and compiled imports pass.
- [x] Typecheck, build, and focused board checks pass; run full suites at the MIG-005 parent gate.

## Evidence

`npm run verify:build`: typecheck/build passed; compiled smoke 9 passed, 0 failed, 0 skipped. Focused board and data-discovery checks: 13 passed, 0 failed, 0 skipped. Reviewed saved board shape, scope checks, SQL parameter binding, and filter initialization. Full suites are due at the MIG-005 parent gate.
