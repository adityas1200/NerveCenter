-- Find earlier tickets with the same failure signature without scanning every ticket.
CREATE INDEX IF NOT EXISTS ops_tickets_signature_idx ON ops_tickets ((data->>'signature')) WHERE data->>'signature' IS NOT NULL;
