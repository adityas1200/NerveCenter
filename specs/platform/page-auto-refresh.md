---
id: SPEC-platform-page-auto-refresh
status: implemented
last_verified: 2026-10-13
owner: platform
---

# Scheduled page refresh

Requested and authorized in chat on 2026-10-13, superseding the manual-only page cadence in SPEC-platform-manual-refresh. Notification polling and backend source synchronization retain their separate contracts.

- FR-1: Page headers with Refresh SHALL reuse their existing refresh action on a configurable cadence. `VITE_AUTO_REFRESH_SECONDS` SHALL default to 300 seconds. Positive integer values configure seconds; zero disables scheduling; missing or invalid values use 300. This is a public build-time setting, documented and passed through frontend Docker builds.
- FR-2: A compact Refresh button SHALL show minutes/seconds remaining, a subtle progress indicator, and a spinner while refreshing. It SHALL expose keyboard-accessible status and respect reduced motion without announcing each second to screen readers. Manual refresh remains available and restarts the countdown.
- FR-3: At expiry, refresh SHALL defer while hidden, a read or mutation is pending, a field is focused, an editor has unsaved changes, a dialog/menu is open, or the reader has interacted within five seconds. Once safe, it SHALL run once, without replaying missed intervals. Finishing a page read starts a fresh interval. Failures SHALL wait for the next interval, with no immediate retry.
- FR-4: Scheduling SHALL stop on unmount, restart for navigation/project/selection changes, use the latest handler, and refresh only the visible page's current scope. Secondary drawer, conversation and item controls SHALL remain manual to avoid independent timers. No change streams, focus/reconnect query refreshes or presence heartbeats are re-enabled.

## Verification

Test default/custom/disabled/invalid configuration, countdown and manual reset, idle expiry, busy/hidden/editing/mutation deferral, no missed-interval bursts, navigation cleanup, latest handler, failure cadence, and page-level request scope. Run frontend quality and full backend suites; report existing failures. Update superseded specs and configuration docs.

| Requirements | Tests |
| --- | --- |
| FR-1 | `frontend/src/lib/autoRefresh.test.ts`, `RefreshButton.disabled.test.tsx` |
| FR-2, FR-3, FR-4 | `frontend/src/components/ops/RefreshButton.test.tsx` |
| FR-3, FR-4 request scope and failure cadence | `frontend/src/features/overview/OverviewPage.test.tsx` |
