# Polling and scheduling audit

- Source revision: `4f15fd15b5137b4b82fb8c9d73206f8d4c2325a8`
- Date: 2026-10-11
- Scope: read-only inventory for CR-23; no runtime behavior changed
- Related: [accepted ADR 0010](../adr/0010-schedule-execute-notify.md), [implementation plan](../plans/polling-scheduling-standardization.md)

## Browser requests

Rates are steady-state requests per visible, mounted tab, calculated from configured intervals. They exclude initial loads, retries, focus/reconnect refetches, mutations, and optional panels. TanStack Query deduplicates concurrent observers of the same project-scoped key; a separate key or a forced invalidation can still refetch. Its interval polling pauses in background tabs by default, while the Data Quality `setInterval` has no visibility guard ([TanStack Query polling reference](https://tanstack.com/query/latest/docs/framework/react/guides/polling)).

| Owner | Endpoint / action | Interval | Requests/min | Purpose and cost |
| --- | --- | ---: | ---: | --- |
| `components/ops/AgentPanel.tsx:73` | `GET /api/tasks?status=running&limit=20` | 10 s | 6 | Shell agent state; database read even with panel closed. |
| `features/inbox/useInboxPending.ts:10` | `GET /api/inbox?status=pending&limit=200` | 20 s | 3 | Sidebar and agent pill badge share a query key, so normally one request per interval. |
| `components/layout/NotificationsTray.tsx:60-65` | `GET /api/notifications?limit=50` | 30 s | 2 | Shell bell and unread count; database/derived status read. |
| `PresenceHeartbeat.tsx:4-25` | `POST /api/presence` | 30 s, visible only | 2 | Keeps user-gated background work active; no provider read itself. |
| `features/data-quality/DataQualityPage.tsx:94-112` | `POST /api/data-quality/monitor/reconcile` | 60 s | 1 plus invalidation | Normally reads the ledger; before the first background fetch it may read the provider live (SPEC-platform-10 FR-5). Effect-driven invalidation can cause another POST near the query tick. |
| Same page | `POST /api/monitor/refresh` (`dataQuality`) | Open and 60 s | 1 | Forces full retention-window provider reads. Backend limits refresh to once per 30 s **per process** (`monitoring-service.mjs:57-67`), so tabs still send redundant requests. |
| `features/tickets/TicketsPage.tsx:109` | `GET /api/tickets` | 15 s | 4 | Paged local store read; interval explicitly pauses in background. |
| `features/inbox/InboxPage.tsx:51` | `GET /api/inbox` (view/page key) | 15 s | 4 | Paged read, separate from badge query. |
| `features/tasks/TasksPage.tsx:71` | `GET /api/tasks` (page key) | 15 s | 4 | Paged read, separate from running-task query. |
| `features/routines/RoutinesPage.tsx:30`; `RoutineDetailPage.tsx:28` | Routines list / detail GET | 30 s / 15 s | 2 / 4 | Local routine definitions and run state. |
| `features/monitor/MonitorPage.tsx:133,427` | Pipeline monitor / detail GET | 15 s / 30 s | 4 / 2 | Reads stored monitoring snapshot; manual refresh invokes provider work. |
| `features/settings/AutomationsTab.tsx:59` | `GET /api/automation` | 30 s | 2 | Settings-only status read. |
| `features/boards/BoardPage.tsx:35-65,148-149` | Task list, board detail, widget data GET | 30 s idle / 5 s busy; 4 s build | 2 idle / up to 12 busy; up to 15 per active build query | Board build progress; multiple observers can share the detail key, but widget keys are separate. |
| `features/tasks/TaskPage.tsx:73`; `features/tasks/useTaskStream.ts` | Task files GET; task event SSE | 10 s while live; stream | 6 GET; 1 stream | Files poll; task events and deltas already stream, with 2 s reconnect after loss. |
| `features/tickets/TicketDetailSheet.tsx:52` | Ticket detail GET | 5 s while agent works | 12 | Stops when that ticket's agent is not working. |

Manual Refresh buttons exist on Overview, Tickets, Boards, board detail, Pipelines, Data Quality, Inbox, Tasks, Routines list/detail, Connectors, Settings, and Knowledge (`frontend/src/features/*`). Most refetch local API data; Pipelines and Data Quality also call `POST /api/monitor/refresh`, which may query providers. Settings > Pipelines has a separate refresh action. Preserve each button's meaning in its phase.

**Calculated one-tab baseline:** a visible project-member tab with the shell and no extra page poll makes about **11 GET + 2 POST = 13 requests/minute**. Data Quality adds one refresh POST and at least one read-only reconciliation POST per minute, and its two refresh mechanisms can add another reconciliation POST: about **15–16 requests/minute** before focus/retries. Two tabs have separate query caches and can approximately double the browser traffic. These are source-derived rates, not captured production traffic. The current API edge logs errors but no request counts (`backend/src/api/server.mjs:232-263`); no measured production request volume is available in this checkout. A five-minute Network trace and server/provider counters are the Phase 1 measurement gate.

## Server work

| Owner | Trigger and cadence | Work / external cost | State and ownership |
| --- | --- | --- | --- |
| `tasks/ticket-tasks.mjs:91-164` | Check at most every 15 s; per-project `sync.tickets` controls actual import; first check after 5 s | Jira / ServiceNow reads and possible Sonic triage | Process-local `polling` and last-poll map. Iterates normal active projects. |
| `sync/integration-sync.mjs:55-97` | Check every 5 s; fallback work interval 15 s | GitHub clone/fetch/PR list; knowledge sync; legacy Databricks failure scan only if enabled (the app passes `databricksFailures: false` in `bootstrap.mts:124`) | One process-local gate based on the **first** project. GitHub only syncs that project. `githubSeconds` and `knowledgeSeconds` are constructor fields but are not used in `poll()`; both use the first project's `configuredInterval`. |
| `monitoring/monitoring-service.mjs:36-99` | Check every 15 s; pipelines default 5 min, DQ default 15 min; detection at least every 60 s; prune at most every 6 h | Pipeline provider reads; DQ full retention-window table reads; alert detection and possible Sonic work | Persisted fetch timestamps, process-local busy/detection/refresh gates. Active projects run while a user is present; automations keep their project watched when idle. |
| `routines/routine-scheduler.mjs:154-200` | Check every 30 s against five-field cron | Starts Sonic routine tasks, with model and tool cost | Project-specific state file records last fired minute after task start; check and write are not an atomic distributed claim. No missed-slot catch-up. |
| `workspace/workspace-sync.mjs:61-85,165-186` | Push every 60 s when configured | Object-store listing plus changed-file writes/deletes | Local snapshot and process-local busy flag; independent of project activity gate. |
| `tasks/task-runtime.mts:140-159,370-425` | Enqueue immediately; drain up to process-local `maxConcurrent` | Claude SDK sessions and tool calls | Task row/events persist, but `queuedRuns` and unsent follow-up messages are in memory; restart reconstruction has limits. |
| `api/task-routes.mjs:99-112` | Open task SSE; heartbeat every 15 s | One long-lived authorized HTTP response, not a provider poll | Replays stored events, then subscribes to the local runtime emitter. Events from another instance are not published to this connection; there is a replay/subscribe gap. |

`backend/src/main.mts:37-46` starts the separate timers. `backend/README.md:15` currently requires one backend per workspace because approvals belong to the process owning a task. This limits today's multi-instance reliability. The monitoring ledger and alert occurrence keys already persist useful deduplication state, but scheduled jobs and task execution have no shared claim/lease record.

## Contract and risk checks

- `SPEC-data-quality-02` FR-10 and FR-15 require 60-second page freshness and the page's refresh POST. ADR 0007 made the full-window read and on-view refresh explicit. Phase 1 must update that contract before changing the trigger pattern; full-window mirror semantics remain.
- `SPEC-platform-10` FR-1, FR-4, FR-6, FR-8 require project cadences, Refresh now, the 30-second throttle, and activity gating. `SPEC-tasks-01` and `SPEC-routines-01` cover task and routine behavior. A new queue cannot silently alter actor identity, permissions, or catch-up behavior.
- `SPEC-platform-10` FR-2 and `SPEC-tickets-06` FR-3 claim per-project knowledge cadence, but `integration-sync.mjs:80-94` uses the first project's shared interval. The integration spec's known gap acknowledges the shared gate. Phase 2 must resolve this contract drift. Databricks pipeline fetch already follows `sync.pipelines` through monitoring; scheduling the retired failure scanner would duplicate it.
- A provider call may be safe to retry; a Sonic tool write may have taken effect before its worker crashed. Automatic retry of an ambiguous write could duplicate an external action. Phase 3 needs a separate recovery rule for that case.
- A durable queue can prevent concurrent claims and recover unfinished jobs, but it cannot guarantee an external side effect happened exactly once if a worker crashes after the side effect and before acknowledging completion. Job idempotency and a visible ambiguous-write state are necessary for the stated reliability goal.
- File-backed local stores have one-process ownership. Multi-instance guarantees apply to the Postgres deployment after a durable claim mechanism and cross-instance event delivery exist; the local mode needs single-process parity for state and manual actions.
