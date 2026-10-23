# 0005. Ticket activity in its own table

- Status: accepted
- Date: 2026-10-06
- Related: specs/tickets/, specs/platform/storage-migrations.md, ADR 0001

## Context
- A ticket's `activity[]` lives inside its row (`ops_tickets.data`, or the ticket in `application-state.json`). Every new entry goes through `appendActivity`, which reads the ticket and writes the whole record back (`updateTicket` in Postgres).
- Activity only grows: each sync adds a `ticket.synced` entry (`operations-service.mjs`, the ServiceNow and Jira sync paths), and comments, task runs, routing and links add more. Tickets that sync often and live long get bigger, and every write to them gets slower. Two writers at once can also lose one entry (read, append, write back).
- Lists carry the whole history: `listTickets` returns full rows, so `GET /api/tickets` sends every ticket's activity to the browser, which does not use it (the detail panel reads `GET /api/tickets/:id/activity`).
- Task events already solved this: `ops_task_events (task_id, seq, id, at, type, data)`, one row per event, seq assigned by the insert, retried on a key clash (`backend/src/tasks/task-store.mjs`).
- `links[]` also lives in the row but is small, rarely written and needed by every list (recurrence badge). The owner decided to keep it there.

## Decision
1. Migration `backend/migrations/010-ticket-events.sql`:
   - `ops_ticket_events (ticket_id text NOT NULL REFERENCES ops_tickets(ticket_id) ON DELETE CASCADE, seq integer NOT NULL, id text NOT NULL, at timestamptz NOT NULL, type text NOT NULL, data jsonb NOT NULL, PRIMARY KEY (ticket_id, seq))`, plus an index on `(ticket_id, at DESC)` for the feed.
   - Backfill each ticket's `data->'activity'` in array order (seq 1..n). A missing `id` gets `<ticketId>-<seq>`, a missing or invalid `at` the ticket's `created_at`, a missing `type` `ticket.event`. Then remove `activity` from `data`. One transaction; safe to run twice (once `activity` is gone there is nothing to copy) and on a fresh database.
2. File-store twin `010-ticket-events.mjs`: each ticket's `activity` moves to `ticket-events/<ticketId>.json` under the runtime dir (the task store's layout), then leaves the ticket. A rerun after a crash between the two steps does not copy twice.
3. Store (`operations-store.mjs`, both stores):
   - `appendActivity(id, events)` inserts rows (seq as in task events, retried on a clash), moves the ticket's `updatedAt` as today, and never rewrites the activity. It returns the ticket as `getTicket` does.
   - Every ticket read carries `activity`: its latest 500 events, oldest first, as today's shape. That holds for `getTicket(id)` and, by the owner's decision of 2026-10-06, for lists too (`listTickets`, `findTicketsBySignature`, the source-key and source-ref finders). A list loads its tickets' events in one query (a per-ticket window of 500 over `ticket_id = ANY(...)`), never one query per ticket.
   - `createTicket` stores a new ticket's starting `activity` as events; re-importing an existing ticket keeps its events, as `mergeExisting` keeps its activity today. `updateTicket` rejects a patch that carries `activity`.
   - New `listActivity(ticketIds, { types, since, limit })`: one bounded query (default 2000, cap 10000, newest first) for readers that span tickets.
4. Service: the feed, similar-ticket comments and "resolved by" read through `listActivity` for the tickets they already have; `ticketActivity` (`GET /api/tickets/:id/activity`) returns the latest 1000.
5. `links[]` stays in the row, unchanged.

## Alternatives considered
- Links in the events table too: rejected by the owner. Links are current state that every list needs; deriving them from a log would make each list query the log.
- A separate `ops_ticket_links` table: rejected by the owner for now. Links are small and rarely written.
- Cap `activity[]` in the row: rejected. History is lost, and every write still rewrites a large array.

## Consequences
- Adding activity costs one insert plus a small ticket update, whatever the ticket's age; concurrent appends no longer lose entries.
- Response shapes do not change: lists and single tickets still carry `activity`, now capped at each ticket's latest 500 entries (the activity endpoint returns the latest 1000). List reads cost about what they do today; the gain is on writes. Shrinking list payloads was considered and declined by the owner.
- The backfill runs in one transaction while the app starts; a large `ops_tickets` makes that start slower once. Take `pg_dump -t ops_tickets` before deploying.
- Tests: new tests for the migration (order, defaults, run twice), concurrent appends, list responses with activity loaded in one query, the bound, and the cross-ticket readers. Existing tests that read `getTicket(...).activity` should pass unchanged; any that need editing get `AI_TEST_CHANGE_ACK=ack`.
- Rollback: forward-only. To go back, revert the code and add a migration that folds the events back into `data.activity`.
- Numbering: `zs-sandbox` already has ADR 0002 and migration 007; ADR 0003/0004 and migrations 008/009 are kept for the RBAC-audit and per-project-settings branches, so this is 0005 and 010.
