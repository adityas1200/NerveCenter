import { describe, expect, it } from "vitest";
import { resolveChatFileLink } from "./markdownLinks";

// SPEC-tasks-01 FR-24: a file named in a chat reply opens the task file it means, not a 404.
const files = ["summary.md", "pipeline-and-dq/l2-model.md", "pipeline-and-dq/index.md", "charts/run times.png", "a/notes.md", "b/notes.md"];

describe("resolveChatFileLink", () => {
  it("keeps a path that is already a task file", () => {
    expect(resolveChatFileLink("pipeline-and-dq/l2-model.md", "T-1", files)).toBe("pipeline-and-dq/l2-model.md");
  });

  it("takes the part after tasks/<id>/ from an absolute or workspace path", () => {
    expect(resolveChatFileLink("var/lib/nervecenter/workspace/projects/pilot/tasks/T-1/summary.md", "T-1", files)).toBe("summary.md");
    expect(resolveChatFileLink("/var/lib/nervecenter/workspace/projects/pilot/tasks/T-1/pipeline-and-dq/index.md", "T-1", files)).toBe("pipeline-and-dq/index.md");
    expect(resolveChatFileLink("file:///var/lib/nervecenter/workspace/tasks/T-1/summary.md", "T-1", files)).toBe("summary.md");
  });

  it("finds a bare name the agent saved in a subfolder", () => {
    expect(resolveChatFileLink("l2-model.md", "T-1", files)).toBe("pipeline-and-dq/l2-model.md");
  });

  it("decodes the link and drops a query or heading anchor", () => {
    expect(resolveChatFileLink("charts/run%20times.png", "T-1", files)).toBe("charts/run times.png");
    expect(resolveChatFileLink("./summary.md#next-steps", "T-1", files)).toBe("summary.md");
  });

  it("does not guess between two files with the same name, or invent one that is missing", () => {
    expect(resolveChatFileLink("notes.md", "T-1", files)).toBe("notes.md");
    expect(resolveChatFileLink("missing.md", "T-1", files)).toBe("missing.md");
    expect(resolveChatFileLink("tasks/T-2/summary.md", "T-1", files)).toBe("tasks/T-2/summary.md");
  });
});
