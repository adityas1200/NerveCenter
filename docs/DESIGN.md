# NerveCenter v2 — Design spec

Status: approved 23 Sep 2026, implementation in progress. Owner: Mitesh Shinde. Inputs: two calls with Bhawin (23 Sep), the operations-fleet plugin (vendored in `plugin/operations-fleet`), Claude-desktop-style reference screenshots, the 22 Sep daily-connect feedback, and the clickable mock in `docs/mockup-v2` (serve with the `mockups` launch config on :8099).

UI direction: **keep the current theme, fonts, components and the existing Overview, Tickets, Pipelines and Data Quality screens.** They are good. The reference screenshots and `docs/mockup-v2` are for layout ideas on the new pages (Tasks, Inbox, Routines, Skills, Knowledge, Connectors, Settings), not a restyle. Where the mock uses a serif display font or a different palette, the real app uses the existing NerveCenter tokens instead.

---

## 1. Vision

NerveCenter is a helper application for data-operations teams, in the spirit of Claude or ChatGPT, but for operations work. A business user opens it, sees their tickets, pipelines and data-quality checks, and asks an agent to investigate, fix, report, or automate. Every section shows an agent helping.

Three rules drive everything:

1. **One brain.** Every agent session in the app is a Claude Agent SDK session that loads the `operations-fleet` plugin. The plugin's orchestrator does all the work: triage, RCA, access, fixes, documents, communication, setup help, and routines. The app has no agents, workflows, tool catalogs or prompt builders of its own.
2. **Configuration, not code.** Client-specific behaviour lives in one `operations.yaml`, a set of knowledge bases, and routine files. The app UI edits those files. The agent can edit them too, on request.
3. **Real data only.** Every environment, including local development, talks to real ServiceNow, Jira, Databricks, Snowflake and Git through configured connectors. No demo mode, no fixtures, no fake tickets. A page with no connector configured shows an empty state that points to Connectors.

## 2. What the user sees

### Navigation

```
Operations        AI & Automation     Platform
  Overview          Routines            Connectors
  Tickets           Skills              Settings
  Pipelines         Knowledge
  Data Quality
  Tasks
  Inbox
```

Brand: keep the name NerveCenter and the current theme. Adopt the dashed-circle mark from the reference screenshots as the logo. Follow `frontend/STYLE_GUIDE.md` and the design bar in memory: flat cards, colour only on status and numbers, restrained motion. In-progress items pulse, completed items show a solid dot.

A **New task** button sits at the top of the sidebar (with a keyboard shortcut). It opens the new-task screen: a wide chat box with four suggestion rows ("Show my open tickets", "Investigate a pipeline failure", "Create a weekly operations report", "Request access for a user"). Sending creates an ad-hoc **Task** and opens it.

### Agent panel on every screen

Every page has an agent button in the top bar that slides in a chat panel from the right. This is the agentic story on each screen: the agent can answer questions about what the user is looking at and take actions from there.

- The panel is a Task under the hood. Opening it on a page starts, or continues, an ad-hoc task tagged with that page. The panel shows the same chat, step checklist and approval prompts as the Task detail, just narrower. "Open as task" jumps to the full view.
- Page context goes into the prompt: which page, active filters and time window, and the selected row if any (a ticket key, a pipeline, a DQ check, a connector, a knowledge base, a routine). The agent gets it as a short system note, not as pasted data, and fetches details itself through the connectors.
- Suggested prompts change per page. Tickets: "Which of these should I start with?", "Assign the P1s to me". Pipelines: "Why did this run fail?", "Which pipelines failed more than once this week?". Data Quality: "Explain this failing check". Connectors: "Connect Jira for me". Knowledge: "Add our runbooks repo". Routines: "Set up a daily ticket review at 9". Settings: "Only auto-create tasks for P1 and P2".
- Writes still go through Inbox approvals. Viewers see the panel read-only.
- This replaces the current Ask Ops dock and the person-level assistant chat.
- One shape everywhere (25 Sep): the pill is white with a hairline border and Sonic's mark; every row and record has an "Ask Sonic" action that opens the same panel with that item selected (`useAskSonic`), and "Investigate" on a failed run, check or ticket does the same with a fuller question. The panel's "Sees" line names the selection.

### Sonic shows its work (25 Sep)

The agent's in-process tools include ones that only draw. NerveCenter renders each call as a card in the task, live:

- `propose_plan` / `update_plan`: a numbered checklist before the first change, ticking as steps finish. Adjust it from the card; writes still pause for approval on their own.
- `record_finding`: hypotheses with evidence chips, ruled-out causes greyed, root cause, fix and verification. A turn's findings draw as one investigation card in the thread; "Inconclusive" is a first-class outcome.
- `show_table`, `show_timeline`, `show_comparison`, `show_metrics`: data the reader should see as data. Markdown and Mermaid stay for prose and flows.
- Every write tool carries a one-sentence `reason`, shown next to the change and on its approval.
- Text streams token by token (`includePartialMessages`); the composer's status line says what Sonic is doing right now.

### Sonic asks a question (25 Sep)

When Sonic needs a choice it cannot make, it uses the SDK's question tool (one to four questions, two to four options each). The gate turns that into an Inbox item of kind `question` with the options, a `question.asked` task event, and the task waits (`pendingApprovalId`). The person answers in the task, the panel or the Inbox: options as radios or checkboxes, an "Other" free answer, Skip to decline. `POST /api/inbox/:id/answer` hands the answers back into the tool call so Sonic continues with them; a restart resumes the session with the answers as a message. Legacy questions (a reply ending in "?") are unchanged.

