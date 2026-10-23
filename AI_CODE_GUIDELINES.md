# AI code guidelines

The one guardrails file for AI coding tools in NerveCenter: Claude Code, Codex, GitHub Copilot, Cursor and similar. Humans follow it too.

Read this file before you change any code. Tool files (`CLAUDE.md`, `AGENTS.md`, `.github/copilot-instructions.md`, `.cursor/rules/project.mdc`) only point here and add tool-specific hints when they must. Do not copy rules into them; change this file instead.

`frontend/STYLE_GUIDE.md` is the source of truth for colours, typography, density and components. `frontend/AGENTS.md` holds the frontend-only detail. If either disagrees with this file, this file wins; fix the other one.

## 1. Scope and repo map

NerveCenter is an operations console for data teams. It shows tickets, pipelines, data quality, boards and routines, and runs an AI agent (Sonic) that investigates and fixes problems. The backend is Node 22 with an Express 5 entrypoint over the repo's own route table; it serves the API and runs agent sessions with the Claude Agent SDK. The frontend is React + Vite + TypeScript. Deployed on AWS (Postgres, S3, Secrets Manager); local development uses files.

- `backend/` API, agent runtime, stores. ES modules, mid-migration from `.mjs` to TypeScript `.mts` (ADR 0002). Read `backend/README.md`.
- `frontend/` UI. Read `frontend/AGENTS.md` and `frontend/STYLE_GUIDE.md` before any UI change.
- `plugin/` vendored `operations-fleet` plugin. Rules in `plugin/SOURCE.md`.
- `specs/` feature specs (the contract), `specs/BACKLOG.md` known gaps. Workflow in `specs/README.md`.
- `docs/` design (`docs/DESIGN.md` is the vision), plans, `docs/adr/` technical decisions.
- `deploy/` AWS and Databricks deploy scripts and the CI test entry (`deploy/ci-test.sh`).
- `data/runtime/` is local runtime data, not source.

## 2. Branches and workflow

1. Start from `zs-sandbox`.
2. Do the work on a feature branch (`feature/<short-name>`).
3. Raise a PR back to `zs-sandbox`.
4. Never commit on `zs-sandbox`, `zs-dev`, `release`, `main` or `master`.

If you find yourself on a protected branch, stop before committing and tell the person to create or switch to a feature branch. The repository pre-commit hook checks every commit. Never suggest bypassing a hook (`--no-verify`) unless a human asks for it.

Keep a change small and reviewable: one concern per change. Do not mix a feature, a test rewrite, a style migration, a dependency upgrade and a cleanup unless the person asks for that scope.

## 3. Hard rules

1. **Spec or ADR first.** Before implementing, add or update a spec in `specs/` (behaviour) or an ADR in `docs/adr/` (technical decision) with `status: draft`, and get a human to approve it. This applies to any change in behaviour and to any change to data storage: tables, columns, indexes, constraints, migrations, file-store record shapes, the `operations.yaml` schema, secret ref layout. The implementing change cites the spec FR ids or ADR number and moves the spec to `implemented`. If you cannot get approval, stop and ask.
2. **Schema changes use migrations.** Add a file to `backend/migrations/`; never add inline `CREATE TABLE` or `ALTER TABLE` in a store. Handle both the file and Postgres stores. Migrations are forward-only and safe to run twice.
3. **Security.** Deny by default. Every write route declares its permission in the route table. Agent tools never bypass `operationsService` access checks. Secrets only through the secret store; never in logs, errors or URLs. No real secrets in tracked files.
4. **Tests.** Every FR you implement gets a test. Do not weaken or delete an existing test without a human confirming (`AI_TEST_CHANGE_ACK=ack`). Do not skip a failing test to get green.
5. **Plugin is vendored.** Local edits are allowed, but record them in `plugin/SOURCE.md` and pass the validator.
6. **Stay in scope.** Fix what was asked. Report other problems; do not fix them in the same change. No new dependency without a stated reason.

## 4. Before you write code

1. Read the spec for the area (`specs/INDEX.md`), then the code it lists under `code:`.
2. Decide: does this change behaviour or data storage? If yes, draft the spec or ADR first (sections 11 and 12), and stop until a human approves it.
3. Pure refactors, bug fixes that restore specified behaviour, and test-only work need no new spec.
4. Prefer a root-cause fix over a surface patch. Read the existing routes, services, specs and tests before editing.

