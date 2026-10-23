---
id: SPEC-projects-02
title: Project roles (project admin and member), project creation and private tickets
status: implemented        # draft | approved | implemented | deprecated
area: projects
owners: []
code:                      # source of truth paths this spec will touch
  - backend/migrations/004-project-roles.sql        # new: Postgres side (role column, ticket visibility remap, connection flag)
  - backend/migrations/004-project-roles.mjs        # new: file-store side of the same migration
  - backend/src/projects/project-store.mts
  - backend/src/projects/project-access.mjs         # gains the "project admin of the current project" rule
  - backend/src/projects/project-routes.mjs
  - backend/src/app/rbac.mjs                        # ADMIN_ROUTES narrowed; role-change hook
  - backend/src/app/rbac-store.mts                  # audit of automatic demotion
  - backend/src/app/operations-service.mjs          # canAccess / permissionFor
  - backend/src/connections/connection-service.mjs  # projectAdminsMayGrant
  - backend/src/tasks/task-runtime.mjs
  - backend/src/tasks/nervecenter-tools.mjs
  - backend/src/api/server.mjs
  - backend/src/lib/router.mjs
  - frontend/src/api/client.ts
  - frontend/src/features/settings
last_verified: 2026-10-06
---

# Project roles (project admin and member), project creation and private tickets

## Purpose
SPEC-projects-01 makes every project a flat member list managed by global admins. Teams need to run their own project: create it, add people, tune its settings, knowledge, skills, routines and connections, and keep a ticket private, without a global admin for each change. This spec adds two roles inside a project (`admin`, `member`), lets developers create projects, and replaces the "every member sees every ticket" rule with `project` / `private` ticket visibility. The global role stays the ceiling: a project role only ADDS management rights inside that one project.

## Amendments to SPEC-projects-01
This spec amends SPEC-projects-01. Where the two disagree, this spec wins; SPEC-projects-01 SHALL be edited to point here when this spec is approved (not done in this draft).

| SPEC-projects-01 | Change |
|---|---|
| Scope, out of scope "per-project roles" | Superseded. Membership now carries a role (FR-1). |
| FR-3 (membership is a plain `(project_id, user_id)` row, no role column) | Superseded by FR-1 and FR-2. Unknown-user ids are no longer allowed to be added (FR-6). |
| FR-4 (only admins create projects and add/remove members or grants) | Superseded. Creation: FR-3. Rename, archive/unarchive: global admin only, unchanged. Members: FR-7, FR-8. Grants: FR-14..FR-16. |
| FR-5 (audit of mutations) | Removed by ADR 0003: there is no audit log. |
| FR-11 (scope classes `global`, `admin-global`, `project`) | Extended: `/api/projects/:id/members*` and grants routes gain the class `project-admin` (FR-18). |
| FR-18 (`GET /api/me/projects` role is `member` or `admin`) | Clarified: `role` is the caller's PROJECT role (`admin` for global admins in every project). |
| FR-30 (all members see all tickets; `visibility` ignored) | Replaced by FR-20..FR-24. FR-30 was never applied (Known gaps of SPEC-projects-01), so it is dropped, not removed from code. |
| FR-31, FR-32, FR-34 (admins grant to projects) | Extended: project admins may grant (FR-14, FR-15). Library additions and deletions stay global-admin. |
| FR-35 (`knowledge/promote` admin only) | Extended: project admins may promote within their project (FR-12). |
| FR-38 (admin-only Projects tab) | Extended: project admins see a Projects tab limited to their projects (FR-27). |
| Actors: "admin creates projects" | Superseded by FR-3. |
| Interfaces: `POST /api/projects` admin only; members and grants routes admin only | Replaced by the HTTP delta below. |

FRs of SPEC-projects-01 not listed here are unchanged.

