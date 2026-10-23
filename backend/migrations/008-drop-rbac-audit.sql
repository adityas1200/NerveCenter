-- ADR 0003: the RBAC audit log is removed. Its one non-audit row, the `rbac-file-import` marker that keeps the
-- image's user file from being imported into Postgres again (which would bring back deleted users), moves to
-- ops_rbac_meta first. Safe to run twice and on a fresh database. The file-store twin is 008-drop-rbac-audit.mjs.
CREATE TABLE IF NOT EXISTS ops_rbac_meta (key text PRIMARY KEY, at timestamptz NOT NULL);
DO $$ BEGIN
  IF to_regclass('ops_rbac_audit') IS NOT NULL THEN
    EXECUTE $q$INSERT INTO ops_rbac_meta(key, at) SELECT id, at FROM ops_rbac_audit WHERE id = 'rbac-file-import' ON CONFLICT (key) DO NOTHING$q$;
  END IF;
END $$;
DROP TABLE IF EXISTS ops_rbac_audit;
