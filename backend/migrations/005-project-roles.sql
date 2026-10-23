-- SPEC-projects-02 FR-1, FR-23: project roles and project-wide ticket visibility. Safe to run twice.
-- The file-store twin is 005-project-roles.mjs.
ALTER TABLE ops_project_members ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'member';
DO $$ BEGIN
  ALTER TABLE ops_project_members ADD CONSTRAINT ops_project_members_role_check CHECK (role IN ('admin', 'member'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
UPDATE ops_tickets SET data = jsonb_set(data, '{visibility}', '"project"') WHERE data->>'visibility' = 'operators';