## Scope
- In scope: project roles and their storage; who may create projects; the global-role cap and automatic demotion; project-admin powers; connection-grant safeguard; ticket visibility; HTTP delta; agent behaviour; migration 004; frontend delta.
- Out of scope / non-goals: more than two project roles; creating connections or credentials by project admins (global admin only); inviting people who are not app users; per-project quotas; changing global role semantics (platform/rbac.md); deleting projects.

## Actors and permissions
- **global admin**: everything, in every project, including appointing and removing project admins. Every global admin is a project admin of every project by default, without being a member, so a project always has an admin.
- **global developer**: may create a project (becomes its project admin) and, as project admin or member of a project, works tickets, tasks and routines as today.
- **global viewer**: stays read-only everywhere. May be a project member; SHALL NOT be a project admin.
- **project admin**: a project member with role `admin`, whose global role is developer or admin.
- **project member**: a project member with role `member`.
- Rule: effective right = global role permits the action AND (project role grants it OR the action needs no project role). A project role never grants a right the global role lacks, except the project management rights in the matrix below, which only a developer or admin can hold.

### Permission matrix (inside project P)
Y = allowed, N = denied, "own" = only for tickets the caller created or is assigned (unchanged owner rule), "-" = not applicable.

| Action | Global admin | Global developer, project admin of P | Global developer, project member of P | Global developer, non-member | Global viewer, project member | Global viewer, non-member |
|---|---|---|---|---|---|---|
| Create project | Y | Y | Y | Y | N | N |
| Rename, archive, unarchive P | Y | N | N | N | N | N |
| Appoint/remove project admin, change member role | Y | Y | N | N | N | N |
| Add/remove member (existing app user) | Y | Y | N | N | N | N |
| Edit P settings, policy, operations.yaml, templates | Y | Y | N | N | N | N |
| Manage P knowledge bases, skills, routines | Y | Y | routines: as today (`routines.manage`); knowledge, skills: N | N | N | N |
| Review/keep/discard Sonic lesson drafts of P | Y | Y | N (read only) | N | N | N |
| Grant knowledge/skill to P | Y | Y | N | N | N | N |
| Grant connection to P, set routing filter | Y | Y only if `projectAdminsMayGrant` | N | N | N | N |
| Create connection or credential; set `projectAdminsMayGrant` | Y | N | N | N | N | N |
| View project-visible ticket of P | Y | Y | Y | N | Y | N |
| View private ticket of P | Y | Y | only if creator, requester, assignee, collaborator or approver | N | only if creator, requester, assignee, collaborator or approver | N |
| Mark ticket private/project | Y | Y | own | N | N | N |
| Assign or close ticket | Y | Y (any ticket in P) | own | N | N | N |
| Run Sonic task in P | Y | Y | Y | N | N (read only) | N |

## Requirements

### Roles and membership
- **FR-1** `ops_project_members` SHALL gain `role text NOT NULL DEFAULT 'member' CHECK (role IN ('admin','member'))` (file store: `role` on each member record, missing means `member`). Existing members SHALL become `member`. PILOT has no members and stays that way.
- **FR-2** Every project SHALL have at least one project admin or be a project with no members at all (PILOT after migration). A project SHALL NOT be left with members but no project admin by any API call made by a non-global-admin (FR-8). Global admins count as an implicit admin of every project, so a project with zero explicit admins remains manageable.
- **FR-3** `POST /api/projects` SHALL be open to global developers and admins (permission check: role is developer or admin; viewers get 403). The creator SHALL be added as project admin in the same operation. A global admin creating a project SHALL also become its project admin unless the request sets `adminUserIds` (see FR-4). Project id and name rules of SPEC-projects-01 FR-1 apply.
- **FR-4** A global admin MAY pass `adminUserIds[]` on create or `PATCH member role` to appoint project admins; each SHALL satisfy FR-5.
- **FR-5** A user whose global role is `viewer` SHALL NOT be appointed project admin (400 `A viewer cannot be a project admin`). Appointment SHALL check the current global role from the RBAC store at the time of the call.
- **FR-6** Members SHALL be existing app users only (a row in the RBAC store). Adding an unknown user id SHALL return 400. This replaces SPEC-projects-01 FR-3's allowance for unknown ids; existing member rows for ids not in the RBAC store are left as they are and stay inert.
- **FR-7** A project admin SHALL be able to add members (role `member` by default) and remove members of their own project. A project admin SHALL NOT change anything on another project (403, same body as a non-member, SPEC-projects-01 FR-10).
- **FR-8** `PATCH /api/projects/:id/members/:userId {role}` SHALL change a member between `member` and `admin`. Because every global admin is a project admin of every project (FR-2), a project never lacks an admin: removing or demoting the last explicit project admin SHALL be allowed and leaves the global admins in charge.
- **FR-9** When a user's global role is changed to `viewer` (`POST /api/admin/rbac/users/:id/role` or the user upsert routes), every project role `admin` of that user SHALL be changed to `member` in the same operation. The user stays a project member. If that leaves a project with no explicit admin, the global admins remain its admins (FR-2); no flag or replacement is required.
- **FR-10** Blocking a user SHALL keep SPEC-projects-01 FR-7 (membership rows stay, inert). A blocked user's project admin rights SHALL NOT apply (blocked users are rejected before scope resolution).

