# MIG-004A — Type task and inbox store contracts

- Status: done
- Parent: MIG-004
- Depends on: MIG-002, MIG-003
- Decision: ADR 0002

## Scope

Convert `backend/src/tasks/task-store.mjs` to `.mts`. Define shared task, event, inbox, filter, and store method contracts for its file and Postgres implementations. Preserve file records, SQL, project checks, ID generation, and return behavior. Do not change task services or other stores in this slice.

## Acceptance

- [x] File and Postgres task/inbox implementations satisfy the same checked interface and emitted `.mjs` imports resolve.
- [x] Existing task, project access, and migration tests pass. Add a focused test only if a critical store boundary has no coverage.
- [x] Typecheck, compiled smoke, and all required repository suites pass; record any external Postgres verification limit.

## Evidence — 2026-10-10

- `backend/src/tasks/task-store.mts` defines the task, event, inbox, filter, query, and store contracts implemented by both file and Postgres classes. The compiled module retains the `.mjs` import path. Existing file records, SQL, IDs, and scope checks are unchanged. Review removed newly introduced JSON shape guards so old records continue through the original read path.
- `npm run verify:build`: typecheck/build passed; compiled smoke 4 passed, 0 failed, 0 skipped. One focused compiled check covers scoped task listing, an event, and an inbox item.
- Full suites: backend 339 passed, 0 failed, 6 skipped; frontend 382 passed, 0 failed; plugin validator passed and 56 tests passed, 0 failed. Runtime Postgres task checks were unavailable because `NC_TEST_DATABASE_URL` is unset; both implementations compile against the same interface.
