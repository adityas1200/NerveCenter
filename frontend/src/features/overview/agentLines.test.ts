import type { Task } from "@/api/tasks";
import { agentLines, domainOf } from "./agentLines";

const base = (over: Partial<Task>): Task => ({ id: "T-1", type: "adhoc", title: "x", summary: "", status: "done", permission: "ask", context: {}, createdBy: { id: "u", name: "U" }, createdAt: "2026-09-23T09:00:00Z", updatedAt: "2026-09-23T10:00:00Z", sessionId: null, cost: { totalUsd: 0, inputTokens: 0, outputTokens: 0, turns: 0, durationMs: 0, runs: 0 }, pendingApprovalId: null, ...over } as Task);
const bounds = { from: "2026-09-23T00:00:00Z", to: "2026-09-23T23:59:59Z" };

describe("agentLines", () => {
  it("assigns tasks to a domain by type, page or wording", () => {
    expect(domainOf(base({ type: "ticket" }))).toBe("tickets");
    expect(domainOf(base({ context: { page: { name: "Pipelines", path: "/monitor" } } }))).toBe("pipelines");
    expect(domainOf(base({ title: "Explain the failing freshness checks" }))).toBe("dataQuality");
    expect(domainOf(base({ type: "routine", title: "Check failed pipelines", context: { routine: { name: "check-failed-pipelines", objective: "List failed jobs" } } }))).toBe("pipelines");
    expect(domainOf(base({ title: "Write the weekly report" }))).toBeNull();
  });

  it("summarises counts per domain inside the window and marks live work", () => {
    const tasks = [
      base({ id: "T-1", type: "ticket", status: "done", title: "Investigate OPS-1001" }),
      base({ id: "T-2", type: "ticket", status: "waiting", title: "Investigate OPS-1002", updatedAt: "2026-09-23T11:00:00Z" }),
      base({ id: "T-3", type: "ticket", status: "done", title: "Old one", updatedAt: "2026-09-01T10:00:00Z" }),
      base({ id: "T-4", type: "routine", status: "done", title: "Check failed pipelines", context: { routine: { name: "check-failed-pipelines", objective: "List failed jobs" } } }),
    ];
    const lines = agentLines(tasks, bounds);
    expect(lines.tickets.text).toBe("1 ticket investigated, 1 waiting on you");
    expect(lines.tickets.live).toBe(true);
    expect(lines.tickets.to).toBe("/tasks?type=ticket");
    expect(lines.pipelines.text).toBe('1 task finished · Routine "Check failed pipelines" ran last');
    expect(lines.pipelines.live).toBe(false);
    expect(lines.dataQuality.text).toBe("No data quality investigations in this window.");
  });
});
