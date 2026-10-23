import type { Task, TaskEvent } from "@/api/tasks";
import { formatDuration } from "@/components/ui";
import { outcomeFrom, type OutcomeState, type Tone } from "./cards/blocks";

/**
 * The line under the task title (SPEC-tasks-10 FR-2): where the work stands. Sonic's latest `set_outcome`
 * when it gave one, else the task's own facts. While it runs, what it is doing now; while it waits on the
 * reader, what for. Pure.
 */

export type OutcomeMood = "good" | "bad" | "warning" | "live" | "neutral";
export interface OutcomeLineData {
  mood: OutcomeMood;
  /** The state word: "Recovered", "Needs you", "Running". */
  word: string;
  headline: string;
  items: Array<{ label: string; value: string; tone: Tone }>;
  /** Set while the task waits on the reader; the line then scrolls to the prompt. */
  waiting: "approval" | "question" | null;
}

const STATE: Record<OutcomeState, { word: string; mood: OutcomeMood }> = {
  resolved: { word: "Resolved", mood: "good" },
  recovered: { word: "Recovered", mood: "good" },
  done: { word: "Done", mood: "good" },
  answered: { word: "Answered", mood: "good" },
  in_progress: { word: "In progress", mood: "neutral" },
  blocked: { word: "Blocked", mood: "warning" },
  needs_you: { word: "Needs you", mood: "warning" },
  failed: { word: "Failed", mood: "bad" },
};

export function latestOutcome(events: TaskEvent[]) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.parentToolUseId) continue;
    const outcome = outcomeFrom(event);
    if (outcome) return outcome;
  }
  return null;
}

export function outcomeLine(task: Pick<Task, "status" | "startedAt" | "finishedAt" | "changes" | "context" | "error">, events: TaskEvent[], live: { activity?: string | null; elapsedMs?: number; pendingApproval?: boolean; pendingQuestion?: boolean } = {}): OutcomeLineData {
  const outcome = latestOutcome(events);
  const items = outcome?.items ?? [];
  if (live.pendingApproval) return { mood: "warning", word: "Needs you", headline: "Waiting for your approval", items, waiting: "approval" };
  if (live.pendingQuestion) return { mood: "warning", word: "Needs you", headline: "Waiting for your answer", items, waiting: "question" };
  if (task.status === "running" || task.status === "queued") {
    const took = live.elapsedMs && live.elapsedMs >= 1000 ? formatDuration(live.elapsedMs) : null;
    return { mood: "live", word: task.status === "queued" ? "Queued" : "Running", headline: live.activity || (task.status === "queued" ? "Starting" : "Thinking"), items: took ? [{ label: "Time", value: took, tone: "neutral" }] : [], waiting: null };
  }
  if (task.status === "waiting") return { mood: "warning", word: "Needs you", headline: "Waiting for you", items, waiting: null };
  // A stop or a crash outranks what Sonic last said about the work.
  if (task.status === "cancelled") return { mood: "neutral", word: "Stopped", headline: outcome?.headline || "Stopped before it finished", items, waiting: null };
  if (task.status === "failed" && (!outcome || STATE[outcome.state].mood === "good")) return { mood: "bad", word: "Failed", headline: task.error ? firstLine(task.error) : "The task failed", items, waiting: null };
  if (outcome) return { mood: STATE[outcome.state].mood, word: STATE[outcome.state].word, headline: outcome.headline, items, waiting: null };
  return { mood: task.status === "failed" ? "bad" : "good", word: task.status === "failed" ? "Failed" : "Done", headline: fallbackHeadline(task), items: fallbackItems(task), waiting: null };
}

function fallbackHeadline(task: Pick<Task, "context">): string {
  if (task.context.ticket) return `Worked on ${task.context.ticket.externalReference?.number || task.context.ticket.ticketId}`;
  if (task.context.routine) return `Ran ${task.context.routine.title || task.context.routine.name}`;
  return "Finished";
}

function fallbackItems(task: Pick<Task, "startedAt" | "finishedAt" | "changes">): OutcomeLineData["items"] {
  const items: OutcomeLineData["items"] = [];
  const changes = task.changes ?? 0;
  items.push({ label: "Changes", value: String(changes), tone: "neutral" });
  const took = task.startedAt && task.finishedAt ? Date.parse(task.finishedAt) - Date.parse(task.startedAt) : Number.NaN;
  if (Number.isFinite(took) && took >= 1000) items.push({ label: "Time", value: formatDuration(took), tone: "neutral" });
  return items;
}

const firstLine = (value: string) => (value.split(/\r?\n/).find((line) => line.trim()) || value).slice(0, 160);
