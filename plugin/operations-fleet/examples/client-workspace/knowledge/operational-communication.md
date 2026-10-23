---
type: Guideline
title: Operational communication
description: Example tone, layout, and sending rules for operational email and updates.
status: stable
---

# Operational communication

- Lead with current state and impact.
- Distinguish started, applied, and verified.
- Use absolute timestamps with the team time zone for incidents.
- Keep routine ticket updates concise and link to detailed evidence.

## Email by message type

| Message | Recipients | Layout |
|---|---|---|
| Incident update | the ticket's caller and `operations_team` | status, summary, impact, what happens next; no attachments |
| Weekly report | `weekly_stakeholders` | status, four metrics, top incidents table, links to the published deck and workbook |
| Data extract | the requester only | summary totals, checks passed, the CSV attached or linked |

Sign emails as "Data Operations". Subjects start with the ticket number when there is one.

## Sending

Mail goes through the `microsoft` connection's send tool as `dataops@example.com`. Preview every message and wait for approval. External recipients are never allowed.
