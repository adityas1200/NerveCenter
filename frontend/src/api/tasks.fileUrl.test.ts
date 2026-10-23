import { afterEach, describe, expect, it } from "vitest";
import { setCurrentProject } from "@/api/projects";
import { tasksApi } from "@/api/tasks";

// SPEC-projects-01 FR-50: raw file URLs go straight to the browser, which cannot send X-NerveCenter-Project.
describe("tasksApi.fileUrl", () => {
  afterEach(() => setCurrentProject(null));

  it("names the current project in the URL", () => {
    setCurrentProject("alpha");
    expect(tasksApi.fileUrl("T-1137", "pipeline-and-dq/index.md")).toMatch(/\/api\/tasks\/T-1137\/files\/raw\?path=pipeline-and-dq%2Findex\.md&project=alpha$/);
  });

  it("leaves the project out when none is chosen, so the server refuses it", () => {
    expect(tasksApi.fileUrl("T-1", "a b.html")).toMatch(/\/files\/raw\?path=a%20b\.html$/);
  });
});
