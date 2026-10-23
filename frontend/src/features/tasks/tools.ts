import type { Activity } from "@/components/ops/ActivityOrb";

/**
 * What the agent's built-in tools are, in one table: how a call reads as a step label, what the live
 * indicator shows, how a row in the thread is laid out, and which family it belongs to (so the
 * journey, the "What Sonic did" list and the Activity tab group them the same way). Tools that come
 * from NerveCenter or a connector (`mcp__…`) are described in stepLabels.ts and journey.ts.
 */

export type StepKind = "init" | "ran" | "read" | "edit" | "search" | "web" | "skill" | "plan" | "system" | "approval" | "other";
type Input = Record<string, unknown> | null;

/** read: looks at files · write: changes files · shell: runs commands · web: reaches the internet · skill · plan */
export type ToolFamily = "read" | "write" | "shell" | "web" | "skill" | "plan";

interface ToolMeta {
  family?: ToolFamily;
  activity: Activity;
  /** The step in plain words; absent when the tool is not labelled (it then shows its own title). */
  label?: (input: Input) => string;
  /** The Activity tab row: `verb` and `target`, the first non-empty of `keys` in the input. */
  row?: { kind: StepKind; verb: string; keys: readonly string[]; isFile?: boolean; firstLine?: boolean };
}

const str = (value: unknown) => String(value || "");
const shortPath = (value: string) => value.split(/[\\/]/).slice(-2).join("/");
const withQuery = (prefix: string, input: Input) => `${prefix}${input?.query ? ` for ${String(input.query)}` : ""}`;

/** Skills that shape how Sonic writes or routes, not what the task is: they never name a phase. */
export const HELPER_SKILLS: ReadonlySet<string> = new Set(["unslop", "orchestrate"]);

/** The skill an event names, as the agent wrote it ("" when none). */
export const skillRef = (input: Input): string => String(input?.skill || input?.name || "");
/** The skill without the plugin prefix: "operations-fleet:rca" is "rca". */
export const skillSlug = (input: Input): string => skillRef(input).replace(/^operations-fleet:/, "");

const readFile = (verb: string): ToolMeta["label"] => (input) => `${verb} ${shortPath(str(input?.file_path))}`.trim();
const searchFiles: ToolMeta["label"] = (input) => `Searched files${input?.pattern ? ` for ${String(input.pattern)}` : ""}`;
/**
 * A command as a person reads it: the agent's own description when it gave one, else the first line
 * without the leading `cd <dir> &&` and with absolute paths cut to their last two parts.
 */
export function commandGist(input: Input): { description: string | null; command: string } {
  const description = str(input?.description).trim() || null;
  const line = str(input?.command).split("\n")[0].trim()
    .replace(/^cd\s+("[^"]*"|'[^']*'|\S+)\s*(&&|;)\s*/i, "")
    .replace(/"?(?:[A-Za-z]:[\\/]|\/(?:Users|home|tmp|var|opt|mnt)\/)[^\s"']*"?/g, (match) => shortPath(match.replace(/"/g, "")));
  return { description, command: line.length > 72 ? `${line.slice(0, 71)}…` : line };
}
const shellLabel: ToolMeta["label"] = (input) => { const gist = commandGist(input); return gist.description || `Ran ${gist.command}`.trim(); };
const shell: ToolMeta = { family: "shell", activity: "ran", label: shellLabel, row: { kind: "ran", verb: "Run", keys: ["command"], firstLine: true } };
const editRow = { kind: "edit", verb: "Edit", keys: ["file_path", "notebook_path"], isFile: true } as const;

const TOOLS: Record<string, ToolMeta> = {
  Skill: { family: "skill", activity: "tool", label: (input) => `Skill · ${skillSlug(input) || "loading"}`, row: { kind: "skill", verb: "Skill", keys: ["skill", "name"] } },
  Read: { family: "read", activity: "read", label: readFile("Read"), row: { kind: "read", verb: "Read", keys: ["file_path"], isFile: true } },
  Glob: { family: "read", activity: "search", label: searchFiles, row: { kind: "search", verb: "Search", keys: ["pattern"] } },
  Grep: { family: "read", activity: "search", label: searchFiles, row: { kind: "search", verb: "Search", keys: ["pattern"] } },
  Write: { family: "write", activity: "writing", label: readFile("Wrote"), row: { kind: "edit", verb: "Write", keys: ["file_path"], isFile: true } },
  Edit: { family: "write", activity: "writing", label: readFile("Edited"), row: editRow },
  MultiEdit: { family: "write", activity: "writing", label: readFile("Edited"), row: editRow },
  NotebookEdit: { family: "write", activity: "writing", row: editRow },
  Bash: shell,
  PowerShell: shell,
  WebSearch: { family: "web", activity: "web", label: (input) => withQuery("Searched the web", input), row: { kind: "web", verb: "Search the web", keys: ["query"] } },
  WebFetch: { family: "web", activity: "web", label: (input) => `Read ${str(input?.url) || "a page"}`, row: { kind: "web", verb: "Fetch", keys: ["url"] } },
  Task: { activity: "tool", label: (input) => `Delegated: ${str(input?.description) || "subtask"}` },
  TodoWrite: { family: "plan", activity: "plan", label: () => "Updated the plan" },
  AskUserQuestion: { activity: "tool", label: () => "Asked you a question" },
  ToolSearch: { activity: "search", label: () => "Loaded tools" },
};

/** Every built-in tool with a label, for tests that check each one. */
export const BUILTIN_TOOLS: readonly string[] = Object.keys(TOOLS);
export const toolMeta = (name?: string | null): ToolMeta | undefined => (name ? Object.prototype.hasOwnProperty.call(TOOLS, name) ? TOOLS[name] : undefined : undefined);
export const isToolFamily = (name: string | null | undefined, family: ToolFamily): boolean => toolMeta(name)?.family === family;
/** Bash or PowerShell. */
export const isShellTool = (name?: string | null) => isToolFamily(name, "shell");
/** Write, Edit, MultiEdit or NotebookEdit. */
export const isFileWrite = (name?: string | null) => isToolFamily(name, "write");
/** Read, Glob or Grep. */
export const isFileLook = (name?: string | null) => isToolFamily(name, "read");
/** WebSearch or WebFetch. */
export const isWebTool = (name?: string | null) => isToolFamily(name, "web");
