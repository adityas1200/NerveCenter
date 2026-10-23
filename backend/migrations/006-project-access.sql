-- SPEC-projects-03 FR-23: project roles become owner, developer and viewer, and projects gain `open` and `color`. Safe to run twice.
-- `admin` becomes `owner`; `member` becomes `viewer` for someone stored as an app viewer, `developer` for everyone else, so
-- nobody gains or loses a right they had. The file-store twin is 006-project-access.mjs.
ALTER TABLE ops_projects ADD COLUMN IF NOT EXISTS open boolean NOT NULL DEFAULT false;
ALTER TABLE ops_projects ADD COLUMN IF NOT EXISTS color text NULL;
ALTER TABLE ops_project_members DROP CONSTRAINT IF EXISTS ops_project_members_role_check;
UPDATE ops_project_members SET role = 'owner' WHERE role = 'admin';
DO $$ BEGIN
  IF to_regclass('ops_rbac_users') IS NOT NULL THEN
    EXECUTE $q$UPDATE ops_project_members m SET role = CASE WHEN EXISTS (SELECT 1 FROM ops_rbac_users u WHERE lower(u.id) = lower(m.user_id) AND u.data->>'role' = 'viewer') THEN 'viewer' ELSE 'developer' END WHERE m.role = 'member'$q$;
  ELSE
    UPDATE ops_project_members SET role = 'developer' WHERE role = 'member';
  END IF;
END $$;
ALTER TABLE ops_project_members ALTER COLUMN role SET DEFAULT 'developer';
ALTER TABLE ops_project_members ADD CONSTRAINT ops_project_members_role_check CHECK (role IN ('owner', 'developer', 'viewer'));
CREATE INDEX IF NOT EXISTS ops_project_members_owner_idx ON ops_project_members (project_id) WHERE role = 'owner';
