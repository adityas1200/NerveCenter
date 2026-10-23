# MIG-008 — Put Express at the HTTP edge

- Status: done
- Depends on: MIG-007
- Decision: ADR 0003

## Scope

Add Express 5 as the backend HTTP entrypoint while adapting the existing route table. Preserve route order, `reply`, `NEXT`, scope and permission checks, body limits, CORS, static files, raw files, errors, and SSE. Keep services, stores, and Sonic APIs unchanged.

## Acceptance

- [x] Every route still declares scope and required permission; unauthorized writes deny by default.
- [x] Representative identity, project, JSON, error, file, and task SSE requests match the current contract.
- [x] Existing backend suite, typecheck/build, compiled smoke, and deployment entrypoint checks pass.

## Evidence

The API edge now uses Express 5 through a pathless async `app.use` adapter. The adapter keeps request parsing lazy through `readBody`, retains the existing route table and dispatch authorization, and adds an Express error middleware that returns the existing JSON error shape if an async rejection escapes the inline handler. Express's `x-powered-by` header is disabled.

- Effective route table: 152 entries, unchanged; `assertRouteTable` remains at startup.
- Focused HTTP, identity, task, UI, and project scope tests: `node --import tsx --import ./tests/test-environment.mjs --test --test-concurrency=1 tests/api.test.mjs tests/projects-scope.test.mjs tests/ui-server.test.mjs tests/tasks.test.mjs` — 45 passed, 0 failed, 0 skipped. Includes identity, project permissions, JSON errors, OPTIONS, task SSE, raw task files, static assets, base paths, and HEAD.
- Full backend: `npm test` — 346 tests, 340 passed, 0 failed, 6 skipped.
- Compiled gate: `npm run verify:build` — typecheck and build passed; compiled smoke 9 passed, 0 failed.
- Effective route count command: initialized `createBackend()` and counted `buildRoutes(backend)` — 152.
