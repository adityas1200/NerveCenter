---
id: SPEC-platform-15
title: Page navigation cues, action placement and complete filtering
status: implemented
area: platform
owners: []
code:
  - frontend/src/components/ops/PageHeader.tsx
  - frontend/src/features/inbox/InboxPage.tsx
  - frontend/src/features/monitor/MonitorPage.tsx
  - frontend/src/features/tasks/cards/ActionsCard.tsx
  - frontend/src/features/tasks/cards/InvestigationCard.tsx
  - frontend/src/api/types.ts
  - backend/src/app/operations-service.mts
  - backend/src/api/server.mjs
last_verified: 2026-10-19
---

# Page navigation cues, action placement and complete filtering

## Purpose
Make navigation intent clear and keep page actions beside the page content they affect. Ensure the Pipelines page filters the full available pipeline set instead of a capped client-side sample.

## Scope
- In scope: link icons across the frontend; page-level actions on pages with a large content heading or tabs; Inbox's "Mark all read" placement; server-side filtering and pagination for the Pipelines list; app-wide review of filterable lists for client filtering over capped or partial responses.
- Out of scope: changing the destination or new-tab behavior of links; moving global shell controls; converting fully returned configuration lists to server pagination without evidence that their responses are capped or partial.

## Actors and permissions
All signed-in users see the same navigation cues and page action placement allowed by their existing role. Existing API permissions and data scope remain in force.

## Requirements
- **FR-1** A link to an external destination SHALL use an external-link icon when an icon is used to communicate where it opens. Same-page and same-app destinations SHALL NOT use an upright-arrow or window-with-arrow icon merely to imply external navigation, including when the same-app link opens in a new tab.
- **FR-2** When a same-page or same-app navigation action is the only icon-bearing action, its misleading upright-arrow or window-with-arrow icon SHALL be removed. When it appears alongside sibling actions, it SHALL be replaced with an icon that describes the action (for example, viewing a record uses a view icon).
- **FR-3** On pages with a large content heading or tabs, page-specific actions SHALL appear in the content area beside the heading or tabs, aligned to the right. Global shell controls SHALL remain in the shell. Actions on compact pages without a content heading or tabs may remain in the shell.
- **FR-4** The Inbox SHALL show "Mark all read" to the right of its filter tabs, outside the shell header menu, and preserve its existing eligibility and pending behavior.
- **FR-5** `/api/monitor` SHALL accept bounded `limit` and `offset` plus the Pipelines page's status, platform, search, and sort parameters. It SHALL apply filters across the full available pipeline set before paging and return the filtered `items` and exact filtered `total`.
- **FR-6** The Pipelines response SHALL provide the full-set status counts, idle count, and platform choices needed to render the status tiles and filter options independently of the selected filters and page. Succeeded SHALL continue to include running pipelines; Missed SHALL continue to include pipelines with a missed slot in the detector lookback.
- **FR-7** The Pipelines page SHALL keep its page and page-size state in the URL, request the selected page from the server, and return to page 1 when search, status, platform, idle inclusion, or time range changes. Status tiles and status filter controls SHALL cause a server request for the matching page.
- **FR-8** The app-wide filter audit SHALL identify whether each filterable list uses a complete or partial/capped source response. Lists already server-paged or filtered against a complete response SHALL retain their current data flow; any additional capped or partial list found SHALL be fixed with the corresponding API pagination/filter contract and tests before this spec is implemented.

## Scenarios
### S1 Same-app links
- **Given** a same-app link, including one that opens in a new tab, with an upright-arrow or window-with-arrow icon
- **When** its navigation treatment is rendered
- **Then** it has no external-navigation icon; an icon among sibling actions describes its action instead

### S2 External links
- **Given** a link to a destination outside NerveCenter
- **When** it uses an icon to indicate navigation
- **Then** the icon communicates that it opens externally

### S3 Page actions
- **Given** a page with a content heading or tabs and page-specific actions
- **When** the page renders
- **Then** those actions appear on the right of the heading or tabs, while global shell controls remain in the shell

### S4 Inbox bulk read
- **Given** Inbox items eligible to mark read
- **When** Inbox renders
- **Then** "Mark all read" appears to the right of the tabs and retains the existing disabled and mutation behavior

### S5 Pipeline filtering beyond one page
- **Given** more pipelines match a status than fit on one page, including matches beyond the former 1,000-row cap
- **When** a status tile or status filter is selected and the user pages through results
- **Then** each request carries the selected filters and offset, every match is reachable, and the server-reported total and unfiltered tile counts are accurate

### S6 Filter reset
- **Given** a reader is on a later Pipelines page
- **When** they change a filter, search, idle inclusion, or time range
- **Then** the URL and request return to page 1 with the new filter state

## Interfaces
- HTTP: extend `GET /api/monitor` with bounded `limit`, `offset`, `status`, `platform`, `q`, `sort`, and `dir` query parameters; return page `items`, exact filtered `total`, and full-set summary counts/options required by FR-6. A focused `pipelineId` lookup keeps existing direct pipeline links resolvable when the target is outside the current page.
- UI: shared `PageHeader` content actions; Inbox tabs/action row; Pipelines page status/search/platform filters and `Pager`.
- URL: Pipelines uses `status`, `platform`, `q`, `showIdle`, `page`, `size`, and existing range parameters.

## Non-functional constraints
Apply server-side filters only within the caller's existing project scope. Keep pipeline health and missed-slot logic in the backend's existing shared rules. Queries must remain bounded and deterministically ordered.

## Audit findings
- Tickets, Tasks, Inbox, and Data quality already request server-filtered pages and exact totals.
- Connectors, routines, and inspected admin lists filter complete API responses; no response cap was found in those flows.
- Pipelines was the only audited filterable list applying filters to a capped sample. It now filters before paging in the backend and reports full-set summary counts and choices.
- Link icon review included same-app links that open a new tab. External-link glyphs remain on external URLs; internal destinations now use action-specific glyphs or no navigation glyph.

## Traceability
| Requirement | Code | Test |
|---|---|---|
| FR-1, FR-2 | frontend link/action renderers | `ActionsCard.test.tsx` and Inbox link coverage |
| FR-3, FR-4 | `PageHeader.tsx`, `InboxPage.tsx` | page-header and Inbox placement tests |
| FR-5, FR-6 | `operations-service.mts`, `server.mjs`, `types.ts` | monitor service and HTTP route tests |
| FR-7 | `MonitorPage.tsx` | pipeline filter, URL and paging tests |
| FR-8 | app filter audit | audit checklist and relevant page tests |

