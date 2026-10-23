/* eslint-disable react-refresh/only-export-components */
import { cn } from "@/lib/utils";

export type StatusTone = "bad" | "warning" | "review" | "info" | "success" | "neutral";

export interface StatusMeta {
  label: string;
  tone: StatusTone;
  /** Work that is still moving; the dot breathes so a list shows what is live. */
  live: boolean;
}

function normalise(value: unknown): string {
  return String(value ?? "").trim().toLowerCase().replace(/[\s_-]+/g, " ");
}

function capitalise(text: string): string {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : "—";
}

/**
 * One vocabulary for every backend state shown to a business user. Raw states
 * are mapped to plain labels and a small set of tones; anything unknown falls
 * back to keyword matching so a new backend state still reads sensibly.
 */
const VOCABULARY: Record<string, Omit<StatusMeta, "live"> & { live?: boolean }> = {
  open: { label: "Open", tone: "info" },
  new: { label: "New", tone: "info" },
  scheduled: { label: "Scheduled", tone: "info" },
  due: { label: "Due now", tone: "warning" },
  triage: { label: "In triage", tone: "warning" },

  "in progress": { label: "In progress", tone: "warning", live: true },
  running: { label: "In progress", tone: "warning", live: true },
  investigating: { label: "Investigating", tone: "warning", live: true },
  "rca running": { label: "Investigating", tone: "warning", live: true },
  validating: { label: "Validating", tone: "warning", live: true },
  remediating: { label: "Remediating", tone: "warning", live: true },
  verification: { label: "Verifying", tone: "warning", live: true },
  monitoring: { label: "Monitoring", tone: "warning", live: true },
  queued: { label: "Queued", tone: "warning" },
  pending: { label: "Pending", tone: "warning" },
  active: { label: "Active", tone: "warning" },
  ready: { label: "Ready", tone: "warning" },
  handoff: { label: "Handed off", tone: "warning" },
  late: { label: "Late", tone: "warning" },
  delayed: { label: "Late", tone: "warning" },
  overdue: { label: "Overdue", tone: "warning" },
  warning: { label: "Warning", tone: "warning" },
  "waiting on agent": { label: "Waiting on agent", tone: "warning" },

  waiting: { label: "Needs human review", tone: "review" },
  "human review": { label: "Needs human review", tone: "review" },
  "needs review": { label: "Needs human review", tone: "review" },
  "needs approval": { label: "Needs approval", tone: "review" },
  "pending approval": { label: "Needs approval", tone: "review" },
  "waiting for approval": { label: "Needs approval", tone: "review" },
  "approval required": { label: "Needs approval", tone: "review" },
  "awaiting approval": { label: "Needs approval", tone: "review" },
  "needs more evidence": { label: "Needs more evidence", tone: "review" },

  failed: { label: "Failed", tone: "bad" },
  failure: { label: "Failed", tone: "bad" },
  error: { label: "Failed", tone: "bad" },
  unsuccessful: { label: "Failed", tone: "bad" },
  "timed out": { label: "Timed out", tone: "bad" },
  timeout: { label: "Timed out", tone: "bad" },
  denied: { label: "Denied", tone: "bad" },
  blocked: { label: "Blocked", tone: "bad" },
  rejected: { label: "Rejected", tone: "bad" },
  "cleanup required": { label: "Cleanup required", tone: "bad" },

  successful: { label: "Successful", tone: "success" },
  succeeded: { label: "Successful", tone: "success" },
  success: { label: "Successful", tone: "success" },
  healthy: { label: "Healthy", tone: "success" },
  passed: { label: "Passed", tone: "success" },
  resolved: { label: "Resolved", tone: "success" },
  completed: { label: "Completed", tone: "success" },
  complete: { label: "Completed", tone: "success" },
  done: { label: "Completed", tone: "success" },
  approved: { label: "Approved", tone: "success" },
  "rca complete": { label: "Root cause found", tone: "success" },
  "auto resolved": { label: "Resolved with Sonic", tone: "success" },

  closed: { label: "Closed", tone: "neutral" },
  cancelled: { label: "Cancelled", tone: "neutral" },
  canceled: { label: "Cancelled", tone: "neutral" },
  archived: { label: "Archived", tone: "neutral" },
  disabled: { label: "Disabled", tone: "neutral" },
  paused: { label: "Paused", tone: "neutral" },
  skipped: { label: "Skipped", tone: "neutral" },
  "not run": { label: "Not run yet", tone: "neutral" },
  "no runs": { label: "No runs", tone: "neutral" },
  unavailable: { label: "Unavailable", tone: "neutral" },
  "configuration required": { label: "Setup needed", tone: "neutral" },
  unknown: { label: "Unknown", tone: "neutral" },
};

function fallbackTone(text: string): StatusTone {
  if (/failed|error|denied|blocked|unsuccessful|rejected/.test(text)) return "bad";
  if (/\bwaiting\b|\bapproval\b|human review|needs review/.test(text)) return "review";
  if (/pending|delayed|running|queued|in progress|investigating|monitoring|handoff|\bopen\b|\bactive\b|\bready\b/.test(text)) return "warning";
  if (/\bsuccessful\b|\bsucceeded\b|\bsuccess\b|\bhealthy\b|\bresolved\b|\bcompleted\b|\bcomplete\b|\bpassed\b/.test(text)) return "success";
  return "neutral";
}

export function statusMeta(value: unknown, options: { waitingReason?: string | null } = {}): StatusMeta {
  const key = normalise(value);
  if (key === "waiting" && (options.waitingReason === "agent" || options.waitingReason === "workflow")) return { ...VOCABULARY["waiting on agent"], live: false };
  if (key === "waiting" && options.waitingReason === "external") return { label: "Waiting on external team", tone: "warning", live: false };
  const known = VOCABULARY[key];
  if (known) return { label: known.label, tone: known.tone, live: known.live ?? false };
  const tone = fallbackTone(key);
  return { label: capitalise(key), tone, live: tone === "warning" && /running|in progress|investigating|queued|monitoring/.test(key) };
}

/** Rank used when sorting by status: problems first, finished work last. */
export const STATUS_TONE_RANK: Record<StatusTone, number> = { bad: 0, review: 1, warning: 2, info: 3, neutral: 4, success: 5 };

const PILL: Record<StatusTone, string> = {
  bad: "border-rose-200 bg-rose-50 text-rose-700",
  warning: "border-amber-200 bg-amber-50 text-amber-800",
  review: "border-violet-200 bg-violet-50 text-violet-700",
  info: "border-blue-200 bg-blue-50 text-blue-700",
  success: "border-emerald-200 bg-emerald-50 text-emerald-700",
  neutral: "border-slate-200 bg-slate-50 text-slate-600",
};

const DOT: Record<StatusTone, string> = {
  bad: "bg-rose-500",
  warning: "bg-amber-500",
  review: "bg-violet-500",
  info: "bg-blue-500",
  success: "bg-emerald-500",
  neutral: "bg-slate-400",
};

/** `label` overrides the shared word when one screen needs its own (a pipeline is "Running", a task is "In progress"). */
export function OperationalStatus({ value, waitingReason, label, className }: { value: unknown; waitingReason?: string | null; label?: string; className?: string }) {
  const meta = statusMeta(value, { waitingReason });
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11.5px] font-semibold leading-4", PILL[meta.tone], className)}>
      <span aria-hidden="true" className={cn("h-1.5 w-1.5 shrink-0 rounded-full", DOT[meta.tone], meta.live && "animate-pulse")} />
      {label ?? meta.label}
    </span>
  );
}
