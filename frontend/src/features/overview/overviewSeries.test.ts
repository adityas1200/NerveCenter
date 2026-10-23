import type { OverviewAttentionItem, PipelineRun, Ticket } from "@/api/types";
import { makeBuckets } from "@/lib/timeBuckets";
import { isDataQualityTicket, openDataQualityTickets, pipelineCounts, plainConnectionReason, runSeries, ticketSeries, workReason } from "./overviewSeries";

const NOW = Date.parse("2026-09-23T12:00:00Z");
const week = makeBuckets({ from: new Date(NOW - 7 * 24 * 3600 * 1000).toISOString(), to: new Date(NOW).toISOString() }, NOW);

describe("ticketSeries", () => {
  it("counts raised tickets by creation time and resolved tickets by close time", () => {
    const tickets = [
      { ticketId: "A", status: "open", createdAt: "2026-09-22T09:00:00Z" },
      { ticketId: "B", status: "closed", createdAt: "2026-09-20T09:00:00Z", closedAt: "2026-09-22T10:00:00Z" },
      { ticketId: "C", status: "resolved", createdAt: "2026-09-01T09:00:00Z", closedAt: "2026-09-21T10:00:00Z" },
    ] as Ticket[];
    const { raised, resolved } = ticketSeries(week, tickets);
    expect(raised.reduce((sum, value) => sum + value, 0)).toBe(2);
    expect(resolved.reduce((sum, value) => sum + value, 0)).toBe(2);
    expect(raised.length).toBe(week.length);
  });
});

describe("runSeries", () => {
  it("separates succeeded and failed runs and ignores running ones", () => {
    const runs = [
      { runId: "1", pipelineId: "p", status: "healthy", startTime: "2026-09-22T09:00:00Z" },
      { runId: "2", pipelineId: "p", status: "failed", startTime: "2026-09-22T10:00:00Z" },
      { runId: "3", pipelineId: "p", status: "running", startTime: "2026-09-22T11:00:00Z" },
    ] as PipelineRun[];
    const { succeeded, failed } = runSeries(week, runs);
    expect(succeeded.reduce((sum, value) => sum + value, 0)).toBe(1);
    expect(failed.reduce((sum, value) => sum + value, 0)).toBe(1);
  });
});

describe("openDataQualityTickets", () => {
  it("keeps open tickets that came from a check and drops closed ones", () => {
    const tickets = [
      { ticketId: "A", status: "open", category: "data_quality" },
      { ticketId: "B", status: "in_progress", source: "agentic-monitor" },
      { ticketId: "C", status: "closed", category: "data_quality" },
      { ticketId: "D", status: "open", category: "incident", source: "databricks" },
    ] as Ticket[];
    expect(openDataQualityTickets(tickets).map((ticket) => ticket.ticketId)).toEqual(["A", "B"]);
  });
});

describe("isDataQualityTicket", () => {
  it("recognises a check ticket by kind, category, source or linked check, whichever system holds it", () => {
    expect(isDataQualityTicket({ ticketId: "A", status: "open", kind: "data_quality" } as Ticket)).toBe(true);
    expect(isDataQualityTicket({ ticketId: "B", status: "open", source: "servicenow", category: "DATA_QUALITY" } as Ticket)).toBe(true);
    expect(isDataQualityTicket({ ticketId: "C", status: "open", metadata: { source: "monitor" } } as Ticket)).toBe(true);
    expect(isDataQualityTicket({ ticketId: "D", status: "open", context: { businessCheckId: "chk-1" } } as Ticket)).toBe(true);
    expect(isDataQualityTicket({ ticketId: "E", status: "open", kind: "pipeline", category: "incident", source: "databricks" } as Ticket)).toBe(false);
  });
});

describe("workReason", () => {
  const base = { id: "x", title: "t", detail: "", status: "open", href: "/tickets/OPS-1", rank: 0 } as OverviewAttentionItem;
  it("explains approvals and questions in the user's words", () => {
    expect(workReason({ ...base, kind: "approval" })).toEqual({ reason: "Needs your approval", action: "Review" });
    expect(workReason({ ...base, kind: "human_task" })).toEqual({ reason: "Sonic asked you a question", action: "Answer" });
  });
  it("offers to claim an unowned ticket and names the owner otherwise", () => {
    expect(workReason({ ...base, kind: "ticket", ticketId: "OPS-1", owner: null })).toEqual({ reason: "No owner yet", action: "Assign to me" });
    expect(workReason({ ...base, kind: "ticket", owner: "Mitesh Shinde", status: "in_progress" }, { name: "Mitesh Shinde" })).toEqual({ reason: "Assigned to you · Sonic investigating", action: "Open" });
    expect(workReason({ ...base, kind: "ticket", owner: "Jay" }, { name: "Mitesh" })).toEqual({ reason: "Assigned to Jay", action: "Open" });
  });
});

describe("plainConnectionReason", () => {
  it("turns raw connector errors into one sentence", () => {
    expect(plainConnectionReason("databricks: Databricks GET /api/2.2/jobs/runs/list failed (403): Invalid access token. [ReqId: x]", "Databricks")).toBe("Databricks rejected the access token.");
    expect(plainConnectionReason("Configure a databricks connection before reading its pipelines")).toBe("No databricks connection is configured.");
  });
});

describe("pipelineCounts", () => {
  const summary = { totalPipelines: 9, latestRunsSucceeded: 6, failedPipelines: 1, failedMonitors: 0, runningPipelines: 1, healthyPipelines: 7, overduePipelines: 0, pausedPipelines: 1, criticalTickets: 0, pendingApprovals: 0, openHumanTasks: 0, activeWorkflows: 0, activeInvestigations: 0, scheduledPrevious12Hours: 0, scheduledNext12Hours: 0 };

  it("counts every pipeline once from its health verdict, so the tiles add up to the total", () => {
    const pipelines = [
      ...Array.from({ length: 6 }, (_, index) => ({ pipelineId: `h${index}`, name: `h${index}`, status: "healthy", health: "healthy" as const })),
      { pipelineId: "r", name: "r", status: "running", health: "running" as const },
      { pipelineId: "f", name: "f", status: "failed", health: "failed" as const },
      { pipelineId: "p", name: "p", status: "healthy", health: "paused" as const },
    ];
    const counts = pipelineCounts({ summary, pipelines: pipelines as never });
    expect(counts).toEqual({ succeeded: 7, failed: 1, missed: 0, paused: 1, other: 0, total: 9 });
    expect(counts.succeeded + counts.failed + counts.missed + counts.paused + counts.other).toBe(counts.total);
  });

  it("names pipelines that never ran as other, and falls back to the summary when there are no verdicts", () => {
    const withIdle = pipelineCounts({ summary: { ...summary, totalPipelines: 3 }, pipelines: [{ pipelineId: "a", name: "a", status: "failed", health: "failed" }, { pipelineId: "b", name: "b", status: "", health: "no_runs" }, { pipelineId: "c", name: "c", status: "healthy", health: "healthy" }] as never });
    expect(withIdle).toEqual({ succeeded: 1, failed: 1, missed: 0, paused: 0, other: 1, total: 3 });
    expect(pipelineCounts({ summary, pipelines: [{ pipelineId: "x", name: "x", status: "failed" }] as never })).toEqual({ succeeded: 7, failed: 1, missed: 0, paused: 1, other: 0, total: 9 });
  });
});
