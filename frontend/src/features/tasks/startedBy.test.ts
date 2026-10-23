import { startedBy, type Task } from "@/api/tasks";

const base: Pick<Task, "type" | "context" | "createdBy" | "title"> = { type: "adhoc", title: "Weekly report", context: {}, createdBy: { id: "mitesh", name: "Mitesh Shinde" } };
const system = { id: "system", name: "NerveCenter" };

describe("startedBy", () => {
  it("names the routine for routine tasks, preferring its title", () => {
    expect(startedBy({ ...base, type: "routine", createdBy: system, context: { routine: { name: "daily-ticket-review", title: "Daily ticket review" } } })).toEqual({ kind: "routine", label: "Routine · Daily ticket review" });
    expect(startedBy({ ...base, type: "routine", createdBy: system, context: { routine: { name: "daily-ticket-review" } } }).label).toBe("Routine · daily-ticket-review");
  });

  it("calls a system-started ticket task automatic triage with the ticket number", () => {
    expect(startedBy({ ...base, type: "ticket", createdBy: system, context: { ticket: { ticketId: "OPS-1001", externalReference: { number: "INC0012345" } } } })).toEqual({ kind: "ticket", label: "Automatic triage · INC0012345" });
    expect(startedBy({ ...base, type: "ticket", createdBy: system, context: { ticket: { ticketId: "OPS-1001" } } }).label).toBe("Automatic triage · OPS-1001");
  });

  it("names the person who pressed Investigate on a ticket", () => {
    expect(startedBy({ ...base, type: "ticket", context: { ticket: { ticketId: "OPS-1001", externalReference: { number: "INC0012345" } } } })).toEqual({ kind: "person", label: "Mitesh Shinde · from ticket INC0012345" });
  });

  it("names the person and the page for a chat", () => {
    expect(startedBy({ ...base, context: { page: { name: "Pipelines", path: "/pipelines" } } })).toEqual({ kind: "person", label: "Mitesh Shinde · Pipelines" });
    expect(startedBy(base)).toEqual({ kind: "person", label: "Mitesh Shinde" });
  });

  it("falls back to NerveCenter for anything else the system started", () => {
    expect(startedBy({ ...base, createdBy: system })).toEqual({ kind: "system", label: "NerveCenter" });
  });
});
