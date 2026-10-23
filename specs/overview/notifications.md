---
id: SPEC-overview-02
title: Notifications (/api/notifications and the bell)
status: implemented
area: overview
owners: []
code:
  - backend/src/app/operations-service.mjs
  - backend/src/api/server.mjs
  - frontend/src/components/layout/NotificationsTray.tsx
  - frontend/src/components/layout/notificationKinds.ts
last_verified: 2026-10-03
---

# Notifications

## Purpose
The bell in the header tells a person what happened to tickets, pipelines and the agent since they last looked, and pins setup problems (a connection that is down) until fixed. Approvals and questions are decided in the Inbox, not here.

## Scope
- In scope: `GET /api/notifications`, item kinds, system (pinned) items, the tray's unread logic.
- Out of scope: the Inbox, task notifications created by the task runtime, email or push delivery.

## Actors and permissions
All roles. Ticket-derived items cover only tickets the caller can access. Pipeline failures and inbox items are workspace-wide.

## Requirements
- **FR-1** `GET /api/notifications?since=<ISO>&limit=<n>` SHALL return `{ generatedAt, since, total, items, system }`. `limit` SHALL be clamped to 1..200 (default 50); `total` counts all matching items before the limit.
- **FR-2** For every accessible ticket the response SHALL include a `ticket.created` item (`id ticket.created:<id>`, at `createdAt`, href `/tickets/<id>`, detail "<id> · P2 · High · opened") and one item per activity event of type `ticket.status`, `ticket.assigned`, `ticket.priority` (same kind) or `task.*` (kind `automation`).
- **FR-3** Item `tone` SHALL be `bad` for a failed event, `warning` when type or status matches waiting/approval/review, `success` for a completed event, else `neutral`.
- **FR-4** For runs in the last 24 hours with status failed, error, timedout, canceled, cancelled or internal_error the response SHALL include a `pipeline.failed` item (tone `bad`), linking to the run's ticket when one exists, else `/monitor?pipeline=<id>`.
- **FR-5** From the task inbox (latest 200) the response SHALL include pending approvals (`agent.approval`, href `/inbox`, tone `warning`), pending questions (`agent.question`) and `notification` items (`agent.update`, href `/tasks/<id>`).
- **FR-6** Items with an unparseable time SHALL be dropped; with `since` set, items at or before it SHALL be dropped; the remainder SHALL be sorted newest first.
- **FR-7** System items (`system.connection:databricks|servicenow`, `system.connection:data-quality`; `pinned: true`, tone neutral, href `/connectors` or `/data-quality`) SHALL be returned in `system`, and also prepended to `items` only when `since` is absent. They appear when Databricks is not ready, ServiceNow is not ready, or the DQ result table is not configured or disabled.
- **FR-8** The tray SHALL poll the all-types notification alert every 15 s, hide `agent.approval`, `agent.question` and `approval.pending` items, treat pinned or `system.*` items as non-unread, and compute unread across the full current source window using the local `nc-notifications-seen-at` timestamp. "Mark all read" SHALL store now there; read state is client-only.
- **FR-9** The tray SHALL offer All, agent and "Tickets and pipelines" views, group by Today and Earlier, show system items on top, navigate to the item's `href` on click, and show "No notifications" when empty.
- **FR-10** The existing GET route SHALL also accept `mode=summary|updates|page`, `view=all|agent|operations`, `seenAt=<ISO>`, `after=<opaque watermark>` and `cursor=<opaque page position>`. Requests without the new parameters SHALL retain FR-1 through FR-7 behavior. Invalid cursors, watermarks and views SHALL return 400. All modes SHALL apply the caller's project and ticket visibility before counting or paging.
- **FR-11** Summary mode SHALL return `{ generatedAt, unread, systemCount, watermark }` without a notification list. `unread` SHALL count visible non-system, non-approval/question notifications newer than `seenAt` across the existing ticket, last-24-hour pipeline and latest-200-inbox source windows. `watermark` SHALL identify the newest such item in stable `(at,id)` order.
- **FR-12** Page mode SHALL return `{ generatedAt, total, items, system, nextCursor }` for the selected view, with 50 items by default. `all` SHALL exclude system and approval/question items, `agent` SHALL include only agent updates, and `operations` SHALL include non-agent activity. Filter before pagination, order by `(at DESC,id DESC)`, and use an opaque cursor so newer arrivals do not displace older pages. Return system items separately on the first page.
- **FR-13** Updates mode SHALL return `{ generatedAt, unread, system, watermark, total, items, nextCursor }` for all visible notification types newer than `after`, in the same stable order. A caller SHALL be able to page through more than 50 new items before advancing its watermark; arrivals after the first updates page SHALL remain eligible for the next poll. The tray SHALL de-duplicate by ID and prepend only items matching its active view.
- **FR-14** While closed, the tray SHALL poll summary mode. On open or tab switch it SHALL fetch page one for the selected view, then poll updates mode while open. It SHALL fetch one older page at a time when the scroll position is within 300 px of the end, virtualize rendered rows, and preserve the reader's position when new rows are prepended. It SHALL show loading and failure states for page fetches without discarding loaded items.
- **FR-15** Notification requests in one browser tab SHALL be serialized and abort on unmount or project switch. Ticket change hints, window focus and automatic retries SHALL NOT trigger notification refetches. The bell SHALL use the all-types unread count and system count; no toast or sound is added.

