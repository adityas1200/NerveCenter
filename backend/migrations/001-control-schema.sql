-- Base Postgres schema that later numbered migrations extend. IF NOT EXISTS lets databases
-- created by the former boot-time DDL record this baseline without rewriting data or sequences.
CREATE SEQUENCE IF NOT EXISTS ops_ticket_seq START 1001;
CREATE TABLE IF NOT EXISTS ops_tickets (
  ticket_id text PRIMARY KEY,
  pipeline_id text,
  run_id text,
  source_key text,
  status text NOT NULL,
  data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ops_tickets_status_idx ON ops_tickets(status, updated_at DESC);

CREATE SEQUENCE IF NOT EXISTS ops_task_seq START 1001;
CREATE TABLE IF NOT EXISTS ops_tasks (
  id text PRIMARY KEY,
  type text NOT NULL,
  status text NOT NULL,
  data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ops_tasks_status_idx ON ops_tasks(status, updated_at DESC);

CREATE TABLE IF NOT EXISTS ops_task_events (
  task_id text NOT NULL REFERENCES ops_tasks(id) ON DELETE CASCADE,
  seq integer NOT NULL,
  id text NOT NULL,
  at timestamptz NOT NULL,
  type text NOT NULL,
  data jsonb NOT NULL,
  PRIMARY KEY (task_id, seq)
);

CREATE TABLE IF NOT EXISTS ops_inbox (
  id text PRIMARY KEY,
  task_id text,
  kind text NOT NULL,
  status text NOT NULL,
  data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ops_inbox_status_idx ON ops_inbox(status, created_at DESC);

CREATE TABLE IF NOT EXISTS ops_rbac_users (
  id text PRIMARY KEY,
  data jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ops_secrets (
  ref text PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
