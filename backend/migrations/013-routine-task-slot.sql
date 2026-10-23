-- ADR-0015: a routine's scheduled slot can create at most one Task per project.
CREATE UNIQUE INDEX IF NOT EXISTS ops_tasks_routine_slot_uq
  ON ops_tasks (project_id, ((data #>> '{context,routine,scheduledJobKey}')))
  WHERE (data #>> '{context,routine,scheduledJobKey}') IS NOT NULL;
