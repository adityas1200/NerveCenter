# NerveCenter frontend

React 18 + Vite + TypeScript. A thin, chat-first shell over the `operations-fleet` agent: Overview, Tickets, Pipelines, Data Quality, Tasks, Inbox, Routines, Skills, Knowledge, Connectors and Settings, plus an agent panel on every screen. The design is in [`docs/DESIGN.md`](../docs/DESIGN.md); conventions for contributors are in [`AGENTS.md`](AGENTS.md).

## Integrated local development

```bash
cd ../backend
npm install
npm start

# in a second terminal
cd ../frontend
npm install
npm run dev
```

The local dev server defaults to `http://localhost:5175` and proxies `/api` to `http://127.0.0.1:8787`. Set `VITE_API_BASE_URL` only when the API is hosted elsewhere. For local-only identity testing, `VITE_DEV_USER_ID` and `VITE_DEV_USER_NAME` add development headers; they are never production authentication.

## Centralized Azure SSO

Production uses the shared Zsnexos session service rather than browser-managed
access tokens. When `VITE_AUTH_ENABLED` is true (the production default),
the application checks `GET {VITE_AUTH_API_BASE_URL:-/dataverse/apps/api/v1}/auth/session` and
redirects unauthenticated users to its `/login` endpoint. API calls include the
HTTP-only session cookie, and logout calls `POST /auth/logout`.

For local fixture development, SSO is disabled by default. To test the browser
login flow locally, create an untracked `.env.local` containing:

```text
VITE_AZURE_SSO_ENABLED=true
VITE_AUTH_ENABLED=true
VITE_AUTH_API_BASE_URL=/dataverse/apps/api/v1
```

Sandbox uses the existing Dataverse auth path,
`/dataverse/apps/api/v1/auth/*`. In `central-sso` backend mode, configure
`OPS_SSO_SESSION_URL` to its server-to-server session endpoint; NerveCenter
forwards the HTTP-only browser cookie and derives the authenticated user from
the verified response. The browser never receives a NerveCenter internal
credential.

## Cookie session recovery

[SPEC-platform-16](../specs/platform/overview-and-session-recovery.md) adds recovery for cookie-SSO API failures. A 401 causes one shared cookie session check; an authenticated response permits one retry of the original request. An unauthenticated session or a second 401 shows an expiry toast for three seconds before opening the existing app sign-in page. The SSO button retains the original pathname, query and fragment. Toasts also render before protected content mounts. Verification outages offer retry without treating them as logout; API 403, development and platform-auth flows remain separate. JSON requests and SSE connection establishment use the same recovery; direct file URLs retain their cookie authentication.

Automatic renewal is **not implemented**: the deployed development auth service's published API schema was inspected on 2026-10-21 and has no refresh/renewal endpoint or expiry field. Its session endpoint only reports `authenticated` and `user`. No renewal endpoint is guessed, and no renewal timer or session polling is installed. The approved 180-second-before-expiry renewal requires a verified provider contract; see the spec's blocked FR-6. Backend authentication, storage and integration behavior are unchanged.

Overview's section timestamps now appear beside its date-range tabs, retaining their individual values and formatting. Queries, page refresh scheduling, section loading/error states and retries are unchanged.

## Scripts

| Command                         | Purpose                                                          |
| ------------------------------- | ---------------------------------------------------------------- |
| `npm run dev`                 | Vite dev server                                                  |
| `npm run build`               | Production build                                                 |
| `npm run lint`                | ESLint flat config with`--max-warnings=0`                      |
| `npm run typecheck`           | TypeScript verification                                          |
| `npm run test:unit`           | Vitest + React Testing Library                                   |
| `npm run guardrails:check`    | AI branch/test guardrails                                        |
| `npm run governance:docs`     | Docs-update check for policy-relevant changes                    |
| `npm run governance:breakage` | Breakage alert check for high-risk paths                         |
| `npm run quality:check`       | Governance, lint, typecheck, tests, and build                    |

## Architecture

- `src/api/` owns the typed API client, normalized errors, and query keys. Each area keeps its key factory in its API file (`taskKeys` in `tasks.ts`, `boardKeys` in `boards.ts`); shared and cross-area keys are in `queryKeys.ts`. Components never write a key array inline, because refreshes match keys by prefix.
- How long a shared read stays fresh is a named tier in `api/queryPolicy.ts` (`FRESH.live` to `FRESH.session`). A page's own data keeps the default of 0 so opening the page fetches it (SPEC-platform-manual-refresh FR-1); do not add a global `staleTime`.
- TanStack Query owns server state. The API behavior contracts live under `../specs/`, with routes in `../backend/src/api/`.
- `src/store/` is reserved for local UI state only; backend responses must not be copied into Zustand.
- `src/components/ui/` contains shadcn/Radix primitives for generic controls.
- `src/components/ops/` contains OPS-specific table, drawer, dialog, metric, and state components.
- `src/components/layout/` contains the sidebar and topbar shell.
- Every page, inside a project and outside it (Home, New project, Admin), is its own lazy chunk. The Sonic panel body (`AgentPanelBody`, with the thread, composer and markdown) loads the first time the panel opens and stays mounted after; only the pill ships with the shell. Do not import a page or `AgentPanelBody` statically from the shell, or it moves back into the first download.
- Under platform auth (`VITE_AUTH_MODE=platform`) the sign-in check's `/api/me` answer seeds `useMe`, so `/api/me` is fetched once per load. No behaviour or API contract changed.

Page headers schedule their existing Refresh action using the configurable countdown described below. Data Quality reads stored results; page Refresh does not force external source synchronization. Shared shell badges remain snapshots.

## Agent Instructions

