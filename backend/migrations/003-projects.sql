-- SPEC-projects-01 phase 1 (FR-1..FR-3, FR-15, FR-41): projects, members and grants, and project_id on
-- tickets, tasks and inbox items. Safe to run twice: every statement is guarded or a no-op on a second pass.
-- The file-store twin is 003-projects.mjs.

CREATE TABLE IF NOT EXISTS ops_projects (
  id text PRIMARY KEY CHECK (id ~ '^[a-z0-9][a-z0-9-]{1,31}$'),
  name text NOT NULL,
  slug text NOT NULL,
  description text NOT NULL DEFAULT '',
  kind text NOT NULL DEFAULT 'normal' CHECK (kind IN ('normal', 'unrouted')),
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL DEFAULT 'system'
);
CREATE UNIQUE INDEX IF NOT EXISTS ops_projects_name_unique ON ops_projects (lower(name));

CREATE TABLE IF NOT EXISTS ops_project_members (
  project_id text NOT NULL REFERENCES ops_projects(id),
  user_id text NOT NULL,
  added_at timestamptz NOT NULL DEFAULT now(),
  added_by text NOT NULL DEFAULT 'system',
  PRIMARY KEY (project_id, user_id)
);
CREATE INDEX IF NOT EXISTS ops_project_members_user_idx ON ops_project_members (lower(user_id));

CREATE TABLE IF NOT EXISTS ops_project_grants (
  project_id text NOT NULL REFERENCES ops_projects(id),
  resource_type text NOT NULL CHECK (resource_type IN ('connection', 'knowledge', 'skill')),
  resource_id text NOT NULL,
  scope jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, resource_type, resource_id)
);

-- Unrouted is reserved. PILOT exists only when records from the old single-workspace layout need it (FR-51).
INSERT INTO ops_projects (id, name, slug, description, kind, created_by) VALUES
  ('unrouted', 'Unrouted', 'unrouted', 'Imported items that match no project yet. Admins only.', 'unrouted', 'migration')
ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE has_legacy_settings boolean := false;
DECLARE has_legacy_profiles boolean := false;
BEGIN
  IF to_regclass('ops_application_settings') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM ops_application_settings WHERE (key = ''boards'' AND data <> ''{}''::jsonb) OR key = ''data_quality'')' INTO has_legacy_settings;
  END IF;
  IF to_regclass('ops_connection_profiles') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM ops_connection_profiles)' INTO has_legacy_profiles;
  END IF;
  IF EXISTS (SELECT 1 FROM ops_tickets)
    OR EXISTS (SELECT 1 FROM ops_tasks)
    OR EXISTS (SELECT 1 FROM ops_inbox)
    OR has_legacy_settings OR has_legacy_profiles THEN
    INSERT INTO ops_projects (id, name, slug, description, kind, created_by) VALUES
      ('pilot', 'PILOT', 'pilot', 'The workspace that existed before projects.', 'normal', 'migration')
    ON CONFLICT (id) DO NOTHING;
  END IF;
END $$;

-- Tickets, tasks and inbox items: add, backfill PILOT (column and the copy inside the record), then require it.
ALTER TABLE ops_tickets ADD COLUMN IF NOT EXISTS project_id text;
UPDATE ops_tickets SET project_id = 'pilot', data = jsonb_set(data, '{projectId}', '"pilot"') WHERE project_id IS NULL;
ALTER TABLE ops_tickets ALTER COLUMN project_id SET NOT NULL;

ALTER TABLE ops_tasks ADD COLUMN IF NOT EXISTS project_id text;
UPDATE ops_tasks SET project_id = 'pilot', data = jsonb_set(data, '{projectId}', '"pilot"') WHERE project_id IS NULL;
ALTER TABLE ops_tasks ALTER COLUMN project_id SET NOT NULL;

ALTER TABLE ops_inbox ADD COLUMN IF NOT EXISTS project_id text;
UPDATE ops_inbox SET project_id = 'pilot', data = jsonb_set(data, '{projectId}', '"pilot"') WHERE project_id IS NULL;
ALTER TABLE ops_inbox ALTER COLUMN project_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ops_tickets_project_fk') THEN
    ALTER TABLE ops_tickets ADD CONSTRAINT ops_tickets_project_fk FOREIGN KEY (project_id) REFERENCES ops_projects(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ops_tasks_project_fk') THEN
    ALTER TABLE ops_tasks ADD CONSTRAINT ops_tasks_project_fk FOREIGN KEY (project_id) REFERENCES ops_projects(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ops_inbox_project_fk') THEN
    ALTER TABLE ops_inbox ADD CONSTRAINT ops_inbox_project_fk FOREIGN KEY (project_id) REFERENCES ops_projects(id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS ops_tickets_project_idx ON ops_tickets (project_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS ops_tasks_project_idx ON ops_tasks (project_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS ops_inbox_project_idx ON ops_inbox (project_id, status, updated_at DESC);

-- Boards live as one blob in application settings; each board record gets projectId (FR-15, FR-41).
-- ADR 0004: ensureControlSchema no longer creates that table and migration 009 drops it, so a fresh database
-- has none; the guard skips the update there. Databases that ran this before are unaffected.
DO $$ BEGIN
  IF to_regclass('ops_application_settings') IS NOT NULL THEN
    EXECUTE $q$UPDATE ops_application_settings
    SET data = COALESCE((
      SELECT jsonb_object_agg(e.key, CASE WHEN jsonb_typeof(e.value) = 'object' AND NOT (e.value ? 'projectId') THEN e.value || '{"projectId":"pilot"}'::jsonb ELSE e.value END)
      FROM jsonb_each(data) AS e
    ), '{}'::jsonb)
    WHERE key = 'boards' AND jsonb_typeof(data) = 'object'$q$;
  END IF;
END $$;
