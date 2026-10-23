-- ADR-0002, SPEC-automations-01: the per-project ledger the background fetch writes and the pages read (pipeline runs and
-- data-quality results), the alerts the detector opens, the occurrences it has already acted on, and fetch state.
-- Forward-only and safe to run twice. The file-store twin is 007-monitoring-ledger.mjs.
CREATE TABLE IF NOT EXISTS ops_pipeline_runs (
  project_id text NOT NULL,
  platform text NOT NULL,
  pipeline_id text NOT NULL,
  run_id text NOT NULL,
  status text,
  start_time timestamptz,
  data jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, platform, pipeline_id, run_id)
);
CREATE INDEX IF NOT EXISTS ops_pipeline_runs_time_idx ON ops_pipeline_runs (project_id, start_time DESC);
CREATE INDEX IF NOT EXISTS ops_pipeline_runs_pipeline_idx ON ops_pipeline_runs (project_id, pipeline_id, start_time DESC);

CREATE TABLE IF NOT EXISTS ops_dq_results (
  project_id text NOT NULL,
  result_key text NOT NULL,
  table_id text,
  status text,
  severity text,
  executed_at timestamptz,
  data jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, result_key)
);
CREATE INDEX IF NOT EXISTS ops_dq_results_time_idx ON ops_dq_results (project_id, executed_at DESC);

CREATE TABLE IF NOT EXISTS ops_alerts (
  id text PRIMARY KEY,
  project_id text NOT NULL,
  alert_key text NOT NULL,
  status text NOT NULL,
  trigger text NOT NULL,
  subject_id text,
  task_id text,
  ticket_id text,
  data jsonb NOT NULL,
  opened_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- One open alert per key per project, across every instance.
CREATE UNIQUE INDEX IF NOT EXISTS ops_alerts_open_key_idx ON ops_alerts (project_id, alert_key) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS ops_alerts_project_idx ON ops_alerts (project_id, opened_at DESC);
CREATE INDEX IF NOT EXISTS ops_alerts_task_idx ON ops_alerts (task_id);

-- An occurrence (a failed run, a missed slot, a failed check) is acted on once, ever: the insert is the claim.
CREATE TABLE IF NOT EXISTS ops_alert_occurrences (
  project_id text NOT NULL,
  occurrence_key text NOT NULL,
  at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, occurrence_key)
);

CREATE TABLE IF NOT EXISTS ops_monitor_state (
  project_id text NOT NULL,
  state_key text NOT NULL,
  data jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, state_key)
);
