# MIG-005D2 — Type knowledge service

- Status: done
- Parent: MIG-005D
- Depends on: MIG-005D1
- Decision: ADR 0002

## Scope

Convert `knowledge-service` to `.mts`. Type drafts, search results, paths, repository operations, and collaborators without changing workspace writes or review behavior.

## Acceptance

- [x] Inputs, records, and collaborators have checked types without domain-record `any`.
- [x] Existing knowledge tests and compiled imports pass.
- [x] Typecheck, build, and focused knowledge checks pass; run full suites at the MIG-005 parent gate.

## Evidence

`npm run verify:build`: typecheck/build passed; compiled smoke 9 passed, 0 failed, 0 skipped. Focused `tests/knowledge-*.test.mjs`: 29 passed, 0 failed, 0 skipped. Reviewed metadata, Git error redaction, upload, and draft review paths. Local casts adapt the unconverted `KnowledgeDrafts` collaborator. Full suites are due at the MIG-005 parent gate.
