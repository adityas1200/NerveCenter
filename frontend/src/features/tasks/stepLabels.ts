import type { TaskEvent } from "@/api/tasks";
import type { Activity } from "@/components/ops/ActivityOrb";
import { platformLabel } from "@/lib/platform";
import { safeParse } from "./taskEvents";
import { toolMeta } from "./tools";

/**
 * Plain-words labels for the agent's tool calls, shared by the thread, the composer status line and
 * the "What Sonic did" list. Pure, so it can be tested without rendering.
 */

export const NERVECENTER_PREFIX = "mcp__nervecenter__";
/** NerveCenter tools that change something; each carries a `reason` the reader sees next to the change. */
export const NERVECENTER_WRITE_TOOLS = new Set(["comment_on_ticket", "assign_ticket", "set_ticket_status", "create_ticket", "link_ticket_to_source", "update_ticket", "update_knowledge", "save_routine", "set_routine_enabled", "run_routine", "sync_knowledge_base", "create_board", "update_board", "publish_board", "delete_board", "apply_fix"]);
/** NerveCenter tools that only draw: rendered as cards, never as folded steps. */
export const CARD_TOOLS = new Set(["show_table", "show_timeline", "show_comparison", "show_metrics", "show_pull_request", "show_artifact", "show_lineage", "show_change"]);

/** The system an MCP tool belongs to, in its product name: mcp__databricks__run_query → Databricks. */
/** Every NerveCenter tool with its own step label, for tests that check each one. */
export const NERVECENTER_STEP_TOOLS = (): readonly string[] => Object.keys(NERVECENTER_STEP);

export function systemName(toolName: string): string | null {
  if (!toolName.startsWith("mcp__")) return null;
  const raw = toolName.split("__")[1] || "";
  const key = raw.toLowerCase().replace(/[-_ ]?(mcp|server)$/, "");
  return platformLabel(key) || (raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : null);
}

export const nervecenterTool = (name?: string | null): string | null => (name && name.startsWith(NERVECENTER_PREFIX) ? name.slice(NERVECENTER_PREFIX.length) : null);
export const isNervecenterWrite = (name?: string | null): boolean => { const tool = nervecenterTool(name); return Boolean(tool && NERVECENTER_WRITE_TOOLS.has(tool)); };