## Scenarios
### S1 Fresh install
- **Given** no connectors **Then** `system` contains Databricks, ServiceNow and Data quality items and the bell shows a dot, not a count.
### S2 Ticket reassigned
- **When** a ticket is assigned to someone **Then** a `ticket.assigned` item with the actor's detail appears and counts as unread until the seen timestamp passes it.
### S3 Incremental fetch
- **When** called with `since` = the last seen time **Then** only newer items return and no system items.
### S4 Approval waiting
- **Then** the item is in the API response but not in the bell; it appears only in the Inbox.
### S5 Long notification history
- **Given** more than 50 matching notifications **When** the tray nears its scroll end **Then** it loads the next page before reaching the end, without duplicate or missing rows after a newer item arrives.
### S6 Burst while the tray is open
- **Given** more than 50 new notifications across types **When** updates are polled **Then** every updates page is consumed before advancing the watermark, and only matching items are prepended to the selected view without moving the reader's scroll position.
### S7 Slow response
- **Given** a notification request is still pending at the next poll tick **Then** no second notification request begins; a project switch aborts the request.

## Interfaces
- HTTP: `GET /api/notifications` (`server.mjs`). Item shape `{ id, kind, title, detail, at, href, tone, ticketId?, pipelineId?, taskId?, pinned?, provider? }`. The new modes and fields are specified in FR-10 through FR-13.
- Client state: `localStorage` key `nc-notifications-seen-at`.
- UI: header bell popover, 380 px wide.

## Non-functional constraints
- Computed per request from tickets, a 24 h monitor scan and the inbox; no persistence, so nothing is "dismissed" server-side. A monitor failure yields no pipeline items rather than an error.

## Known gaps / deviations
- No data-quality failure items are produced although the tray maps `dq.failed` to an icon; `approval.pending` is likewise only a client-side filter value the backend never emits.
- System items cover ServiceNow but not Jira or GitHub.
- Read state is per browser, not per user; clearing storage re-marks everything unread.
- Ticket events and the "created" item exist for every accessible ticket regardless of whether the caller is involved, so operators-visible tickets notify everyone.
- `limit` (default 50) truncates the merged, time-sorted list, so heavy ticket churn can push agent items out of view.
- Backend coverage: only that `system` includes Databricks when it is not connected (`api.test.mjs:50`). Item building, `since`, `limit` and tones are untested; tray tests cover filtering and the unread count only.

## Traceability
| Requirement | Code | Test |
|---|---|---|
| FR-1, FR-6 | `backend/src/app/operations-service.mjs:164-203` | `backend/tests/api.test.mjs:50` (shape only) |
| FR-2, FR-3 | `backend/src/app/operations-service.mjs:170-182` | none |
| FR-4 | `backend/src/app/operations-service.mjs:183-188` | none |
| FR-5 | `backend/src/app/operations-service.mjs:189-196` | none |
| FR-7 | `backend/src/app/operations-service.mjs:203-216` | `backend/tests/api.test.mjs:50` |
| FR-8 | `frontend/src/components/layout/NotificationsTray.tsx:35-85`, `notificationKinds.ts:4` | `frontend/src/components/layout/NotificationsTray.test.tsx:19`, `:31` |
| FR-9 | `frontend/src/components/layout/NotificationsTray.tsx:86-140` | none |

## Open questions
- Should notifications be scoped to tickets the user is involved in, and stored per user?
