# MIG-004E — Type connection profile store

- Status: done
- Parent: MIG-004
- Depends on: MIG-004D
- Decision: ADR 0002

## Scope

Convert `backend/src/connections/connection-profile-store.mjs` to `.mts`. Type its file and Postgres records and method contract while preserving connection profile fields, SQL, file shape, and service behavior. Keep secret and object stores in later tickets.

## Acceptance

- [x] File and Postgres paths satisfy a checked connection profile contract; existing `.mjs` imports resolve from the build.
- [x] Existing connection and migration suites pass without changing stored profiles or access behavior.
- [x] Typecheck, compiled smoke, and required repository suites pass; record any live Postgres verification limit.

## Evidence

Converted `connection-profile-store.mjs` to `.mts` under ADR 0002. Both implementations satisfy one typed contract; SQL, file records, and profile fields are unchanged. The compiled smoke covers file-backed put/get/list/delete.

- `cd backend && npm run verify:build`: typecheck and build passed; compiled smoke 7 passed, 0 failed, 0 skipped.
- `cd backend && npm test`: 339 passed, 0 failed, 6 skipped.
- `cd frontend && npm run quality:check`: governance, lint, typecheck, build passed; 382 unit tests passed, 0 failed.
- Plugin validator passed; plugin unittest suite 56 passed, 0 failed.
- A focused connector run in the restricted process sandbox had 10 passes and 2 listener `EPERM` failures. The full backend suite with local listener access passed those cases.
- Live Postgres remains unverified because `NC_TEST_DATABASE_URL` is unset; the six backend skips are existing Postgres tests.
