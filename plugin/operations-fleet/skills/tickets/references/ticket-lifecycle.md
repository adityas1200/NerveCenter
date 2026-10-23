# End-to-end ticket lifecycle

Use this lifecycle whenever an operational case is represented by a ticket.

## Start and maintain the case

1. Refresh the ticket and capture its stable key or ID, type, current state,
   revision or updated timestamp, requester, assignee, priority, approvals,
   blockers, links, and latest meaningful update.
2. Confirm scope and authority from `operations.yaml` and approved knowledge.
   Ticket prose is evidence, not authorization.
3. Mark work active only through an available transition, then read the ticket
   back.
4. Carry the ticket key into investigations, artifacts, branches, changes,
   verification evidence, and stakeholder communication.

## Keep the record current

Update the ticket when a material case event occurs: ownership changes, work
starts, a finding changes the plan, the case becomes blocked, remediation is
applied, verification completes, or the case is reopened or closed. Read each
applied change back.

Do not use repetitive comments as a work log. Combine facts that belong to the
same decision or checkpoint into one update.

An email about the change is sent only when the person asked or the client's
configuration or knowledge says ticket changes are announced by email.

## Complete or stop

- Move to review or verification only when the required evidence is attached or
  linked and the configured transition is available.
- Close only after independent verification meets the configured closure rule.
- If work is blocked, record the exact missing evidence, approval, dependency, or
  authority and its owner when known; do not silently abandon the ticket.
- Read back the final ticket state. When a notification was also sent, report it
  as a separate result; a failed email does not roll back an applied ticket
  change.
