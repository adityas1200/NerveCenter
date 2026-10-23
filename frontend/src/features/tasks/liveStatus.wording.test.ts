import type { TaskEvent } from "@/api/tasks";
import { currentActivity } from "./TaskThread";
import { BUILTIN_TOOLS } from "./tools";
import { NERVECENTER_PREFIX, NERVECENTER_STEP_TOOLS, liveLabel, presentTense, stepLabel, toolTitle } from "./stepLabels";

// The live status says what Sonic is doing now, in the present tense, for every tool: never "About to ran".

const tools = [...BUILTIN_TOOLS, ...NERVECENTER_STEP_TOOLS().map((tool) => NERVECENTER_PREFIX + tool), "mcp__databricks__run_query"];
const pastTense = /^(About to\b|[A-Z][a-z]*ed\b|Ran\b|Read\b|Wrote\b|Set\b)/;

let seq = 0;
const ev = (extra: Partial<TaskEvent>): TaskEvent => { seq += 1; return { id: `e${seq}`, taskId: "T-1", seq, at: "2026-10-16T09:00:00Z", type: "status", ...extra } as TaskEvent; };

describe("live status wording", () => {
  it.each(tools)("%s reads in the present tense before its input arrives", (name) => {
    const label = liveLabel(toolTitle(name, name));
    expect(label).not.toMatch(pastTense);
    expect(presentTense(label)).toBe(label);
  });

  it("names what a bare step acts on, and the specifics once they arrive", () => {
    expect(liveLabel(toolTitle("Bash"))).toBe("Running a command");
    expect(liveLabel(stepLabel({ name: "Bash", input: JSON.stringify({ command: "ls" }), title: undefined }))).toBe("Running ls");
    expect(liveLabel(toolTitle("Glob"))).toBe("Searching files");
    expect(liveLabel(toolTitle("WebSearch"))).toBe("Searching the web");
    expect(liveLabel(toolTitle("ToolSearch"))).toBe("Loading tools");
    expect(liveLabel(toolTitle("Skill"))).toBe("Loading a skill");
    expect(liveLabel(stepLabel({ name: "Skill", input: JSON.stringify({ skill: "monitoring" }), title: undefined }))).toBe("Using the monitoring skill");
    expect(liveLabel(toolTitle(`${NERVECENTER_PREFIX}get_ticket`))).toBe("Opening ticket");
    expect(liveLabel(toolTitle(`${NERVECENTER_PREFIX}test_connection`))).toBe("Testing a connection");
  });

  it("follows the phase: reading the message, a step, then thinking between steps", () => {
    const sent = ev({ type: "user.message", text: "Check the routine" });
    expect(currentActivity([sent])).toBe("Reading your message");
    expect(currentActivity([sent], { name: "Bash", title: "Bash", at: "2026-10-16T09:00:01Z" })).toBe("Running a command");
    const call = ev({ type: "tool.use", name: "Bash", input: JSON.stringify({ command: "ls" }), toolUseId: "tu-1" });
    expect(currentActivity([sent, call])).toBe("Running ls");
    expect(currentActivity([sent, call, ev({ type: "tool.result", toolUseId: "tu-1", content: "ok" })])).toBe("Thinking");
  });
});
