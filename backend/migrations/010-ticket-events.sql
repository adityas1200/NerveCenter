-- ADR-0005: a ticket's activity moves out of ops_tickets.data into one row per event, so adding an entry no longer
-- rewrites the whole ticket and two writers cannot lose each other's entry. Forward-only and safe to run twice (once
-- `activity` is gone from data there is nothing to copy). The file-store twin is 010-ticket-events.mjs.
-- Take `pg_dump -t ops_tickets` before deploying: the backfill reads every ticket in this one transaction.
CREATE TABLE IF NOT EXISTS ops_ticket_events (
  ticket_id text NOT NULL REFERENCES ops_tickets(ticket_id) ON DELETE CASCADE,
  seq integer NOT NULL,
  id text NOT NULL,
  at timestamptz NOT NULL,
  type text NOT NULL,
  data jsonb NOT NULL,
  PRIMARY KEY (ticket_id, seq)
);
CREATE INDEX IF NOT EXISTS ops_ticket_events_at_idx ON ops_ticket_events (ticket_id, at DESC);

-- Array order is the order they happened in, so it becomes seq. Entries older than the id/at/type fields get defaults.
INSERT INTO ops_ticket_events (ticket_id, seq, id, at, type, data)
SELECT t.ticket_id, e.seq::integer,
  COALESCE(NULLIF(e.item->>'id', ''), t.ticket_id || '-' || e.seq),
  CASE WHEN e.item->>'at' ~ '^\d{4}-\d{2}-\d{2}T' THEN (e.item->>'at')::timestamptz ELSE t.created_at END,
  COALESCE(NULLIF(e.item->>'type', ''), 'ticket.event'),
  e.item
FROM ops_tickets t
CROSS JOIN LATERAL jsonb_array_elements(t.data->'activity') WITH ORDINALITY AS e(item, seq)
WHERE jsonb_typeof(t.data->'activity') = 'array' AND jsonb_typeof(e.item) = 'object'
ON CONFLICT DO NOTHING;

UPDATE ops_tickets SET data = data - 'activity' WHERE data ? 'activity';
