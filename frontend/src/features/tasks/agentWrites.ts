import type { QueryKey } from "@tanstack/react-query";

/**
 * Which screens a change by Sonic touches, so they refresh the moment the change lands instead of on
 * their next poll. Keyed by the nervecenter tool name (backend/src/tasks/nervecenter-tool-categories.mjs);
 * reads and cards are absent because they change nothing.
 */
const TICKETS: QueryKey[] = [["tickets"], ["overview"], ["monitor"], ["data-quality"]];
const AFFECTS: Record<string, QueryKey[]> = {
  comment_on_ticket: TICKETS, assign_ticket: TICKETS, set_ticket_status: TICKETS, update_ticket: TICKETS, create_ticket: TICKETS, link_ticket_to_source: TICKETS,
  save_routine: [["routines"]], set_routine_enabled: [["routines"]], run_routine: [["routines"], ["tasks"]],
  create_board: [["boards"]], update_board: [["boards"]], publish_board: [["boards"]], delete_board: [["boards"]],
  update_knowledge: [["knowledge"]], sync_knowledge_base: [["knowledge"]],
  test_connection: [["connectors"]],
};

/** The query keys to refresh after a successful call of `toolName` (mcp__nervecenter__<name>), or none. */
export function queriesTouchedBy(toolName: string | undefined): QueryKey[] {
  const match = /^mcp__nervecenter__(.+)$/.exec(String(toolName || ""));
  return match ? AFFECTS[match[1]] ?? [] : [];
}
