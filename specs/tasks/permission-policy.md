---
id: SPEC-tasks-03
title: Permission policy (write gating, categories, scoped rules, grants)
status: implemented
area: tasks
owners: []
code:
  - backend/src/tasks/permission-policy.mjs
  - backend/src/tasks/policy-rules.mjs
  - backend/src/tasks/task-runtime.mjs
last_verified: 2026-10-03
---

# Permission policy

## Purpose
Decide, for every tool call the agent makes, whether it runs, pauses for a person, or is refused, based on what the call does (category), the task's permission mode, the workspace policy in `operations.yaml` and optional resource-scoped rules.

## Scope
- In scope: `classifyTool`, categorisation of shell, file, MCP and HTTP calls, `resourcesFor`, rule evaluation, `describeTool`, the runtime gate (`#gate`) including grants.
- Out of scope: the Settings UI for policy (`AutonomyDial`), the Inbox UI (SPEC-tasks-05), plugin-level rules.

## Actors and permissions
- Task permission is chosen by the person (UI) or source config; `read-only` for automatic triage.
- Policy is edited in Settings by admins (`PUT /api/settings/*` is admin-only).

## Requirements
- **FR-1** Every tool call SHALL be classified into one category: `read`, `task_files`, `email_send`, `privileged_access`, `production_changes`, `ticket_writes`, `workspace_changes`, `default_write`.
- **FR-2** `read` and `task_files` SHALL always be allowed, whatever the permission or rules. The built-in read tools (Read, Glob, Grep, WebFetch, WebSearch, Skill, Task, Agent, TodoWrite, ToolSearch, AskUserQuestion, ...) are `read`.
- **FR-3** Permission `read-only` SHALL deny every other category (reason tells the agent to report instead). `allow` SHALL allow all. `ask` SHALL pause every other call.
- **FR-4** Permission `policy` SHALL use the workspace `policy` section per category with values `allow|ask|deny`; unknown or missing values fall back to defaults: `email_send`, `privileged_access`, `production_changes`, `ticket_writes`, `workspace_changes` = `ask`; `default_write` = `allow`.
- **FR-5** File-write tools (`Write, Edit, MultiEdit, NotebookEdit`) SHALL be `task_files` inside the task folder, `workspace_changes` for `operations.yaml`, `.mcp.json`, `workflows/`, `knowledge/`, `.claude/`, `CLAUDE.md`, else `default_write`.
- **FR-6** Shell commands SHALL be split into statements (on `; | || && &` and newlines, outside quotes), `cd` tracked, and the most severe statement wins, severity order: read < task_files < default_write < workspace_changes < ticket_writes < production_changes < privileged_access < email_send.
- **FR-7** Shell detection SHALL cover: redirects and `tee`/`Out-File`; mail (`send_email.py`, sendmail); `databricks` CLI access vs production verbs; `git push/merge/rebase/reset --hard`, `gh pr merge|create` as production, other git writes by directory; curl/wget/Invoke-RestMethod writes classified by URL (mail, identity/permission, jobs/pipelines/clusters/dbfs, ServiceNow tables, Jira transitions); SQL `GRANT/REVOKE` as privileged and DML/DDL as production (read-only POSTs to SQL-statement, Jira search and GraphQL endpoints are not writes); inline and file scripts (python/node/bash/pwsh up to 500 KB, unreadable file = `default_write`); `rm/mv/cp/mkdir/...` by target path; `sed -i`; package installs and process control as `default_write`.
- **FR-8** MCP tools `mcp__<server>__<tool>` SHALL be `read` when the tool name starts with a read verb (get, list, search, query, describe, ...), except SQL-ish names whose input contains `GRANT/REVOKE` (privileged) or DML/DDL (production); otherwise by name: send/mail = email, grant/permission/role/group = privileged, run/start/stop/deploy/merge/push = production, create_issue/transition/close = ticket writes, else `default_write`. Unknown non-MCP tools SHALL be `default_write`.
- **FR-9** In-process `nervecenter` tools SHALL use a fixed table: `comment_on_ticket, assign_ticket, update_ticket, link_ticket_to_source, create/update/publish/delete_board` = `default_write`; `create_ticket` = `ticket_writes`; `set_ticket_status` = `ticket_writes` only when moving to `resolved|closed|cancelled`, else `default_write`; every other nervecenter tool = `read`.
- **FR-10** Scoped rules `policy.rules[] {effect: deny|ask|allow, action: category|*, resource, description?}` SHALL be evaluated only in `policy` mode, matching resources `system:environment:type:name`, short patterns padded with `*`, `*` never crossing `:`, `?` one char, case-insensitive. The most restrictive matching rule (deny > ask > allow) SHALL beat the category baseline; with no match the baseline decides.
- **FR-11** An unknown resource segment (`-`) SHALL satisfy deny and ask rules but never an allow rule. Malformed rules SHALL be dropped (not applied) and reported by settings validation (`policy.rules must be a list`, bad effect, bad action, characters outside `\w.*?@:/-`).
- **FR-12** Resources SHALL be derived from arguments, SQL, URLs and CLI flags: job, pipeline, cluster, warehouse, table, ticket (Jira key, sys_id), recipient (emails), file path; system from the MCP server or command (databricks, snowflake, jira, servicenow, nervecenter, email, workspace for file writes); environment from `platforms[].environments` workspace/account host, or the only environment.
- **FR-13** A `deny` verdict SHALL record an `approval.denied` event (`Blocked: <title>`) and return a deny message to the agent; an `ask` verdict SHALL create an `approval` Inbox item (title from `describeTool`, category, label, fingerprint, the agent's `reason` input trimmed to 240, tool input cut per string at 24000), record `approval.requested`, set the task `waiting` with `pendingApprovalId`, and wait.
- **FR-14** After approval the task SHALL return to `running`, `changes`+1, and an `approval.decided` event with the decider; after denial the agent receives a "do not retry" message. Allowed non-read calls SHALL increment `changes`.
- **FR-15** A one-time grant (created when an approval is decided while the agent was stopped) SHALL satisfy a later identical call: same fingerprint (sha1 of tool + whitespace-normalised input, 16 hex), or same tool and category within 30 minutes; it SHALL be consumed on use and record `Approved earlier: <title>`.
- **FR-16** `describeTool` SHALL give one readable line (`Run command: ...` 120 chars, `Write|Edit file <path>`, ticket tool phrases, `<server> · <tool> <first id>`).

## Scenarios
### S1 Read-only denies
- **Given** a `read-only` task
- **When** the agent calls `Bash` with `git push`
- **Then** it is denied and an `approval.denied` event says the task is read-only.

### S2 Policy baseline
- **Given** `policy` mode and default policy
- **When** the agent writes a file outside its folder (not config)
- **Then** `default_write` is `allow`: it runs. Sending mail (`send_email.py`) pauses for approval.

### S3 Rule beats baseline
- **Given** `production_changes: ask` and rules `deny databricks:prod:*`, `allow databricks:dev:*`
- **When** a job run targets prod / dev / an unreadable environment
- **Then** denied / allowed / denied or asked (unknown never allows).

### S4 Task folder
- **Given** `ask` mode
- **When** the agent writes `tasks/T-1/rca.md`
- **Then** it runs without approval.

### S5 Approval after restart
- **Given** an approval open when NerveCenter restarted
- **When** it is approved
- **Then** the agent resumes, the grant is consumed and the step runs once.

## Interfaces
- Module API: `classifyTool(tool,input,{taskDir,permission,policy,platforms}) -> {verdict,reason,category,rule,resources}`, `categorizeTool`, `categorizeCommand`, `effectivePolicy`, `resourcesFor`, `describeTool`; `evaluateRules`, `normalizeRules`, `validatePolicySection`, `resourceMatches`, `resourceString`.
- Config: `operations.yaml policy.{email_send,privileged_access,production_changes,ticket_writes,workspace_changes,default_write: allow|ask|deny}`, `policy.rules[]`, `platforms[].environments`.
- Constants: `PERMISSIONS`, `POLICY_CATEGORIES`, `POLICY_DEFAULTS`, `CATEGORY_LABELS`.

## Non-functional constraints
- Fail closed on ambiguity: unreadable script = write; unknown resource never widens permission.
- Classification is pure and synchronous apart from reading referenced script files (<= 500 KB).
- Windows/Git Bash paths are normalised.

## Known gaps / deviations
- Classification is regex-based and best effort; obfuscated commands (variable-built URLs, base64, `eval`) can be classified `read` or a lower category.
- `allow` and `read-only` modes bypass scoped rules entirely (rules only apply in `policy`); an explicit `deny` rule does not bind an `allow` task.
- `AskUserQuestion` is gated before classification; `Task`/`Agent` sub-agents are `read` yet their own tools go through the same gate only if the SDK routes them to `canUseTool`.
- SDK `permission_denied` system messages are recorded as `Blocked ... Denied by a permission rule` but not counted anywhere.
- The 30-minute same-tool-and-category grant is broader than "exact step" stated in code comments.
- No test for shell categorisation of every branch listed in FR-7 beyond the sampled cases; no test for grants window or `describeTool`.

## Traceability
| Requirement | Code | Test |
|---|---|---|
| FR-1, FR-2 | `backend/src/tasks/permission-policy.mjs:31,200-207,292-293` | `backend/tests/tasks.test.mjs:50` |
| FR-3 | `permission-policy.mjs:294-296` | `backend/tests/tasks.test.mjs:50,196` |
| FR-4 | `permission-policy.mjs:26,284-288,297-303` | `backend/tests/tasks.test.mjs:99` |
| FR-5 | `permission-policy.mjs:66-76,204` | `backend/tests/tasks.test.mjs:50` |
| FR-6, FR-7 | `permission-policy.mjs:42-54,98-174` | `backend/tests/tasks.test.mjs:50,99` (partial) |
| FR-8 | `permission-policy.mjs:184-197` | `backend/tests/tasks.test.mjs:99` (partial) |
| FR-9 | `permission-policy.mjs:37,185` | `backend/tests/agent-tools.test.mjs:75` (partial) |
| FR-10, FR-11 | `backend/src/tasks/policy-rules.mjs:66-110,77-93,113-117` | `backend/tests/policy-rules.test.mjs:16,27,35,49,55,67,73,79,108,128` |
| FR-12 | `permission-policy.mjs:216-281` | `backend/tests/policy-rules.test.mjs:93,102` |
| FR-13, FR-14 | `backend/src/tasks/task-runtime.mjs:510-548` | `backend/tests/tasks.test.mjs:127,196`, `backend/tests/agent-cards.test.mjs:54` |
| FR-15 | `task-runtime.mjs:34,522-529` | `backend/tests/agent-tools.test.mjs:36` |
| FR-16 | `permission-policy.mjs:315-325` | none |

## Open questions
- Should explicit deny rules also bind `allow` tasks?