### Project admin powers (inside their project only)
- **FR-11** A project admin SHALL be able to edit the project's settings and policy: its `operations.yaml`, agent permission policy, and document templates, through the existing settings and templates write routes, resolved against the request's project (header `X-NerveCenter-Project`), never against another project. Platform-level settings (`/api/settings/**` that are not project-scoped, secrets, identity, RBAC, `/api/admin/**`) SHALL stay global-admin only.
- **FR-12** A project admin SHALL be able to manage the project's own knowledge bases, skills and routines (create, edit, remove, run as today's `routines.manage`/`knowledge.manage`/`skills.manage` allow), and to keep, discard or edit Sonic's lesson drafts and promote a kept lesson (SPEC-projects-01 FR-35) in their project. Granted shared resources stay read-only inside projects (SPEC-projects-01 FR-34).
- **FR-13** Creating, editing or deleting a connection profile or credential, importing the deployment-env profile, and setting `projectAdminsMayGrant` SHALL stay global-admin only (`/api/connections*`, `/api/secrets/*` remain in `ADMIN_ROUTES`).
- **FR-14** A project admin SHALL be able to grant existing knowledge bases and skills to their project, remove such grants, and grant existing connections that are flagged `projectAdminsMayGrant`, with routing filters (`scope`) and `isDefault`, subject to SPEC-projects-01 FR-27 overlap rejection (409 naming the colliding project and value). A project admin SHALL be able to remove a connection grant from their project (revoking never needs the flag).
- **FR-15** (Decided by the owner, 2026-10-04.) Each connection profile SHALL carry `projectAdminsMayGrant` (boolean, default `false`, set only by a global admin). A project admin granting or changing the routing filter of a connection whose flag is `false` SHALL get 403 `A global admin must grant this connection`. Turning the flag off SHALL NOT remove existing grants. A global admin MAY grant any connection regardless of the flag.
- **FR-16** *Removed by ADR 0003 (2026-10-06): there is no audit log.*
- **FR-17** A project admin SHALL NOT archive, unarchive or rename the project, add or remove library items, or see other projects' members, grants or settings.

