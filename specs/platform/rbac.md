---
id: SPEC-platform-02
title: Roles, permissions and admin-only routes
status: implemented
area: platform
owners: []
code:
  - backend/src/app/rbac.mjs
  - backend/src/app/rbac-store.mts
  - backend/src/api/server.mjs
  - backend/src/config.mjs
  - frontend/src/auth/rbac.tsx
  - frontend/src/api/admin.ts
  - frontend/src/features/settings/UsersRolesTab.tsx
last_verified: 2026-10-06
---

# Roles, permissions and admin-only routes

## Purpose
Three-tier RBAC (admin, developer, viewer) with an admin console to manage users. (The audit log was removed by ADR 0003.) Admin-only HTTP routes protect platform controls (settings, secrets, connections, connectors, skills, knowledge writes).

## Scope
- In scope: role resolution, permission lists, user directory store, `/api/admin/rbac/*`, admin route matcher, Users & roles tab.
- Out of scope: per-ticket ownership checks (`operations-service.mjs` `isAdmin`/`permissionFor`), identity modes (identity-auth.md).

## Actors and permissions
- **admin**: all permissions, all admin routes.
- **developer**: `tasks.manage, routines.manage, skills.manage, knowledge.manage, connectors.use`.
- **viewer**: no permissions.
Only admins reach `/api/admin/*` and the admin-only write routes.

## Requirements
- **FR-1** Valid roles SHALL be exactly `admin`, `developer`, `viewer`.
- **FR-2** Role resolution order SHALL be: stored role in the RBAC store; user id in `config.adminUserIds`; IdP role equal to `OPS_ADMIN_ROLE` (default `ops-admin`) or `admin`; IdP `developer`; IdP `viewer`; then `admin` in `development`/`single-user` mode, else `developer`. (Test: stronger of viewer+developer wins.)
- **FR-3** `permissionsFor` SHALL return the admin list (12 permissions) for admin, `[]` for viewer, and the 5 developer permissions otherwise.
- **FR-4** The matcher `isAdminOnlyRoute(method, path)` SHALL mark as admin-only: any `/api/admin/**`; write methods on `/api/secrets/:ref`, `/api/connections[/:id[/set-default]]`, `/api/data-quality/config`, `/api/settings[/**]`, `/api/connectors/**`, `/api/knowledge/**`; `POST/DELETE /api/skills/**` and `/api/templates/**`; `POST /api/integrations/{servicenow,jira}/sync`; `POST /api/tickets/poll`. The server SHALL return 403 "Administrator role is required for this action" for non-admins, before any handler.
- **FR-5** The store SHALL auto-provision a user on first authenticated request: `admin` if id is in `adminUserIds` or IdP roles include the admin role, else `developer`; it SHALL backfill name/email on later logins.
- **FR-6** The store SHALL seed `config.seedAdmins` (only from `OPS_RBAC_SEED_ADMINS` JSON; no admins are baked in) as admins when missing, never overwriting existing entries. `adminUserIds` comes from `OPS_ADMIN_USER_IDS` plus `data/config/admins.json`.
- **FR-7** An existing non-blocked user whose id is in `adminUserIds` SHALL be promoted to admin on request.
- **FR-8** `POST /api/admin/rbac/users` upserts (201); `PATCH|PUT /users/:id` upserts; `POST /users/:id/role` sets role; `POST /users/:id/block|unblock`; `DELETE /users/:id`; `GET /users`, `/users/:id` (404 if missing), `/roles`.
- **FR-9** A user SHALL NOT delete (400), block (400) or demote (400) their own account via these routes.
- **FR-10** Validation: id required, <=128 chars; role must be valid (400 `Invalid role: x`); name/email truncated to 200; unknown user on role/block returns 404.
- **FR-11** *Removed by ADR 0003 (2026-10-06): there is no audit log.*
- **FR-12** With `OPS_METADATA_STORE=file` the store SHALL persist JSON at `OPS_RBAC_USERS_FILE` (default `backend/data/config/rbac-users.json`) via write-temp-then-rename. With `postgres` it SHALL use table `ops_rbac_users`, importing the JSON file exactly once (claimed by the `ops_rbac_meta` row `rbac-file-import`, ADR 0003) so deletions are not undone by restarts.
- **FR-13** The frontend SHALL show Settings tabs other than Policy only to admins; non-admins get Policy read-only and a redirect to `/` for other tabs. The Users & roles tab SHALL disable role/block/remove controls for the current user.

