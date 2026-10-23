---
id: SPEC-projects-04
title: A project's own Anthropic API key
status: implemented        # draft | approved | implemented | deprecated
area: projects
owners: []
code:                      # source of truth paths this spec will touch
  - backend/src/projects/project-api-keys.mjs      # new: store and check of a project's key
  - backend/src/projects/project-routes.mjs        # GET|PUT|DELETE /api/projects/:id/api-key
  - backend/src/app/rbac.mjs                       # ADMIN_ROUTES: setting and removing the key is app-admin only
  - backend/src/tasks/task-runtime.mjs             # every run uses its project's key, or does not start
  - backend/src/data-quality/data-quality-service.mjs
  - backend/src/data-quality/ddl-mapping-agent.mjs # the DQ mapping agent uses the project's key
  - backend/src/api/server.mjs
  - backend/src/bootstrap.mjs
  - frontend/src/api/projects.ts
  - frontend/src/features/settings/ModelTab.tsx
last_verified: 2026-10-06
---

# A project's own Anthropic API key

## Purpose
Today every project's Claude usage runs on one deployment key (`ANTHROPIC_API_KEY`), so usage cannot be billed or capped per project. This spec gives each project its own key, set by an app admin in the project's Settings > Model, and makes it the only key that project's Claude calls use.

## Decisions (owner, 2026-10-05)
- Only app (global) admins set, replace or remove a project's key. Project owners and members see whether one is set. This keeps SPEC-projects-03 FR-2 (`secrets.manage` is admin-only).
- No fallback: a project without its own key does not use the deployment key. Its Sonic runs and its DQ mapping agent stop with a message saying so.
- The key covers every Claude call made for the project: Sonic tasks and chats (including routines and ticket triage, which run as tasks) and the data-quality DDL mapping agent.

## Requirements
- **FR-1** A project's key SHALL be stored only in the secret store (`OPS_SECRET_STORE`), at ref `projects/<projectId>/anthropic/api-key`, as JSON `{key, setBy, setById, setAt}`. It SHALL never be written to `operations.yaml`, the workspace, logs, task events or an API response.
- **FR-2** `GET /api/projects/:id/api-key` SHALL return `{set, last4?, setBy?, setAt?}` to app admins and to anyone with a role in the project; others get 403.
- **FR-3** `PUT /api/projects/:id/api-key {apiKey}` and `DELETE /api/projects/:id/api-key` SHALL be app-admin only (`ADMIN_ROUTES`), and return the same status shape as FR-2.
- **FR-4** Saving SHALL reject (400) a value that does not look like an Anthropic key (`sk-ant-…`) and a key Anthropic answers 401 or 403 for (`GET /v1/models`). When Anthropic cannot be reached, the key SHALL be saved and the response SHALL say `verified: false`.
- **FR-5** *Removed by ADR 0003 (2026-10-06): there is no audit log.*
- **FR-6** A task run SHALL get `ANTHROPIC_API_KEY` from its project's key, overriding any deployment value. A run whose project has no key SHALL fail before the SDK starts, with the error `This project has no Anthropic API key. Ask an app admin to add one in Settings > Model.`
- **FR-7** The DQ mapping agent SHALL use the project's key. When the project has none, `analyze` SHALL still return the deterministic mapping, with `agent.used: false` and the FR-6 message as the reason, and SHALL not read a data sample.
- **FR-8** Settings > Model SHALL show the key's state (set, ending in, by whom and when, or "No key"). App admins SHALL get a password field to set or replace it and a Remove action; everyone else a read-only line naming who can change it.

## Scenarios
### S1 An app admin sets a key
- **Given** project `sales` with no key
- **When** an app admin PUTs a valid key
- **Then** the response is `{set: true, last4, setBy, setAt}`; the secret store holds it at `projects/sales/anthropic/api-key`.

### S2 A project owner cannot set it
- **When** the owner of `sales` (not an app admin) PUTs a key
- **Then** 403; GET still answers `{set: false}`.

### S3 No key blocks the run
- **Given** project `sales` with no key and a deployment `ANTHROPIC_API_KEY`
- **When** a task in `sales` runs
- **Then** it fails with the FR-6 message and the SDK is never started.

## Known gaps / deviations
- The DQ service is one shared instance without a project (`bootstrap.mjs`), so the route passes the project's key in; result-table settings are not yet per project (separate gap).
- `/health` `anthropicKeyPresent` still reports the deployment key only.

## Traceability
| Requirement | Code | Test |
|---|---|---|
| FR-1..FR-5 | `projects/project-api-keys.mjs`, `projects/project-routes.mjs`, `app/rbac.mjs` | `backend/tests/project-api-key.test.mjs` |
| FR-6 | `tasks/task-runtime.mjs` (`apiKey` option), `bootstrap.mjs` | `backend/tests/project-api-key.test.mjs` |
| FR-7 | `data-quality/data-quality-service.mjs`, `data-quality/ddl-mapping-agent.mjs`, `api/server.mjs` | `backend/tests/project-api-key.test.mjs` |
| FR-8 | `frontend/src/features/settings/ModelTab.tsx`, `frontend/src/api/projects.ts` | `frontend/src/features/settings/ModelTab.apiKey.test.tsx` |