### Route authorization (deny by default)
- **FR-18** `project-access.mjs` SHALL expose `assertProjectAdmin(scope, user)`: it passes when the user is a global admin, or when `scope.projectId` is a concrete project, the user's global role is developer or admin, and the user's member role in that project is `admin`. Everything else (viewer, non-member, All view, no project, archived on write) SHALL throw 403. `resolveScope` SHALL load the member role once per request together with membership (no cross-request cache) and put `projectRole: 'admin'|'member'|null` on the issued scope; `scope.admin` keeps meaning global admin.
- **FR-19** `ADMIN_ROUTES` in `rbac.mjs` SHALL no longer block the following routes for non-global-admins; instead each SHALL be declared in the route table with scope class `project-admin`, whose guard runs `assertProjectAdmin` after `resolveScope`: `POST|PUT|PATCH|DELETE /api/projects/:id/members*`, `GET /api/projects/:id/members`, `GET|PUT|POST|DELETE /api/projects/:id/grants*`, `POST /api/projects/:id/knowledge/promote`, project-scoped writes of `/api/settings/**` (operations.yaml, policy), `/api/templates/**`, `/api/knowledge/**`, `/api/skills/**`, and the routines write routes. For these, the project is the `:id` path param when present, otherwise the request header; the path id and header project SHALL match (403 otherwise). A route of class `project-admin` without a guard SHALL fail server start (extends SPEC-projects-01 FR-11). Any path not listed stays in `ADMIN_ROUTES` (deny by default); the matcher change is by explicit route, not by loosening a regex.
- **FR-19a** A test SHALL walk the route table and assert every `project-admin` route returns 403 for a project member, a viewer-admin mix, a non-member, and a project admin of a different project.

### Ticket visibility (replaces SPEC-projects-01 FR-30)
- **FR-20** `ops_tickets.visibility` SHALL take the values `project` and `private`. New tickets inside a project SHALL default to `project` (all members of the project may view and comment). The creator, the assignee and a project admin or global admin MAY change a ticket between `project` and `private`.
- **FR-21** A `private` ticket SHALL be viewable and commentable only by its creator, requester, assignee, collaborators, its routed approver, the project's admins and global admins. This EXTENDS the access check in `operations-service.mjs` `canAccess`: the existing `visibility === 'private'` rule stays, the value `operators` is replaced by `project`, and `isProjectAdmin(ticket.projectId, user)` is added to the allowed viewers. Viewers who are members see `project` tickets only.
- **FR-22** `assign` and `close` owner rules SHALL stay (creator or assignee; global admin always). A project admin SHALL also be allowed to assign and close any ticket in their own project. `approve` and `executeAction` rules are unchanged.
- **FR-23** The migration SHALL map existing `visibility: 'operators'` to `project` and leave existing `private` tickets `private` (PILOT included). Code reading `operators` SHALL keep accepting it as `project` for one release (read-time mapping), and no code SHALL write it.
- **FR-24** Ticket lists, counts, notifications, Overview, search, similarity, recurrence and agent tools SHALL apply the same visibility rule per caller; a private ticket SHALL NOT appear in any list, count, link or notification of a user who cannot view it (extends SPEC-projects-01 FR-49). Auto-created tickets (pipeline failures, imports) SHALL default to `project`; an assigned pipeline-failure ticket keeps today's `private` default only when its creator sets it.

### Agent behaviour
- **FR-25** A Sonic task SHALL run with the project role of the task's creator in the task's project (stored on the task as `createdByProjectRole` at creation, re-read from the member table when each turn starts, so a demotion applies at once). Tools built by `createAppTools(task, sdk)` SHALL pass that role and the creator's global role to the services; a write tool SHALL be refused when the human could not do the same action in the UI (matrix above), e.g. a member's task cannot edit `operations.yaml`, keep a lesson draft or change a grant.
- **FR-26** Tasks created by the system (triage poller, routines) SHALL run with project role `member` and the system scope of SPEC-projects-01, never as project admin; a routine created by a project admin runs with member rights unless a human with the rights approves a write through the normal inbox (SPEC-tasks-05).
- **FR-26a** Private tickets SHALL be invisible to the agent as to the creator of the task: `get_ticket`, `list_tickets`, `find_similar_tickets` and `link_related_ticket` apply FR-21 for the task creator, not for a project admin who later opens the task.

### Frontend
- **FR-27** The Projects tab in Settings SHALL be shown to global admins (all projects) and to project admins (only the projects they administer); it SHALL show members with a role selector, the grants editor (connections without `projectAdminsMayGrant` are disabled with the reason "Ask a global admin"), and a private/project toggle on tickets. `GET /api/me/projects` role drives it. Global viewers never see the appoint-admin control; global developers who are only members see the tab read-only.

