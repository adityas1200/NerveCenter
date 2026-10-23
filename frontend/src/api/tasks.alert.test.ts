import { TASK_TYPE_LABEL, startedBy, taskTypeDetail, type Task } from "@/api/tasks";

// SPEC-automations-01 FR-42: an automatic investigation reads as started by the automation, on its own Alerts type.

const base = { title: "Pipeline sales_load failed", createdBy: { id: "system", name: "NerveCenter" } } as Pick<Task, "title" | "createdBy">;

describe("alert tasks", () => {
  it("label the type and the asset", () => {
    expect(TASK_TYPE_LABEL.alert).toBe("Alert");
    const task = { ...base, type: "alert", context: { alert: { alertId: "AL-1", trigger: "pipelineFailed", subject: { name: "sales_load" } } } } as Task;
    expect(taskTypeDetail(task)).toBe("sales_load");
    expect(startedBy(task)).toEqual({ kind: "system", label: "Automation · pipeline failed" });
  });

  it("an investigation on a ticket is still started by the automation", () => {
    const task = { ...base, type: "ticket", context: { ticket: { ticketId: "OPS-9" }, alert: { alertId: "AL-2", trigger: "dqFailed" } } } as Task;
    expect(startedBy(task)).toEqual({ kind: "system", label: "Automation · check failed" });
  });
});