const humanise = (value: string) => value.replace(/[_-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
const str = (value: unknown, fallback = "") => (value === undefined || value === null || value === "" ? fallback : String(value));

const NERVECENTER_STEP: Record<string, (input: Record<string, unknown> | null) => string> = {
  app_overview: () => "Looked at the NerveCenter overview",
  list_tickets: (input) => `Looked up ${input?.status && input.status !== "active" ? `${String(input.status).replace(/_/g, " ")} ` : ""}tickets${input?.text ? ` about ${String(input.text)}` : ""}${input?.assignee ? ` for ${String(input.assignee)}` : ""}`,
  get_ticket: (input) => `Opened ticket ${str(input?.ticketId)}`.trim(),
  list_pipelines: (input) => `Looked up ${input?.status && input.status !== "all" ? `${String(input.status)} ` : ""}pipelines`,
  get_pipeline_runs: (input) => `Read runs of ${str(input?.pipelineId, "a pipeline")}`,
  data_quality_results: () => "Read data quality results",
  list_tasks: () => "Looked up tasks",
  get_task: (input) => `Opened task ${str(input?.taskId)}`.trim(),
  list_approvals: () => "Checked what is waiting on people",
  list_routines: () => "Looked up routines",
  list_people: () => "Looked up people",
  search_knowledge: (input) => `Searched knowledge${input?.query ? ` for ${String(input.query)}` : ""}`,
  knowledge_catalog: () => "Read the knowledge map",
  update_knowledge: (input) => knowledgeStepLabel(input),
  propose_plan: (input) => `Proposed a plan${input?.title ? `: ${String(input.title)}` : ""}`,
  update_plan: (input) => `Marked a plan step ${str(input?.state, "updated")}`,
  record_finding: (input) => FINDING_LABEL[String(input?.kind || "")] || "Recorded a finding",
  show_table: (input) => `Showed a table${input?.title ? `: ${String(input.title)}` : ""}`,
  show_timeline: (input) => `Showed a timeline${input?.title ? `: ${String(input.title)}` : ""}`,
  show_comparison: (input) => `Showed a comparison${input?.title ? `: ${String(input.title)}` : ""}`,
  show_metrics: () => "Showed key numbers",
  show_pull_request: (input) => `Opened pull request${typeof input?.number === "number" ? ` #${input.number}` : ""}${input?.title ? `: ${String(input.title)}` : ""}`,
  show_artifact: (input) => `Showed ${str(input?.title) || (input?.path ? String(input.path).split(/[\\/]/).pop() : "") || "an artifact"}`,
  comment_on_ticket: (input) => `Commented on ${str(input?.ticketId, "a ticket")}`,
  assign_ticket: (input) => `Assigned ${str(input?.ticketId, "a ticket")} to ${str(input?.assignee, "someone")}`,
  set_ticket_status: (input) => (input?.status ? `Set ${str(input?.ticketId, "a ticket")} to ${str(input.status).replace(/_/g, " ")}` : `Set the status of ${str(input?.ticketId, "a ticket")}`),
  update_ticket: (input) => `Updated ${str(input?.ticketId, "a ticket")}`,
  create_ticket: (input) => `Created ticket${input?.title ? `: ${String(input.title)}` : ""}`,
  link_ticket_to_source: (input) => `Linked ${str(input?.ticketId, "a ticket")} to ${input?.system === "servicenow" ? "ServiceNow" : input?.system === "jira" ? "Jira" : "its source"}${input?.number ? ` ${String(input.number)}` : ""}`,
  query_data: (input) => `Queried ${queriedTables(input?.statement) || "data"}${input?.purpose ? ` · ${String(input.purpose)}` : ""}`,
  describe_board_data: (input) => `Looked up ${input?.table ? `the columns of ${String(input.table)}` : "tables"}`,
  show_lineage: (input) => `Showed lineage${input?.title ? `: ${String(input.title)}` : ""}`,
  show_change: (input) => `Showed a change${input?.title ? `: ${String(input.title)}` : ""}`,
  save_routine: (input) => { const name = str(input?.title) || str(input?.name); return name ? `Saved routine ${name}` : "Saved a routine"; },
  set_routine_enabled: (input) => `${input?.enabled === false ? "Paused" : "Resumed"} ${input?.name ? `routine ${str(input.name)}` : "a routine"}`,
  run_routine: (input) => `Started ${input?.name ? `routine ${str(input.name)}` : "a routine"}${input?.test ? " as a test run" : ""}`,
  list_connections: () => "Checked the connections",
  test_connection: (input) => (input?.id ? `Tested the ${str(input.id)} connection` : "Tested a connection"),
  sync_knowledge_base: (input) => (input?.base ? `Synced knowledge base ${str(input.base)}` : "Synced a knowledge base"),
  list_boards: () => "Looked up boards",
  get_board: (input) => `Opened board ${str(input?.board)}`.trim(),
  create_board: (input) => `Created board${input?.title ? `: ${String(input.title)}` : ""}`,
  update_board: (input) => `Updated board ${str(input?.board)}`.trim(),
  publish_board: (input) => `${input?.published === false ? "Unpublished" : "Published"} ${input?.board ? `board ${str(input.board)}` : "a board"}`,
  delete_board: (input) => (input?.board ? `Deleted board ${str(input.board)}` : "Deleted a board"),
  get_board_widget_data: (input) => `Read widget ${str(input?.widget)} on board ${str(input?.board)}`.replace(/\s+/g, " ").trim(),
  create_fix_sandbox: (input) => `Copied ${str(input?.table, "a table")} into the fix sandbox`,
  run_in_sandbox: (input) => `Ran on the sandbox copy${input?.purpose ? `: ${String(input.purpose)}` : ""}`,
  drop_fix_sandbox: (input) => `Dropped the sandbox copy ${str(input?.sandbox)}`.trim(),
  propose_fix: (input) => `Proposed a tested fix${input?.title ? `: ${String(input.title)}` : ""}`,
  apply_fix: (input) => `Applied tested fix ${str(input?.proposalId)}`.trim(),
};

/** "gold.sales, ref.territory": the tables a SELECT reads, for labels (mirrors tablesIn in nervecenter-tools.mts). */
export function queriedTables(statement: unknown): string {
  const names = new Set<string>();
  for (const match of String(statement || "").replace(/--[^\n]*|\/\*[\s\S]*?\*\//g, " ").matchAll(/\b(?:FROM|JOIN)\s+([`"[]?[\w$-]+[`"\]]?(?:\.[`"[]?[\w$-]+[`"\]]?){0,2})/gi)) {
    const name = match[1].replace(/[`"[\]]/g, "");
    if (!/^(?:select|lateral|unnest|values)$/i.test(name)) names.add(name);
  }
  return [...names].join(", ");
}

/** "Known issues › Pipelines" from `known-issues/pipelines.md`: the page's place in its base, in words. */
export const knowledgePlace = (value: unknown): string => String(value || "").replace(/\.md$/i, "").split("/").filter(Boolean).map((part) => { const words = part.replace(/[-_]+/g, " ").trim(); return words.charAt(0).toUpperCase() + words.slice(1); }).join(" › ");

/** The lesson-capture step: what was added, updated, or why nothing was. */
export function knowledgeStepLabel(input: Record<string, unknown> | null): string {
  const decision = String(input?.decision || "");
  const place = knowledgePlace(input?.path);
  const what = str(input?.section) || str(input?.title);
  if (decision === "skip") return "Checked knowledge: nothing new to add";
  if (decision === "create") return `Added to knowledge${place ? ` · ${place}` : ""}`;
  if (decision === "append") return `Updated knowledge${place ? ` · ${place}` : ""}${what ? ` › ${what}` : ""}`;
  return "Saved to knowledge";
}

const FINDING_LABEL: Record<string, string> = { hypothesis: "Recorded a hypothesis", evidence: "Recorded evidence", ruled_out: "Ruled out a cause", root_cause: "Recorded the root cause", fix: "Recorded the fix", verification: "Recorded the verification", inconclusive: "Recorded an inconclusive result" };

export function stepLabel(event: Pick<TaskEvent, "name" | "input" | "title">): string {
  const name = event.name || "";
  const input = safeParse(event.input);
  const label = toolMeta(name)?.label;
  if (label) return label(input);
  const tool = nervecenterTool(name);
  if (tool) return NERVECENTER_STEP[tool] ? NERVECENTER_STEP[tool](input) : `NerveCenter · ${humanise(tool)}`;
  const system = systemName(name);
  if (system) return `${system} · ${humanise(name.split("__").slice(2).join(" ") || "call")}`;
  return event.title || name;
}

/** What kind of work a tool call is, for the live indicator: reading, searching, running, talking to a system, planning, writing. */
export function activityOf(name?: string | null): Activity {
  const tool = name || "";
  const builtin = toolMeta(tool);
  if (builtin) return builtin.activity;
  const nc = nervecenterTool(tool);
  if (nc === "propose_plan" || nc === "update_plan") return "plan";
  if (nc) return NERVECENTER_WRITE_TOOLS.has(nc) || CARD_TOOLS.has(nc) ? "tool" : "search";
  if (systemName(tool)) return "system";
  return "tool";
}

/** The label for a tool the agent has decided to call but not yet called: input is unknown. */
export function toolTitle(name: string, fallback?: string): string {
  const label = stepLabel({ name, input: undefined, title: fallback });
  return label || fallback || name;
}

const PRESENT: Array<[RegExp, string]> = [
  [/^Read\b/, "Reading"], [/^Wrote\b/, "Writing"], [/^Edited\b/, "Editing"], [/^Searched\b/, "Searching"], [/^Ran\b/, "Running"],
  [/^Looked up\b/, "Looking up"], [/^Looked at\b/, "Looking at"], [/^Opened\b/, "Opening"], [/^Checked\b/, "Checking"], [/^Queried\b/, "Querying"],
  [/^Delegated\b/, "Delegating"], [/^Updated\b/, "Updating"], [/^Proposed\b/, "Proposing"], [/^Marked\b/, "Marking"], [/^Recorded\b/, "Recording"],
  [/^Ruled out\b/, "Ruling out"], [/^Showed\b/, "Showing"], [/^Commented\b/, "Commenting"], [/^Assigned\b/, "Assigning"], [/^Set\b/, "Setting"],
  [/^Created\b/, "Creating"], [/^Linked\b/, "Linking"], [/^Asked\b/, "Asking"], [/^Added\b/, "Adding"], [/^Saved\b/, "Saving"],
  [/^Applied\b/, "Applying"], [/^Copied\b/, "Copying"], [/^Dropped\b/, "Dropping"], [/^Loaded\b/, "Loading"], [/^Resumed\b/, "Resuming"],
  [/^Paused\b/, "Pausing"], [/^Started\b/, "Starting"], [/^Tested\b/, "Testing"], [/^Synced\b/, "Syncing"], [/^Published\b/, "Publishing"],
  [/^Unpublished\b/, "Unpublishing"], [/^Deleted\b/, "Deleting"],
];

/** "Read runs of X" becomes "Reading runs of X" for a step that is happening now. */
export function presentTense(label: string): string {
  for (const [pattern, replacement] of PRESENT) if (pattern.test(label)) return label.replace(pattern, replacement);
  return label;
}

// A built-in step with no input yet reads as a bare verb; say what it acts on.
const BARE_VERB: Record<string, string> = { Running: "Running a command", Reading: "Reading a file", Writing: "Writing a file", Editing: "Editing a file", NotebookEdit: "Editing a notebook" };

/**
 * A step as it happens now, for the live status: "Ran ls" reads "Running ls", and a shell call whose command has not
 * arrived yet "Running a command". Step labels are past tense, so this never prefixes them ("About to ran").
 */
export function liveLabel(label: string): string {
  const clean = label.trim();
  if (!clean) return "Using a tool";
  const skill = /^Skill · (.+)$/.exec(clean);
  if (skill) return skill[1] === "loading" ? "Loading a skill" : `Using the ${skill[1]} skill`;
  const present = presentTense(clean);
  return BARE_VERB[present] ?? present;
}