Coding tools that understand repo-local agent instructions should read `AGENTS.md` in this folder. It points them to `STYLE_GUIDE.md`, the local guardrail commands, and the component rules for future OPS work.

## Workbench chat

The RCA Workbench uses the real backend session, message, file, lineage, archive, and restore endpoints. It is intentionally incident-specific, not a generic site-wide assistant. Custom Agents, Skills, Workflows, connectors, tools, and OKF v0.2 Markdown knowledge bundles all use the backend registry and knowledge contracts.

## Attaching files to a message

`TaskComposer` with `attachments` takes files from its + button, a drop on the box, or a paste (screenshots). It is on for New task, the task page and the Sonic panel. Allowed types and limits are in `src/features/tasks/attachments.ts` and mirror `backend/src/tasks/attachments.mjs`; the files go up as base64 with the message, land in the task folder under `attachments/`, and show in the message bubble and the Details sheet (SPEC-tasks-11). Word, Excel, PowerPoint and `.vtt` meeting transcripts are allowed too (SPEC-knowledge-03 FR-4).

## Knowledge setup

Owners start it from the Knowledge page ("Set up knowledge", then "Continue setup"). It opens one task per project. The task's side panel opens on the Guide tab (`src/features/tasks/InterviewGuidePanel.tsx`), which reads `GET /api/tasks/:id/interview-guide` and downloads the questions still to ask as Markdown for the meeting (`interviewGuide.ts`). Sonic writes the guide; the page only reads it (SPEC-knowledge-03).

## Guardrails

Install the repository pre-commit hook once in each clone (from any repository subdirectory):

```bash
git config --local core.hooksPath .githooks
```

The root hook runs branch/test guardrails and staged docs/breakage checks for every commit, then runs focused checks for staged backend, frontend, and plugin changes. Run `npm run quality:check` before hand-over for the full frontend suite; CI runs the full backend and frontend checks.

Docs governance accepts changes to `README.md` or `STYLE_GUIDE.md`.

## v2 direction (23 Sep 2026)

The app is being rebuilt as a thin shell over the `operations-fleet` Claude Code plugin. See `../docs/DESIGN.md`.
Task 1 removed Agents, Workflows, AI Curator, Skills builder, Workbench, Approvals, Knowledge, Connectors & Tools and Runs.
Overview, Tickets, Pipelines, Data Quality and Settings (users and roles) remain. Tasks, Inbox, Routines, Skills,
Knowledge and Connectors return as they are rebuilt.

## Manual data refresh (2026-10-13)

SPEC-platform-manual-refresh replaces automatic page polling, event invalidation, focus/reconnect refresh, live task streams and presence heartbeats. Open/navigation/filter actions fetch data; Refresh reloads the active view. User edits update affected visible data once. Notifications retain their separate 15-second poll. The scheduled page refresh amendment below adds a guarded page cadence. Shared badges are snapshots. Sonic continues server-side; use conversation Refresh to read progress. Presence-dependent integration synchronization may become idle; Refresh reads stored data, without forcing external synchronization.

Overview loads tickets, pipelines, data quality, Sonic summaries and work independently through `/api/overview/{tickets,pipelines,data-quality,agent,work}`. Section skeletons cover initial/selection loads; spinners accompany retained data during refresh. Errors preserve previous data for the same selection and have explicit retry. Abort signals cancel obsolete reads. Changes to existing tests for this contract were approved by the user.


## Live task chat (2026-10-14, draft)

The task page follows `GET /api/tasks/:id/events` again (SPEC-platform-manual-refresh FR-7/FR-8 amendment): replies, status and the live draft arrive as the server pushes them, starting after the saved events. Nothing polls the task; a dropped stream reconnects after 2 s, doubling to 30 s. The stream only updates the chat and never refetches other pages. The test that asserted no stream was replaced with stream and reconnect tests, approved by the user in chat.

What the agent is doing now is shown once, in the composer line (`currentActivity`, with the time on this reply); the thread's steps fold only names the steps unless `TaskThread` gets `liveStatus` (the Sonic panel sets it for viewers, who have no composer). Live steps read in the present tense through `liveLabel` ("Running ls", "Running a command" before the input arrives), "Thinking" between steps. Step labels are past tense: turn them into live text with `liveLabel`, never by prefixing them.

## Scheduled page refresh

[SPEC-platform-page-auto-refresh](../specs/platform/page-auto-refresh.md) supersedes the manual-only page cadence. Set public build variable `VITE_AUTO_REFRESH_SECONDS=300` (five minutes). Any nonnegative integer is accepted; `0` keeps pages manual. Missing, empty, negative, fractional or nonnumeric values use 300. Set the variable in the build environment (or `frontend/.env.local` for local development), then rebuild/restart Vite. Production builds also read the tracked root `.env.defaults`. Changing an environment value on an already-built frontend container does not change the embedded interval.

Page Refresh buttons show remaining time and a subtle progress line. Clicking Refresh or finishing a page read starts a full interval. At expiry, the same handler reloads the current page/filter/sort scope. Scheduling waits for reads and mutations, focused fields, unsaved Settings/board/conversation edits, dialogs/menus, hidden tabs, and five seconds without keyboard, pointer or scroll activity. Missed cycles are never replayed. Errors remain visible and the next scheduled attempt waits a full interval. Secondary item/drawer/conversation buttons remain manual. Notification polling stays independent at 15 seconds; source sync settings are unchanged.

The control uses existing Radix tooltip/button primitives, a stable accessible label, no per-second live announcements, and reduced-motion styling. References: [Radix accessibility](https://www.radix-ui.com/primitives/docs/overview/accessibility), [Page Visibility API](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API).
