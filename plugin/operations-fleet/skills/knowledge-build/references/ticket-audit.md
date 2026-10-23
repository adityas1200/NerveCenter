# Ticket audit

Past tickets show how the team really works: which failures recur, how they get fixed, and where the fix differs from what is written down. Audit them to draft known issues and to find the questions worth asking.

## Read the export

Read a spreadsheet export with Python and openpyxl (or the CSV reader), not the document extraction, so no rows are cut. Find the columns for id, created and resolved dates, category, short description, resolution notes, assignee or resolver, and the affected system or job. Say which columns were missing.

Keep the rows in the task folder. Never copy a ticket body, a customer name, or a person's details into knowledge.

## Before and after a migration

When the history spans a platform migration, split it at the cut-over date first. Tickets from before it describe the old system: use them for which journeys matter, which brands and stakeholders ask most, and failure patterns that could still happen, and mark anything drafted from them `era: legacy`. Never draft a runbook step from a pre-migration fix unless a live system shows the same job and step still exist. Ask the team for the cut-over date when no document gives it.

## Group by problem

Group resolved tickets by what went wrong, not by their category label: the affected job or system plus a normalised symptom or error signature. Two "daily load failed" tickets with different causes are two groups. Rank groups by how often they happened and by impact (priority, data consumers, SLA breaches).

## Judge each group

For the biggest groups, check the resolution against the knowledge and the evidence you can reach: a commit near the resolution date, the job's run history, a configuration change, the runbook for that job.

| Verdict | Signs | What to do |
|---|---|---|
| Follows the runbook | The fix matches a written procedure | Nothing, or add the ticket ids to the known issue's "Seen in" |
| Not covered | No page covers the symptom, cause, or fix | Draft a known issue from what is clear; ask about the rest |
| Deviates from the SOP | The fix skips or changes a written step | Ask why, and flag the deviation for the SOP's owner |
| Looks off | Manual data patch, rerun with no cause recorded, hardcoded value, a fix that recurs | Ask the people who resolve that area what it was and whether it is the usual way |

Call a fix "off" only with evidence. When unsure, ask; do not label.

## Who asks, and eval cases

Count who raised the resolved tickets by role and by brand or market. The few roles that raise most of the work, and the vague asks they make ("refresh the Brand X numbers"), become `requests/` pages and stakeholder pages with their `tier`.

Turn the clearest resolved tickets into eval cases: up to 10 for each top journey, chosen across different causes. Each case keeps the ask as the person wrote it and, separately, what was actually done. Save them with origin `eval`; the owner keeps the ones that are fair tests.

## From audit to questions

- Ask about a group, not every ticket: one question per group, naming one or two example tickets.
- Prefer groups that recur or hurt. A one-off with a clear resolution needs no question.
- Offer what the evidence suggests as options, and accept "don't remember":

```text
INC-4821 and INC-5017 (sales load, March and May): both were fixed by rerunning after about two hours,
with no cause recorded. What was it?
a) the upstream file arrived late   b) the cluster ran out of memory   c) a manual fix in sales_stg
d) something else                    e) don't remember
```

- Word it as learning, never blame: "help us understand how this was fixed", not "this broke the SOP". A deviation goes to the SOP's owner, not back at the person who fixed it.