## 5. Configuration and secrets

Precedence, highest first:

```text
real env vars (platform / SSM RunCommand)
  + AWS Secrets Manager hydration (backend/src/runtime-env.mjs), on every env
  -> host deploy/aws/.env when present (sandbox, prod EC2); .env.defaults is then ignored
  -> repo-root .env.defaults when no host .env exists (dev)
backend/.env is loaded for local runs only, never in tests.
```

- Backend config is read in `backend/src/config.mjs`, plus the workspace `operations.yaml`. A change to the `operations.yaml` schema is a storage change: spec or ADR first, and update `docs/operations.example.yaml`.
- New env vars have a safe default and are documented in `backend/README.md`. Keep `config.mjs`, `backend/README.md`, `.env.defaults` and the deploy scripts in step.
- Naming: backend app settings use `OPS_*`; deployment isolation keys use `NC_*`. Shared platform keys (`AWS_*`, `APP_ENV`, `BEACON_ENV`, `DATABASE_URL`, `ANTHROPIC_API_KEY`) keep their shared names. Do not rename a key or drop an alias without a migration plan a human approved.
- `.env` files are never committed. Do not create or fill one unless the person asks, and then only untracked.
- `.env.defaults` holds non-secret defaults only.
- Frontend env is visible in the browser: `VITE_` keys only, no secrets, tokens or credentials of any kind.
- Secrets go in the secret store (`backend/src/secrets/secret-store.mts`: memory, file, Postgres (encrypted with `OPS_SECRET_ENCRYPTION_KEY`), AWS Secrets Manager) and are referenced by ref. Never in logs, error messages, URLs, task transcripts or tracked files. Test fixtures use obviously fake values.
- System URLs must be HTTPS; plain HTTP only for loopback hosts.

## 6. Backend

### Conventions
- Node 22, ES modules. The backend is moving to TypeScript in slices (ADR 0002): `.mjs` and `.mts` coexist, and new or converted modules are `.mts`. `npm run typecheck` (`tsc`) is the type gate; `tsx` only runs code. Imports use explicit `.mjs` extensions, including imports of `.mts` files, since that is the name `tsc` emits.
- Express 5 sits at the HTTP edge (ADR 0003), but routes still go through the route table below; do not add native Express routes that skip its scope and permission checks.
- No new dependency without a reason you can state in the change. Prefer `node:` built-ins and what `backend/package.json` already has (`pg`, `yaml`, `zod`, `adm-zip`, AWS SDK clients).
- Shared helpers live in `src/lib/` (`util.mjs` has `now`, `clone`, `clean`, `slug`, `actorOf`, `httpError`). Look there before writing a helper.
- Services are small classes or factories, one per area (`connector-service`, `board-service`, ...). They take their collaborators as arguments; no hidden globals or module-level mutable state in request paths.
- Comments are terse and say why, not what. Match the file you are in.

### Errors
- Throw `httpError(status, 'Plain sentence a person can act on.')`. Use the real status: 400 bad input, 403 not allowed, 404 missing, 409 conflict.
- Messages name the thing and the fix ("Unknown connector: x", not "invalid input"). No stack traces, tokens, URLs with credentials or file system paths in messages.
- Do not catch an error just to hide it. If you swallow one, say why in a comment. Raise a clear error instead of returning partial success.

### Route table
- Every API route goes through `src/lib/router.mts`: `route('GET|POST', '/api/things/:id', handler)`. The first match wins, so list literal paths before `:params`.
- A handler returns a body (sent as 200), `reply(status, body)`, `NEXT`, or `undefined` after writing the response itself.
- Each route declares the permission it needs in the table. Reads and writes are both deny-by-default. A write route with no declared permission is a bug. (If your checkout predates the permission column in the route table, do not add new undeclared write routes; call `assertPermission`/`assertAdmin` from `src/app/rbac.mjs` explicitly and note it.)
- Validate input at the route edge (zod or explicit checks), not deep in services. Handlers delegate real work to services.
- App roles are viewer, developer, admin; project roles are viewer, developer, owner (see `backend/README.md`). New routes use the narrowest role that works.
- Streaming endpoints (task event streams) authorise the caller for that task, not just authenticate them.

