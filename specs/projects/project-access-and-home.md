---
id: SPEC-projects-03
title: Owner, developer and viewer in every project, open projects, the home page and the admin console
status: implemented        # draft | approved | implemented | deprecated
area: projects
owners: []
code:                      # source of truth paths this spec will touch
  - backend/migrations/006-project-access.sql        # new: role values, open and color columns
  - backend/migrations/006-project-access.mjs        # new: file-store side of the same migration
  - backend/src/app/rbac.mjs                         # app roles; project permission sets; new users start as viewer
  - backend/src/app/rbac-store.mts                   # default role on first sign-in; no more auto-demotion in projects
  - backend/src/projects/project-access.mjs          # effective permission per project; open projects
  - backend/src/projects/project-store.mts
  - backend/src/projects/project-routes.mjs          # create with settings, grants and members in one call
  - backend/src/api/server.mjs                       # route permission checked against the project role
  - backend/src/tasks/nervecenter-tools.mjs          # Sonic's write tools use the project role
  - frontend/src/App.tsx                             # / is home, /p/:projectId/* is the app, /admin, /new
  - frontend/src/lib/project.tsx                     # the URL decides the project
  - frontend/src/features/home                       # new
  - frontend/src/features/admin                      # new
  - frontend/src/features/projects                   # new: the create flow
  - frontend/src/features/settings
last_verified: 2026-10-06
---

# Owner, developer and viewer in every project, open projects, the home page and the admin console

## Purpose
NerveCenter is used by many teams. Each team works in its own project, and the people in it need to run the project themselves without asking an admin for every change. This spec:
- gives every project three roles (owner, developer, viewer);
- makes the app role decide only who runs the app and who may create projects;
- adds open projects that anyone signed in can view;
- adds a home page that lists your projects;
- adds a create flow that sets the project up in one go;
- adds an admin console that holds what only app admins do.

Design reference: `docs/mockup-home` (served by the `mockup-home` launch config on port 8098). The dock's "As" button shows the screens as an admin, a developer, a viewer and a new user.

## Amendments to SPEC-projects-01 and SPEC-projects-02
Where they disagree, this spec wins.

| Earlier rule | Change |
|---|---|
| SPEC-02: project roles `admin` and `member` | Replaced by `owner`, `developer`, `viewer` (FR-4). Migration in FR-21. |
| SPEC-02 Actors: "the global role stays the ceiling"; FR-5: a viewer cannot be a project admin | Dropped. Any signed-in person can hold any project role (FR-3, FR-5). |
| SPEC-02 FR-9: demoting someone to viewer demotes them in every project | Dropped. A change of app role does not touch project roles (FR-8). |
| SPEC-02 FR-3: developers and admins create projects | Kept, and the create call gains settings, grants and members (FR-17). |
| SPEC-02 FR-12: only project admins manage knowledge and skills | Project developers may edit knowledge and skills; owners manage grants (FR-6). |
| SPEC-01 FR-38, SPEC-02 FR-27: Settings > Projects tab | Moves to the admin console (FR-19) and to each project's own Settings (FR-20). |
| SPEC-01: the project comes from a saved choice and the header | The project comes from the URL (FR-14); the header is still how the API learns it. |
| SPEC-01 FR-37: a project switcher in the sidebar | No switcher. The sidebar names the project and leads back to Home, where people pick another (FR-14). |
| SPEC-01 FR-9 and Actors: the admins' "All projects" view | No All view in the app (FR-14). The `*` read scope stays on the API for the admin console. |
| `rbac-store.mjs` `provisionIfMissing`: new users become developers | New users become viewers (FR-1). |

## Scope
- In scope:
  - app roles and project roles;
  - effective permission and route checks;
  - open projects;
  - the create call and create flow;
  - the home page, project URLs and the admin console;
  - moving project settings into the project;
  - migration 006.
- Out of scope / non-goals, each to get its own spec:
  - access requests;
  - custom roles;
  - invites for people who have never signed in;
  - Entra ID group mapping;
  - deleting projects.