## Scenarios

### S1 Developer creates a project and becomes its admin
- **Given** global developer `dev1` and no project `sales`
- **When** `dev1` calls `POST /api/projects {id:'sales', name:'Sales'}`
- **Then** 201; `dev1` is a member with role `admin`; `GET /api/me/projects` lists `sales` with `role: 'admin'`.

### S2 Project admin adds a member
- **Given** `dev1` admin of `sales`, user `dev2` (developer) exists in the RBAC store
- **When** `dev1` calls `POST /api/projects/sales/members {userId:'dev2'}`
- **Then** 201 with role `member`; the same call by `dev2` returns 403; adding `ghost` (not an app user) returns 400.

### S3 A viewer cannot be appointed
- **Given** `sales` and user `vic` with global role `viewer`, a member of `sales`
- **When** `dev1` calls `PATCH /api/projects/sales/members/vic {role:'admin'}`
- **Then** 400 `A viewer cannot be a project admin`; `vic` stays `member`.

### S4 Demoting a project admin to global viewer demotes them
- **Given** `dev3` is project admin of `sales` and `ops`
- **When** a global admin sets `dev3`'s global role to `viewer`
- **Then** `dev3` is `member` in both projects, and `dev3` can no longer call the member routes.

### S5 Removing the last explicit admin
- **Given** `dev1` is the only explicit admin of `sales`, `dev2` a member
- **When** `dev1` calls `PATCH /api/projects/sales/members/dev1 {role:'member'}`
- **Then** it succeeds; `sales` has no explicit admin and global admins still manage it as project admins.

### S6 Project admin cannot grant a non-shareable connection
- **Given** connection `snow-prod` with `projectAdminsMayGrant: false` and `jira-main` with `true`; `dev1` admin of `sales`
- **When** `dev1` grants `snow-prod`, then `jira-main` (scope `{projectKeys:['SAL']}`) to `sales`
- **Then** the first returns 403 `A global admin must grant this connection`; the second succeeds; a second project granting key `SAL` gets 409 (overlap). A global admin granting `snow-prod` succeeds.

### S7 A private ticket is visible to the project admin and hidden from another member
- **Given** ticket `OPS-2001` in `sales`, `visibility: 'private'`, creator `dev2`; `dev1` is project admin; `dev4` is a developer member
- **When** each calls `GET /api/tickets/OPS-2001` and `GET /api/tickets`
- **Then** `dev2` and `dev1` get it; `dev4` gets 403 on the by-id call (same body as other 403s) and the list omits it; counts and notifications of `dev4` omit it.

### S8 A project-visible ticket is seen by all members
- **Given** `OPS-2002` in `sales` with default visibility, created by `dev2`
- **When** `dev4` (member) and viewer member `vic` fetch it
- **Then** both can view it; `vic` cannot comment or assign; `dev4` can comment but not assign (not owner); `dev1` (project admin) can assign and close it.

### S9 Global admin override
- **Given** a global admin `ada`, not a member of `sales`
- **When** `ada` sends header `sales` and reads a private ticket, edits `sales` operations.yaml, grants `snow-prod`, and removes the last admin
- **Then** all succeed.

### S10 Agent respects the creator's project role
- **Given** a task in `sales` created by member `dev4`, who asks Sonic to edit the project `operations.yaml`
- **When** Sonic calls the settings write tool
- **Then** it is refused (member lacks the right); the same task created by `dev1` may do it. After `dev1` is demoted to member, a follow-up turn of that task is refused.

### S11 Migration
- **Given** existing members, tickets with `visibility: 'operators'` and `private`
- **When** migration 004 runs twice on both stores
- **Then** all members have `role: 'member'`; `operators` becomes `project`; `private` is unchanged; every connection has `projectAdminsMayGrant: false`; nothing changes on the second run.

