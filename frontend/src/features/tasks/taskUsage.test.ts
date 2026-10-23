import { describe, expect, it } from "vitest";
import type { TaskEvent } from "@/api/tasks";
import { investigationFrom } from "./investigation";
import { availableSkillsLabel, knowledgePathOf, knowledgeUsage, skillFromPath, skillUsage } from "./taskUsage";

let seq = 0;
const call = (name: string, input: Record<string, unknown>): TaskEvent => { seq += 1; return { id: `e${seq}`, taskId: "T-1", seq, at: `2026-09-30T10:00:${String(seq).padStart(2, "0")}Z`, type: "tool.use", toolUseId: `tu${seq}`, name, input: JSON.stringify(input) }; };
const read = (path: string) => call("Read", { file_path: path });

describe("skill and knowledge usage", () => {
  it("recognises skill files and knowledge pages, with either slash", () => {
    expect(skillFromPath("C:\\work\\plugin\\operations-fleet\\skills\\orchestrate\\references\\html-report.md")).toBe("orchestrate");
    expect(skillFromPath("plugin/operations-fleet/skills/rca/SKILL.md")).toBe("rca");
    expect(skillFromPath("skills/rca/notes.md")).toBeNull();
    expect(knowledgePathOf("C:\\ws\\knowledge\\platform-runbooks\\restart.md")).toBe("platform-runbooks/restart.md");
    // The knowledge skill's own references are a skill, not a knowledge page.
    expect(knowledgePathOf("plugin/operations-fleet/skills/knowledge/references/lesson-capture.md")).toBeNull();
  });

  it("counts a skill whether it was called or its files were read", () => {
    seq = 0;
    const events = [call("Skill", { skill: "operations-fleet:rca" }), read("plugin/operations-fleet/skills/orchestrate/SKILL.md"), read("plugin/operations-fleet/skills/orchestrate/references/html-report.md"), read("src/app.ts")];
    expect(skillUsage(events)).toEqual([{ name: "rca", uses: 1, firstSeq: 1 }, { name: "orchestrate", uses: 2, firstSeq: 2 }]);
  });

  it("gathers searches, pages read and pages the investigation cited", () => {
    seq = 0;
    const events = [
      call("mcp__nervecenter__search_knowledge", { query: "restart policy" }),
      call("mcp__nervecenter__search_knowledge", { query: "Restart policy" }),
      read("knowledge/platform-runbooks/restart.md"),
      read("knowledge/platform-runbooks/restart.md"),
      call("mcp__nervecenter__record_finding", { kind: "evidence", text: "Runbook says restart once", evidence: [{ label: "Restart runbook", kind: "knowledge", ref: "knowledge/platform-runbooks/restart.md" }, { label: "Owners", kind: "knowledge", ref: "definitions/owners.md" }] }),
    ];
    expect(knowledgeUsage(events, investigationFrom(events))).toEqual({
      searches: [{ query: "restart policy", firstSeq: 1 }],
      docs: [
        { path: "platform-runbooks/restart.md", name: "restart.md", reads: 2, cited: true, firstSeq: 3 },
        { path: "definitions/owners.md", name: "owners.md", reads: 0, cited: true, firstSeq: null },
      ],
    });
  });

  const init = (id: string): TaskEvent => { seq += 1; return { id, taskId: "T-1", seq, at: `2026-09-30T10:00:${String(seq).padStart(2, "0")}Z`, type: "session.init", skills: ["operations-fleet:rca", "operations-fleet:orchestrate"], mcpServers: [{ name: "databricks", status: "connected" }] }; };

  it("counts the project's own skills with the plugin's and names them (SPEC-tasks-08 FR-2)", () => {
    seq = 0;
    const withProject: TaskEvent = { ...init("i1"), projectSkills: ["sales-kpis", "margin-check", "hcp-rules", "territory"] };
    expect(availableSkillsLabel(withProject, "skills available")).toBe("6 skills available, including sales-kpis, margin-check, hcp-rules and 1 more");
    expect(availableSkillsLabel({ ...init("i2"), projectSkills: ["sales-kpis"] })).toBe("3 skills, including sales-kpis");
    expect(availableSkillsLabel({ ...init("i3"), skills: [] })).toBeNull();
  });
});
