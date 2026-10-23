// The permission category of every tool on the nervecenter MCP server (nervecenter-tools.mjs).
// Defining a tool there without an entry here fails at start-up, and the permission gate treats
// an unknown nervecenter tool as a change, never a read. Categories are described in permission-policy.mjs.

import { COMPONENT_TOOLS } from './ui-catalog.mjs';

export const TOOL_CATEGORIES = Object.freeze({
  // Reading the app
  app_overview: 'read', list_tickets: 'read', get_ticket: 'read', list_pipelines: 'read', get_pipeline_runs: 'read', data_quality_results: 'read',
  find_similar_tickets: 'read', list_tasks: 'read', get_task: 'read', get_task_log: 'read', list_approvals: 'read', list_routines: 'read', list_people: 'read', list_connections: 'read', test_connection: 'read',
  // Data on the connected platforms (one read-only SELECT at a time)
  describe_board_data: 'read', query_data: 'read',
  // Knowledge
  search_knowledge: 'read', knowledge_catalog: 'read', update_knowledge: 'knowledge_drafts', sync_knowledge_base: 'default_write',
  // Knowledge setup: the interview guide is a file in the task's own folder (SPEC-knowledge-03 FR-6)
  update_interview_guide: 'task_files',
  // Eval runs and the weekly digest are files in the task's own folder, indexed for the Knowledge page (SPEC-knowledge-06, 07)
  record_eval_run: 'task_files', record_knowledge_digest: 'task_files',
  // Every component in Sonic's catalog only draws in the task and changes nothing.
  ...Object.fromEntries(Object.keys(COMPONENT_TOOLS).map(name => [name, 'read'])),
  // Tickets (set_ticket_status is a ticket write only when it resolves, closes or cancels; see permission-policy.mjs)
  comment_on_ticket: 'default_write', assign_ticket: 'default_write', update_ticket: 'default_write', link_ticket_to_source: 'default_write', link_related_ticket: 'default_write', set_ticket_status: 'ticket_writes', create_ticket: 'ticket_writes',
  // Routines
  save_routine: 'workspace_changes', set_routine_enabled: 'workspace_changes', run_routine: 'default_write',
  // Boards
  list_boards: 'read', get_board: 'read', get_board_widget_data: 'read', list_board_sources: 'read', preview_board_widget: 'read',
  create_board: 'default_write', update_board: 'default_write', publish_board: 'default_write', delete_board: 'workspace_changes',
  // Tested fixes (SPEC-tasks-13): the sandbox tools write only inside the sandbox schema (sql-scope.mts); applying is a production change.
  create_fix_sandbox: 'default_write', run_in_sandbox: 'default_write', drop_fix_sandbox: 'default_write', propose_fix: 'read', apply_fix: 'production_changes',
});

// The permission the acting person needs for a tool, the same as the HTTP route that does the work (rbac.mjs). A
// tool that changes anything and has no entry here needs tasks.manage; reads need nothing.
const TOOL_PERMISSIONS = Object.freeze({
  comment_on_ticket: 'tickets.manage', assign_ticket: 'tickets.manage', update_ticket: 'tickets.manage', link_ticket_to_source: 'tickets.manage', set_ticket_status: 'tickets.manage', create_ticket: 'tickets.manage', link_related_ticket: 'tickets.manage',
  save_routine: 'routines.manage', set_routine_enabled: 'routines.manage', run_routine: 'routines.manage',
  create_board: 'boards.manage', update_board: 'boards.manage', publish_board: 'boards.manage', delete_board: 'boards.manage',
  update_knowledge: 'knowledge.manage', sync_knowledge_base: 'knowledge.manage',
});
export function toolPermission(name) { return TOOL_PERMISSIONS[name] || (TOOL_CATEGORIES[name] === 'read' ? null : 'tasks.manage'); }
