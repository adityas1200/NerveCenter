---
id: SPEC-platform-13
title: Project change hints for UI refresh
status: implemented
area: platform
owners: []
code:
  - backend/src/events/change-feed.mjs
  - backend/src/api/change-routes.mjs
  - backend/src/app/operations-service.mts
  - frontend/src/api/changes.ts
  - frontend/src/lib/ProjectChangeFeed.tsx
  - frontend/src/features/tickets/TicketsPage.tsx
last_verified: 2026-10-12
---

# Project change hints

## Purpose

Refresh stored page data when a backend write completes without changing task output rendering. ADR 0014 chooses an in-process feed for the confirmed single-backend deployment.

## Requirements

- **FR-1** A change stream SHALL authenticate the caller and authorize the selected project. It SHALL reject an all-project scope and SHALL never send another project's hints.
- **FR-2** A published hint SHALL contain only a resource kind, optional resource id, project id and timestamp. The stream SHALL send a ready marker and bounded keepalives; closing the request SHALL remove its subscriber.
- **FR-3** A resource path SHALL publish a hint only after its write succeeds. The first slice SHALL cover ticket changes, including provider imports; later resources SHALL keep their current polling until their write paths are covered.
- **FR-4** The browser SHALL hold one feed for its selected project. A ticket hint SHALL invalidate active ticket and overview queries for that project. Notifications use their own 15-second all-types alert poll (SPEC-overview-02 FR-15). Hints SHALL NOT write data directly into query caches.
- **FR-5** After a disconnect or project switch, the browser SHALL refetch active project data to cover missed hints. While disconnected, visible pages SHALL retain bounded fallback polling; background tabs SHALL not add new fallback polling.
- **FR-6** Task SSE event names, payloads, sequence/replay behavior, draft rendering, approvals and queued-message controls SHALL remain unchanged.

## Critical checks

Unauthorized and cross-project stream requests, ticket hints after successful writes and no hint after failed writes, subscriber cleanup, targeted invalidation, disconnect/reconnect and project-switch recovery, hidden-tab fallback behavior, and existing task-stream tests.

## Known gaps

Only ticket write paths are included in the first implementation slice. Monitoring, inbox, routines, knowledge and boards retain their existing refresh cadences until their write paths and cache keys are migrated. Multi-instance delivery needs a separate ADR.

## Browser behavior amendment (approved 2026-10-13)

SPEC-platform-manual-refresh disables browser stream subscriptions, fallback refresh and presence heartbeats. Server interfaces remain available; notification polling is independent.