## Actors and permissions
- **App admin:**
  - can do everything in every project, and counts as an owner of each one without being a member;
  - is the only one who can manage users and app roles, connections and credentials, the open flag, renaming and archiving, and the Unrouted queue.
- **App developer:** a viewer who may also create projects. Creating a project makes them its owner.
- **App viewer:** everyone starts here. Sees the projects they were added to and the open projects. Cannot create projects.
- **Project owner, developer and viewer:** what each may do inside one project is in the matrix below. The app role does not cap the project role.
- **Visitor:** someone signed in who is not a member of an open project. They get the project viewer's read rights, minus private tickets and the member list.

### Permission matrix (inside project P)
Y = allowed, N = denied, "own" = only tickets the caller created, is assigned or collaborates on.

| Action | Owner | Developer | Viewer | Visitor (open project) |
|---|---|---|---|---|
| See tickets, pipelines, data quality, boards, tasks, knowledge | Y | Y | Y | Y |
| See private tickets | Y | own | own | N |
| See the member list | Y | Y | Y | N |
| Start Sonic tasks, work tickets, decide approvals, edit boards and routines | Y | Y | N | N |
| Edit knowledge pages and project skills | Y | Y | N | N |
| Keep or discard Sonic's lesson drafts | Y | N | N | N |
| Assign or close any ticket, mark any ticket private | Y | own | N | N |
| Edit settings: workspace, ticketing, pipelines, data quality, policy, model, templates | Y | N | N | N |
| Grant knowledge and skills | Y | N | N | N |
| Grant connections and set routing filters | Y, only connections an admin marked shareable | N | N | N |
| Add or remove people, change roles | Y | N | N | N |
| Rename, archive, open the project to everyone | N (app admin only) | N | N | N |

## Requirements

### Roles
- **FR-1** A person's app role SHALL be `admin`, `developer` or `viewer`.
  - When someone signs in for the first time, they SHALL be stored as `viewer`. Exceptions:
    - people in `OPS_ADMIN_USER_IDS`, or carrying the IdP admin role, SHALL be stored as `admin`;
    - people carrying the IdP developer role SHALL be stored as `developer`.
  - `resolveRole`'s fallback for unknown users SHALL become `viewer`.
  - Development and single-user modes keep `admin`.
  - Stored roles of existing users SHALL NOT change.
- **FR-2** Only app developers and admins SHALL create projects (`projects.create`). Platform permissions SHALL stay admin-only: `users.manage`, `roles.manage`, `security.manage`, `secrets.manage`, `connections.manage`, `settings.platform.manage`, `logs.view`. No other permission SHALL come from the app role.
- **FR-3** Any person stored in the RBAC store SHALL be addable to a project with any project role, whatever their app role. A blocked person SHALL have no project access (SPEC-01 FR-7 unchanged).
- **FR-4** `ops_project_members.role` SHALL take the values `owner`, `developer` and `viewer`. A missing or unknown value SHALL read as `viewer`.
- **FR-5** The person who creates a project SHALL become its owner in the same operation.
  - An app admin creating a project becomes its owner unless the request names other owners.
- **FR-6** Inside a project, the permissions SHALL come from the project role and nowhere else:
  - **viewer:** none (read only).
  - **developer:** `tickets.manage`, `tasks.manage`, `approvals.decide`, `routines.manage`, `boards.manage`, `skills.manage`, `knowledge.manage`, `connectors.use`.
  - **owner:** developer plus `project.settings`, `project.members`, `project.grants`, `knowledge.review`.
  - **App admin:** every permission.
  - **Visitor:** none.
  - `rbac.mjs` SHALL hold these sets, and `effectivePermissions(user, scope)` SHALL be the only place that combines the app role, the project role and the open flag.
- **FR-7** Owners SHALL add and remove members and change roles in their own project.
  - An owner SHALL NOT remove or demote the last explicit owner, themselves included. The error is 400 `A project needs an owner. Make someone else owner first.`
  - An app admin may do so; app admins remain implicit owners.
- **FR-8** Changing someone's app role SHALL NOT change their project roles. `rbacStore.onRoleChange` SHALL no longer call `projectStore.demoteAdmin`.

