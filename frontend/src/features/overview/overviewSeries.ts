import type { OverviewAttentionItem, OverviewResponse, PipelineRun, Ticket } from "@/api/types";
import { isClosed as isClosedTicket } from "@/features/tickets/ticketFields";
import { countInto, type TimeBucket } from "@/lib/timeBuckets";

/**
 * Pure helpers behind the Overview charts and the "Your work" table. Kept
 * separate from the page so the counting rules can be tested without rendering.
 */

const FAILED = new Set(["failed", "failure", "error", "timed_out", "timedout", "cancelled", "canceled"]);
const SUCCEEDED = new Set(["healthy", "success", "succeeded", "successful", "completed"]);


/** Tickets raised and tickets resolved per bucket. */
export function ticketSeries(buckets: TimeBucket[], tickets: Ticket[]): { raised: number[]; resolved: number[] } {
  return {
    raised: countInto(buckets, tickets, (ticket) => ticket.createdAt),
    resolved: countInto(buckets, tickets.filter(isClosedTicket), (ticket) => ticket.closedAt || ticket.updatedAt),
  };
}

/** Tickets the agent resolved per bucket, optionally only one kind (pipeline, data_quality). */
export function agentResolvedSeries(buckets: TimeBucket[], tickets: Ticket[], kind?: string): number[] {
  return countInto(buckets, tickets.filter((ticket) => ticket.resolvedWithAgent && (!kind || ticket.kind === kind)), (ticket) => ticket.closedAt || ticket.updatedAt);
}

/** Pipeline runs that succeeded and failed per bucket. Running or unknown runs are not counted. */
export function runSeries(buckets: TimeBucket[], runs: PipelineRun[]): { succeeded: number[]; failed: number[] } {
  const status = (run: PipelineRun) => String(run.status || "").toLowerCase();
  return {
    succeeded: countInto(buckets, runs.filter((run) => SUCCEEDED.has(status(run))), (run) => run.startTime),
    failed: countInto(buckets, runs.filter((run) => FAILED.has(status(run))), (run) => run.startTime),
  };
}

export interface PipelineCounts { succeeded: number; failed: number; missed: number; paused: number; /** Never ran, or a state the rules do not know. */ other: number; total: number }

/**
 * The four pipeline tiles from one rule, so they add up to the total: succeeded (latest run fine, or
 * running now), failed, missed (a scheduled run did not start) and paused. Counted from each
 * pipeline's health verdict; an older backend without verdicts falls back to the summary fields.
 */
export function pipelineCounts(data: Pick<OverviewResponse, "summary" | "pipelines">): PipelineCounts {
  const pipelines = data.pipelines ?? [];
  const verdicts = pipelines.filter((pipeline) => pipeline.health);
  if (verdicts.length) {
    const count = (...states: string[]) => verdicts.filter((pipeline) => states.includes(String(pipeline.health))).length;
    const succeeded = count("healthy", "running"); const failed = count("failed"); const missed = count("overdue"); const paused = count("paused");
    const total = Math.max(data.summary.totalPipelines ?? 0, verdicts.length);
    return { succeeded, failed, missed, paused, other: Math.max(0, total - succeeded - failed - missed - paused), total };
  }
  const summary = data.summary;
  const succeeded = summary.healthyPipelines ?? summary.latestRunsSucceeded + summary.runningPipelines;
  const failed = summary.failedPipelines; const missed = summary.overduePipelines ?? 0; const paused = summary.pausedPipelines ?? 0;
  const total = summary.totalPipelines ?? succeeded + failed + missed + paused;
  return { succeeded, failed, missed, paused, other: Math.max(0, total - succeeded - failed - missed - paused), total };
}

const DQ_SOURCES = new Set(["agentic-monitor", "data-quality", "dq", "monitor"]);

/**
 * A ticket about a data-quality check, whichever system it lives in: the backend's kind or category,
 * a check source, or a linked business check. The Overview tile and the Tickets page's
 * `category=data_quality` filter both use this, so the number and its destination agree.
 */
export function isDataQualityTicket(ticket: Ticket): boolean {
  return ticket.kind === "data_quality"
    || String(ticket.category || "").toLowerCase() === "data_quality"
    || DQ_SOURCES.has(String(ticket.source || ticket.metadata?.source || "").toLowerCase())
    || Boolean(ticket.context?.businessCheckId);
}

/** Open tickets that came from a data-quality check. */
export function openDataQualityTickets(tickets: Ticket[]): Ticket[] {
  return tickets.filter((ticket) => !isClosedTicket(ticket) && isDataQualityTicket(ticket));
}

export interface WorkReason {
  /** Plain sentence for the "Why it needs you" column. */
  reason: string;
  /** Verb on the row's button. */
  action: "Review" | "Answer" | "Open" | "Assign to me";
}

/** Why an attention item is on this person's list, in their words. */
export function workReason(item: OverviewAttentionItem, me?: { id?: string; name?: string } | null): WorkReason {
  const owner = String(item.owner || "").trim();
  const mine = Boolean(owner) && (owner === me?.id || owner === me?.name);
  switch (item.kind) {
    case "approval": return { reason: "Needs your approval", action: "Review" };
    case "human_task": return { reason: "Sonic asked you a question", action: "Answer" };
    case "pipeline": return { reason: item.ticketId ? "Pipeline failed" : "Pipeline failed, no ticket yet", action: "Open" };
    case "monitor": return { reason: "Check failed", action: "Open" };
    default: break;
  }
  if (!owner) return { reason: "No owner yet", action: item.ticketId ? "Assign to me" : "Open" };
  const state = String(item.status || "").toLowerCase();
  if (mine) {
    if (/waiting|review/.test(state)) return { reason: "Assigned to you, ready for your review", action: "Review" };
    if (/progress|running|investigat/.test(state)) return { reason: "Assigned to you · Sonic investigating", action: "Open" };
    return { reason: "Assigned to you", action: "Open" };
  }
  return { reason: `Assigned to ${owner}`, action: "Open" };
}

/** Turns a raw connection error into one sentence a business user can act on. */
export function plainConnectionReason(reason?: string | null, platform = "The platform"): string {
  const text = String(reason || "");
  if (/403|invalid access token|unauthori[sz]ed/i.test(text)) return `${platform} rejected the access token.`;
  const configure = text.match(/Configure an? (\w+) connection/i);
  if (configure) return `No ${configure[1]} connection is configured.`;
  if (/not configured|not connected/i.test(text)) return `${platform} is not connected.`;
  return text ? text.replace(/^[\w-]+:\s*/, "").split(" [ReqId")[0] : `${platform} is not connected.`;
}
