-- SPEC-projects-01 phase 2 (FR-25, FR-32, FR-41): a ticket belongs to the connection it was imported through, so the same
-- source key can exist once per connection; existing connection profiles become PILOT's grants. Safe to run twice.
-- The file-store twin is 004-ticket-connection.mjs.

-- The profiles table is normally created by the profile store; a fresh database has not opened it yet.
CREATE TABLE IF NOT EXISTS ops_connection_profiles (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE ops_tickets ADD COLUMN IF NOT EXISTS connection_id text;

-- Backfill from the default profile of the ticket's provider (the one a read picked before projects: the flagged default,
-- else the first enabled profile by name). Manual, GitHub and unknown sources have no connection: ''.
UPDATE ops_tickets t
SET connection_id = COALESCE((
  SELECT p.id FROM ops_connection_profiles p
  WHERE p.provider = t.data->>'source' AND COALESCE(p.data->>'enabled', 'true') <> 'false'
  ORDER BY (p.data->>'isDefault') = 'true' DESC, p.data->>'name', p.id LIMIT 1
), '')
WHERE t.connection_id IS NULL;
UPDATE ops_tickets SET data = jsonb_set(data, '{connectionId}', to_jsonb(connection_id)) WHERE NOT (data ? 'connectionId');
ALTER TABLE ops_tickets ALTER COLUMN connection_id SET DEFAULT '';
ALTER TABLE ops_tickets ALTER COLUMN connection_id SET NOT NULL;

-- Idempotency is per connection now. The old global constraint and index are what the boot-time schema used to create.
ALTER TABLE ops_tickets DROP CONSTRAINT IF EXISTS ops_tickets_pipeline_id_run_id_key;
DROP INDEX IF EXISTS ops_tickets_source_key_unique;
CREATE UNIQUE INDEX IF NOT EXISTS ops_tickets_connection_source_key_unique ON ops_tickets (connection_id, source_key) WHERE source_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ops_tickets_connection_run_unique ON ops_tickets (connection_id, pipeline_id, run_id);

-- Every existing connection profile is PILOT's, with no scope filter; the profile a provider read used stays its default.
INSERT INTO ops_project_grants (project_id, resource_type, resource_id, scope, is_default)
SELECT 'pilot', 'connection', x.id, '{}'::jsonb, x.first AND x.enabled
FROM (
  SELECT p.id, COALESCE(p.data->>'enabled', 'true') <> 'false' AS enabled,
         ROW_NUMBER() OVER (PARTITION BY p.provider ORDER BY (COALESCE(p.data->>'enabled', 'true') <> 'false') DESC, (p.data->>'isDefault') = 'true' DESC, p.data->>'name', p.id) = 1 AS first
  FROM ops_connection_profiles p
) x
ON CONFLICT (project_id, resource_type, resource_id) DO NOTHING;