### Route checks
- **FR-9** For routes whose scope class is `project` or `project-read`:
  - the permission a route declares SHALL be checked against `effectivePermissions(user, scope)` after `resolveScope`, not against the app role;
  - a write route that declares nothing SHALL need `project.settings`, so it is closed by default;
  - the `ADMIN_ROUTES` entries marked `project: true` (settings, skills, templates, knowledge) SHALL map to `project.settings`, `skills.manage` and `knowledge.manage`, so these entries no longer need a separate project-admin bypass.
- **FR-10** Routes with scope class `global` or `admin-global` SHALL keep checking the app role.
  - `/api/projects/:id/members*` and `/api/projects/:id/grants*` SHALL need `project.members` and `project.grants` in project `:id`.
  - The path id and header SHALL match, as today.

### Open projects
- **FR-11** `ops_projects.open boolean NOT NULL DEFAULT false`. Only app admins SHALL set it: `PATCH /api/projects/:id {open}`, or `open` on create.
- **FR-12** `resolveScope` SHALL admit a signed-in non-member to an open, unarchived, normal project for read methods only:
  - the issued scope SHALL carry `access: 'open'` and `projectRole: null`;
  - writes SHALL get 403 with the same body as a non-member;
  - a person with no memberships SHALL get this instead of 403 `No project` when the project is open.
- **FR-13** Visitors SHALL NOT see:
  - private tickets;
  - the member list (`GET /api/projects/:id/members` returns 403);
  - grants, settings that hold connection details, or task transcripts started by others. Task transcripts are an open question below.

  Every list, count, search, notification and Sonic tool SHALL apply the same rule.

### Home, URLs and switching
- **FR-14** The frontend routes SHALL be:
  - `/` home;
  - `/new` create a project;
  - `/admin/:tab?` admin console;
  - `/p/:projectId/<page>` for every page that is in the app today (overview, tickets, boards and so on);
  - `/p/unrouted/tickets` for the admins' Unrouted queue. (The read-only All view at `/p/all` was removed on 2026-10-06; `/p/all` is now an ordinary project URL.)

  The project in the URL SHALL decide the `X-NerveCenter-Project` header. The saved project in localStorage SHALL only be used to redirect old links (`/tickets/OPS-12` goes to `/p/<last>/tickets/OPS-12`).

  Inside a project the sidebar SHALL show, at the top:
  - the NerveCenter logo and name, which lead Home;
  - a "Projects" link back to Home;
  - the project's art and name, and the person's role only when it limits them (Viewer, View only, Read only).

  There SHALL be no project menu. People switch projects on Home. (Amended 2026-10-06.)
- **FR-15** `GET /api/me/projects` items SHALL be `{id, name, color, role: 'owner'|'developer'|'viewer'|'admin'|'open', archived}`.
  - `admin` means an app admin who is not a member.
  - `open` means a visitor.
  - The response lists member projects, then the rest an admin sees, then open projects.
- **FR-16** The home page SHALL show, in this order:
  - the hero: date, greeting and one line about NerveCenter, with the ring;
  - the person's projects as cards (art, name and role), plus a New project tile for developers and admins;
  - "Open to everyone": open projects they are not in (for admins, "Everything else": all other projects);
  - the footer.

  A person with no projects SHALL see "No projects yet" and the open projects. Nothing else SHALL be on the page.
- **FR-24** The pages outside a project SHALL look like the app: Home, New project, the admin console, the no-access page and the opening screen. That means:
  - the app frame colour (`surface-base`);
  - Inter headings in the page-title style. The Home greeting and the footer wordmark keep the serif (Instrument Serif);
  - cards as inside a project.

  The project art (landscapes, the hero ring, the footer heron and wordmark) SHALL stay, drawn on that frame. (Added 2026-10-06; replaces warm paper and the serif.)
- **FR-17** `ops_projects.color text NULL` SHALL hold one of `indigo`, `teal`, `amber`, `rose`, `sky`, `green`. When it is null, the colour comes from a hash of the id. The card art is drawn from the colour and the id; nothing else is stored.

