---
name: workflow
description: Turn a repeated operations outcome into a small reusable or scheduled workflow (a routine). Use for morning reviews, weekly reports, recurring checks, ticket routines, access reviews, release updates, and other tasks that should run with consistent scope and authority, and to change, pause, resume, or test-run an existing one.
metadata:
  category: modular
---

# Create a reusable workflow

A workflow describes the outcome and boundaries. It is not a hard-coded sequence of agents.

## When the host offers routine tools

When the host offers `save_routine`, use it instead of writing a workflow file by hand: `list_routines` first so you change rather than duplicate, then `save_routine` with a name, the objective in plain words (the instruction each run follows), the schedule, the permission each run gets (read-only unless the person asked for changes), who is told, and the connections it relies on. Test with `run_routine` and `test: true`, which runs read-only and changes nothing. Pause or resume with `set_routine_enabled`. Give the person the routine link.

## Method

1. Capture the outcome in the user's language and link it to systems and aliases already defined in `operations.yaml`.
2. Record the trigger, timezone, parameters that may change, and exact scope.
3. State allowed reads and writes, approval-controlled actions, and actions that are always denied. An unattended run cannot answer questions in chat; anything that needs approval must pause at the host's approval gate or be left out.
4. Define observable success, skip conditions, failure behavior, retry limit, who is told, and evidence or artifacts to preserve.
5. Keep credentials, raw client knowledge, and provider secrets out of the workflow.
6. Let the orchestrator choose skills from current evidence on every run. When the client wants a scenario to follow a consistent path, write it as a knowledge `Playbook` for the orchestrator to consult, not as a pinned order in the workflow.
7. Run the workflow manually or as a test run first. Confirm useful output, correct routing, safe failure behavior, and idempotency before scheduling.
8. Without host routine tools, use the host's approved scheduler and record service identity, locking, missed-run behavior, and how to disable it. Use `research` to confirm version-sensitive scheduler syntax or limits.

## Minimal shape

`uses` lists the connections the workflow relies on (names under `connections` in `operations.yaml`). It does not name skills or an order.

```yaml
name: weekly-operations-report
objective: Create and review the weekly report and prepare stakeholder communication.
trigger:
  type: schedule
  timezone: UTC
  expression: "0 16 * * 5"
uses: [jira, databricks, email]
parameters:
  ticket_view: weekly-team-work
authority:
  publish: ask
  email_send: ask
success:
  - report reconciles to its sources
  - communication uses the reviewed files
on_failure:
  notify: operations-team
  retry: 1
```

A host may add its own block (for example `app:` with title, enabled, notify, and connections); keep it as the host wrote it.

Read [workflow design](references/workflow-design.md).
