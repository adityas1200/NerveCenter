import { activityOf, knowledgePlace, knowledgeStepLabel, presentTense, stepLabel } from "./stepLabels";

describe("lesson-capture steps", () => {
  it("names the page's place in its base in words", () => {
    expect(knowledgePlace("known-issues/pipeline_failures.md")).toBe("Known issues › Pipeline failures");
    expect(knowledgePlace(undefined)).toBe("");
  });

  it("says what was added, updated, or that nothing was", () => {
    expect(knowledgeStepLabel({ decision: "create", path: "known-issues/cluster-quota.md", title: "Cluster quota" })).toBe("Added to knowledge · Known issues › Cluster quota");
    expect(knowledgeStepLabel({ decision: "append", path: "known-issues/pipelines.md", section: "Schema change" })).toBe("Updated knowledge · Known issues › Pipelines › Schema change");
    expect(knowledgeStepLabel({ decision: "skip", checked: ["ops/known-issues/pipelines.md"] })).toBe("Checked knowledge: nothing new to add");
  });

  it("labels both tools as steps, in the present tense while they run", () => {
    expect(stepLabel({ name: "mcp__nervecenter__knowledge_catalog", input: "{}" })).toBe("Read the knowledge map");
    const saving = stepLabel({ name: "mcp__nervecenter__update_knowledge", input: JSON.stringify({ decision: "create", path: "a/b.md" }) });
    expect(presentTense(saving)).toBe("Adding to knowledge · A › B");
    expect(activityOf("mcp__nervecenter__update_knowledge")).toBe("tool");
  });
});
