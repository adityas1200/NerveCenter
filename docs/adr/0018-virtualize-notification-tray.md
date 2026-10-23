# 0018. Virtualize the notification tray with TanStack Virtual

- Status: accepted
- Date: 2026-10-13
- Related: specs/overview/notifications.md

## Context

The notification tray currently renders at most 50 items. The approved pagination behavior will let a person scroll through many pages in a 460 px popover. Rows have variable heights and section headings. Keeping every loaded row mounted would make long sessions increasingly expensive, while a fixed-height manual window can misplace rows and scroll anchors.

## Decision

Add `@tanstack/react-virtual` to the frontend and use it to window notification rows in `NotificationsTray`. Keep the system section separate and virtualize the Today/Earlier activity rows with measured heights. Fetching pages remains owned by the notification API code; virtualization never initiates a request except through the tray's near-end prefetch rule.

## Alternatives considered

- Render all loaded rows: DOM size grows with every page and does not meet the requested virtual scrolling behavior.
- Build a custom variable-height virtualizer: adds scroll measurement and anchor logic that an established library already handles.

## Consequences

The frontend gains one focused dependency and must show its audit output in the PR. Tests must cover variable-height rows, prepend position and near-end prefetch. Rollback is to remove the dependency and return to a bounded rendered list while retaining server pagination.
