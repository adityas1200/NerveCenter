# Backend TypeScript and Express migration plan

Status: implementation and local release gates complete on `zs-sandbox`; ready for diff review. ADR 0002 and ADR 0003 were approved on 2026-10-10; TypeScript preceded Express.

Execution and current status: [backend migration tickets](migration-tickets/README.md). Update each ticket and its board row as work progresses.

## Direction

Keep the Node 22 backend and its Claude Agent SDK, stores, schedulers, and deployment architecture. Migrate source to TypeScript first, then change the HTTP layer to Express 5. `tsx` is a runner for TypeScript during development, not a backend language or a type checker. Backend modules do not need JSX, so converted ESM files should use `.mts` where preserving `.mjs` output names matters. A separate `tsc` check is required.

The work preserves `SPEC-platform-07` (HTTP), `SPEC-platform-01` (identity), `SPEC-projects-03` (project access), `SPEC-tasks-01` and `SPEC-tasks-03` (Sonic), and `SPEC-platform-06` (stores). Any intended behavior or stored-shape change needs its own approved spec or ADR.

## Progress on 2026-10-10

- Added mixed JavaScript/TypeScript checking and compilation, `tsx` source development and tests, and compiled production entrypoints. Converted the pipeline filter and endpoint helper to typed `.mts` modules.
- Updated both container build paths, the staged app, and CI to build before running. A compiled backend smoke check covers runtime roots, file migrations, and HTTP health. The staged app was also installed with production dependencies and started locally against a temporary file store.
- File migrations now receive file helpers and the data root from the runner. The package check applies them from a temporary artifact containing `dist/` and `migrations/`, with no `src/` tree.
- Shared HTTP and route helpers, store and service slices, task runtime, and bootstrap now have TypeScript contracts. Production runs compiled `dist/main.mjs`; source development runs through `tsx` with a separate `tsc` gate. The mixed source tree is intentional while the remaining JavaScript modules stay in place.
- MIG-007 verified the compiled backend and frontend deployment targets and the staged app, including file and Postgres migrations and a mock SDK task session. MIG-008 added Express 5 at the HTTP entrypoint while retaining the existing response and routing contracts. MIG-009 made all 86 mutating routes in the 152-route table declare a permission and added a startup assertion for omissions. Both final container targets and the staged app rebuilt and booted locally.
- The final database-backed backend suite passed 346 tests with no failures or skips. The frontend gate passed 382 tests and built successfully; plugin validation and all 56 plugin tests passed. The compiled smoke passed 9 checks. The production dependency audit reports 8 existing advisories (4 high, 4 moderate), one fewer than the original lockfile.

## Sequence and gates

| Stage | Work | Exit gate |
| --- | --- | --- |
| 0. Approve and baseline | Approve ADR 0002. Record existing test results and inventory module imports, runtime-relative paths, route scope/permission metadata, streams, and build entrypoints. | A test baseline and dependency map identify the first safe module slice. |
| 1. Tooling proof | Add `typescript`, Node types, and `tsx` for development, with `allowJs`, Node ESM resolution, and a separate output directory. Convert one low-risk leaf module to `.mts`. Verify source execution, emitted `.mjs` imports, existing tests, and `tsc` diagnostics. Switch production to the built output in the same change as the first imported `.mts` module, since plain Node cannot resolve that source module. | The mixed source tree, compiled output, and the existing tests run the same code and return the same results. |
| 2. TypeScript slices | Convert shared types and helpers, then services and stores, then bootstrap and the task runtime. Keep each slice small and rely on existing tests for behavior. Add a focused test only when a critical boundary lacks coverage. Type external input and persisted records without replacing runtime validation. Keep explicit `.mjs` import paths where emitted output requires them. | Each slice type-checks and passes its affected tests; permission and store contract checks stay intact. |
| 3. Production build | Build the entire backend before packaging; run `node` on emitted JavaScript. Resolve runtime roots deliberately: `config.mjs` currently derives `ROOT` from `import.meta.url`, so the build must still find `.env`, migrations, workspace, plugin, and data correctly. Update AWS Dockerfiles, Databricks staging/entry command, and CI together. | Both deployment artifacts boot, apply the existing migrations, serve the API and UI as before, and run Sonic and background jobs once. Rollback is the previous JavaScript artifact. |
| 4. Express edge | Approve ADR 0003. Add Express 5 around the existing route table, translating its `reply`, `NEXT`, scope, and permission rules. Compare representative requests and responses before migrating route groups to native Express routers. | Focused contract tests pass for identity, project scope, write denial, one JSON route, one file route, and task SSE; existing tests cover the remaining behavior. |
| 5. Route groups | Convert one route group at a time only where Express removes useful custom glue. Keep a startup assertion that every route declares its scope and required permission. | All current route declarations are accounted for, or the retained table is documented as intentional; both platform builds and full suites pass. |

## First two working days after ADR 0002 approval

1. Build a module and runtime-path inventory focused on `backend/src/config.mjs`, `backend/src/main.mjs`, test imports, `Dockerfile`, `deploy/aws/Dockerfile`, and `deploy/databricks/build.sh`.
2. Add the TypeScript configuration and scripts, then convert one leaf module to `.mts` as a proof. Verify that `tsx` can run it and `tsc` emits the `.mjs` name expected by callers.
3. Add `typecheck` and `build` to the backend quality path, switch production to built output with the first imported `.mts` module, and check the compiled runtime roots and file migrations. Report any test failure separately from the existing baseline.

## Test scope

This is a behavior-preserving refactor. Do not create a test for every file, type, or route conversion. Keep and run the existing suites. Add or strengthen focused tests only for migration risks that lack coverage:

- identity, project isolation, and denial of unauthorized writes;
- one file-store and one Postgres path, plus runtime paths in the built artifact;
- Sonic tool permission decisions, approval/resume, and one live SSE stream;
- representative JSON, file, and error responses at the Express boundary.

Use one representative test per shared mechanism rather than repeating it for every route. If implementation adds a new feature requirement, the repo's FR test rule still applies.

## Development agent allocation

Use a strong orchestrator for architecture choices, task boundaries, security review, integration, and the final result. Use cheaper subagents for bounded independent work such as module inventories, low-risk file conversions in non-overlapping areas, and focused review. Give each subagent a specific deliverable and file ownership; the orchestrator reviews the result before integration. Start with at most two subagents and compare their total usage and rework with a single-agent run before increasing parallelism. Keep short dependent steps and changes to the same files with the orchestrator. This applies to development work, not Sonic's runtime model setting.

## Release rules

- Keep TypeScript conversion and Express routing changes in separate reviewable changes.
- `tsx` execution never substitutes for `tsc` type checking. Production runs built JavaScript unless the tooling proof establishes a better, equally checked deploy path.
- Do not weaken or delete tests. Any new behavior gets a spec FR and a test. Run backend, frontend, and plugin suites before handover and report pass, fail, and skip counts.
- Keep the existing API and data contract while changing implementation. No schema or file-record change is part of this plan.
