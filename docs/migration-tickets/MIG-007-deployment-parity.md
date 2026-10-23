# MIG-007 — Verify compiled deployment parity

- Status: done
- Depends on: MIG-006
- Decision: ADR 0002

## Scope

Build both container targets and the staged app from the final TypeScript source. Verify runtime roots, migrations, API and UI serving, Sonic startup, and background jobs once per process. Keep rollback to the previous JavaScript artifact documented.

## Acceptance

- [x] Both container targets build and boot with production dependencies; the staged app boots from its packaged files.
- [x] File and Postgres migration paths, API and UI health, and one task/session startup pass in the deployable artifacts.
- [x] CI typecheck, compiled smoke, backend suite, frontend quality gate, and plugin checks pass with real counts recorded.

## Evidence

The AWS `backend` and `frontend` targets built with the existing Buildx builder and booted from production image dependencies. The backend ran compiled `dist/main.mjs` and returned HTTP 200 from `/health`; the frontend served its production `index.html` with HTTP 200. The local frontend boot used an explicit loopback upstream and placeholder identity environment values because the tracked development upstream hostname was not present. Reverse proxy traffic to a deployed backend was not exercised. The disposable containers and images were removed.

`deploy/databricks/build.sh` built and staged the frontend, compiled backend, migrations, and plugin. The staged app installed production dependencies, started from packaged files, returned HTTP 200 from `/health` and `/`, and applied file migrations 003–006. A compiled `TaskRuntime` inside that stage completed a mock SDK session with `session.init` and `result` events. The staged process started its poller, integration sync, and routines through the existing conditional startup sites; static review found one constructor and start site for each. An external live agent session was not run because no model credential was supplied to the disposable artifact.

The file migration smoke passed 9/9. A disposable Postgres 16 instance ran the targeted migration tests 10/10 and the full backend suite 345 passed, 0 failed, 0 skipped. The existing Postgres migration expectation was updated to include the already present `006-project-access.sql`. The frontend quality gate passed 382/382 and built; plugin validation passed and 56/56 plugin tests passed. `npm run verify:build` passed typecheck, build, and 9/9 compiled checks after the artifact run.

Rollback: retain the previous deployed JavaScript image or staged artifact and redeploy that artifact if the compiled runtime fails. MIG-007 adds no schema migration; confirm the prior artifact's compatibility with any migrations already applied in the target environment before switching traffic back.