## Scenarios
### S1 Non-admin writes settings
- **Given** developer `alice`
- **When** `PUT /api/settings/team`
- **Then** 403; the same call by an admin returns 200 (`api.test.mjs`).

### S2 Viewer role assignment
- **Given** user `priya` as developer
- **When** an admin sets role `viewer`, then `member`
- **Then** first succeeds, second fails `Invalid role` (`rbac.test.mjs`).

### S3 Self protection
- **Given** admin `a`
- **When** `a` POSTs role `developer` for `a`
- **Then** 400 "You cannot demote your own admin role".

## Interfaces
- HTTP: see FR-8; `GET /api/me`; `GET /api/admin/rbac/roles` returns `ROLE_DEFINITIONS`.
- Data: tables `ops_rbac_users(id, data jsonb)`, (created at runtime by the store, not in `backend/migrations`), `ops_rbac_meta(key, at)` (migration 008); record `{id,name,email,role,blocked,createdAt,updatedAt,updatedBy}`.
- Config: `OPS_ADMIN_ROLE`, `OPS_ADMIN_USER_IDS`, `OPS_ADMIN_LIST_FILE` (`data/config/admins.json`), `OPS_RBAC_SEED_ADMINS`, `OPS_RBAC_USERS_FILE`.
- UI: `/settings?tab=users`.

## Non-functional constraints
File store is single-process (no locking across instances).

## Known gaps / deviations
- **Viewer and developer permissions are not enforced by the backend.** `hasPermission`/`assertPermission` (rbac.mjs:42-53) are module-private and never called; only `assertAdmin` and ticket-level checks run. A viewer can still create tasks, tickets, comments. Docs say "cannot chat with Sonic or change anything"; only the frontend hides controls.
- Anyone in `OPS_ADMIN_USER_IDS` cannot be durably demoted: FR-7 re-promotes on each request, and deleted seeds return on boot. `.env.defaults` commits real admin ids/emails for dev.
- RBAC tables are created inline by the store, bypassing `backend/migrations` (see storage-migrations.md).
- `DELETE /api/data-quality/config/:id` is admin-checked in-handler (server.mjs:71) and also matched only for POST/PUT in the matcher.
- Frontend `Permission` union (`approvals.production`, `agents.manage`, `connectors.integrate`, ...) does not match backend names (`logs.view`, `connectors.use`...).
- A developer-role user in `development` mode with no stored entry would be admin (FR-2 fallback), but provisioning normally prevents this.
- Untested: `/api/templates` matcher entry, admin route matcher, self-protection, block/unblock, seeding, auto-promote, `/api/admin/rbac/*` HTTP routes.

## Traceability
| Requirement | Code | Test |
|---|---|---|
| FR-1 | `backend/src/app/rbac.mjs:6-8` | `backend/tests/rbac.test.mjs:6` |
| FR-2 | `backend/src/app/rbac.mjs:22-34` | `backend/tests/rbac.test.mjs:6` (partial) |
| FR-3 | `backend/src/app/rbac.mjs:10-40` | `backend/tests/rbac.test.mjs:6` |
| FR-4 | `backend/src/app/rbac.mjs:57-75`, `backend/src/api/server.mjs:39` | `backend/tests/api.test.mjs:56` (settings only) |
| FR-5 | `backend/src/app/rbac-store.mts` | `backend/tests/api.test.mjs:20` (indirect) |
| FR-6 | `backend/src/app/rbac-store.mts` | none |
| FR-7 | `backend/src/app/rbac-store.mts` | none |
| FR-8 | `backend/src/api/server.mjs:44-55` | none |
| FR-9 | `backend/src/api/server.mjs:51-53` | none |
| FR-10 | `backend/src/app/rbac-store.mts` | `backend/tests/rbac.test.mjs:21` |
| FR-11 | removed (ADR 0003) | `backend/tests/rbac-audit-removed.test.mjs` |
| FR-12 | `backend/src/app/rbac-store.mts`, `backend/migrations/008-drop-rbac-audit.sql` | `backend/tests/rbac-postgres.test.mjs:55,68,81` (postgres); `backend/tests/rbac.test.mjs:21` (file) |
| FR-13 | `frontend/src/features/settings/SettingsPage.tsx:48,59-67`, `UsersRolesTab.tsx:101-117` | `frontend/src/features/settings/SettingsPage.test.tsx` |

## Open questions
- Should the backend enforce `tasks.manage` etc. so viewers are read-only server-side?