## Interfaces
- HTTP delta (all routes keep header `X-NerveCenter-Project`; 403 bodies as in SPEC-projects-01 FR-10):
  - `POST /api/projects {id,name,description,adminUserIds?}`: open to developer and admin (was admin only); creator becomes project admin (FR-3). Viewers 403.
  - `GET /api/projects/:id/members` -> items now include `role`; project admin of `:id` or global admin.
  - `POST /api/projects/:id/members {userId, role?='member'}`, `PUT /api/projects/:id/members {members:[{userId, role}]}` (replace; `userIds[]` still accepted as all `member`), `DELETE /api/projects/:id/members/:userId`: project admin of `:id` or global admin; `role: 'admin'` is subject to FR-5.
  - `PATCH /api/projects/:id/members/:userId {role: 'admin'|'member'}`: new (FR-8).
  - `GET|PUT|POST|DELETE /api/projects/:id/grants*`: project admin of `:id` or global admin; connection grants subject to FR-15.
  - `PATCH /api/connections/:id {projectAdminsMayGrant}`: global admin only (stays in `ADMIN_ROUTES`).
  - `PATCH /api/tickets/:id {visibility: 'project'|'private'}`: creator, assignee, project admin, global admin.
  - `POST /api/projects/:id/archive|unarchive`, `PATCH /api/projects/:id` (rename): unchanged, global admin only.
  - `GET /api/me/projects` items: `role` is the project role (FR-18 of SPEC-projects-01 amended).
- Route table: scope class `project-admin` (FR-18, FR-19); `rbac.mjs` `ADMIN_ROUTES` keeps all other admin-only entries unchanged.
- Data (Postgres; the file store mirrors it):
  - `ops_project_members.role text NOT NULL DEFAULT 'member' CHECK (role IN ('admin','member'))`; index `(project_id) WHERE role='admin'`.
  - `ops_tickets.visibility` values `project|private` (file store: ticket field); `UPDATE ... SET visibility='project' WHERE visibility='operators'`.
  - Connection profile field `projectAdminsMayGrant boolean NOT NULL DEFAULT false` (`ops_connection_profiles`; file store: profile record).
  - Tasks: `created_by_project_role text` (nullable; null reads as `member`).
  - Migration `backend/migrations/004-project-roles.sql` plus `004-project-roles.mjs` (file store), forward-only and safe to run twice (`ADD COLUMN IF NOT EXISTS`, guarded updates), run through the runners of SPEC-projects-01 FR-44 and `storage/migrations.mjs`.
- UI: Settings > Projects tab (FR-27); ticket private toggle; member role selector.

## Non-functional constraints
- **Security:** deny by default. `assertProjectAdmin` is the only place that decides project-admin rights (a test greps for role comparisons on `ops_project_members.role` outside `project-access.mjs` and the store). A missing role, unknown role value or a lookup failure SHALL mean `member`, never `admin`. Global role is re-read per request; no role is cached across requests.
- **Audit:** none (ADR 0003).
- **Compatibility:** single-user and development modes: the user is a global admin and keeps everything. API clients that never send `role` get `member`.
- **Performance:** one membership+role lookup per request (same query as SPEC-projects-01).

## Delivery notes
- Implement after SPEC-projects-01 phase 2 merges (grants routes, per-project settings, knowledge, skills and routines routes are what FR-19 gates; they do not exist yet as project-scoped routes).
- Order: migration 004 and store (FR-1, FR-2, FR-6, FR-8, FR-9); `assertProjectAdmin` and `project-admin` scope class (FR-18, FR-19); project creation (FR-3..FR-5); ticket visibility (FR-20..FR-24; this changes `rbac-routes.test.mjs` and ticket-access tests that assert `operators`, which needs the owner to confirm, AGENTS.md rule 4); grant safeguard (FR-14..FR-16); agent role (FR-25, FR-26); frontend (FR-27).
- Do not implement before this spec is approved (AGENTS.md rule 1). `specs/projects/projects.md` is edited separately; the amendments table above lists exactly what to reflect there.