### Creating a project
- **FR-18** `POST /api/projects` SHALL accept `{id, name, description?, color?, copyFrom?, grants?: [{resourceType, resourceId, scope?, isDefault?}], members?: [{userId, role}], settings?: {model?, autonomy?}, open?}`.
  - **Validate first:** the server SHALL check the whole request before it creates anything:
    - `copyFrom` is a project the caller owns, or the caller is an app admin;
    - every grant is allowed (SPEC-02 FR-15) and does not overlap another project (409);
    - every member exists;
    - `open` is set only by an app admin.
  - Any failure SHALL return 400, 403 or 409 and create nothing.
  - **Then apply, in order:** the project and its owner; the workspace (blank, or the `operations.yaml`, templates and policy of `copyFrom`, without its grants or members); the settings; the grants; the members.
- **FR-19** The create flow at `/new` SHALL have five steps.
  - **Basics:** name, id (filled in from the name), colour, description, and start blank or copy settings from a project.
  - **Sources:** connections the caller may grant, each with its routing filter. Connections they may not grant show "Ask an admin".
  - **Knowledge:** knowledge bases and skills from the library.
  - **Sonic:** the model, and whether Sonic only reads, acts after approval, or acts in dev.
  - **People:** people with a role. App admins also see the open toggle.

  "Create now" SHALL be available on every step once there is a name. The preview card SHALL update as the person types. Viewers who open `/new` SHALL be sent home.

### Admin console and project settings
- **FR-20** `/admin` SHALL be visible to app admins only, from the top bar and the avatar menu. It SHALL have four tabs:
  - **People:** everyone who has signed in, with filters for everyone, admins, developers and viewers. Each person shows their app role and their projects with roles. Admins can add them to a project, change a project role, block them or unblock them. This replaces Settings > Users & roles.
  - **Projects:** every project, with its owners, how many people it has, the open toggle and when it was created. Admins can change members and roles, rename, archive, and open the project's settings. A link leads to the Unrouted queue with its count. This replaces Settings > Projects.
  - **Connections:** the connection library, which projects use each connection, and the "owners can grant" toggle (`projectAdminsMayGrant`), plus creating and testing connections.
- **FR-21** Each project's Settings at `/p/:projectId/settings` SHALL have the tabs Workspace, People, Sources, Ticketing, Pipelines, Data quality, Knowledge and skills, Policy, Model and Templates.
  - Owners and app admins edit them.
  - Developers and viewers read People and Policy.
  - Visitors see no Settings.
  - The People tab SHALL show the permission matrix above.
  - Platform settings (identity, secrets, platform defaults) SHALL live only in the admin console.

### Sonic
- **FR-22** A Sonic task SHALL run with the project role of the person who started it. The role is read when each turn starts, so a change of role applies at once.
  - Sonic's write tools SHALL be refused when that person could not do the same thing in the UI (matrix above).
  - Viewers and visitors SHALL NOT start tasks.
  - System tasks (triage poller, routines) SHALL run with developer rights, never owner rights.

### Migration
- **FR-23** Migration `006-project-access`, for both stores, run forward only and safe to run twice:
  - `role`: `admin` becomes `owner`. `member` becomes `developer` when the person's stored app role is `developer` or `admin`, otherwise `viewer`. This keeps everyone's current rights.
  - `open` is added with default `false`, and `color` is added as nullable.
  - Project members with role `admin` in the file store are mapped the same way.

## Scenarios
### S1 A new person signs in
- **Given** someone not in the RBAC store.
- **When** they sign in.
- **Then** they are stored as `viewer`, and home shows "No projects yet" and the open projects, with no New project tile.

### S2 A developer creates a project
- **Given** an app developer.
- **When** they create "Market Mix Modelling" with a Jira grant filtered to `MMM` and Ana Souza as developer.
- **Then** they are its owner, Ana is a developer, the grant exists, and the home page shows the card with "Owner".

### S3 A viewer made owner
- **Given** an app viewer.
- **When** an owner makes them owner of project P.
- **Then** they can manage P's people and settings, but still cannot create a project.

### S4 Open project visitor
- **Given** project P is open, and V is not a member.
- **When** V opens `/p/P/tickets`.
- **Then** V sees P's project-visible tickets, not its private ones. A write returns 403, `GET /api/projects/P/members` returns 403, and Settings is not offered.

