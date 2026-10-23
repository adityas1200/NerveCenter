-- ADR-0017: one automatic triage Task per project/ticket across concurrent workers.
CREATE UNIQUE INDEX IF NOT EXISTS ops_tasks_ticket_triage_key_uq
  ON ops_tasks (project_id, ((data #>> '{context,ticket,autoTriageKey}')))
  WHERE (data #>> '{context,ticket,autoTriageKey}') IS NOT NULL;
