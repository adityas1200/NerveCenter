---
id: SPEC-tasks-12
title: Ask Sonic about what you see (widgets, chart points, rows, screenshots)
status: implemented  # approved and implemented 2026-10-13
area: tasks
owners: []
code:
  - frontend/src/components/ops/agentPanelContext.ts
  - frontend/src/components/ops/AgentPanel.tsx
  - frontend/src/features/boards/BoardWidgets.tsx
  - frontend/src/features/boards/BoardPage.tsx
  - frontend/src/features/boards/boardSelection.ts
  - frontend/src/components/ops/AskSonic.tsx
  - frontend/src/features/overview/OverviewPage.tsx
  - frontend/src/components/ops/charts/ColumnChart.tsx
  - frontend/src/components/ops/charts/BarChart.tsx
  - frontend/src/components/ops/charts/LineChart.tsx
  - frontend/src/components/ops/charts/DonutChart.tsx
  - frontend/src/features/tasks/TaskComposer.tsx
  - frontend/src/features/tasks/screenCapture.ts
  - backend/src/tasks/nervecenter-tools.mts
  - backend/src/tasks/task-runtime.mts
  - backend/src/tasks/attachments.mjs
last_verified: 2026-10-13
---

# Ask Sonic about what you see

## Purpose
A person looking at a board or the Overview who thinks a number is wrong should be able to point at it and ask. Today "Ask Sonic" exists on ticket, pipeline and check rows, but a board sends only the board id and a widget title, so Sonic has to guess what the person meant. Leading BI tools send the widget, its data, the filters and the picked point instead of pixels (Databricks AI/BI "Ask Genie", Power BI Copilot, Chrome DevTools "Ask AI"), and the agent re-reads the data itself. This spec does the same for NerveCenter, and lets a person attach a screenshot of the screen they are on as a pointer when words are not enough.

## Scope
- In scope: an "Ask Sonic" action on every board widget and Overview panel; picking a chart point, a donut slice or a table row in a widget; the context the panel sends; a context chip in the panel; a screenshot of the current screen from the panel's + menu; how Sonic treats a screenshot.
- Out of scope: outside BI tools (Tableau, Power BI, Looker; no connectors exist), cropping or annotating a screenshot, sending the prompt without the person pressing Enter (see FR-9), a picker for arbitrary page elements.

## Actors and permissions
Anyone who can chat with Sonic (developer, admin; `tasks.manage`) sees the Ask actions. Viewers and visitors to an open project do not (SPEC-projects-03 FR-13, SPEC-tasks-07). `get_board_widget_data` reads a board with the reader's own access: published boards, or the reader's own drafts (SPEC-boards-01).

## Requirements
- **FR-1** Every board widget SHALL have an "Ask Sonic about this" action in its header (shown on hover and on keyboard focus, always reachable by Tab), for people who can chat. It SHALL open the Sonic panel with the widget as the selection and a starter question typed into the box.
- **FR-2** Clicking a column, bar, line point or donut slice in a board chart widget, or a row of a board table widget, SHALL pin that point under the widget header ("09/24 · Failed 3, Succeeded 12") with "Ask Sonic about this" and a clear button. Asking SHALL send the widget plus the point. A second click on the same point, the clear button or Escape SHALL unpin it.
- **FR-3** The selection for a widget SHALL be `{kind: "board_widget", id: "<boardId>/<widgetId>", title, detail: {boardId, boardTitle, widgetId, widgetTitle, widgetType, filters, point?}}`, where `filters` are the board's effective filter values on screen and `point` is `{label, values: {series: value}}` for a chart or `{row: {column: value}}` (at most 12 columns, values cut at 120 characters) for a table.
- **FR-4** Each Overview panel (Tickets, Pipelines, Data quality) SHALL have an "Ask Sonic about this" action, and a click on a column of its chart SHALL pin the bucket the same way as FR-2. The selection SHALL be `{kind: "overview_panel", id: <panel>, title, detail: {range, point?}}`.
- **FR-5** The panel SHALL show what the next message is about as a chip above the message box ("About: Failed runs · 09/24") with a button to clear it; a cleared selection SHALL not be sent.
- **FR-6** A new nervecenter tool `get_board_widget_data({board, widget, filters?})` (category read) SHALL return the widget's spec and the columns and up to 50 rows it shows for those filters (the board's defaults when none are given), computed the way the board page computes them, with `rowCount` and the filters used. A widget id that is not on the board SHALL return "No widget <id> on board <title>".
- **FR-7** When the selection is a board widget, the turn context SHALL tell Sonic to call `get_board_widget_data` with that board, widget and filters before answering, and to investigate the source data behind a point with `query_data` (for SQL widgets) or the matching nervecenter tool.
- **FR-8** The panel's + menu SHALL offer "Screenshot of this screen" where the browser supports screen capture (`navigator.mediaDevices.getDisplayMedia`). It SHALL capture one frame of the current tab after the browser's own prompt, add it as a PNG attachment (shown as a thumbnail the person can remove before sending, SPEC-tasks-11 FR-2), and stop the capture at once. When a board widget is selected and on screen, the image SHALL be cropped to that widget. A refused or failed capture SHALL show an inline message and attach nothing. Where capture is unsupported the item SHALL not be shown.
- **FR-9** "Ask Sonic" from a page SHALL open the panel with the selection set and the prompt typed into the box; the person sends it with Enter, so they can add what looks wrong. *Amends SPEC-tasks-07 FR-7, which said the prompt is sent: the code prefills, and the person approved keeping that on 2026-10-13.*
- **FR-10** When a message carries an image, the agent SHALL be told to treat it as a pointer, not as evidence: match it to the page, board, widget or table it shows using the page context and the titles in the image, read the real data with its tools, and say so when it cannot match the image to data it can read. Numbers read only from an image SHALL be called out as unconfirmed.

