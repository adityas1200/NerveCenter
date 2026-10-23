# MIG-005E — Type operations service

- Status: done
- Parent: MIG-005
- Depends on: MIG-005D
- Decision: ADR 0002

## Scope

Convert the central `operations-service` to `.mts` after its collaborators are typed. Preserve the authorization and secret-store boundaries, operation results, and error behavior.

## Acceptance

- [x] Collaborators, inputs, and outputs have checked types without domain-record `any`.
- [x] Identity, project scope, write-denial, and operation tests pass.
- [x] Typecheck, build, and focused operations and access checks pass; run full suites at the MIG-005 parent gate.

## Evidence

Converted `backend/src/app/operations-service.mjs` to `.mts` under ADR 0002. Preserved the runtime defaults, source write behavior, and authorization paths during emitted JavaScript review. Focused operations, project and viewer checks: 24 passed, 0 failed, 0 skipped. Compiled smoke: 9 passed, 0 failed, 0 skipped. The MIG-005 parent gate passed after this slice.
