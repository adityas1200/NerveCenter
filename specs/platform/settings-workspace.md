---
id: SPEC-platform-04
title: Settings and agent workspace (operations.yaml, MCP config, S3 sync)
status: implemented
area: platform
owners: []
code:
  - backend/src/workspace/workspace.mjs
  - backend/src/workspace/workspace-sync.mjs
  - backend/src/sync/sync-settings.mjs
  - backend/src/api/server.mjs
  - backend/src/main.mjs
  - frontend/src/features/settings/SettingsPage.tsx
  - frontend/src/features/settings/useSaveSection.ts
  - frontend/src/api/settings.ts
  - docs/operations.example.yaml
last_verified: 2026-10-03
---

# Settings and agent workspace

## Purpose
One workspace folder per deployment holds `operations.yaml` (the only config file), the rendered `.mcp.json`, knowledge, routines, custom skills, templates and per-task folders. Settings is a form over `operations.yaml`, one section at a time; the vendored plugin's skills read the same file. In deployed stacks the folder is mirrored to S3.

## Scope
- In scope: workspace layout/seeding, `operations.yaml` read/validate/section write with comment preservation, `.mcp.json` rendering, `GET /api/settings`, `PUT /api/settings/:section`, S3 restore/push, Settings page shell and Workspace tab.
- Out of scope: contents/semantics of each section (ticketing, policy, agent model have their own specs), connectors CRUD, skills/knowledge/routine file ops (library specs).

## Actors and permissions
Reads (`GET /api/settings`) are open to every signed-in user (the Policy tab relies on it). Writes are admin-only via the route matcher (rbac.md FR-4).

## Requirements
- **FR-1** On init the workspace SHALL create `knowledge/`, `workflows/`, `.claude/skills/`, `tasks/`, `templates/`; seed `operations.yaml` from the plugin's `skills/setup/assets/operations.template.yaml` (fallback: minimal `team`/`connections`) with `policy` defaults applied, comments preserved; write `CLAUDE.md` if missing; render `.mcp.json`.
- **FR-2** The writable sections SHALL be exactly: team, sync, ticketing, platforms, identity, source_control, branding, documents, communication, knowledge, policy, connections, routines, connectors, agent, ui. Any other name SHALL throw `Unknown operations.yaml section: <name>` (HTTP 400).
- **FR-3** `PUT /api/settings/:section` SHALL replace the whole section with the request body (an absent body writes `null`), then return `{section, value, validation}`. `agent` and `policy` values SHALL be validated before writing and rejected with 400 on problems; all other sections are written unvalidated.
- **FR-4** Writes SHALL be serialized through an in-process queue, retain YAML comments for surviving sections, delete top-level keys the mutator removes, then re-render `.mcp.json`.
- **FR-5** `.mcp.json` SHALL contain `{mcpServers}` from `connections` entries with `kind: mcp` and `enabled !== false`: remote transports `http|sse|ws` need `url`; `stdio` needs `command` (optional `args` list); `headers|env|oauth` pass through as mappings; other transports throw.
- **FR-6** `validateOperations` SHALL return `{errors, warnings}`: errors for missing `team`, `team.name`, `team.timezone`; `connections` not a mapping or entries with kind outside `mcp|cli|api|native|smtp`; invalid MCP/CLI/SMTP specs; `connection:` keys pointing to unknown connections; keys named like password/token/secret/api_key/... whose value is not a `${VAR}` reference ("possible committed secret"); agent and policy section errors. Warnings: unrecognized top-level sections; missing `policy.default_write`.
- **FR-7** `GET /api/settings` SHALL return `{operations, validation, mcp}`.
- **FR-8** `setConnection` SHALL slugify the name (`^[a-z0-9][a-z0-9-]{0,63}$`) and reject unknown kinds or invalid MCP specs before writing.
- **FR-9** `WorkspaceSync` SHALL exist only when `s3_bucket`/`OPS_S3_BUCKET` is set. At boot it SHALL restore from `s3://<bucket>/<prefix>/workspace/` only when local `operations.yaml` is absent (or forced); restore failure SHALL not stop boot.
- **FR-10** `push()` SHALL upload files whose size or mtime changed since the last push (state in `.nervecenter-sync.json`), delete S3 objects for files removed locally, exclude `.git`, `node_modules`, `__pycache__`, root `source/` and the state file, run at most one push at a time, repeat every `OPS_WORKSPACE_SYNC_SECONDS` (default 60), and flush on SIGINT/SIGTERM.
- **FR-11** Automatic sync settings SHALL be read from `sync.enabled` (default true) and `sync.intervalValue` + `sync.intervalUnit` (seconds|minutes|hours), falling back to legacy `sync.interval_seconds`, then 15 s.
- **FR-12** The Settings page SHALL list tabs Workspace, Ticketing, Pipelines, Data quality, Policy, Model, Templates, Users & roles (`?tab=`; `team` aliases workspace), disable Save until the draft differs from stored values, surface backend errors in a toast, and show validation errors as an amber banner to admins. Non-admins SHALL see only Policy, read-only.
- **FR-13** The Workspace tab SHALL write `team` (name, timezone required), `sync` (enabled, interval) and `ui.disabledSections` (pages hidden workspace-wide).