## Known gaps / deviations
- **Superseded in part by SPEC-projects-03 (2026-10-05).** Project roles are now owner, developer and viewer, and the global role no longer caps them. FR-5 and FR-9 (the viewer cap and automatic demotion) no longer apply, and the Projects tab (FR-27) moved to the admin console and each project's Settings. See `project-access-and-home.md`.
- Backend implemented 2026-10-05; frontend (FR-27) with SPEC-projects-01 phase 3 the same day. Deviation: FR-27 says developers who are only members see the tab read-only, but members get 403 on members and grants (FR-19), so the tab shows them their projects and role only. Non-admins reach the tab from the profile menu, since Settings stays admin-only in the sidebar.
- FR-25 re-reads the creator's admin projects on every tool call instead of storing `createdByProjectRole` on the task; the effect (a demotion applies at once) is the same.
- FR-6's "existing users only" is enforced on the HTTP member routes and on `adminUserIds`; direct store calls (migrations, tests) may still add an id that has not signed in yet.
- The Postgres member-role queries run in the migration test but the API suites run on the file store.
- Not implemented; this is a draft. Current code: members have no role (`project-store.mjs`), `POST /api/projects` and all member routes are admin-only through `ADMIN_ROUTES`, `GET /api/me/projects` reports `role: 'member'` for non-admins, `canAccess` knows `private` and `operators` only, and `resolveScope` returns `memberProjectIds` without roles.
- The settings, knowledge, skills, templates and routines write routes are global today; `project-admin` can only gate them once SPEC-projects-01 phase 2 makes them project-scoped.
- `canAccess` today also lets the requester and the routed approver view a ticket; this spec keeps both (FR-21).

## Traceability
| Requirement | Code | Test |
|---|---|---|
| FR-1, FR-2, FR-6..FR-10 | `project-store.mts`, `migrations/004-project-roles.*`, `rbac-store.mts` | none (planned) |
| FR-3..FR-5 | `project-routes.mjs`, `rbac.mjs` | none (planned) |
| FR-11..FR-17 | `project-routes.mjs`, `connection-service.mjs` (`setProjectAdminsMayGrant`, `PATCH /api/connections/:id` in `api/server.mjs`), `knowledge-service.mjs`, `skill-service.mjs` | `backend/tests/project-roles.test.mjs` (FR-13, FR-15: shareable flag) |
| FR-18, FR-19, FR-19a | `project-access.mjs`, `rbac.mjs`, `lib/router.mjs`, `api/server.mjs` | none (planned) |
| FR-20..FR-24 | `operations-service.mjs` (`canAccess`, `permissionFor`), `operations-store.mjs` | none (planned) |
| FR-25, FR-26, FR-26a | `task-runtime.mjs`, `nervecenter-tools.mjs` | none (planned) |
| FR-27 | `frontend/src/features/settings/ProjectsTab.tsx`, `frontend/src/api/projects.ts`, `frontend/src/features/tickets/TicketDetailSheet.tsx` (private toggle), `grant-service.mjs` (`grantable`) | `frontend/src/features/settings/ProjectsTab.test.tsx`, `frontend/src/features/settings/ProjectsTab.sharing.test.tsx` (Project admins can grant switch), `frontend/src/features/tickets/TicketVisibility.test.tsx`, `backend/tests/projects-grantable.test.mjs` |

## Open questions
None. Decided by the owner on 2026-10-04:
- Connection grants (FR-15): project admins grant only connections a global admin flagged `projectAdminsMayGrant`; all others need a global admin.
- Every global admin is a project admin of every project, so a project always has an admin (FR-2, FR-8, FR-9); no `needsAdmin` flag.
- A project admin may mark any ticket in their project private, including tickets they did not create (FR-20).
- Updating the existing tests that assert `operators` visibility to the new `project` value is approved (AGENTS.md rule 4).
