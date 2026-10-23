---
id: SPEC-platform-03
title: App presence and heartbeat
status: implemented
area: platform
owners: []
code:
  - backend/src/app/app-presence.mjs
  - backend/src/api/server.mjs
  - backend/src/bootstrap.mjs
  - frontend/src/PresenceHeartbeat.tsx
last_verified: 2026-10-03
---

# App presence and heartbeat

## Purpose
Let background work (integration sync, ticket polling) run only while someone is actually using NerveCenter in a visible browser tab, so idle deployments do not poll Jira, ServiceNow or Databricks.

## Scope
- In scope: `AppPresence` tracker, `POST /api/presence`, frontend heartbeat, idle window.
- Out of scope: what the pollers do (sync specs); `sync.enabled` setting.

## Actors and permissions
Any authenticated user (all roles) can send heartbeats.

## Requirements
- **FR-1** `AppPresence` SHALL record the clock time on `touch()` and report `active` only when `now - lastActiveAt <= idleSeconds * 1000` (boundary inclusive) and at least one touch happened.
- **FR-2** `idleSeconds` SHALL default to `OPS_SYNC_IDLE_SECONDS` or 90; when `idleSeconds <= 0` (or NaN-false) `isActive()` SHALL always be true.
- **FR-3** `status()` SHALL return `{active, idleSeconds, lastActiveAt (ISO or null)}`.
- **FR-4** The server SHALL call `presence.touch()` on every authenticated request (not only heartbeats), and `POST /api/presence` SHALL return `status()` with 200.
- **FR-5** `createBackend` SHALL expose `isAppActive = () => presence.isActive()` to the ticket-task poller and the integration sync service.
- **FR-6** The frontend `PresenceHeartbeat` SHALL POST `/api/presence` immediately and every 30 s only while `document.visibilityState === "visible"`, stop the timer when hidden, restart on `visibilitychange`, ignore failures, and clear on unmount.

## Scenarios
### S1 Heartbeats stop
- **Given** a touch at T with idle 90 s
- **When** the clock is T+90 s then T+90 s+1 ms
- **Then** `isActive()` is true, then false.

### S2 Never touched
- **Given** a fresh process
- **Then** `isActive()` is false (unless idle disabled).

### S3 Hidden tab
- **Given** the tab becomes hidden
- **Then** no further heartbeats are sent until visible again.

## Interfaces
- HTTP: `POST /api/presence` -> `{active, idleSeconds, lastActiveAt}`.
- Config: `OPS_SYNC_IDLE_SECONDS` (default 90; read at module load).
- UI: `<PresenceHeartbeat />` mounted inside `AuthGate` in `main.tsx`.

## Non-functional constraints
In-memory, per process, single global flag (not per user); resets on restart.

## Known gaps / deviations
- Because every authenticated API call touches presence (server.mjs:38), a script or non-visible client using the API keeps the app "active"; "visible tab" is not enforced server-side.
- Presence is global, not per user or per session; a restart makes the app idle until the first request.
- No frontend test for `PresenceHeartbeat`; no test for the HTTP route.

## Traceability
| Requirement | Code | Test |
|---|---|---|
| FR-1 | `backend/src/app/app-presence.mjs:11-19` | `backend/tests/app-presence.test.mjs:5` |
| FR-2 | `backend/src/app/app-presence.mjs:1,16-17` | `backend/tests/app-presence.test.mjs:17` |
| FR-3 | `backend/src/app/app-presence.mjs:21-27` | `backend/tests/app-presence.test.mjs:5` (partial) |
| FR-4 | `backend/src/api/server.mjs:38,41` | none |
| FR-5 | `backend/src/bootstrap.mjs:54-60` | none |
| FR-6 | `frontend/src/PresenceHeartbeat.tsx:4-32` | none |

## Open questions
- Should only `POST /api/presence` (not every request) count as activity?

## Browser behavior amendment (approved 2026-10-13)

SPEC-platform-manual-refresh disables browser stream subscriptions, fallback refresh and presence heartbeats. Server interfaces remain available; notification polling is independent.