### Stores: file and Postgres
- Tickets, tasks, inbox and similar records have two backends: JSON files under `data/runtime/` locally, Postgres when deployed. Both must behave the same; test both paths or the shared contract.
- Schema is changed only through `backend/migrations/*.sql`, applied by `src/storage/migrations.mjs` (ordered by file name, tracked in `ops_schema_migrations`, transactional, advisory-locked). Today some tables are still created inline by `ensureControlSchema` in `src/storage/postgres.mjs`; do not add to that. Moving them is a spec/ADR-planned change.
- A migration is forward-only (no down scripts) and safe to run twice: `IF NOT EXISTS`, guarded `ALTER`, idempotent backfills. Name it with the next number and a short title, e.g. `015-ticket-labels.sql`.
- When the change also affects file-store records, add the twin `<number>-<title>.mjs` next to the `.sql`, exporting `up({ runtimeDir })` (run by `src/storage/file-migrations.mjs`). It must also be safe to run twice.
- A fresh database must come up correctly by applying the full migration chain. Never depend on a manual SQL step or a startup side effect as the only setup path.
- Every query is bounded. List and search queries apply an explicit server-side limit or page, cap caller-provided page sizes at a backend maximum, order deterministically and filter on indexed columns. No API exposes an unbounded read.
- Use parameterised queries (`$1`, `$2`). Never build SQL by string concatenation with input; schema names come from config, not requests.
- File-store changes need a read path that tolerates old records (missing fields get defaults). Never rewrite user data in place without a spec saying so.
- File paths: resolve with `path.resolve`/`path.join` and check containment with `path.relative` (no `..`, not absolute). Never use string-prefix checks.

### Startup
- Optional or feature-scoped code must not stop the server from starting. New optional integrations get safe defaults or fail clearly at use time, in the affected route or job only. Watch for import-time crashes in `src/main.mts` and the app setup.
- This is not a licence to hide real failures. Auth, RBAC, required storage, migrations, secret loading and required config still fail loudly when unsafe or incomplete.

### Fallbacks
Do not add fallback paths, compatibility shims, support for removed features, duplicate execution paths, silent retries or swallowed errors by instinct. Existing documented fallbacks may stay. A new one needs a stated product, compatibility or external-dependency reason, and tests for both the primary and the fallback path.

## 7. Agent tools

- Tools live in `src/tasks/nervecenter-tools.mts`, with categories in `nervecenter-tool-categories.mjs`.
- Every write tool takes a `reason` (the shared `reasonField`: one plain sentence, 3-240 chars) that the person sees next to the change.
- Mark annotations honestly: `readOnlyHint` true only for reads; `destructiveHint` for deletes.
- Tools reach data through `operationsService` and the other services, so access checks apply for the signed-in user. Never read the stores directly from a tool, never use admin identity on a user's behalf.
- Tool descriptions are prompts: say when to use the tool and when not to. Keep outputs small (clip long text).
- The permission gate in `permission-policy.mts` decides what the agent may write; do not widen it without a spec.

## 8. Frontend

Follow `frontend/AGENTS.md` and `frontend/STYLE_GUIDE.md`. In short:

- shadcn/Radix components from `src/components/ui/`; ops composites in `src/components/ops/`. No other UI kit.
- Colour tokens only, never hex or `bg-white`. Visual rules live in the style guide; do not invent a palette for a feature.
- TanStack Query owns server state. All fetches live in `src/api/`; components never call `fetch()` directly.
- One Task engine (`/api/tasks/*`) for agent chat. Never fabricate agent replies client-side.
- New files are `.ts` / `.tsx`.
- Lazy-load routes, pages, heavy panels and heavy libraries. Large or unbounded collections use paginated API calls; long rendered lists use windowing where practical. Never load a whole collection when a page is enough.
- Every interactive state has loading, empty, error, disabled and keyboard-focus behaviour. Icon-only buttons have an accessible label.
- Expected network failures show as a toast or inline error; unexpected render failures belong to the error boundary.
- No tokens or secrets in `localStorage`, `sessionStorage` or URLs. No raw-HTML rendering (`dangerouslySetInnerHTML`) of untrusted content; markdown goes through the shared `Markdown` component.
- Do not commit `dist/`, `node_modules/`, `coverage/` or other generated output.
- Run `npm run quality:check`. The pre-commit hook must not be bypassed.

