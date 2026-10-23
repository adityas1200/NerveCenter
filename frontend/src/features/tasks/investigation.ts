import type { TaskEvent } from "@/api/tasks";
import { nervecenterTool } from "./stepLabels";
import { safeParse } from "./taskEvents";

/**
 * The investigation, folded from `record_finding` calls: hypotheses with their evidence, what was
 * ruled out and why, the root cause with a confidence, the fix, its verification, or an inconclusive
 * result. Pure, so the tab and its tests share one reading of the events.
 */

export type FindingKind = "hypothesis" | "evidence" | "ruled_out" | "root_cause" | "fix" | "verification" | "inconclusive";
export type EvidenceKind = "run" | "ticket" | "query" | "file" | "knowledge" | "table" | "url" | "log";
export type Confidence = "high" | "medium" | "low";
export type HypothesisState = "open" | "ruled_out" | "confirmed";

export interface EvidenceRef { label: string; kind: EvidenceKind | null; ref: string | null }
export interface Finding { id: string; seq: number; at: string; text: string; refs: EvidenceRef[] }
export interface Hypothesis extends Finding { state: HypothesisState; evidence: Finding[]; ruledOutBecause: string | null }
export interface Investigation {
  hypotheses: Hypothesis[];
  looseEvidence: Finding[];
  rootCause: (Finding & { confidence: Confidence | null; hypothesisId: string | null }) | null;
  fixes: Finding[];
  verifications: Finding[];
  inconclusive: Finding | null;
  /** Findings recorded so far, so a tab can show a count or a dot. */
  count: number;
}

const FINDING_KINDS = new Set<FindingKind>(["hypothesis", "evidence", "ruled_out", "root_cause", "fix", "verification", "inconclusive"]);
const EVIDENCE_KINDS = new Set<EvidenceKind>(["run", "ticket", "query", "file", "knowledge", "table", "url", "log"]);
const CONFIDENCE = new Set<Confidence>(["high", "medium", "low"]);
const STATE_ORDER: Record<HypothesisState, number> = { confirmed: 0, open: 1, ruled_out: 2 };

function refsOf(value: unknown): EvidenceRef[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => item && typeof item === "object").map((item) => {
    const row = item as Record<string, unknown>;
    const label = typeof row.label === "string" && row.label.trim() ? row.label.trim() : typeof row.ref === "string" ? row.ref : "";
    return { label, kind: EVIDENCE_KINDS.has(row.kind as EvidenceKind) ? (row.kind as EvidenceKind) : null, ref: typeof row.ref === "string" && row.ref.trim() ? row.ref.trim() : null };
  }).filter((ref) => ref.label);
}

export function isFindingEvent(event: Pick<TaskEvent, "type" | "name">): boolean { return event.type === "tool.use" && nervecenterTool(event.name) === "record_finding"; }

export function investigationFrom(events: TaskEvent[]): Investigation {
  const hypotheses: Hypothesis[] = [];
  const byId = new Map<string, Hypothesis>();
  const out: Investigation = { hypotheses, looseEvidence: [], rootCause: null, fixes: [], verifications: [], inconclusive: null, count: 0 };
  for (const event of events) {
    if (!isFindingEvent(event) || event.parentToolUseId) continue;
    const input = safeParse(event.input);
    const kind = input?.kind as FindingKind;
    if (!input || !FINDING_KINDS.has(kind)) continue;
    const text = typeof input.text === "string" ? input.text.trim() : "";
    if (!text) continue;
    out.count += 1;
    const finding: Finding = { id: typeof input.id === "string" && input.id.trim() ? input.id.trim() : `f-${event.seq}`, seq: event.seq, at: event.at, text, refs: refsOf(input.evidence) };
    const targetId = typeof input.hypothesisId === "string" && input.hypothesisId.trim() ? input.hypothesisId.trim() : null;
    const target = targetId ? byId.get(targetId) : undefined;

    if (kind === "hypothesis") {
      const existing = byId.get(finding.id);
      if (existing) { existing.text = text; existing.refs = [...existing.refs, ...finding.refs]; continue; }
      const hypothesis: Hypothesis = { ...finding, state: "open", evidence: [], ruledOutBecause: null };
      hypotheses.push(hypothesis); byId.set(hypothesis.id, hypothesis);
    } else if (kind === "evidence") {
      if (target) target.evidence.push(finding); else out.looseEvidence.push(finding);
    } else if (kind === "ruled_out") {
      // The text is the reason, shown once; its refs join the hypothesis's own chips rather than repeating the text as an evidence line.
      if (target) { target.state = "ruled_out"; target.ruledOutBecause = text; if (finding.refs.length) target.refs = [...target.refs, ...finding.refs]; }
      else { const hypothesis: Hypothesis = { ...finding, state: "ruled_out", evidence: [], ruledOutBecause: null }; hypotheses.push(hypothesis); byId.set(hypothesis.id, hypothesis); }
    } else if (kind === "root_cause") {
      // The root cause is drawn once, with its own chips, above the hypotheses; copying it into the confirmed hypothesis repeated it word for word.
      if (target) target.state = "confirmed";
      out.rootCause = { ...finding, confidence: CONFIDENCE.has(input.confidence as Confidence) ? (input.confidence as Confidence) : null, hypothesisId: target ? target.id : null };
    } else if (kind === "fix") out.fixes.push(finding);
    else if (kind === "verification") out.verifications.push(finding);
    else if (kind === "inconclusive") out.inconclusive = finding;
  }
  hypotheses.sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state] || a.seq - b.seq);
  return out;
}

export const CONFIDENCE_WORD: Record<Confidence, string> = { high: "Confident", medium: "Likely", low: "Uncertain" };

/** Where an evidence chip goes. `file` refs open in the viewer; `url` refs open a tab; the rest route inside the app. */
export type EvidenceTarget = { type: "route"; to: string } | { type: "file"; path: string } | { type: "url"; href: string } | { type: "none" };
const TICKET_IN_TEXT = /\b(OPS-\d+|INC\d+|CDO-\d+)\b/i;

export function evidenceTarget(ref: EvidenceRef): EvidenceTarget {
  const value = ref.ref || "";
  if (ref.kind === "url" || /^https?:\/\//i.test(value)) return value ? { type: "url", href: value } : { type: "none" };
  if (ref.kind === "ticket") { const id = TICKET_IN_TEXT.exec(value)?.[1] || TICKET_IN_TEXT.exec(ref.label)?.[1] || value; return id ? { type: "route", to: `/tickets/${encodeURIComponent(id)}` } : { type: "none" }; }
  if (ref.kind === "run") return { type: "route", to: `/monitor?q=${encodeURIComponent(ref.label)}` };
  if (ref.kind === "file") return value ? { type: "file", path: value } : { type: "none" };
  // Route through the same `?path=` + locateCitedPath resolution KnowledgePage uses for citations, rather
  // than guessing the base name here: that knows the real list of bases, this doesn't.
  if (ref.kind === "knowledge") return value ? { type: "route", to: `/knowledge?path=${encodeURIComponent(value.replace(/^knowledge\//, ""))}` } : { type: "none" };
  return { type: "none" };
}