### S5 Only admins open a project
- **Given** an owner of P.
- **When** they `PATCH /api/projects/P {open: true}`.
- **Then** they get 403, and an app admin doing the same succeeds.

### S6 The last owner
- **Given** P has one explicit owner, O.
- **When** O changes their own role to developer.
- **Then** they get 400, and an app admin doing the same succeeds.

### S7 Create is all or nothing
- **Given** a create request whose second grant overlaps another project's filter.
- **When** it is sent.
- **Then** the response is 409, naming the other project, and no project, workspace, grant or member exists afterwards.

### S8 Sonic follows the role
- **Given** D is a developer in P and starts a task.
- **When** D is made a viewer during the task.
- **Then** Sonic's next write tool call is refused.

### S9 Old links
- **Given** someone last used project P.
- **When** they open `/tickets/OPS-12`.
- **Then** they land on `/p/P/tickets/OPS-12`.

### S10 Migration
- **Given** a member `admin` and a member `member` whose app role is viewer.
- **When** 006 runs twice.
- **Then** they are `owner` and `viewer`, and the second run changes nothing.

## Interfaces
- **HTTP delta:**
  - `POST /api/projects`: needs `projects.create` (app developer or admin). Body as in FR-18.
  - `PATCH /api/projects/:id`: `name` and `description` stay app-admin only; `open` and `color` are new. Owners may set `color` and `description`.
  - `POST|PATCH|DELETE /api/projects/:id/members*`: the role is `owner|developer|viewer`; needs `project.members`.
  - `GET /api/me/projects`: as in FR-15.
  - `GET /api/admin/rbac/users`: each item gains `projects: [{id, role}]` for the People tab.
- **Data:**
  - `ops_projects.open`, `ops_projects.color`, and the `ops_project_members.role` values.
  - `projects.json` mirrors them in the file store.
- **UI:**
  - The routes in FR-14.
  - `features/home`: the hero ring and the footer heron scene are ported from `docs/mockup-home/ring.js` and `footer.js` as canvas components, keeping the reduced-motion handling.
  - `features/admin`, `features/projects/CreateProject`, and `features/settings` regrouped per FR-21.
  - The empty, no-access ("This project isn't shared with you.") and view-only banner states as in the mock.

## Non-functional constraints
- **Security:**
  - Deny by default.
  - `effectivePermissions` is the only function that turns roles into permissions; a test fails if the project role is compared anywhere else.
  - An unknown role, missing row or lookup error means no permissions, never owner.
  - The open flag only ever adds read access.
- **Audit:** none (ADR 0003).
- **Performance:** one membership and role lookup per request, as today. The home page needs `GET /api/me/projects` only.
- **Motion:** the hero and footer canvases pause when off screen, and stop under `prefers-reduced-motion`.

## Delivery
1. **Backend:**
   - FR-1 to FR-13 and FR-15, then FR-17, FR-18, FR-22 and FR-23.
   - Tests per FR. The existing tests that assert `admin` and `member` project roles, or the viewer cap, change, which needs the owner's confirmation (AGENTS.md rule 4).
2. **Frontend:**
   - FR-14, FR-16, FR-19, FR-20 and FR-21.
   - The grants editor (`GrantsSection`, now `features/settings/ProjectGrants.tsx`) is reused inside project Settings. `ProjectsTab` and `UsersRolesTab` are replaced by the admin console; its sharing switch tests moved to `AdminConsolePage.test.tsx`.
3. **Later, in their own specs:** access requests, sending them from the view-only banner and the no-access page to the owners' People tab; the open question on task transcripts.