## Scenarios
### S1 Admin saves team
- **Given** admin and an empty workspace
- **When** `PUT /api/settings/team {name,timezone}`
- **Then** 200, value echoed, `GET /api/settings` shows it; a developer gets 403.

### S2 Unknown connection reference
- **Given** `ticketing.connection: missing`
- **When** validation runs
- **Then** errors include `unknown connection: missing`.

### S3 Fresh container with S3
- **Given** empty local workspace and objects under the prefix
- **When** boot restores
- **Then** files are downloaded and state recorded; a second restore is skipped.

### S4 Secret in config
- **Given** `identity.api_token: real-secret-value`
- **Then** validation reports "possible committed secret".

## Interfaces
- HTTP: `GET /api/settings`; `PUT /api/settings/:section`.
- Files: `<WORKSPACE_DIR>/operations.yaml`, `.mcp.json`, `CLAUDE.md`, `.nervecenter-sync.json`; `WORKSPACE_DIR` = `OPS_WORKSPACE_DIR` or `backend/workspace`; plugin from `OPS_PLUGIN_DIR` (default `plugin/operations-fleet`).
- Config: `s3_bucket`/`OPS_S3_BUCKET`, `NC_S3_PREFIX`/`OPS_S3_PREFIX` (default `nervecenter`), `AWS_REGION` (default us-east-1), `OPS_WORKSPACE_SYNC_SECONDS`.
- UI: `/settings`; `docs/operations.example.yaml` documents the post-connect shape (placeholders use `${VAR}`).

## Non-functional constraints
No secrets in `operations.yaml` (enforced only by the validator heuristic). Writes are serialized per process only; two replicas race on S3.

## Known gaps / deviations
- A section write is persisted even when it leaves the file invalid (only `agent`/`policy` pre-validated); `validation` is reported after the fact. Writing a bad `connections` section writes YAML first and then `renderMcp` throws (400 but file already changed, `.mcp.json` stale).
- `PUT` with a section name as `p[2]` only; nested paths and `PATCH` are not supported although the matcher lists them.
- S3 sync is last-writer-wins, push-only after boot; restore runs only on an empty workspace so S3 edits never flow back while the pod runs. mtime-based diff; no checksum.
- `operations.example.yaml` was not machine-validated here; its `team.operator` is a plugin-only field and `ticketing.sources`/`platforms` shapes differ from the UI's `ticketing.app.sources`.
- Tests do not cover `PUT` with invalid agent/policy over HTTP, the `ui` section, templates dir, or sync interval parsing. `GET /api/settings` leaks full operations to all roles (by design, noted in UI).

## Traceability
| Requirement | Code | Test |
|---|---|---|
| FR-1 | `backend/src/workspace/workspace.mjs:113-127` | `backend/tests/workspace.test.mjs:11` |
| FR-2 | `backend/src/workspace/workspace.mjs:31,148-152` | `backend/tests/workspace.test.mjs:36` |
| FR-3 | `backend/src/api/server.mjs:103`, `workspace.mjs:148-152` | `backend/tests/api.test.mjs:56` |
| FR-4 | `backend/src/workspace/workspace.mjs:128-146` | `backend/tests/workspace.test.mjs:22` |
| FR-5 | `backend/src/workspace/workspace.mjs:44-64` | `backend/tests/workspace.test.mjs:22` |
| FR-6 | `backend/src/workspace/workspace.mjs:67-99` | `backend/tests/workspace.test.mjs:36` |
| FR-7 | `backend/src/api/server.mjs:102` | `backend/tests/api.test.mjs:56` |
| FR-8 | `backend/src/workspace/workspace.mjs:158-164` | `backend/tests/workspace.test.mjs:22` |
| FR-9 | `backend/src/workspace/workspace-sync.mjs:40-57,112-115`, `backend/src/main.mjs:9-14` | `backend/tests/workspace-sync.test.mjs:46` |
| FR-10 | `backend/src/workspace/workspace-sync.mjs:60-100` | `backend/tests/workspace-sync.test.mjs:27` |
| FR-11 | `backend/src/sync/sync-settings.mjs:4-12` | none |
| FR-12 | `frontend/src/features/settings/SettingsPage.tsx:33-90`, `useSaveSection.ts:12-19` | `frontend/src/features/settings/SettingsPage.test.tsx` |
| FR-13 | `frontend/src/features/settings/SettingsPage.tsx:107-170` | `frontend/src/features/settings/SettingsPage.test.tsx` |

## Open questions
- Should PUT reject writes that make `validation.errors` non-empty?