### Editing a sent message (25 Sep)

A message the person already sent can be rewritten in place, the way a chat lets you edit a turn: Edit under the bubble opens a box, Send rewinds the task to that message and Sonic answers the new text. Everything after the message is discarded from the record (`PATCH /api/tasks/:id/messages/:eventId`, `TaskRuntime.editMessage`); a "Message edited" line marks the point. The SDK session cannot forget, so the task gets a fresh session told the conversation up to the edit; the thread shows only the new message. The task's `historyVersion` goes up and every open reader drops its events and reopens the stream. Sonic's real changes are never rewritten out of history: if it made a change after the message (a write tool, an approved step), the edit is refused with a one-sentence reason and the person is told to send a follow-up instead.

### HTML report artifacts (25 Sep)

A result with more than a headline and a few numbers becomes a self-contained HTML report (inline CSS, no scripts, inline SVG charts) written to the task folder and shown with `show_artifact`. The task page renders it inline in a sandboxed iframe in the thread where it was produced, and compact in the panel; Expand opens the file viewer. The template and rules live in `plugin/operations-fleet/skills/orchestrate/references/html-report.md`; the chat reply keeps the headline, the deciding facts and the next actions.

### Who started a task (25 Sep)

Every task says who started it: a person (and the page they were on), automatic triage from a ticket, or a routine. `startedBy(task)` in `frontend/src/api/tasks.ts` derives it from `type`, `createdBy` and `context`.

### Email (25 Sep)

The Email (SMTP) connector (Connectors page) writes `communication.platform: smtp`, the sender and internal domains into `operations.yaml` and gives the agent `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURITY`. The communication skill renders HTML mail with `render_email.py` (tables and inline styles, branded from `operations.yaml` or NerveCenter defaults), previews it, and sends with `send_email.py` after the `email_send` policy is satisfied. Verified 25 Sep end to end against a local SMTP sink: a data-pull task queried Databricks, wrote a CSV, rendered the HTML, paused for approval and sent with the CSV attached. The ZS relay (10.121.0.205:25) was not reachable from the build machine at the time.