## Scenarios
### S1 A wrong-looking bar
- **Given** a board with a "Failed runs by day" column chart
- **When** the person clicks the 09/24 column and then "Ask Sonic about this"
- **Then** the panel opens with "About: Failed runs by day · 09/24" and a starter question, and the message sent carries the board, widget, filters and point
- **And** Sonic calls `get_board_widget_data` first

### S2 A table row
- **Given** a table widget listing pipelines
- **When** the person clicks the "veltrix_sales_daily · Failed" row and asks
- **Then** the selection's point holds that row's cells

### S3 Screenshot
- **Given** the panel is open on a board with a widget selected
- **When** the person picks "Screenshot of this screen" and allows the browser prompt
- **Then** a PNG of that widget is attached as a thumbnail and sent with the next message

### S4 Capture refused
- **When** the person cancels the browser prompt
- **Then** an inline message says the screenshot was not taken and nothing is attached

## Interfaces
- Agent tool: `mcp__nervecenter__get_board_widget_data` `{board: id or title, widget: id, filters?: {key: value}}` → `{board: {id, title}, widget: {id, title, type, source, viz}, filters, columns, rows (≤50), rowCount}`.
- Page context: `context.page.selection` gains the optional `detail` object (FR-3, FR-4). Stored on the task as today (`context.page`), sent inside `<screen>` as "Selected: …" (cut at 1500 characters).
- UI: widget header button `aria-label="Ask Sonic about <title>"`; pinned point bar `role="status"`; panel chip `aria-label="Clear what this message is about"`; + menu item "Screenshot of this screen".

## Non-functional constraints
- The screenshot never leaves the browser except as the attachment the person sends; it goes through the SPEC-tasks-11 checks and limits. The browser's own capture prompt is the consent.
- No new dependency: capture uses `getDisplayMedia`, a video element and a canvas.

## Known gaps / deviations
- Firefox has no `preferCurrentTab`, so the person picks the tab in the browser prompt.
- Heatmap, funnel and gantt widgets have the header action but no point picking.

## Traceability
| Requirement | Code | Test |
|---|---|---|
| FR-1 | `BoardWidgets.tsx` | `frontend/src/features/boards/askAboutWidget.test.tsx` |
| FR-2 | `BoardWidgets.tsx`, `charts/*.tsx` | `askAboutWidget.test.tsx` |
| FR-3 | `boardSelection.ts` | `askAboutWidget.test.tsx` |
| FR-4 | `OverviewPage.tsx`, `AskSonic.tsx` | `frontend/src/features/overview/askAboutPanel.test.tsx` |
| FR-5 | `AgentPanel.tsx` | `frontend/src/components/ops/AgentPanelAbout.test.tsx` |
| FR-6 | `nervecenter-tools.mts` | `backend/tests/ask-about-this.test.mjs` |
| FR-7 | `task-runtime.mts` | `backend/tests/ask-about-this.test.mjs` |
| FR-8 | `screenCapture.ts`, `TaskComposer.tsx` | `frontend/src/features/tasks/screenCapture.test.tsx` |
| FR-9 | `agentPanelContext.ts`, `boardSelection.ts` | `askAboutWidget.test.tsx`, `AgentPanelAbout.test.tsx` |
| FR-10 | `attachments.mjs` | `backend/tests/ask-about-this.test.mjs` |

## Open questions
None.
