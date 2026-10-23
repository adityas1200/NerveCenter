-- ADR-0011: durable scheduled work, deduplicated by project/source/slot.
CREATE TABLE IF NOT EXISTS ops_scheduled_jobs (
  id text PRIMARY KEY,
  project_id text NOT NULL,
  source text NOT NULL,
  slot text NOT NULL,
  due_at timestamptz NOT NULL,
  state text NOT NULL CHECK (state IN ('queued', 'running', 'retry', 'succeeded', 'failed', 'skipped')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  result jsonb,
  error text,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts integer NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 3),
  worker_id text,
  lease_token text,
  lease_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  history jsonb NOT NULL DEFAULT '[]'::jsonb,
  UNIQUE (project_id, source, slot),
  CHECK ((state = 'running') = (lease_token IS NOT NULL AND lease_expires_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS ops_scheduled_jobs_due_idx
  ON ops_scheduled_jobs (due_at, created_at, id) WHERE state IN ('queued', 'retry', 'running');
CREATE INDEX IF NOT EXISTS ops_scheduled_jobs_project_active_idx
  ON ops_scheduled_jobs (project_id, lease_expires_at) WHERE state = 'running';
CREATE INDEX IF NOT EXISTS ops_scheduled_jobs_latest_idx
  ON ops_scheduled_jobs (project_id, source, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS ops_scheduled_jobs_history_idx
  ON ops_scheduled_jobs (finished_at, id) WHERE state IN ('succeeded', 'failed', 'skipped');
