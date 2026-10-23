# MIG-003 — Type shared HTTP and access contracts

- Status: done
- Depends on: MIG-001
- Decision: ADR 0002

## Scope

Define TypeScript types at the route, request, scope, permission, and response boundaries, then convert the shared helpers that use them. Keep explicit `.mjs` imports and existing runtime validation. Own `backend/src/lib/` and the smallest necessary access-boundary files; coordinate file ownership with MIG-002.

## Acceptance

- [x] Route scope and permission metadata have checked types; converted modules emit the import names existing callers expect.
- [x] Identity, project isolation, write denial, JSON/error, and route-table checks preserve behavior.
- [x] Typecheck, affected tests, and the compiled smoke check pass; add a focused test only if a critical boundary is uncovered.

## Evidence — 2026-10-10

- Converted `backend/src/lib/http.mjs` and `router.mjs` to `.mts`, adding HTTP, route, scope, permission, context, handler, and response types while retaining `.mjs` output names and the existing runtime guards.
- `npm run verify:build`: typecheck/build passed; compiled smoke 2 passed, 0 failed, 0 skipped. Existing backend tests exercise identity, project access, denied writes, router dispatch, and JSON/error responses; no new test was needed.
- Full suites: backend 339 passed, 0 failed, 6 skipped; frontend 382 passed, 0 failed; plugin validator passed and 56 tests passed, 0 failed.