## 9. Testing

- Backend: `cd backend && npm test` (`node --test`, concurrency 1, `tests/*.test.mjs`). Tests use a temp workspace per file; reuse `tests/helpers.mjs` (`tempDir`, `fakeSdk`, `makeRuntime`, `wait`). No test may touch the network or real credentials.
- Frontend: `npm run test:unit` (vitest), or `npm run quality:check` for the whole gate.
- Plugin: the validator and unittest commands in `plugin/SOURCE.md`.
- Each implemented FR gets a test that fails without the change. Fix bugs with a failing test first.
- Every new or changed API route gets a test through the HTTP route, covering the success contract. If the change touches permissions, validation, storage or errors, also test the denial or failure path. A helper-only test does not replace a route test.
- Every new or changed frontend API method, page workflow or integration-facing state gets a focused test: request path and payload, response and error handling, and the loading, empty and failure states that changed.
- Do not delete, skip, loosen or rewrite an existing test to make a change pass. If a test is wrong, tell a human and wait. Commits that edit an existing test file need `AI_TEST_CHANGE_ACK=ack`, only after a human confirms, and the PR explains the behaviour change. New test files need no acknowledgement.
- Coverage target: 70% for new or materially changed modules. Visible but not blocking for now. Report it for feature changes (`npm run test:coverage` in `frontend/`, `node --test --experimental-test-coverage` in `backend/`); a typecheck or build result is not a substitute.
- Use four validation tiers. After each meaningful edit, run the cheapest check that can falsify the change. At commit, the path-scoped pre-commit hook runs its required guardrails. At feature handoff, run the full checks for every changed surface in the matrix below. CI runs the deploy gate for backend and frontend; it does not replace a plugin handoff check.

| Changed surface | Edit loop | Feature handoff |
| --- | --- | --- |
| Docs or spec only | Relevant docs and governance check | No product suite, unless the change implements or changes an FR |
| Backend | Typecheck and affected test or route test | `npm run verify:build` and `npm test` in `backend/` |
| Frontend | Affected ESLint, typecheck or Vitest test | `npm run quality:check` in `frontend/` |
| Plugin | Validator or affected unit test | Plugin validator and full plugin unit suite |
| More than one surface | Each affected surface's edit-loop check | Each affected surface's handoff check |

- Changes to routes, RBAC, storage, migrations, agent permissions, configuration or deploy scripts also run the focused denial, integration or failure-path test required by their area. Do not defer that test to handoff.
- Run the narrowest relevant test first. Report counts as they are (passed, failed, skipped), name pre-existing failures (`deploy/ci-test.sh` lists known ones), and never claim a suite passed that you did not run.
- If a test or doc update is genuinely not needed, say why in the handoff and PR.

## 10. Security review

Package vulnerability output must be visible to the developer and the reviewer. For dependency changes, show `npm audit` output (`npm run audit` in `frontend/`, `npm audit --omit=dev` in `backend/`). Audit findings do not block for now, but call out high and critical findings in the PR with a fix plan or an accepted-risk note.

AI reviewers and humans flag:

- Routes without a declared permission, or reads that skip project or ownership checks.
- Streaming endpoints that authenticate but do not authorise.
- Path traversal or unsafe file handling, including zip extraction (`adm-zip`).
- `child_process` calls built from input, or with a shell.
- SQL built from strings, or unbounded queries.
- Secrets in source, logs, errors, responses, task transcripts, browser storage or the plugin.
- Insecure CORS, cookie or session behaviour; unsafe redirects.
- Frontend XSS sinks.
- Agent tools or permission-policy changes that widen what the agent may write.
- Dependency upgrades without audit output and compatibility notes.

## 11. Specs

