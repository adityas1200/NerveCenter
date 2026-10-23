# MIG-005D3 — Type skill and template services

- Status: done
- Parent: MIG-005D
- Depends on: MIG-005D2
- Decision: ADR 0002

## Scope

Convert `skill-service` and `template-service` to `.mts`. Preserve path guards, stored files, and document output.

## Acceptance

- [x] Inputs and collaborators have checked types.
- [x] Existing skill and document tests pass.
- [x] Typecheck, build, and focused skill and document checks pass; run full suites at the MIG-005 parent gate.

## Evidence

`npm run verify:build`: typecheck/build passed; compiled smoke 9 passed, 0 failed, 0 skipped. Focused skill, template, workspace, and project workspace checks: 31 passed, 0 failed, 0 skipped. Reviewed ZIP path guards, shared skill handling, and template validation/output shape. Full suites are due at the MIG-005 parent gate.
