---
id: SPEC-platform-manual-refresh
status: implemented
owner: platform
---

# Manual browser refresh

Approved in chat on 2026-10-13, including changes to existing tests. Supersedes automatic browser refresh requirements in page, change-stream and task-stream specs. Notification polling remains governed by SPEC-overview notifications.

- FR-1: Fetch on navigation, selection changes, Refresh, and successful user writes affecting visible data. Disable other polling, retries, focus/reconnect refetch, project change streams and task streams. Remove presence heartbeats; server jobs remain unchanged and may become idle without presence.
- FR-2: Overview reads separate ticket, pipeline, DQ, agent and work endpoints. Group same-source calculations, return aggregates, preserve metric definitions, scope and history windows; retain the legacy Overview endpoint.
- FR-3: Refresh only displayed queries, preserving selections and scroll. Cancel obsolete requests, deduplicate in-flight work, and never apply old-project responses. Writes update visible affected queries once; other caches become stale without fetching.
- FR-4: Initial loads and selection changes use layout-preserving skeletons. Same-selection refresh retains data with spinners. Errors stop loading and preserve successful data. Independent groups have individual freshness and errors. Respect reduced motion and expose accessible loading state.
- FR-5: Conversations fetch saved events on opening and manual refresh. Sending/approving performs one affected-view update. No stream, reconnect loop or background files polling.
- FR-6: Notifications remain the sole automatic data-refresh exception. Hidden panels do not fetch; visible shared controls initialize once and update after relevant user writes.

## Verification

Test grouped endpoint isolation and aggregates; idle/focus/reconnect silence; navigation and selection requests; one request during repeated refresh; cancellation and project switches; initial/refresh/error rendering; manual conversation snapshots and actions. Run backend and frontend full suites. Environment network verification requires authenticated access.

## Scheduled page refresh amendment (2026-10-13)

[Scheduled page refresh](page-auto-refresh.md) supersedes the manual-only portions of FR-1, FR-5 and FR-6 for page headers with Refresh. A configurable five-minute default reuses the same scoped action after interaction guards. Secondary conversation/drawer controls stay manual. Notification polling, disabled event/focus/reconnect triggers and stopped presence heartbeats remain unchanged.

## Live task chat amendment (2026-10-14, draft)

Requested in chat on 2026-10-14; awaiting approval. Supersedes the "no stream, reconnect loop" part of FR-5 for the task page only. Without a stream, a sent prompt showed "Working" until the browser was refreshed.

- FR-7: The task page SHALL hold one task event stream (`GET /api/tasks/:id/events?after=<lastSeq>`) per open task and apply events, task snapshots and partial-output drafts as they arrive (SPEC-tasks-ui FR-7 to FR-9). The stream SHALL NOT trigger fetches of other queries.
- FR-8: Nothing polls the task. A dropped stream SHALL reconnect after 2 s, doubling to at most 30 s, and reset to 2 s once data arrives. Closing the page SHALL close the stream and cancel any pending reconnect.
- Background files polling, project change streams, focus/reconnect refetch and presence heartbeats stay off.
