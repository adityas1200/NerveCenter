---
id: SPEC-projects-01
title: Projects (scoping layer over the whole app)
status: implemented        # draft | approved | implemented | deprecated  (owner decisions of 2026-10-04 recorded below; deviations under Known gaps)
area: projects
owners: []
code:                      # source of truth paths this spec will touch (none exist yet unless marked existing)
  - backend/src/projects/project-store.mts        # new: projects, members, grants (file + Postgres)
  - backend/src/projects/project-access.mjs       # new: the ONE place that resolves and enforces project scope
  - backend/src/projects/project-routes.mjs       # new: /api/projects*, /api/me/projects
  - backend/src/projects/project-migration.mjs    # new (phase 2): moves the PILOT workspace folder (FR-42)
  - backend/migrations/003-projects.sql           # new: Postgres side of the projects migration (follows 002-ticket-signature.sql)
  - backend/migrations/003-projects.mjs           # new: file-store side of the same migration (FR-44)
  - backend/src/storage/file-migrations.mjs       # new: file-store migration runner, mirrors storage/migrations.mjs
  - backend/src/api/server.mjs
  - backend/src/lib/router.mjs
  - backend/src/lib/http.mjs
  - backend/src/app/rbac.mjs
  - backend/src/app/operations-service.mjs
  - backend/src/app/operations-store.mts
  - backend/src/storage/postgres.mjs
  - backend/src/storage/migrations.mjs
  - backend/src/workspace/workspace.mjs
  - backend/src/workspace/workspace-sync.mjs
  - backend/src/connections/connection-service.mjs
  - backend/src/connectors/connector-service.mjs
  - backend/src/knowledge/knowledge-service.mjs
  - backend/src/knowledge/knowledge-drafts.mjs
  - backend/src/skills/skill-service.mjs
  - backend/src/documents/template-service.mjs
  - backend/src/tasks/task-store.mts
  - backend/src/tasks/task-runtime.mjs
  - backend/src/tasks/ticket-tasks.mjs
  - backend/src/tasks/nervecenter-tools.mjs
  - backend/src/sync/integration-sync.mjs
  - backend/src/routines/routine-scheduler.mjs
  - backend/src/boards/board-service.mjs
  - backend/src/bootstrap.mjs
  - backend/src/main.mjs
  - frontend/src/api/client.ts
  - frontend/src/components/layout
  - frontend/src/features/settings
last_verified: 2026-10-11
---

# Projects (scoping layer over the whole app)

## Purpose
Today one deployment is one workspace: every signed-in user sees every ticket, task, routine, connection, knowledge base and skill, and Sonic works in a single shared folder. Teams that share one NerveCenter need separation. A project is a scoping layer (like a user group) over the whole app: members see everything in their project and nothing in others, and Sonic's session runs in the project's own workspace folder so nothing project-specific leaks between projects.