- Specs in `specs/<area>/<feature>.md`, from `specs/_templates/feature-spec.md`. Status flow: draft, approved, implemented, deprecated.
- Requirements are numbered `FR-n`, written with SHALL, each testable. Name FR ids in test titles or comments so coverage can be traced.
- The implementing change updates `status` and `last_verified`, and removes any "Known gaps" entry it closed (and the matching line in `specs/BACKLOG.md`).
- `docs/DESIGN.md` is the product vision. Specs are the contract. If DESIGN.md is now wrong, update it in the same change.
- When spec and code disagree: do not pick silently. Decide which is right by asking a human. If the spec is right, fix the code. If the code is right, edit the spec in the same change and say so. If unsure, record it under "Known gaps" and keep going on unrelated work.

## 12. ADRs

Use `docs/adr/0000-template.md`. One decision per file, next free number, status `proposed` until a human accepts it. Write one for: new storage layout or migration approach, new external service or dependency, auth or permission model changes, deployment shape. Keep it under a page: context, decision, alternatives, consequences. Never edit an accepted ADR's decision; supersede it. See `docs/adr/README.md`.

## 13. Plugin

`plugin/operations-fleet/` is vendored from `zs_businesstech/ai_for_data`. Local edits are allowed. Each one is recorded in `plugin/SOURCE.md` under a dated heading, and the validator and unit tests pass. Skills stay generic; client-specific content belongs in the client's knowledge. Do not paste secrets or demo-client names into it.

## 14. Commits and PRs

- Subject: one line, imperative, sentence case, no trailing period, says what the change does ("Route the API through one table and share backend helpers").
- Body: a short paragraph on what changed and what behaviour is preserved or different. Mention new tests. Cite the spec FR ids or ADR number when there are any.
- Keep a change reviewable: one concern, no drive-by edits. Do not commit unless asked. Never force-push or rewrite history unasked.
- Agent commits shouldn't end with the `Co-Authored-By` line the tool gives you.

An AI-assisted PR says:

- Which AI tool was used, and which files it generated or heavily changed.
- Whether existing tests changed, and why.
- Which tests were added.
- Which docs were updated, or why none needed to be.
- Whether any fallback path was added, and the reason.
- Whether auth, RBAC, env, storage, migrations, deployment, dependencies, agent tools or the plugin changed.
- Which checks were run, with their results, and any hook or check that was skipped.

Review and waivers:

- A human reviews AI output before merge. AI summaries, tests and reviews do not replace human approval.
- Sensitive changes need an owner's review: auth and sessions, RBAC and the route table, secrets, migrations, the API client, env wiring, deployment config, agent tools and the permission policy.
- Deterministic checks (tests, lint, typecheck, build, audit) are the source of truth; AI review is extra.
- Do not merge unresolved high or critical security findings without a waiver naming the owner, reason, risk accepted, follow-up ticket and expiry date.

## 15. Checks to run

```bash
cd backend && npm test                                  # backend, node:test, no external services
cd frontend && npm run quality:check                    # governance, lint, typecheck, vitest, build
python plugin/operations-fleet/tools/validate_plugin.py # plugin, after any plugin change
python -m unittest discover -s plugin/operations-fleet/tests
```

Visible, not blocking, for now:

```bash
cd frontend && npm run test:coverage && npm run audit
cd backend && node --import tsx --import ./tests/test-environment.mjs --test --experimental-test-coverage --test-concurrency=1 tests/*.test.mjs
cd backend && npm audit --omit=dev
```

The repository pre-commit hook (`.githooks/pre-commit`) runs from any repository subdirectory. Install it once per clone with `git config --local core.hooksPath .githooks`. It always runs branch/test guardrails and staged docs/breakage checks, then runs typechecks, lint, plugin validation and focused tests for staged source paths. It is a commit-tier check, not a replacement for the changed-surface handoff matrix in section 9.

## 16. Do not

- Add inline `CREATE TABLE`, or change a stored shape, without an approved spec or ADR.
- Add a write route without a declared permission.
- Weaken auth, SSO, RBAC, project checks, validation, path safety, error handling, CORS or secret handling.
- Put secrets, tokens or customer data in code, tests, logs, docs or browser storage.
- Add a fallback, shim, silent retry or swallowed error without a stated reason and tests.
- Add an unbounded query or an API that returns a whole table.
- Call `fetch()` from a component, or add another UI kit.
- Edit generated or vendored files (`plugin/` excepted, with a SOURCE.md note).
- Commit on a protected branch, or bypass a hook unasked.
- Fix unrelated problems inside your change; list them in your report or `specs/BACKLOG.md`.
