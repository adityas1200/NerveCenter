# MIG-004D — Type RBAC store contracts

- Status: done
- Parent: MIG-004
- Depends on: MIG-004C
- Decision: ADR 0002

## Scope

Convert `backend/src/app/rbac-store.mjs` to `.mts`. Type the user, role, and audit persistence records and the file and Postgres adapters. Preserve permission checks, audit fields, SQL, migration behavior, and stored record shapes. Keep the diff in this module and its focused compiled check; split it before coding if the adapter and store API changes cannot be reviewed together.

## Acceptance

- [x] File and Postgres paths satisfy a checked RBAC persistence contract; existing `.mjs` imports resolve from the build.
- [x] Existing RBAC, project access, and migration suites pass with no permission or audit behavior change.
- [x] Typecheck, compiled smoke, and required repository suites pass; record any live Postgres verification limit.

## Evidence

Converted `rbac-store.mjs` to `rbac-store.mts` under ADR 0002. Added typed user and audit records, a shared persistence contract, and typed store methods. The file loader still passes through existing JSON array entries without filtering; SQL, one-time import marker, audit cap, and stored shapes are unchanged. The compiled smoke covers role changes, blocks, invalid roles, audit entries, and a file-backed restart.

- `cd backend && npm run verify:build`: typecheck and build passed; compiled smoke 6 passed, 0 failed, 0 skipped.
- `cd backend && npm test`: 339 passed, 0 failed, 6 skipped.
- `cd frontend && npm run quality:check`: governance, lint, typecheck, and build passed; 382 unit tests passed, 0 failed.
- Plugin validator passed; plugin unittest suite 56 passed, 0 failed.
- Live Postgres verification remains unavailable because `NC_TEST_DATABASE_URL` is unset; the six backend skips are existing Postgres tests. The RBAC Postgres adapter's in-memory pool tests passed in the backend suite.