## Known gaps / deviations
- Implemented 2026-10-05, backend and frontend.
- 2026-10-06: the sidebar switcher is replaced by a back link to Home (FR-14), and the outside pages take the app's look (FR-24). Approved by Mitesh in chat.
- **All view removed (2026-10-06):** with the switcher gone the read-only All view had no way in, and the owner asked for it to be deleted. The frontend no longer has `/p/all` or its read-only notice. The backend still accepts `*` as an admin read scope (SPEC-projects-01 FR-9), because the admin console's Connections tab lists the library with it. Unrouted stays, reached from the admin console's Projects tab (FR-20).
- **FR-21:** Settings keeps the existing Workspace, Ticketing, Pipelines, Data quality, Policy, Model and Templates tabs rather than folding them into General and Sonic. Non-owners read People and Policy; Model and Workspace have no read-only view yet.
- **FR-13:** visitors are kept off settings, connections, connectors, tasks, inbox, routines and templates by path, in `project-access.mjs` (`assertVisitorMayRead`). A new project route that should be hidden from visitors has to be added to that list.
- **FR-18:** "copy settings from a project" copies the `operations.yaml` sections that name no connection (`agent`, `policy`, `documents`, `branding`, `communication`, `tickets`, `ui`) and the templates folder, so nothing points at a connection the new project was not granted.
- **FR-20:** the Connections tab lists the library and the "owners can grant" switch, through `PATCH /api/connections/:id`, which SPEC-projects-02 FR-15 added. Creating and testing connections stays on the Connectors page inside a project.
- **Access requests:** the view-only notice tells a visitor to ask an owner; the Request access button and the owners' request list are not built (their own spec).
- **Members by id:** project members show their user id, not their name, because only app admins may read the directory.
- **Postgres:** migration 006 is written for both stores, but the API suites run on the file store; it has not been run against a real Postgres.

## Traceability
| Requirement | Code | Test |
|---|---|---|
| FR-1..FR-8 | `rbac.mjs`, `rbac-store.mts`, `project-store.mts` | `backend/tests/project-access.test.mjs`, `project-roles.test.mjs`, `rbac.test.mjs`, `api.test.mjs` |
| FR-9, FR-10 | `api/server.mjs`, `lib/router.mjs`, `project-access.mjs` | `backend/tests/rbac-routes.test.mjs`, `project-roles.test.mjs` |
| FR-11..FR-13 | `project-access.mjs`, `project-routes.mjs`, `operations-service.mjs` | `backend/tests/project-access.test.mjs` |
| FR-14..FR-17 | `frontend/src/lib/appRouter.tsx`, `lib/appRouterCore.ts`, `lib/project.tsx`, `Root.tsx`, `features/home`, `components/layout/ProjectHeader.tsx` | `frontend/src/lib/project.test.tsx`, `Root.test.tsx`, `features/home/HomePage.test.tsx`, `components/layout/ProjectHeader.test.tsx` |
| FR-24 | `components/layout/OutsideChrome.tsx`, `features/home`, `features/projects`, `features/admin`, `NoProjectState.tsx`, `features/home/art` | `features/home/HomePage.test.tsx` |
| FR-18, FR-19 | `project-setup.mjs`, `grant-service.mjs`, `features/projects` | `backend/tests/project-access.test.mjs`, `frontend/src/features/projects/NewProjectPage.test.tsx` |
| FR-20, FR-21 | `features/admin`, `features/settings`, `connection-service.mjs` (`setProjectAdminsMayGrant`) | `frontend/src/features/admin/AdminConsolePage.test.tsx`, `features/settings/ProjectPeopleTab.test.tsx`, `SettingsPage.test.tsx` |
| FR-22 | `nervecenter-tools.mjs`, `agent-access.mjs` (`ownerHold`) | `backend/tests/project-access.test.mjs`, `viewer-guards.test.mjs` |
| FR-23 | `migrations/006-project-access.*` | `backend/tests/project-access.test.mjs`, `projects-migration.test.mjs` |

## Open questions
None. Decided by the owner (Mitesh) on 2026-10-05:
- An app viewer may hold any project role, owner included (FR-3).
- Visitors to an open project do not see Sonic's task transcripts (FR-13).
- Project developers edit knowledge and skills; keeping Sonic's lesson drafts is the owners' (FR-6).
- People stored as developers before this spec stay developers; an admin tidies up in the People tab (FR-1).
- Updating the tests that asserted project `admin` and `member`, the viewer cap and the old Settings tabs is approved (AGENTS.md rule 4).
