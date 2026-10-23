# MIG-004C — Type project persistence contracts

- Status: done
- Parent: MIG-004
- Depends on: MIG-004A, MIG-004B
- Decision: ADR 0002

## Scope

Convert `backend/src/projects/project-store.mjs` to `.mts`, typing the file and Postgres persistence boundary and the project-store methods that share this module. Preserve authorization checks, migration behavior, SQL, and stored record shapes. Split this slice further before coding if the combined diff stops being reviewable.

## Acceptance

- [x] File and Postgres persistence satisfy one checked contract and the existing `.mjs` imports resolve after compilation.
- [x] Existing project, role, scope, grant, and migration suites pass without changing the data contract.
- [x] Typecheck, compiled smoke, and all required repository suites pass; record any external Postgres verification limit.

## Evidence

Converted `project-store.mjs` to `project-store.mts` under ADR 0002. Added types for projects, members, grants, actors, both persistence adapters, and store methods. SQL, file records, validation, and access checks retain their previous behavior. The compiled smoke covers owners, membership, grants, and the last-owner guard.

- `cd backend && npm run verify:build`: typecheck and build passed; compiled smoke 5 passed, 0 failed, 0 skipped.
- `cd backend && npm test`: 339 passed, 0 failed, 6 skipped.
- `cd frontend && npm run quality:check`: governance, lint, typecheck, build passed; 382 unit tests passed, 0 failed.
- Plugin validator passed; plugin unittest suite 56 passed, 0 failed.
- Live Postgres behavior remains unverified because `NC_TEST_DATABASE_URL` is unset; the six backend skips above are the existing Postgres tests.