Follow-up the same day, after a real send never arrived: the relay is reachable only from some networks, and the agent had spent 57 turns hunting for another route. Three rules now hold. The mail server can come from the deployment environment alone (`EMAIL_NOTIFICATIONS_ENABLED`, `EMAIL_PROVIDER`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USE_TLS`), and the Connectors page shows it as "from environment". **Test** on the Email card opens a real connection and says in one sentence why it failed ("did not answer within 5 seconds from this machine: the network route to the mail server is missing"). `send_email.py` runs the same check before every send (and on demand with `--check`) so an unreachable relay fails in seconds, leaves no ambiguous send record, and the agent's instructions say: report the host, port and error, ask for the network to be fixed, never try another server, port, outbox or sender. Colleagues in the sender's own domain count as internal recipients.

### Message queue (25 Sep)

Typing while Sonic works no longer disappears into a toast. The message joins a queue that the task carries (`task.queue`, pushed with every task update) and the thread shows it under the live activity: a dashed bubble on the reader's side with "Waits for the current step · Edit · Remove · Send now". Edit changes the text in place (Enter saves, Escape cancels), Remove drops it, Send now interrupts the current step (its open approval is withdrawn, a status line says who interrupted) and the same session continues with that message first. Messages run one by one in order when a step ends. The queue lives in the backend's memory, like a chat's outbox: a restart drops it, and the thread shows that by simply not listing it. This is the pattern Claude Code and Codex use, because it lets a person steer without stopping the agent and losing the session.

### Tasks list as a table (25 Sep)

Mitesh: "the task page looks very unstructured, tabularize this so it looks symmetric". The list is one table with fixed columns: state, task (with the failure sentence under the title), type, started by, status, updated, actions. The three groups (Waiting on you, Running, Earlier) are row groups inside that one table, so every column lines up across groups. Type and Started by hide on narrow screens; the title stays the keyboard control and the whole row is clickable.

### Boards (25 Sep)

Dashboards people build with Sonic and publish for the team, at `/boards` (sidebar, right after Overview). A board is a saved spec, not code: title, filters (always a period; optional pick-lists and text), and widgets (metric, table, chart, text; quarter, half or full width). Widget sources are either NerveCenter sources (the same numbers the pages show: pipeline health, runs over time, tickets by priority, failing checks, Sonic activity) or one read-only SELECT on a connected platform with filter values bound as parameters, never spliced into SQL. Developers and admins build and publish; viewers open published boards and use the filters. Drafts are the builder's own; admins see every draft.

Chart widgets pick a kind: column, bar, line, area, donut or pie (`viz.chart`), with optional value labels and a sparkline on metrics. While Sonic works on a board the page polls and animates widgets in, with a "Sonic is building this board" line.

Sonic builds boards from the page ("Build with Sonic", "New board") through `list_board_sources`, `preview_board_widget`, `create_board`, `update_board`, `publish_board`. Widget data comes from `POST /api/boards/:id/data`, cached 45 s per board, widget and filter set; a failing widget shows one plain sentence and never blanks the board. A starter board is seeded once per workspace (`BoardService.ensureStarter`). Backend: `backend/src/boards/board-service.mjs`, `backend/src/api/board-routes.mjs`; frontend: `frontend/src/features/boards/`.

### Notifications and Inbox (25 Sep)

Both stay. The bell is the log of what happened: task and routine outcomes, ticket and pipeline changes, connection problems pinned on top. The Inbox is what needs a decision: approvals and questions. The bell never counts approvals or questions, so the two numbers never disagree.

### Overview

- Stays as it is today: the three panels (Tickets, Pipelines, Data Quality) with the shared time window and clickable numbers. No chat box here.
- Enhancements only: a source filter when more than one ticket platform is configured, and one line under each panel about what the agent did ("Routine 'Check failed pipelines' ran 2h ago, 1 failure triaged").
- Static by default. Admins can later ask the agent to change it. Dynamic dashboards are backlog.

### Tickets, Pipelines, Data Quality

Keep the current screens. Changes:

- Tickets gets a **Source** column and filter (ServiceNow, Jira). Ticket actions (comment, assign, resolve) stay on the ticket, and the "Investigate" button opens or creates the ticket's Task.
- Ticket row shows the task state pill (Not started, Running, Waiting on you, Done).
- Pipelines and Data Quality: "Investigate" on a failed run or check creates an ad-hoc Task with that context.
- Which platforms and which tables feed these pages comes from Settings, not env vars.

### Tasks (was Workbench)

A Task is one agent session with a chat. List view like reference screenshot 2: title, one-line latest summary, relative time, state dot. Search box. Filter by type.

Three task types, same screen:

| Type | Created by | Title | Extra header info |
|---|---|---|---|
| Ticket | Automatically when a ticket enters the configured scope, or by "Investigate" | Ticket key and title | Source, priority, assignee, link to ticket |
| Routine | The scheduler, or "Run now" on a routine | Routine name and run time | Link to routine |
| Ad-hoc | "New task", the agent panel on any page, "Investigate" on a pipeline or DQ item | First message, shortened | Page it started from, if any |

Task detail (reference screenshot 3):

- Header: title, created time, Share, and a menu with **Logs** (admin only).
- Centre: the chat. Agent turns render markdown. While the agent works, its steps show as a compact checklist (skill loaded, tool called, waiting for approval). Finished steps get a solid dot, the current one pulses.
- Artifacts the agent produced (files, drafts, diagrams) appear as cards in the thread and in a right rail. Clicking opens a preview.
- Follow-up box at the bottom. Sending resumes the same SDK session.
- Ticket tasks show ticket actions (Add comment, Assign, Mark resolved) in the header; they call the ticket platform directly, then post a system line into the chat so the agent knows.
- **Logs** (admin): the raw SDK stream for this session: every message, tool call, tool result, tokens, cost per turn, total cost, duration.

Visibility: every user sees every task and its chat. Only members and admins can send messages. Viewers read only.

### Inbox (was Approvals)

Mail-style list. Three item kinds:

- **Approval**: the agent wants to do a write that policy marks `ask`. Shows the exact tool, target and reason. Approve or Deny. Approving resumes the session.
- **Question**: the agent asked the user something and stopped. Reply opens the task with the box focused.
- **Notification**: task finished, routine finished, routine failed, ticket task created.

Unread count on the sidebar. Filter: All, Needs action, Done. Each item links to its task.

### Routines

Reference screenshots 4, 5, 6.

- List: name, schedule in words, state (Running, Last run 2h ago, Next run, Paused), chevron.
- Detail: Run now, Test, Edit, Pause. Schedule and next run, instruction text, connections used, last test result, recent runs (each is a Task).
- Create modal: "What should happen?" text box, schedule pickers (Every weekday / Every day / Weekly / Monthly / Custom cron), time, timezone, "Where should the result appear?" (Tasks, plus Inbox notification toggle). Advanced: permission (Read only / Ask before writes / Allow writes), notify me (on completion / on failure only). Check setup button runs the plugin's workspace check. Test run creates a Task in read-only mode.

### Skills

Read-only. List every skill in the plugin plus custom skills. Click a skill: renders `SKILL.md`, with a file tree of its `references/`, `scripts/`, `assets/`. Nothing else. "Add custom skill" accepts a zip with the normal skill anatomy and extracts it into the workspace's `.claude/skills/<name>/`.

### Knowledge

Multiple knowledge bases. Two source kinds:

- **Git**: repository URL, branch, optional sub-path, token reference. Cloned into `workspace/knowledge/<name>/`. Sync button pulls latest and shows the commit.
- **MCP**: a knowledge MCP server (URL or command). Browsed through the server's list and read tools.

Browser like the MCP5 reference (screenshot 7): left file tree with sizes and search, right pane renders the markdown with frontmatter shown as a metadata block. "Set up with agent" opens an ad-hoc Task pre-filled with "Help me connect a knowledge base".

Knowledge is Sonic's only memory, and it stays OKF Markdown in Git (ADR 0022): no graph database, no vector store. What changed since the first build (20 Oct 2026, SPEC-knowledge-04 to 07, plan in `docs/plans/knowledge-layer.md`):

- **Typed links.** Pages name their relationships in frontmatter (`brands`, `upstream`, `stakeholders`, `vendor`, `sla`, `tier`, ...). The catalog filters on them and returns backlinks; a base has a **Map** view of its pages and links. Live truth (catalog, ontology, schedules) is read through tools, never copied.
- **Write-back stays reviewed.** Sonic drafts; a person keeps or discards. Drafts now say where they came from: a lesson, a person's correction (a "teach moment", saved in the same turn with a "Saved for review" card), an interview, a document, the weekly pass or an eval case.
- **Evals per journey.** Kept eval cases (`evals/<journey>/`) are answered blind and graded; NerveCenter keeps the score history and shows it on the Knowledge page.
- **Weekly pass.** An owner turns on one routine that reviews the week's tasks, stale pages, drift from live systems and the evals, and records a digest for the Knowledge page and the Inbox.

### Connectors

Card view: Databricks, ServiceNow, Atlassian (Jira and Bitbucket), Snowflake, Custom MCP. Each card: state (Not connected, Connected, Error), what it is used for, Configure. Configure form asks the non-secret fields (host, site, project, workspace) and secret fields (token). Secrets go to the secret store and are referenced as `${VAR}` in `operations.yaml`. Custom MCP takes a name and either a URL or a command, like Claude Code's `.mcp.json`.

"Set up with agent" button opens an ad-hoc Task: "I am on the Connectors page and want to connect Jira". The agent uses the plugin's `setup` skill and writes the same files.

### Settings (admin)

- Ticketing: one row per source (platform, connection, scope query that decides which tickets become tasks, auto-create toggle, max concurrent tasks), category field, closure rule. Multiple sources allowed. No free-text conventions field; that kind of guidance belongs in Knowledge.
- Pipelines: which platform and which tables or system views feed the Pipelines page.
- Data Quality: which tables feed the DQ page.
- Policy: default write, production changes, privileged access, ticket close, email send.
- Team: name, timezone, operator.
- Users and roles: existing RBAC (admin, member, viewer).

Everything on this page is a form over `operations.yaml`.

## 3. How it works

### The workspace

One folder on the server. Locally `backend/workspace/` (untracked), in containers a mounted volume synced to S3.

```
workspace/
├── operations.yaml         # the only config file; Settings and Connectors edit it
├── CLAUDE.md               # copied from plugin example, rarely changes
├── .mcp.json               # generated from operations.yaml connections
├── .claude/skills/         # custom skills uploaded as zip
├── knowledge/<name>/       # one folder per Git knowledge base
├── workflows/<name>.yaml   # routines
└── tasks/<taskId>/         # per-task working folder: artifacts the agent writes
```

This is exactly the plugin's own client-workspace layout, so the plugin's `setup`, `workflow` and `knowledge` skills and our UI read and write the same files.

### Starting a session

Every Task is one SDK session:

```js
query({
  prompt,
  options: {
    cwd: `${workspace}/tasks/${taskId}`,
    plugins: [{ type: 'local', path: PLUGIN_DIR }],
    settingSources: ['project'],
    systemPrompt: { type: 'preset', preset: 'claude_code', append: orchestratorPrompt + taskContext },
    mcpServers: fromMcpJson(workspace),
    permissionMode: 'default',
    canUseTool: approvalGate(taskId),
    resume: task.sessionId,          // on follow-ups
    includePartialMessages: true,
    env: secretsAsEnv(),
  }
})
```

Tested on 23 Sep with SDK 0.3.223: the plugin loads, all 14 skills register as `operations-fleet:<skill>`, and the orchestrator registers as a subagent. The `agent` option did not switch the main thread to it, so we put the orchestrator's prompt into the system prompt append. Same effect. Task context appended per type: ticket fields for ticket tasks, the routine instruction and policy for routine tasks, the page the user came from for ad-hoc tasks.

Each message from the SDK stream is stored as an event on the task and pushed to the browser over SSE. The `result` message gives cost, tokens and duration for the Logs view.

### Approvals

`canUseTool` fires when the SDK wants to run a tool that has no allow rule. Our gate:

1. Reads are auto-allowed (MCP read tools, Read, Glob, Grep, WebFetch, WebSearch).
2. Writes create an Inbox approval item, mark the task "Waiting on you", and hold the promise.
3. When a user approves or denies in Inbox, the promise resolves and the session continues.
4. Routine tasks in read-only mode deny writes outright.

The plugin's own rules (confirm target, read back, verify) still apply on top.

### Ticket to task flow

1. The ticket poller (already exists) fetches tickets matching the Settings scope from each configured source.
2. New ticket in scope: create a Ticket Task, start a session with the prompt "Triage this ticket. Read-only. Summarise what it is, likely cause, what you would do, and what approval you need." Post an Inbox notification.
3. The task's first agent turn becomes the one-line summary on the ticket row and the Tasks list.
4. User opens the task, chats, approves writes. Ticket actions in the header hit the platform directly.
5. The scheduler caps concurrent sessions and honours the scope filter so a big queue does not spawn a session storm.

### Routines

A routine is `workflows/<name>.yaml` in the plugin's workflow format plus a `schedule` block and app fields:

```yaml
name: daily-ticket-review
objective: Review my assigned Jira tickets, group by type, flag blockers and SLA risk, say what to start next.
trigger: { type: schedule, timezone: Asia/Kolkata, expression: "0 9 * * 1-5" }
authority: { writes: denied }
app: { result: tasks, notify: on_complete, enabled: true, created_by: mitesh }
```

The backend scheduler (a small in-process cron, replacing `scheduler.mjs`) checks every minute, starts a Routine Task with the objective as prompt, and posts an Inbox notification on completion or failure. "Test run" does the same once with writes denied. The agent's `workflow` skill writes the same file when a user says "save this as a routine".

### Storage

| Data | Local | Deployed |
|---|---|---|
| Tasks, events, inbox, routines index, RBAC | JSON files under `backend/data/runtime/` | Postgres (keep existing store code) |
| Workspace folder | `backend/workspace/` | Volume, synced to S3 on change and restored on boot |
| Task artifacts | `workspace/tasks/<id>/` | Same, synced to S3 |
| SDK session transcripts | SDK default, under the runtime dir | Same volume |
| Secrets | `.env` | AWS Secrets Manager (keep existing) |

Removed: SQS worker and `OPS_RUN_DISPATCH`, the file-intake MCP container, the registry-custom volume.

Cost note: the workspace is small (config, markdown, a few generated files per task). Disk cost is negligible. The point of S3 and Postgres is survival across container restarts, not size.

### Roles

Existing RBAC stays. Admin: everything, including Settings, Connectors, Logs, cost. Member: create tasks, chat, approve. Viewer: read everything, no chat, no approvals. These limits are enforced by the API (each route declares the permission it needs; an undeclared write is admin-only), not only hidden in the UI.

### Local development

Same as deployed, just file storage instead of Postgres and S3. Mitesh configures real Databricks, Jira, Git and other targets through Connectors. `OPS_LOCAL_DEMO`, the fixtures folder and the demo seed scripts are deleted.

## 4. What gets deleted

Frontend (`frontend/src`):
- `features/agents`, `features/workflows`, `features/optimus`, `features/runs`, `features/skills` (rebuilt read-only in task 9), `features/platform/RegistryPrimitives.tsx`, `features/workbench` and `features/approvals` (replaced by Tasks and Inbox in tasks 4 and 5), `features/knowledge` and `features/connectors` (rebuilt in tasks 8 and 9). `features/admin` stays until task 8 folds it into Settings.
- `components/ops`: LineageDialog, TriageSteps, CaseOutcomePanel, RichArtifactContent, OpsAgentChat, AssistantDock, AgentJourney (replaced by the Task chat), MonitorEditorDialog if unused.
- Ticket detail loses the agent-journey, RCA and classification blocks; task 6 adds the task-state pill and "Investigate" instead.
- `api/optimus.ts`, registry and workflow calls, most of `api/types.ts`.
- `lib/agentJourney`, `lib/governedOperation`, `lib/caseOutcomeText`.
- Playwright specs for removed pages.

Backend (`backend/src`):
- `optimus/`, `runtime/` (compiler, graph executor, policy engine, tool gateway, prompt builder, mock runtime), `registry/`, `skills/skill-service.mjs`, `work-items/`, `sales/`, `triggers/` (replaced by the scheduler), `dispatch/`, `worker.mjs`, `scheduler.mjs`.
- `mcp/servers/*` and `mcp/services/*` (all 14 in-repo MCP servers), `mcp/file-intake/`, `mcp/tool-sync-service.mjs`, connector OAuth manager.
- `app/`: incident, orchestration and RCA workflow services, classification, handoff, capability gap. `application-service.mjs` shrinks to tickets, overview and monitor reads.
- `api/server.mjs`: all `/api/registry`, `/api/workflows`, `/api/runs`, `/api/optimus`, `/api/work-items`, `/api/tools`, `/api/skills/drafts`, `/api/knowledge/{proposals,sources,bundles}`, `/api/file-intake`, `/api/orchestration`, `/api/catalog` routes.
- `backend/data/registry/`, `backend/data/skills/`, `backend/data/knowledge/`, `backend/data/fixtures/`, `backend/contracts/`, most of `backend/scripts/` including the demo seed scripts, and every `OPS_LOCAL_DEMO` branch.
- Tests for all of the above.

Repo:
- `deploy/docker-compose.yml`: drop the file-intake service. `buildspec.yml` and `Dockerfile` updated for the plugin folder.
- `.env.defaults`: remove SQS, file-intake, workflow IDs, sales mode, and the committed JWT and secret key values.

What we keep and reuse: HTTP server skeleton and auth, RBAC, ticket clients (ServiceNow, and Jira to add), Databricks and Snowflake read services, monitors, data-quality readers, overview aggregation, Postgres and S3 stores, secret store, SSE helper, the frontend shell, UI primitives, table and chart components, TanStack Query setup.

## 5. Backend API after the change

```
GET  /api/me, /api/health, /api/overview, /api/notifications
GET  /api/tickets, /api/tickets/:id, POST /api/tickets/:id/{comment,assign,resolve}
GET  /api/pipelines, /api/pipelines/:id/runs, GET /api/data-quality
GET  /api/tasks, POST /api/tasks, GET /api/tasks/:id, GET /api/tasks/:id/events (SSE)
POST /api/tasks/:id/messages, POST /api/tasks/:id/cancel, GET /api/tasks/:id/logs (admin)
GET  /api/inbox, POST /api/inbox/:id/{approve,deny,read}
GET  /api/routines, POST /api/routines, PATCH /api/routines/:id, POST /api/routines/:id/{run,test,pause,resume,check}
GET  /api/skills, GET /api/skills/:id/tree, GET /api/skills/:id/file?path=, POST /api/skills/upload
GET  /api/knowledge, POST /api/knowledge, DELETE /api/knowledge/:id, POST /api/knowledge/:id/sync
GET  /api/knowledge/:id/tree, GET /api/knowledge/:id/file?path=
GET  /api/connectors, PUT /api/connectors/:id, POST /api/connectors/:id/test, DELETE /api/connectors/:id
GET  /api/settings, PUT /api/settings/:section
GET  /api/admin/users, PUT /api/admin/users/:id
```

The workspace module owns reading and writing `operations.yaml`, `.mcp.json`, `workflows/`, `knowledge/` and `.claude/skills/`. Connectors, Settings, Routines, Knowledge and Skills endpoints are thin wrappers over it.

## 6. Tasks

Order matters: each step leaves the app running.

| # | Task | Done when |
|---|---|---|
| 1 | **Delete.** Remove everything in section 4. Fix imports. Sidebar shows Overview, Tickets, Pipelines, Data Quality and Settings only until later tasks add pages back. **Done 23 Sep.** Backend went from 117 to 27 source files; frontend from 137 to 83. Ticket activity now lives on the ticket record instead of a workbench session. Priority governance (P1/P2 needed approval evidence) was dropped: the source's priority is the priority. | `npm run quality:check` passes in frontend, `node --test` passes in backend, app boots and Overview, Tickets, Pipelines, DQ still render. |
| 2 | **Workspace module.** Read and write `operations.yaml`, render `.mcp.json`, list knowledge bases, routines, custom skills. Local `backend/workspace/` seeded from the plugin template. **Done 23 Sep.** `backend/src/workspace/workspace.mjs`; created at boot; `GET /api/settings` and `PUT /api/settings/:section` (admin) are live. Section edits keep the template's comments. Knowledge bases are folders under `knowledge/` with a generated root `index.md` so the plugin's index-first lookup spans all of them. | Unit tests for read, write, render. |
| 3 | **Session runtime.** `startTask`, `sendMessage`, `cancel`. Streams SDK messages to an event store and SSE. Approval gate with a pending-promise map. Cost and usage captured. **Done 24 Sep.** `backend/src/tasks/` (store, permission policy, runtime) and `backend/src/api/task-routes.mjs`. The orchestrator prompt is appended to the `claude_code` preset; cwd is the workspace root so `operations.yaml`, `.mcp.json`, `CLAUDE.md`, knowledge and custom skills load through `settingSources: ['project']`. Task permission is `read-only`, `ask` (default) or `allow`. Reads and writes inside `tasks/<id>/` pass; other writes become Inbox approvals; a reply ending in a question becomes an Inbox question and parks the task in `waiting`. Messages sent while the agent works are queued. Concurrency cap via `OPS_MAX_CONCURRENT_TASKS` (default 3). | An ad-hoc task started from a curl call streams events and returns a result. |
| 4 | **Tasks UI and agent panel.** Task list and detail per section 2. Chat, step checklist, artifact cards, follow-up, Logs for admin. The slide-in agent panel on every page with page context and per-page suggestions. **Done 24 Sep.** `frontend/src/features/tasks/` (list, detail, New task, thread, composer, live SSE hook) and `components/ops/AgentPanel.tsx`. Steps fold into "Working · n of m steps" with a pulsing dot while live; approvals render inline with Approve and Deny; the right rail shows ticket or routine context, files written, skills used, tool calls, and cost for admins. The panel remembers one task per page in session storage and passes page name, path, filters and selection as context. Ctrl+K opens New task, Ctrl+J toggles the panel. | Ask "which of these should I start with?" from the Tickets page panel and watch it work end to end. |
| 5 | **Inbox.** Approval, question and notification items. Approve resumes the session. Sidebar unread count. **Done 24 Sep.** `frontend/src/features/inbox/`. Filters All, Needs action, Done; Mark all read; approvals show the tool's key inputs and decide inline; questions link into the task. The sidebar badge counts approvals and questions still pending. The old Approvals route redirects here, and the Overview tile "Waiting on you" points here. | A write in a task pauses, appears in Inbox, approve continues it. |
| 6 | **Ticket tasks.** Poller creates tasks for in-scope tickets with a concurrency cap. Ticket row shows task state. Header actions comment, assign, resolve through the platform. **Done 24 Sep.** `backend/src/tasks/ticket-tasks.mjs`. Sources come from `ticketing.app.sources[]` in `operations.yaml` (platform, filters, `auto_create_tasks`, `max_concurrent_tasks`, `permission`); the plugin's own `ticketing` block stays the primary mapping. Automatic triage runs read-only; "Investigate" from the ticket runs ask-before-writes. Task status and the agent's one-line summary are mirrored onto the ticket (`taskId`, `taskStatus`, `agentSummary`) and into its activity. Ticket edits post a status line into the task. Header actions on a ticket task update the NerveCenter ticket record; write-back into ServiceNow or Jira is the agent's job through its MCP connection. Poll interval `OPS_TICKET_POLL_SECONDS` (default 60), `OPS_TICKET_POLLING=0` disables. | New in-scope ticket gets a triage summary within a minute. |
| 7 | **Routines.** Scheduler, list, detail, create modal, run now, test, pause, check setup. **Done 24 Sep.** `backend/src/routines/` (five-field cron matcher with timezone support, scheduler that ticks every 30 s and remembers the fired minute) and `frontend/src/features/routines/`. A routine is `workflows/<name>.yaml` in the plugin's format plus an `app` block (title, enabled, notify, connections). `authority.writes: denied` maps to a read-only task, `allowed` to allow, anything else to ask. Test runs are always read-only and never notify. Check setup verifies the schedule, named connections, team settings and plugin skills locally. | A routine set for the next minute creates a Routine Task and an Inbox notification. |
| 8 | **Connectors and Settings.** Card view and forms over `operations.yaml`. Secrets to the secret store. "Set up with agent" opens a task. Jira added as a second ticket source. **Done 24 Sep.** One form connects a system for both the agent (MCP entry in `connections` with `${VAR}` references, secrets under `connectors/<id>/<ENV>` in the secret store, injected as env per session) and the data pages (managed connection profile). Custom MCP servers take a name plus URL or command. Settings tabs: Team, Ticketing (sources table under `ticketing.app.sources`, category field, closure rule; no conventions field), Pipelines (`platforms`), Data Quality (result table summary, opens the DQ dialog), Policy, Users & roles. Jira: `jira` connection provider, `/api/integrations/jira/{status,preview,sync}`, Sync menu on Tickets, Source = Jira on rows and detail. | Connecting Jira through the form makes tickets appear with Source = Jira. |
| 9 | **Skills and Knowledge.** Read-only skill browser, zip upload. Knowledge list, Git clone and sync, MCP browse, file tree and markdown view. **Done 24 Sep.** Skills: plugin skills plus `.claude/skills/<name>` uploads (zip with one `SKILL.md`, admin), shared read-only file browser with sizes, search and frontmatter block. Knowledge: Git bases cloned into `knowledge/<name>` with the `git` CLI (shallow clone, fetch and reset on sync, token in the secret store passed as a per-command auth header), local folders listed as they are, root `knowledge/index.md` rewritten on every change, MCP knowledge source picked from Connectors into `knowledge.connection`. Routes `/api/skills*`, `/api/knowledge*`. Containers need `git` (task 11). | Plugin skills visible; a Git repo added and synced shows its files. |
| 10 | **New task screen, Overview lines and brand.** New task button and screen with suggestions, agent lines under each Overview panel, new mark in the sidebar. **Done 24 Sep.** New task button and screen landed with task 4. Each Overview panel now ends with one agent line built from the task list (ticket tasks for Tickets; ad-hoc and routine tasks matched to Pipelines or Data Quality by the page they started from or their wording), live work pulses, the link opens the filtered task list. Brand: dashed-circle mark as an inline SVG (`BrandMark`) in the sidebar and as the SVG favicon; the rest of the Overview is untouched. **Updated 24 Sep:** mark replaced by the blue-to-violet loop logo (`public/nervecenter-logo.svg` in the sidebar, `public/nervecenter-favicon.svg` as the favicon; old `favicon.ico` and `nervecenter-mark.svg` removed). | New task from the sidebar creates and opens an ad-hoc task; Overview unchanged otherwise. |
| 11 | **Deploy and docs.** Compose, Dockerfile, buildspec, env defaults, README for frontend and backend, `frontend/AGENTS.md` rewritten. S3 workspace sync. **Done 24 Sep (code and docs; container boot not exercised here).** Compose is two services again (file-intake, registry volume and the old runtime/worker flags are gone); the backend image copies `plugin/operations-fleet`, installs `git`, `python3` and `uv` for the MCP servers Connectors configures, and mounts a workspace volume. `workspace/workspace-sync.mjs` restores the workspace from `s3://<bucket>/<prefix>/workspace/` before boot and pushes changes every minute (skips `.git` folders). Postgres task events now take their sequence number in the insert (the old `FOR UPDATE` on an aggregate always fell back). `deploy/.env.example`, `deploy/README.md`, `backend/README.md` and `frontend/README.md` describe the new shape. Still to prove on a real host: image build, S3 restore, one ticket task end to end. | Container boots, workspace restored from S3, one full ticket task runs. |

### Numbers that add up, and a word for each (25 Sep)

Mitesh read the Overview and could not make the pipeline tiles agree: 9 pipelines, 7 healthy, 1 failed, 0 overdue,
"2 fixed with Sonic". The ninth was paused and had no tile; the 2 were tickets closed with Sonic's help, a different
thing from pipelines. Rules now:

- The four tiles of a panel count one thing and, where they say "of N", add up to N. Pipelines: Succeeded (latest run
  fine, or running now), Failed, Missed (a scheduled run did not start; nothing failed), Paused. Tickets: Open, High
  priority open, Waiting on you, Resolved in the period. Data quality: Passed, Warnings, Failed (of the checks run) and
  Open data quality tickets. A pipeline that never ran is named in the panel's meta line rather than hidden.
- The agent's credit is tickets, so "Fixed with Sonic" moved out of the tiles into the agent line under each panel, as a
  linked figure with its own suffix ("2 of 7 resolved", "2 tickets in the last 7 days"), and stays in the chart legend.
- "Healthy" became "Succeeded" and "Overdue" became "Missed" everywhere a business user reads them: Overview, Pipelines
  tiles and rows, board widgets. Old links with `status=Healthy` or `status=Overdue` still work.
- Every tile has a small info mark whose tooltip says in one sentence what the number counts. The words live next to the
  tiles (`HINT` in OverviewPage, `HEALTH_HINT` in MonitorPage, `HINT` in DataQualityPage); keep them one sentence, no
  system states.

### The ticket panel shows the result, not a second Investigate (25 Sep)

A ticket with a finished task still offered "Investigate" as its main button, and its summary was cut at 160
characters. The task now keeps a `report` (the reply's opening paragraphs, up to 700 characters, `reportFrom`), mirrored
to the ticket as `agentReport` with `taskFinishedAt`; `agent` on a ticket carries `report`, `finishedAt` and `changes`.
The panel reads: What Sonic found, the report (folded at six lines), "Finished 21h ago · 0 changes made", then
**Open task** (primary), **Look again** (sends "look at this ticket again" to the same task; "Try again" after a
failure) and **Ask Sonic**. Only a ticket without a task shows **Investigate**.

### Data quality columns follow the result table (25 Sep)

The table showed a Rule column that was empty for a result table with no rule column. Optional columns (Dataset, Rule,
Failed rows) appear when a result table maps them or the rows carry a value (`resultColumns`); Last run is always
shown. The detail sheet hides the same blocks. Adding a rule column to the mapping brings the column back.

### The Result tab as a report (25 Sep, replaced 11 Oct)

Replaced by the one-thread task page below; kept for the history.


The Result tab was one run of markdown on a grey page. It is now cards: the outcome (status, headline, lead, and a facts
row: confidence, changes, turns, time, finished), one card per section of the reply in the agent's order, tables with a
tinted header row, "What to do next" as numbered steps, then files. A finished ticket task with no recorded findings no
longer shows an empty Investigation tab; a task still running or waiting keeps it so findings land in view.

### One conversation and Sonic's component catalog (11 Oct)

The task page had four views of one piece of work (Result, Journey, Investigation, Conversation), a phase strip and a seven-tab rail. It is now one conversation (SPEC-tasks-10, ADR 0009; research in `docs/research/generative-ui.md`, mock in `docs/mockup-task/`):

- Under the title, one outcome line: Sonic's latest `set_outcome` (state, headline, up to five facts), what it is doing while it runs, or "Waiting for your approval" with a jump to the prompt.
- Each turn: the fold ("Worked for 2m · 11 steps · Databricks"), then, once the turn is done, its answer in one bold sentence, the components Sonic drew in order, then the rest of the reply. Approvals sit in the turn; after `explain_action` they lead with Sonic's plain summary and keep the exact command behind "Show command".
- Sonic answers data with components from a catalog defined once in `backend/src/tasks/ui-catalog.mjs`: charts, facts, status grids, progress, flows, set diffs, checklists, records, email drafts, documents, notes, actions, forms (`request_input`), data-bound ticket and run cards, and `show_view` to compose up to 12 of them into one stakeholder view. The model sends data; the app owns the components. Nothing it sends runs as script or HTML.
- People act from components: an action, a checklist item or a grid cell sends a message as the reader, so every write still goes through approval. Suggested questions sit as chips above the composer.
- Adding a component is one catalog entry: the tool, its validation, the `show_view` block and the prompt line follow from it. Until the page has a renderer, the new kind still reads as a card of its facts, lists and tables. A skill package uses the catalog through `skills/orchestrate/references/reply-format.md`.
- Files, changes, skills, knowledge, context and session facts moved to a Details sheet.

## 7. Out of scope for now

Agent-written interactive HTML (composed views cover agent-built dashboards). Tool-level permissions and governance UI. Knowledge write-back without a person's review. Multi-tenant workspaces. Cost budgets per user. Mobile layout.

## 8. Open items

Verified end to end on 24 Sep 2026 against local fake platforms (Databricks, ServiceNow, Jira and a mail/docs/identity
service, all untracked under `local/`): setup through the agent, connector save + test, knowledge clone + sync, ticket
import and automatic triage, every plugin skill including a custom uploaded one, approvals in the Inbox, routines and
an agent-written workflow file. Fixes that came out of it: plain-HTTP loopback targets are accepted, a `file` secret
store keeps credentials across restarts, the permission gate understands PowerShell and multi-statement read-only
commands (POST-based reads such as SQL statements, redirects into the task folder), tool inputs stay valid JSON for the
Inbox, mid-flight tasks resume once after a restart, a follow-up message can widen a triage task's permission, ticket
sources without auto-create still import, tickets closed in the source close here, agent drafts block a knowledge sync
until reviewed, and the Databricks and ServiceNow MCP package names were corrected.

- Two backends on the same workspace and runtime files corrupt each other (approvals are resolved in the owning process,
  pollers double up, restart recovery mislabels the other's tasks). Run exactly one backend per workspace; document this
  for anyone starting a verify copy.
- Frontend follow-ups from the new API fields: knowledge cards get `pendingChanges` (agent drafts awaiting a commit), connector
  cards get `connectionKind` (api, cli, native) with a matching Test result, task follow-ups accept `permission`.
- Databricks token in the local environment returns 403. Mitesh will configure a working target; until then the local Pipelines and DQ pages show the empty state unless the fakes are running.
- Task 11 is done in code and docs but not proven on a host: build the backend image, boot against Postgres and S3, confirm the workspace restores, run one ticket task end to end.
- Jira import is tested against the Jira Cloud `search/jql` shape with unit fixtures only; the first real connection should confirm status and priority mapping for the client's workflow names.
- Custom skills and knowledge bases uploaded in the UI reach the agent on its next session; there is no live reload of a running task.
