# MIG-009 — Finish Express route groups and release gate

- Status: done
- Depends on: MIG-008
- Decision: ADR 0003

## Scope

Move route groups to native Express routers only where that removes useful custom glue. Keep the table for any group whose custom semantics remain valuable and document that choice. Verify the production artifacts and rollback path before release.

## Acceptance

- [x] All current route declarations are accounted for, with mandatory scope and permission metadata enforced at startup.
- [x] Critical HTTP, task SSE, file, identity, and project-isolation contracts pass through the final route layout.
- [x] Full backend, frontend, and plugin suites and both deployment artifact checks have recorded pass/fail/skip results; rollback is ready.

## Evidence

The custom route table is retained because it still owns route order, scope resolution, path normalization, request parsing, response envelopes, and authorization behavior. Native Express route groups would duplicate those contracts without removing useful glue. Added an explicit `admin` permission sentinel and startup validation requiring permission metadata for every POST/PUT/PATCH/DELETE entry. Annotated the 39 previously implicit writes (4 connector, 12 library, 4 project, 19 server routes); `assertRouteTable` continues validating scope metadata. The effective route count remains 152, with 86 mutating routes and no missing write permissions.

- Focused route, identity, project access and API tests: `node --import tsx --import ./tests/test-environment.mjs --test --test-concurrency=1 tests/projects-scope.test.mjs tests/project-access.test.mjs tests/api.test.mjs` — 36 passed, 0 failed, 0 skipped.
- `npm run typecheck` — passed.
- `npm run verify:build` — typecheck/build passed; compiled smoke 9 passed, 0 failed.
- Final backend suite with a disposable Postgres 16 database: `NC_TEST_DATABASE_URL=... npm test` — 346 passed, 0 failed, 0 skipped. The disposable database was removed.
- Frontend `npm run quality:check` — governance, lint, typecheck, 382 tests (382 passed, 0 failed, 0 skipped), and production build passed.
- Plugin validator — passed (1 plugin, 19 skills, 1 orchestrator). Plugin unit suite — 56 passed, 0 failed, 0 skipped.
- `deploy/aws/Dockerfile` backend and frontend targets built with Buildx from the final tree. The backend container returned `/health` HTTP 200; the frontend container returned `/` HTTP 200. Both disposable images and containers were removed. The frontend reverse proxy to a live backend was not exercised in this isolated smoke check.
- `deploy/databricks/build.sh` staged the final compiled backend and UI; production dependencies installed. The staged app booted with isolated file/memory stores and disabled pollers, returning `/health` and `/` HTTP 200. File migrations 003–006 were present in its migration state. A credential-free mock SDK task from the staged compiled package completed with `session.init` and `result` events. Live cloud integrations and live SDK credentials were not exercised.
- Production dependency audit: 8 advisories (4 high, 4 moderate); the pre-migration lockfile had the same 8 plus one additional finding. None of the 8 is in Express. Dependency remediation is separate from this migration.
- `git diff --check` — passed. Rollback for a deployment is to redeploy the previous JavaScript artifact or checkout before this migration; no live deployment was made here.