## Scope
- In scope: projects and membership; request scoping (header, middleware, store filters, by-id checks); per-project workspace folder; connection, knowledge and skill grants; ticket/pipeline routing and the Unrouted queue; per-project background jobs; agent-tool scoping; board cache key; PILOT migration; frontend switcher, admin Projects tab, empty state.
- Out of scope / non-goals: per-project roles (membership is a plain `(project_id, user_id)` row); per-ticket private visibility inside a project (dropped, see FR-30); per-project quotas or budgets; moving a resource between projects other than the admin move of an Unrouted ticket (FR-26); any audit log (removed by ADR 0003); project deletion that destroys data (archive only, FR-6).
- Dependency: backend enforcement of global role permissions (BACKLOG P0 #1: `hasPermission`/`assertPermission` wired into the routes) SHALL land first, as a separate change. This spec assumes it; it does not implement it. Until then membership narrows WHICH data a viewer sees but not WHAT they can do.

## Actors and permissions
- **admin** (global role): creates/archives projects, manages membership and grants, sees all projects and the "All projects" view and the Unrouted queue. Exempt from membership checks (FR-10) but not from the project header on write routes (FR-9).
- **developer / viewer** (global roles): unchanged in WHAT they may do (rbac.md). Membership decides WHICH project's data they see. A user may belong to many projects.
- **system** (poller, sync, scheduler): acts per project with that project's connections; never reads across projects in one call.
- **member of no project**: sees only the empty state (FR-36); no data, no Sonic.

## Requirements

### Model and membership
- **FR-1** The system SHALL store projects `{id, name, slug, description, kind ('normal'|'unrouted'), archivedAt, createdAt, createdBy}`, members `(project_id, user_id)` and grants `(project_id, resource_type, resource_id, scope)`. Project ids SHALL match `^[a-z0-9][a-z0-9-]{1,31}$` and be immutable; names are unique case-insensitively.
- **FR-2** There SHALL be exactly one reserved project `unrouted` (`kind: 'unrouted'`), created at migration. It SHALL NOT accept members or grants, SHALL NOT be returned by `GET /api/me/projects` to non-admins, and SHALL NOT be archivable.
- **FR-3** Membership SHALL be a plain `(project_id, user_id)` row with no role column. `user_id` is the id used by the RBAC store; adding an unknown user id SHALL be allowed (the person may not have signed in yet).
- **FR-4** Only admins SHALL create, rename, archive/unarchive projects and add/remove members or grants. A project with `archivedAt` set SHALL be read-only (writes 409, background jobs skipped) and SHALL still resolve for admins.
- **FR-5** *Removed by ADR 0003 (2026-10-06): there is no audit log.*
- **FR-6** Projects SHALL NOT be hard-deleted through the API (archive only), so ids on historical rows never dangle.
- **FR-7** Blocking or deleting a user in the RBAC store SHALL NOT delete their membership rows (they are inert while blocked; deleting the user does not orphan data because data is owned by project, not user).

### Request scoping and enforcement (deny by default, one place)
- **FR-8** The client SHALL send the current project in request header `X-NerveCenter-Project` (a project id, or `*` for admins' "All projects") on every `/api` call. CORS allow-headers in `backend/src/lib/http.mjs` SHALL include it.
- **FR-9** Scope resolution SHALL happen once per request in `backend/src/projects/project-access.mjs`, called from `server.mjs` right after `requestUser` and the admin-route check, producing an immutable `scope` object `{projectId | 'ALL', projectIds[], admin}` handed to every handler. Handlers and stores SHALL NOT read the header or query membership themselves. `*` SHALL be valid for admins on read routes only: the "All projects" view is read-only, and on write routes an admin SHALL send a concrete project id (403 `Project required` otherwise).
- **FR-10** Resolution SHALL fail closed: a missing, empty, unknown, archived-for-write or malformed header on a project-scoped route returns 403; a non-member (non-admin) returns 403 with the same body whether the project exists or not (no existence leak). Admins are exempt from the membership check only. No code path SHALL default to "all projects" or "no filter" when the context is missing.
- **FR-50** A browser-opened read route (one the UI hands to `<a>`, `<iframe>` or `<img>`, which cannot send headers) MAY be marked `linkable` in the route table and then SHALL also accept the project as query parameter `?project=<id>`. Only `GET` routes may be linkable; the header wins when both are sent; the value goes through the same resolution as the header (FR-9, FR-10), so a missing, unknown, malformed or non-member value is the same 403. Today only `GET /api/tasks/:id/files/raw` is linkable. A project id is not a secret, so it may sit in a URL.
- **FR-11** Every route SHALL declare its scope class in the route table: `project` (needs a project), `global` (no project: `/api/me`, `/api/me/projects`, `/api/presence`, `/api/meta`, `/health`, `/api/connection-templates`, `/api/admin/**`, `/api/projects**`), or `admin-global` (admin, no project: connections, secrets, and grant management). `route()` in `backend/src/lib/router.mjs` SHALL require the class; a route without one SHALL make server start fail. A test SHALL walk the table and assert every `project` route is rejected with 403 when the header is absent.
- **FR-12** Every store list method (`listTickets`, `listTasks`, `listInbox`, boards, routines, connections, knowledge, skills, templates) SHALL take a required `scope` argument and throw when it is undefined. `ALL` SHALL be an explicit value only an admin scope can carry. List SQL SHALL filter `project_id = ANY($projectIds)`; the file stores SHALL filter the same field.
- **FR-13** Every by-id read or write (`GET|PATCH /api/tickets/:id`, tasks, task events/files/stream, inbox items, boards, routines, knowledge bases, skills) SHALL load the row, read its `project_id` and call `assertRowInScope(scope, row)`. A row outside the scope returns 403 for a member of other projects and 404 is NOT used to hide it (a 403/404 split would leak existence differently per route; use 403 uniformly). The check SHALL live in one function; copies of membership logic in handlers or services are defects.
- **FR-14** Resource ids SHALL stay global (`OPS-1001`, `T-1002`, `I-xxxx`, `B-xxxxxxxx`). Links keep working: opening a link whose row is in another project the user belongs to SHALL return that row's `projectId`, and the UI SHALL switch the project switcher to it; a non-member gets 403.
- **FR-15** Creates SHALL stamp `project_id` from `scope.projectId`; a client-supplied `project_id` or `projectId` in a body SHALL be ignored (except admin move, FR-26). `project_id` SHALL be `NOT NULL` with a foreign key to `ops_projects(id)` on tickets, tasks and inbox items, and a required field on board and routine records.
- **FR-16** Notifications and Overview SHALL be computed from project-scoped lists only (tickets, runs from the project's monitor, inbox items). The "waiting on you" and pipeline counts SHALL cover the current project (or all in the admin All view). Notification ids SHALL include the project id so read state does not collide across projects.
- **FR-17** The board widget result cache key SHALL include `projectId` and `userId` (`<boardId>:<projectId>:<userId>:<widgetId>:<filters>:<updatedAt>`), which also closes BACKLOG P0 #4. A board SHALL belong to one project; `GET /api/boards` SHALL return only that project's boards (published plus caller's drafts; all drafts for admins).
- **FR-18** `GET /api/me/projects` SHALL return `{items: [{id, name, slug, role: 'member'|'admin'}], all: boolean}`; for admins it SHALL return every non-reserved project plus `all: true` and an `unrouted` count. `GET /api/me` SHALL be unchanged.

### Workspace and agent isolation
- **FR-19** Each project SHALL have its own workspace folder `<WORKSPACE_DIR>/projects/<id>/` with its own `operations.yaml`, `.mcp.json`, `CLAUDE.md`, `knowledge/`, `.claude/skills/`, `workflows/`, `tasks/`, `templates/`. `Workspace` SHALL become a per-project instance obtained from `workspaces.for(projectId)`; all callers (`settings`, `knowledge`, `skills`, `templates`, `routines`, `runtime`) SHALL receive it from the request scope or the task's `project_id`, never a module singleton. Each instance keeps its own write queue.
- **FR-20** New project folders SHALL be seeded like `Workspace.init()` today (plugin `operations.template.yaml` plus policy defaults, `CLAUDE.md`, `.mcp.json`). The plugin (operations-fleet skills) is loaded from the shared `OPS_PLUGIN_DIR` via `plugins: [{type:'local', path}]`; it stays global. No project file SHALL be written to the plugin or the shared library.
- **FR-21** A task's SDK session SHALL use `cwd` = its project's workspace dir, `settingSources: ['project']` and `mcpServers` rendered from that project's `.mcp.json`; the environment injected by `connectors.envForTasks()` SHALL contain only the project's connectors and granted connection credentials. The task's `project_id` SHALL be fixed at creation; follow-up messages and resume SHALL use the same project.
- **FR-22** `cwd` is not a sandbox, so the `canUseTool` gate (`task-runtime.mjs #gate`) SHALL deny file reads/writes, Bash working directories and `Glob/Grep` roots that resolve (after `realpath`) outside the project's workspace, the plugin dir, or the task's temp area. Shared-library paths SHALL be reachable only through the materialized grant links (FR-31). A denied access SHALL be a normal permission denial recorded in the task.
- **FR-23** S3 workspace sync SHALL mirror `projects/<id>/` per project under `s3://<bucket>/<prefix>/workspace/projects/<id>/`; restore SHALL run per project when that project's `operations.yaml` is absent. The `.nervecenter-sync.json` state file SHALL be per project. Materialized grant links (FR-31) SHALL be excluded from push and regenerated at boot.
- **FR-24** Connector secrets SHALL use project-qualified refs `projects/<id>/connectors/<connector>/<ENV>` (today `connectors/<id>/<env>` is global and would collide). Connector cards, Settings, templates and the Data quality config SHALL read and write the current project's workspace and settings only.

### Tickets, routing and visibility
- **FR-25** Ticket source-key idempotency SHALL be per connection: `ops_tickets` SHALL gain `connection_id` and the unique constraint SHALL become `(connection_id, source_key)` (and `(connection_id, pipeline_id, run_id)` replaces `UNIQUE(pipeline_id, run_id)`), so a ticket belongs to exactly one project. Manual tickets (`source: manual`) use connection `''`.
- **FR-26** Imported tickets and pipeline failures SHALL be routed to the project whose grant of that connection has a scope filter matching the item: ServiceNow `assignmentGroups[]`, Jira `projectKeys[]`, Databricks `jobInclude` (same include syntax as `pipeline-filter.mjs`). No match SHALL stamp project `unrouted`. An admin SHALL be able to move an Unrouted ticket to a project (`POST /api/tickets/:id/route {projectId}`, only from `unrouted`). A later sync SHALL route a still-unrouted ticket once a matching grant exists; it SHALL NOT move a ticket that already has a project.
- **FR-27** Saving a grant SHALL reject (409, naming the colliding project and value) when its scope filter overlaps another project's grant of the same connection: a shared assignment group, a shared Jira project key, or Databricks include patterns that can both match one job name. A grant of a ticketing/pipeline connection with an empty scope SHALL be rejected unless no other project holds a grant of that connection. Overlap SHALL be re-checked on update and on connection edit.
- **FR-28** Importers (`syncServiceNow`, `syncJira`, `ticketTasks.poll`, the Databricks failure job, the GitHub PR job) SHALL run per project and per granted connection, and SHALL read only the connections granted to that project. The routing filter in the grant is authoritative; `ticketing.app.sources[].filters` in a project's `operations.yaml` SHALL be ignored for routing (the source block still carries `auto_create_tasks`, `max_concurrent_tasks`, `permission`). The manual sync/preview endpoints SHALL use the request project's granted connection.
- **FR-29** The Unrouted queue (`GET /api/tickets?project=unrouted` or the "Unrouted" entry of the admin switcher) SHALL be visible to admins only; no task SHALL auto-start for an unrouted ticket and the triage poller SHALL skip it.
- **FR-30** Inside a project every member SHALL see every ticket: the per-ticket `visibility: 'private'` rule in `operations-service.mjs` (`canAccess`/`permissionFor`) SHALL be dropped for `view` and `comment`, and the `visibility` field SHALL be ignored. Owner rules for `assign` and `close` (creator or assignee; admin always) and `approve`/`executeAction` rules SHALL stay as they are.

### Grants (connections, knowledge, skills)
- **FR-31** Admins SHALL add connection profiles, knowledge bases and skills once to a global library, then grant each to one or more projects (`project_grants`). A project SHALL see and use only resources granted to it. Knowledge bases and skills live in `<WORKSPACE_DIR>/library/{knowledge,skills}/<name>/`; granting materializes them in the project folder as a link (symlink; copy fallback) at `knowledge/<name>` and `.claude/skills/<name>`, reconciled at boot and on grant change. A name that collides with a project-local base or skill SHALL reject the grant (409).
- **FR-32** A connection grant SHALL carry `scope` (FR-26) and `isDefault`. "Default per provider" SHALL be per project: `getDefault(provider, projectId)` and `resolve(provider, projectId)` SHALL consider only enabled profiles granted to that project; `set-default` SHALL apply to a project's grant. The deployment-env fallback in `resolve()` SHALL NOT apply to any project. Deployment-env credentials (Databricks service principal, ServiceNow, Snowflake) SHALL be imported as a normal managed profile `<provider>-env` (FR-41); it is granted to `pilot` only when that legacy project exists, and an admin MAY grant it to any other project. It is not locked to PILOT.
- **FR-33** Every provider-backed read (`/api/monitor`, `/api/pipelines*`, `/api/data-platform/*`, `/api/data-quality/*`, board SQL/NerveCenter sources, `connection-provider-status`) SHALL resolve its client with the request's project. A project with no grant of the provider SHALL get the existing "not configured" state, not another project's data.
- **FR-34** Removing a grant SHALL stop use immediately (next resolve) and SHALL NOT delete the profile, base or skill; deleting a connection/base/skill from the library SHALL fail (409) while any grant references it. Granted bases and skills SHALL be read-only inside projects (changes happen in the library by an admin).
- **FR-35** (Promotion into Git bases is out of scope, see Known gaps.) Sonic's lesson drafts (`update_knowledge`) SHALL land in the project's own local base (default `team-knowledge` in `projects/<id>/knowledge/`, via `knowledge-drafts.mjs`), never in a granted base. `POST /api/projects/:id/knowledge/promote {base, path, target}` SHALL let an admin copy a kept lesson into a granted shared base of kind `local`; `findSecret` SHALL run again, the copy SHALL be additive, audited, and a `git` target base SHALL be rejected (400).

### UI and no-project state
- **FR-36** A user with no project (non-admin) SHALL get HTTP 403 `No project` on every project-scoped route, `GET /api/me/projects` returns `{items: []}`, the UI SHALL show only the empty state "Ask an admin to add you to a project", and the agent panel, "Ask Sonic" and Investigate SHALL not be available. No data requests SHALL be made.
- **FR-37** The sidebar SHALL show a project switcher listing the user's projects (admins also "All projects" and "Unrouted"). The choice SHALL persist in `localStorage` (`nc-project`), be sent as `X-NerveCenter-Project` by the single API client in `frontend/src/api/client.ts`, be part of every React Query key, and clear cached data on switch. If the stored project is no longer in `/api/me/projects`, the UI SHALL fall back to the first project.
- **FR-38** Settings SHALL gain an admin-only "Projects" tab: project list (create, rename, archive), members (add/remove by user), grants (connections with scope filter editor, knowledge, skills) with server-side overlap errors shown inline, and an Unrouted count linking to the queue. Non-admins SHALL NOT see it.

### Background jobs and agent tools
- **FR-39** Integration sync, the triage poller, the routine scheduler, the S3 workspace sync and the board cache SHALL iterate active projects and run each with that project's workspace, connections and `sync.*` settings; a failure in one project SHALL NOT stop another. Presence gating (`isAppActive`) stays global. `routines-state.json` SHALL be per project. Job results SHALL carry `projectId` in logs.
- **FR-40** Every `mcp__nervecenter__*` tool SHALL be built per task with the task's project (`createAppTools(task, sdk)` already builds per task) and SHALL pass its scope to the services: `app_overview`, `list_tickets`, `get_ticket`, `list_tasks`, approvals, `list_routines`, `list_people` (members of the project), `search_knowledge` (`knowledgeDir` becomes the project's `knowledge/`), `knowledge_catalog`, `update_knowledge`, board tools, `create_ticket` and every write tool. A tool given an id from another project SHALL return an `isError` "not found in this project" without revealing the row. `search_knowledge` SHALL NOT cross out of the project's folder.

### Migration (PILOT)
- **FR-41** The migration (`backend/migrations/003-projects.sql` plus `003-projects.mjs` for the file store) SHALL, in one transaction and idempotently: create the three tables; create `unrouted`; create `pilot` (name "PILOT") only when legacy records need a project; add `project_id` and backfill `pilot` on legacy rows of `ops_tickets`, `ops_tasks`, `ops_inbox`, boards, routines and routine state; backfill `connection_id` on tickets from the default profile per provider at migration time; grant every existing connection profile, knowledge base and skill to `pilot` when it exists (connection grants with empty scope, defaults preserved); import deployment-env credentials as a normal managed profile `<provider>-env`, granted to `pilot` only when it exists and grantable by an admin to any project. Members SHALL be empty, so initially only admins see PILOT.
- **FR-51** A clean deployment with no legacy records or workspace content SHALL have no normal project and SHALL NOT create a PILOT workspace. An authorized user SHALL create the first project explicitly. Existing PILOT projects and legacy workspaces SHALL remain available; migration SHALL NOT delete or rename them. Background jobs SHALL tolerate zero normal projects and begin using a project created later without a restart.
- **FR-42** The filesystem step SHALL move the existing workspace content (`operations.yaml`, `.mcp.json`, `CLAUDE.md`, `knowledge/` + `.bases.json`, `.claude/skills/`, `workflows/`, `tasks/`, `templates/`) into `projects/pilot/`, then move existing admin-added knowledge bases and uploaded skills' canonical copy to `library/` with links back (FR-31). It SHALL be marker-guarded (`.projects-migrated`), crash-safe (rename, not copy+delete) and SHALL run before S3 restore decisions and before any scheduler starts. `.git` directories of Git bases SHALL be preserved.
- **FR-43** The migration SHALL be applicable to both stores (`OPS_METADATA_STORE=file|postgres`); the file store keeps `projects.json` with the same interface as the Postgres store.
- **FR-44** Phase 1 SHALL add a file-store migration runner (`backend/src/storage/file-migrations.mjs`) mirroring the Postgres runner in `storage/migrations.mjs`: ordered by file name, one `.mjs` module per migration next to the `.sql` file of the same number in `backend/migrations/`, applied migrations tracked in a marker file under the runtime dir, forward-only, and idempotent (a failed migration is not marked and may run again; a marked one never runs again). Every later schema or data migration SHALL cover both stores through this runner and the Postgres runner (AGENTS.md rule 2).

### Resuming old tasks
- **FR-45** After PILOT's folder moves (FR-42), resuming a task created before the move SHALL NOT use its stored SDK `sessionId`: the task starts a fresh SDK session seeded with its transcript, using the mechanism `editMessage` already uses in `task-runtime.mjs` (a transcript preamble followed by the new message). No compatibility symlink is kept at the old path.

### Agent shell isolation
- **FR-46** Sonic's file tools (`Read`, `Write`, `Edit`, `Glob`, `Grep`, `NotebookEdit`) SHALL be confined by the permission gate (`#gate`): a path (resolved with `realpath`) outside the task's project workspace, the task temp area, the plugin dir, or the shared library's materialized grant links (FR-31) SHALL be denied as a normal permission denial recorded in the task. This is the concrete form of FR-22 for file tools.
- **FR-47** `Bash` for project tasks SHALL run under the Claude Agent SDK sandbox with filesystem access limited to the project workspace (read and write) plus the paths FR-46 allows read-only. It SHALL fail closed: if the sandbox is unavailable (unsupported platform, missing dependency, or the SDK refuses to start it), `Bash` is disabled for project tasks and the task says why; it SHALL NOT fall back to an unsandboxed shell.

### Ticket similarity, recurrence and links stay inside a project
- **FR-48** Recurrence detection (`#flagRecurrence`), `findSimilarTickets` (and the agent's `find_similar_tickets`) and `linkTickets` (and `link_related_ticket`) SHALL only consider, match and link tickets in the same project as the ticket (or, for `findSimilarTickets` by text, the caller's scope project). Signature lookups take the scope; a cross-project link attempt returns 403. All-projects scope is read-only, so it SHALL NOT be used to create a link.
- **FR-49** Notifications and `get_ticket` SHALL NOT reveal the id or title of a related ticket (recurrence or link) to a user who cannot access it: such a link is omitted or shown as "a ticket you cannot access" without id or title.

## Scenarios

### S1 Member sees only their project
- **Given** projects `alpha` and `beta`, user `priya` (developer) a member of `alpha` only, ticket `OPS-1001` in `alpha`, `OPS-1002` in `beta`
- **When** `priya` calls `GET /api/tickets` with `X-NerveCenter-Project: alpha`
- **Then** only `OPS-1001` is returned; tasks, inbox, boards, routines, notifications and Overview likewise contain only `alpha` rows.

### S2 Non-member gets 403 on a by-id ticket fetch
- **Given** the same data
- **When** `priya` calls `GET /api/tickets/OPS-1002` (with header `alpha`, and again with header `beta`)
- **Then** both return 403 with the same body; no field of the ticket is disclosed. A request with no header returns 403 too (never a global lookup).

### S3 Admin all-projects view
- **Given** admin `ada` and the data above
- **When** `ada` calls `GET /api/tickets` with `X-NerveCenter-Project: *`
- **Then** `OPS-1001` and `OPS-1002` are returned, each with `projectId`; the same call as `priya` with `*` is 403; `ada` creating a ticket with `*` gets 403 `Project required`.

### S4 Routing to the right project
- **Given** connection `snow-prod` granted to `alpha` with `assignmentGroups: ["Data Ops"]` and to `beta` with `["Finance IT"]`
- **When** a ServiceNow import returns an incident assigned to group "Finance IT"
- **Then** the ticket is created in `beta` with `connection_id = snow-prod`; importing the same `sys_id` again updates that ticket, not a new one.

### S5 Unrouted queue
- **Given** the grants above
- **When** an import returns an incident for group "Facilities"
- **Then** the ticket is stored in project `unrouted`, is invisible to `priya`, appears for admins in the Unrouted queue, and no task is auto-started. After an admin routes it to `alpha`, `priya` sees it.

### S6 Overlapping grant rejected
- **Given** `alpha` holds `snow-prod` with `["Data Ops"]`
- **When** an admin grants `snow-prod` to `beta` with `["Data Ops", "Finance IT"]`
- **Then** 409 naming `alpha` and "Data Ops"; nothing is saved. Likewise a second Jira grant sharing project key `OPS`, or a Databricks include pattern that matches the same job.

### S7 Lesson draft stays in the project
- **Given** a task in `alpha` verified a fix and Sonic calls `update_knowledge` with decision `create`
- **When** the draft is saved
- **Then** the page is an untracked draft in `projects/alpha/knowledge/team-knowledge/`; `beta`'s `search_knowledge` and a granted shared base do not contain it. After an admin promotes the kept page into shared local base `shared-runbooks`, every project granted that base can search it.

### S8 PILOT migration
- **Given** an existing deployment with tickets, tasks, a Databricks profile, a Git knowledge base, one custom skill and `workflows/*.yaml`
- **When** the migration runs (twice, to test idempotency)
- **Then** project `pilot` exists with no members; all rows carry `project_id = 'pilot'`; the workspace content lives under `projects/pilot/` with the Git base's `.git` intact; the profile, base and skill are granted to `pilot`; admins see everything under PILOT; a developer sees the empty state until added.

### S9 User with no project
- **Given** developer `sam`, a member of no project
- **When** `sam` opens the app
- **Then** `GET /api/me/projects` returns `{items: []}`, the UI shows "Ask an admin to add you to a project", no Sonic panel renders, and any `/api` project route returns 403.

### S10 Agent isolation
- **Given** a task in `alpha` whose prompt asks Sonic to read `../beta/operations.yaml` and to call `get_ticket OPS-1002`
- **When** the task runs
- **Then** the file read is denied by the gate and the tool returns "not found in this project"; the session `cwd` is `projects/alpha/`.

## Interfaces
- Header: `X-NerveCenter-Project: <projectId>|*` on every `/api` call (`*` admin read only).
- HTTP, admin-only (add `^/api/projects` to `ADMIN_ROUTES` for writes; `GET` lists are filtered):
  - `GET /api/projects` -> `{items}` (admin: all; others: their projects); `POST /api/projects {id,name,description}` -> 201; `GET|PATCH /api/projects/:id`; `POST /api/projects/:id/archive|unarchive`. 409 on duplicate id/name; no `DELETE`.
  - `GET /api/projects/:id/members` -> `{items:[{userId,name,email,addedAt,addedBy}]}`; `PUT /api/projects/:id/members {userIds[]}` (replace) or `POST {userId}` / `DELETE /:userId`.
  - `GET /api/projects/:id/grants?type=`; `PUT|POST /api/projects/:id/grants {resourceType, resourceId, scope?, isDefault?}`; `DELETE /api/projects/:id/grants/:type/:resourceId`. 409 on overlap (FR-27) or name collision (FR-31).
  - `POST /api/tickets/:id/route {projectId}` (FR-26); `POST /api/projects/:id/knowledge/promote` (FR-35).
  - `GET /api/me/projects` -> `{items, all, unrouted?}` (any signed-in user).
- Existing routes are unchanged in shape; they now require the header (FR-11) and may return 403.
- Data (Postgres; the physical table names are `ops_projects`, `ops_project_members` and `ops_project_grants`; the file store mirrors them in `projects.json`):
  - `ops_projects(id text pk, name, slug, description, kind, archived_at, created_at, created_by)`; `ops_project_members(project_id fk, user_id, added_at, added_by, pk(project_id,user_id))`; `ops_project_grants(project_id fk, resource_type check in ('connection','knowledge','skill'), resource_id, scope jsonb default '{}', is_default bool, created_at, pk(project_id,resource_type,resource_id))`.
  - New columns: `project_id text NOT NULL references ops_projects` on `ops_tickets`, `ops_tasks`, `ops_inbox`; `connection_id text` on `ops_tickets`; indexes `(project_id, status, updated_at DESC)`; `ops_task_events` inherits through `task_id` (no column).
  - `scope` shapes: connection `servicenow {assignmentGroups[]}`, `jira {projectKeys[]}`, `databricks {jobInclude[]}`, others `{}`; knowledge and skill `{}`.
  - Files: `<WORKSPACE_DIR>/projects/<id>/…`, `<WORKSPACE_DIR>/library/{knowledge,skills}/…`, marker `.projects-migrated`; file-store runner marker `<RUNTIME_DIR>/file-migrations.json`.
- UI: sidebar switcher; `/settings?tab=projects` (admin); empty state at `/` for no-project users; Unrouted queue for admins.

## Non-functional constraints
- **Security:** deny by default and enforcement in one module (FR-9..FR-13). A 403 body never says whether the project or row exists. Cross-project reads in one query are only possible with the explicit `ALL` scope, built only for admins.
- **Dataverse mistakes to avoid:** (1) checks that fail open when context is missing (an absent header, an unresolved project, an empty membership list MUST yield 403 or an empty result, never "no filter"); (2) the same membership logic copy-pasted in several places (only `project-access.mjs` may decide membership; a lint test greps for `ops_project_members`/`membership` outside the module and the store).
- **Performance:** scope resolution is one membership lookup per request, cached for the request only (not across requests, so removal applies at once). Background jobs run projects sequentially per tick.
- **Audit:** no audit log (ADR 0003); task and ticket activity events keep the actor and now record `projectId`.
- **Secrets:** grants bind profiles; credentials stay once in the secret store and never get copied into project folders.
- **Compatibility:** single-user/development identity modes keep working: the single user is admin and the UI selects the first available project, or shows the create-project state when there is none. Since phase 3 the UI always sends the header; a request without it is 403 for everyone (FR-10).

## Delivery phases
1. **Data model, PILOT migration, request scoping, core data.** File-store migration runner (FR-44), tables and columns (FR-1..FR-7, FR-41, FR-43), same-project similarity, recurrence and links (FR-48, FR-49), header and `project-access.mjs` with route classes and fail-closed tests (FR-8..FR-15), `GET /api/me/projects`, scoping of tickets, tasks, inbox, notifications and Overview (FR-16, FR-18, FR-30), board cache key (FR-17). Workspace stays single (folder content moves in phase 2); everything defaults to PILOT. Depends on BACKLOG P0 #1.
2. **Per-project workspace, agent and background jobs, grants and routing.** Workspace per project and S3 layout (FR-19..FR-24, FR-42), agent/tool scoping and gate (FR-21, FR-22, FR-40, FR-45..FR-47), grants and library (FR-31..FR-35), routing, overlap checks, per-connection idempotency and Unrouted (FR-25..FR-29), per-project background jobs (FR-39), env credentials import (FR-32).
3. **Frontend.** Switcher, header client, query keys (FR-37), admin Projects tab with grants and overlap errors (FR-38), Unrouted queue, empty state (FR-36).

## Known gaps / deviations
- CR-19 (2026-10-11): provider reads now resolve only the requesting project's granted profile; Connectors form profiles are project-qualified and granted to their owner project. The provider principal's effective read-only grants and approved-view scope cannot be verified by this backend; the data owner checks them in the provider as described in `docs/security/provider-data-access.md`.
- FR-47 is deferred by the owner (2026-10-04, see BACKLOG): Bash is not sandboxed, so a project task's shell can still read other projects' folders. FR-46's path guard covers the file tools only.
- Phase 2 leaves GitHub pull-request sync running for PILOT only; ticket polling, Databricks failure sync and knowledge sync run per project (FR-39).
- Grant routes: resolved by SPEC-projects-02 (project admins).
Facts in the current code that this spec has to change (checked 2026-10-04):
- No project concept exists. `Workspace` is a singleton (`bootstrap.mjs:50`) with 13 direct `workspace.dir`/`*Dir` uses; `TaskRuntime` sets `cwd: this.workspace.dir` (`task-runtime.mjs:427`).
- `backend/migrations/` holds one file (`002-ticket-signature.sql`); the tables are still created inline by `ensureControlSchema` in `storage/postgres.mjs`. The file store has no migration runner, so FR-43 needs one (FR-44).
- `ops_tickets` has global `UNIQUE(pipeline_id, run_id)` and a global partial unique index on `source_key`; keys such as `jira:<issue.id>` are not connection-qualified, so two Jira sites collide on issue id.
- Boards and data quality configs are stored per project: `ops_boards (id, project_id, data)` and `ops_data_quality_configs (project_id, data)` (ADR 0004, migration 009). `ops_application_settings` is gone.
- Connectors and connection profiles are two separate systems: connector cards write the workspace `operations.yaml` and `connectors/<id>/<ENV>` secrets (global refs today), while profiles live in `ops_connection_profiles`. Only profiles are granted; connectors become per project through the project's `operations.yaml` (FR-24).
- `ConnectionService.resolve()` falls back to deployment env (Databricks service principal, ServiceNow, Snowflake) with no profile to grant; left alone it would give every project the same credentials.
- Task transcripts and `sessionId` resume are tied to the SDK's cwd; moving PILOT's folder changes cwd for old tasks (decided: FR-45).
- Promoting a lesson into a Git knowledge base (push or pull request) is out of scope; FR-35 allows promotion into shared local bases only.
- `POST /api/connections/:id/test`, `GET /api/connectors`, `/api/boards/preview` and `/api/data-quality/analyze` are open to any role today (BACKLOG P0 #3); project scoping does not fix this, the P0 #1 change must.
- Notification and Overview "waiting on you" counts are workspace-wide today; after this change they are per project, which changes the numbers users see.
- Status after phase 1 (2026-10-04): implemented FR-1..FR-6, FR-8..FR-13, FR-15, FR-16, FR-17, FR-18 (backend), FR-40 (ticket, task and board tools), FR-41, FR-43, FR-44, FR-48, FR-49. Deferred: FR-7 (`connection_id` columns), FR-14 and FR-36..FR-38 (frontend), FR-19..FR-24, FR-42, FR-45..FR-47 (workspaces, sandbox, resume), FR-25..FR-29 (routing), FR-31..FR-35 (grants have a store and tables but no routes), FR-39 beyond PILOT-scoped background jobs, FR-30.
- Phase 3 (2026-10-05): FR-14, FR-36, FR-37, FR-38 implemented in the frontend; the temporary no-header fallback for admins and its test are gone. The All view shows a read-only notice instead of disabling each write control; the server still refuses the writes (FR-9). Cross-project links switch the project when a by-id call answers 403 with `projectId` (only for projects the caller belongs to).
- 2026-10-06: phase 3 broke file links (open in new tab, HTML/PDF/image previews, downloads), since browsers cannot send the project header there; FR-50 adds the `?project=` query parameter for the raw task file route.
- FR-30 (all members see all tickets in a project) is NOT applied: `tests/rbac-routes.test.mjs` and the ticket-access tests still assert the `visibility: 'private'` rule, so changing it needs the owner to confirm that those tests may change.
- A request for a row id that does not exist returns the same 403 as a row in another project (FR-13); a mistyped id in your own project is therefore a 403, not a 404. The admin All view still gets 404 for a missing id.
- Background jobs, routines, the integration sync and agent tasks run under `systemScope('pilot')` (or the task's own project) until phase 2 loops over every project (FR-39).
- Postgres changes (`003-projects.sql`, the store code) were not run against a database in phase 1 (none available); the test in `projects-migration.test.mjs` runs them when `NC_TEST_DATABASE_URL` is set.

## Traceability
| Requirement | Code | Test |
|---|---|---|
| FR-1..FR-7 | `backend/src/projects/project-store.mts`, `project-routes.mjs`, `backend/migrations/003-projects.sql`, `app/rbac-store.mts` (audit) | `projects-scope.test.mjs` (FR-1..FR-6 admin CRUD, members, archive, audit) |
| FR-8, FR-9, FR-10, FR-11 | `backend/src/projects/project-access.mjs`, `api/server.mjs`, `lib/router.mts`, `lib/http.mts` | `backend/tests/projects-scope.test.mjs`: scope resolution (missing header, non-member, admin All read-only, archived 409), route-table walk |
| FR-50 | `lib/router.mts` (`linkable`), `api/server.mjs`, `api/task-routes.mjs`, `frontend/src/api/tasks.ts` (`fileUrl`) | `backend/tests/projects-scope.test.mjs` (FR-50), `frontend/src/api/tasks.fileUrl.test.ts` |
| FR-12, FR-13, FR-15 | `app/operations-store.mts`, `tasks/task-store.mts`, `app/operations-service.mts`, `api/task-routes.mjs` | `backend/tests/projects-scope.test.mjs`: list scoping, by-id 403, create stamping, no project no row |
| FR-14, FR-18 | `project-routes.mjs`, `project-access.mjs` (`assertRowInScope`), `lib/http.mjs`, `frontend/src/api/client.ts`, `frontend/src/lib/project.tsx` | `backend/tests/projects-scope.test.mjs` (`/api/me/projects`, FR-14), `frontend/src/lib/project.test.tsx` (FR-14) |
| FR-16 | `app/operations-service.mjs` (`overview`, `notifications`) | `backend/tests/projects-scope.test.mjs` (lists include no other project's ticket) |
| FR-17 | `boards/board-service.mjs` (cache key carries project and user) | none yet (implemented; no dedicated test) |
| FR-31, FR-32, FR-33 (provider reads) | `bootstrap.mts`, `connections/connection-service.mts`, `connectors/connector-service.mts`, `boards/board-service.mts`, `tasks/nervecenter-tools.mts` | `backend/tests/project-provider-isolation.test.mjs` |
| FR-19, FR-20, FR-23, FR-24 | `workspace/workspace.mjs`, `workspace-sync.mjs`, `bootstrap.mjs`, `connectors/connector-service.mjs:11` | none (planned) |
| FR-21, FR-22 | `tasks/task-runtime.mjs:427`, `#gate`, `tasks/agent-access.mjs` | none (planned) |
| FR-25..FR-29 | `app/operations-store.mts`, `storage/postgres.mjs`, `app/operations-service.mjs` (sync*), `tasks/ticket-tasks.mjs`, `platform/pipeline-filter.mjs` | none (planned) |
| FR-30 | `app/operations-service.mjs:63` | none (planned) |
| FR-31..FR-35 | `connections/connection-service.mjs:59-91,147-158`, `knowledge/knowledge-service.mjs`, `knowledge/knowledge-drafts.mjs`, `skills/skill-service.mjs` | none (planned) |
| FR-36, FR-37, FR-38 | `frontend/src/api/projects.ts`, `frontend/src/lib/project.tsx`, `frontend/src/components/layout/ProjectSwitcher.tsx`, `NoProjectState.tsx`, `frontend/src/features/settings/ProjectsTab.tsx` | `frontend/src/lib/project.test.tsx`, `frontend/src/components/layout/ProjectSwitcher.test.tsx`, `frontend/src/features/settings/ProjectsTab.test.tsx` |
| FR-39 | `sync/integration-sync.mjs`, `tasks/ticket-tasks.mjs:84`, `routines/routine-scheduler.mjs`, `workspace/workspace-sync.mjs` | none (planned) |
| FR-40 | `tasks/nervecenter-tools.mjs` (scope per task; knowledge and board-folder parts are phase 2) | `backend/tests/projects-same-project.test.mjs` (tools read in the task's project, "No ticket ... in this project") |
| FR-41..FR-43 | `backend/migrations/003-projects.sql`, `backend/migrations/003-projects.mjs`, `bootstrap.mjs` | `backend/tests/projects-migration.test.mjs` (FR-41, FR-43 both stores; the Postgres case runs when `NC_TEST_DATABASE_URL` is set); FR-42 (move PILOT's folder) is phase 2 |
| FR-51 | `backend/migrations/003-projects.sql`, `backend/migrations/003-projects.mjs`, `backend/src/bootstrap.mts`, `backend/src/sync/integration-sync.mjs` | `backend/tests/projects-migration.test.mjs` (clean and legacy in both stores), `backend/tests/projects-clean-start.test.mjs`, `backend/tests/build-output.check.mjs` |
| FR-44 | `storage/file-migrations.mjs`, `bootstrap.mjs` | `backend/tests/file-migrations.test.mjs` |
| FR-45 | `tasks/task-runtime.mjs` (`editMessage` mechanism) | none (planned) |
| FR-46, FR-47 | `tasks/task-runtime.mjs` (`#gate`), `tasks/permission-policy.mjs` | none (planned) |
| FR-48, FR-49 | `app/operations-service.mjs`, `app/operations-store.mts`, `tasks/nervecenter-tools.mjs` | `backend/tests/projects-same-project.test.mjs` |

## Open questions
None. Resolved by the owner on 2026-10-04: pre-migration tasks start a fresh seeded session (FR-45); the admin All view is read-only (FR-9); env credentials are an ordinary grantable profile (FR-32, FR-41); Git-base promotion is out of scope (Known gaps); physical table names are `ops_projects`, `ops_project_members`, `ops_project_grants`; the file-store runner is in phase 1 (FR-44); agent shell isolation is FR-46 and FR-47 (feasibility of the SDK sandbox is being checked separately); ticket similarity, recurrence and links are same-project (FR-48, FR-49).
