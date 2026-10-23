-- ADR 0004: boards and data quality configs move out of the shared key/value table into per-project tables.
-- Every board becomes its own row (a board without projectId was PILOT's); `data_quality` is PILOT's config and
-- `data_quality:<id>` another project's. A key it does not know stops the migration, so nothing is dropped
-- unread. Safe to run twice and on a fresh database. The file-store twin is 009-per-project-settings.mjs.
CREATE TABLE IF NOT EXISTS ops_boards (id text PRIMARY KEY, project_id text NOT NULL, data jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS ops_boards_project_idx ON ops_boards (project_id, updated_at DESC);
CREATE TABLE IF NOT EXISTS ops_data_quality_configs (project_id text PRIMARY KEY, data jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
DO $$
DECLARE unknown text;
BEGIN
  IF to_regclass('ops_application_settings') IS NOT NULL THEN
    EXECUTE $q$SELECT string_agg(key, ', ') FROM ops_application_settings WHERE key <> 'boards' AND key <> 'data_quality' AND left(key, 13) <> 'data_quality:'$q$ INTO unknown;
    IF unknown IS NOT NULL THEN RAISE EXCEPTION 'ops_application_settings holds keys migration 009 does not move: %', unknown; END IF;
    EXECUTE $q$INSERT INTO ops_boards(id, project_id, data, updated_at)
      SELECT e.key, COALESCE(NULLIF(e.value->>'projectId', ''), 'pilot'), e.value || jsonb_build_object('projectId', COALESCE(NULLIF(e.value->>'projectId', ''), 'pilot')),
             CASE WHEN e.value->>'updatedAt' ~ '^\d{4}-\d{2}-\d{2}T' THEN (e.value->>'updatedAt')::timestamptz ELSE s.updated_at END
      FROM ops_application_settings s, jsonb_each(s.data) AS e
      WHERE s.key = 'boards' AND jsonb_typeof(s.data) = 'object' AND jsonb_typeof(e.value) = 'object'
      ON CONFLICT (id) DO NOTHING$q$;
    EXECUTE $q$INSERT INTO ops_data_quality_configs(project_id, data, updated_at)
      SELECT CASE WHEN key = 'data_quality' THEN 'pilot' ELSE substr(key, 14) END, data, updated_at
      FROM ops_application_settings WHERE key = 'data_quality' OR left(key, 13) = 'data_quality:'
      ON CONFLICT (project_id) DO NOTHING$q$;
  END IF;
END $$;
DROP TABLE IF EXISTS ops_application_settings;
