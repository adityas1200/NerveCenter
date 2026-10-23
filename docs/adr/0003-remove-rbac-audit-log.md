# 0003. Remove the RBAC audit log

- Status: accepted
- Date: 2026-10-06
- Related: specs/platform/rbac.md, specs/platform/storage-migrations.md, specs/projects/projects.md, specs/projects/project-roles.md, specs/projects/project-access-and-home.md, specs/projects/project-api-key.md

## Context
- Every user, project, member, grant, connection and project API key change appends an entry through `rbacStore.recordAudit` / `#record` (`backend/src/app/rbac-store.mjs`). Callers are wired in `backend/src/bootstrap.mjs` (project store, connection service, project API keys). `operations-service.mjs` has an `audit` hook that nothing wires.
- Entries live in `ops_rbac_audit` (Postgres, created inline by `PostgresRbacPersistence.load`, capped at 2000) or `rbac-audit.json` (file store, `OPS_RBAC_AUDIT_FILE`). They are read by `GET /api/admin/rbac/audit` (permission `audit.view`) and shown in the Admin console "Audit log" tab.
- Nobody uses the log. The product owner asked to remove it, its API and its UI.
- The table also holds one row that is not an audit entry: id `rbac-file-import`. Claiming it guarantees the user directory in the image file is copied into Postgres once. Without it, every boot would re-import the file, and users deleted in the Admin console would come back with the file's role (existing users are skipped, so role changes are kept).

## Decision
1. Stop recording. Remove `#record`, `recordAudit`, `listAudit`, the in-memory `audit` array and `AUDIT_MAX` from `rbac-store.mjs`, and the `audit` collaborator from `project-store.mjs`, `connection-service.mjs`, `project-api-keys.mjs`, `operations-service.mjs` and `bootstrap.mjs`.
2. Remove `GET /api/admin/rbac/audit` from `backend/src/api/server.mjs` and the `audit.view` permission from `backend/src/app/rbac.mjs` and `frontend/src/auth/rbac.tsx`.
3. Remove the Audit log tab, `KEYS.audit`, `adminApi.audit` and `AdminAuditEntry` from the frontend.
4. Migration `backend/migrations/008-drop-rbac-audit.sql`: create `ops_rbac_meta (key text PRIMARY KEY, at timestamptz NOT NULL)`; if `ops_rbac_audit` exists, copy its `rbac-file-import` row into `ops_rbac_meta`, then `DROP TABLE ops_rbac_audit`. Guarded with `to_regclass` and `ON CONFLICT DO NOTHING`, so it is safe to run twice and on a fresh database.
5. The import-once claim moves to `INSERT INTO ops_rbac_meta(key, at) ... ON CONFLICT DO NOTHING RETURNING key`. Same single-INSERT race safety as today.
6. File twin `backend/migrations/008-drop-rbac-audit.mjs`: delete the audit file at `OPS_RBAC_AUDIT_FILE` if still set, and `rbac-audit.json` beside the users file (`OPS_RBAC_USERS_FILE`, default `data/config/`), where every stack kept it. The file store has no import marker, so nothing moves.
7. Remove `OPS_RBAC_AUDIT_FILE` from `backend/tests/test-environment.mjs`, `deploy/aws/docker-compose.yml` and the specs.
8. Update the specs listed above: drop the audit FRs and "goes to `ops_rbac_audit`" lines, record the change in each changelog, and list `ops_rbac_meta` where the RBAC tables are listed.

## Alternatives considered
- Hide only the UI tab and keep recording: rejected. The owner wants the data gone, not hidden.
- Drop the table and check "is `ops_rbac_users` empty?" instead of a marker: rejected. An admin who empties the directory on purpose would get the image file's users back on the next boot.
- Keep the marker in `ops_schema_migrations`: rejected. That table belongs to the migration runner; mixing app state into it is surprising.

## Consequences
- No record remains of who changed a role, membership, grant, connection setting or API key. Answering "who made X an admin" needs the deploy logs or a new feature. Existing entries are deleted by the migration and cannot be recovered.
- Five backend test files lose audit assertions (`project-access`, `project-api-key`, `project-roles`, `projects-scope`, `rbac-postgres`). These are edits to existing tests and need `AI_TEST_CHANGE_ACK=ack`. The behaviour each test covers otherwise stays.
- New tests: migration 008 copies the marker, drops the table and runs twice cleanly; a restarted Postgres store does not re-import the file once the marker is in `ops_rbac_meta`; the file migration removes the audit file; `GET /api/admin/rbac/audit` returns 404; the Admin console no longer shows the tab.
- Rollback: the migration is forward-only. To restore the feature, revert the code and add a new migration that recreates the table; past entries are not recoverable, so take a `pg_dump -t ops_rbac_audit` before deploying if anyone may want them.
- Historical docs (`docs/sonic-audit/*`, `docs/PLAN-*`, `docs/mockup-home`) are left as they are; they describe past states.
