import { BookOpen, Database, ExternalLink, FileText, Link2, Play, ScrollText, Table2, Ticket, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { CONFIDENCE_WORD, evidenceTarget, type EvidenceKind, type EvidenceRef, type Finding, type Hypothesis, type Investigation } from "../investigation";
import { AgentCard } from "./AgentCard";
import { StateTag } from "./DataBlocks";

/**
 * A turn's `record_finding` calls as one card in the thread (SPEC-tasks-10 FR-9): the root cause first with
 * its confidence, then the hypotheses (confirmed one ruled in emerald, ruled-out ones greyed with the reason),
 * loose evidence, the fix and its verification. Evidence chips open the run, ticket, file or page.
 */
export function InvestigationCard({ investigation, live = false, compact = false, onOpenFile, className }: { investigation: Investigation; live?: boolean; compact?: boolean; onOpenFile?: (path: string) => void; className?: string }) {
  const { rootCause, inconclusive } = investigation;
  const ruledOut = investigation.hypotheses.filter((hypothesis) => hypothesis.state === "ruled_out").length;
  const note = [`${investigation.hypotheses.length} ${investigation.hypotheses.length === 1 ? "hypothesis" : "hypotheses"}`, ruledOut ? `${ruledOut} ruled out` : null].filter(Boolean).join(" · ");
  const verdict = rootCause ? <StateTag tone="good">Root cause found</StateTag> : inconclusive ? <StateTag tone="neutral">Inconclusive</StateTag> : live ? <StateTag tone="brand">Investigating</StateTag> : null;
  return (
    <AgentCard title="Investigation" note={investigation.hypotheses.length ? note : null} action={verdict} compact={compact} className={className}>
      <div className="space-y-4">
        {rootCause ? (
          <section aria-label="Root cause">
            <div className="flex items-center gap-2"><SectionLabel>Root cause</SectionLabel>{rootCause.confidence ? <StateTag tone="neutral">{CONFIDENCE_WORD[rootCause.confidence]}</StateTag> : null}</div>
            <p className="mt-1 text-[14.5px] font-medium leading-6 text-ink-1">{rootCause.text}</p>
            <Chips refs={rootCause.refs} onOpenFile={onOpenFile} />
          </section>
        ) : null}
        {inconclusive ? (
          <section className="rounded-lg border border-line bg-surface-subtle px-3 py-2.5" aria-label="Inconclusive">
            <SectionLabel>Inconclusive</SectionLabel>
            <p className="mt-1 text-[14px] leading-6 text-ink-2">{inconclusive.text}</p>
            <Chips refs={inconclusive.refs} onOpenFile={onOpenFile} />
          </section>
        ) : null}
        {investigation.hypotheses.length ? (
          <section aria-label="Hypotheses">
            <SectionLabel>Hypotheses</SectionLabel>
            <ol className="relative ml-1.5 mt-2 space-y-2 border-l border-line pl-4">
              {investigation.hypotheses.map((hypothesis) => <li key={hypothesis.id} className="relative"><span className={cn("absolute -left-[21px] top-3.5 h-2 w-2 rounded-full border", hypothesis.state === "confirmed" ? "border-emerald-500 bg-emerald-500" : hypothesis.state === "ruled_out" ? "border-line-strong bg-line" : "border-line-strong bg-raised")} aria-hidden="true" /><HypothesisRow hypothesis={hypothesis} onOpenFile={onOpenFile} /></li>)}
            </ol>
          </section>
        ) : null}
        <FindingList label="Evidence" findings={investigation.looseEvidence} onOpenFile={onOpenFile} />
        <FindingList label="Fix" findings={investigation.fixes} onOpenFile={onOpenFile} />
        <FindingList label="Verification" findings={investigation.verifications} onOpenFile={onOpenFile} />
      </div>
    </AgentCard>
  );
}

function SectionLabel({ children }: { children: ReactNode }) { return <h4 className="text-[12px] font-medium text-ink-4">{children}</h4>; }

function FindingList({ label, findings, onOpenFile }: { label: string; findings: Finding[]; onOpenFile?: (path: string) => void }) {
  if (!findings.length) return null;
  return (
    <section aria-label={label}>
      <SectionLabel>{label}</SectionLabel>
      <ul className="mt-1.5 space-y-2">{findings.map((finding) => <li key={finding.id}><FindingRow finding={finding} onOpenFile={onOpenFile} /></li>)}</ul>
    </section>
  );
}

function HypothesisRow({ hypothesis, onOpenFile }: { hypothesis: Hypothesis; onOpenFile?: (path: string) => void }) {
  const ruledOut = hypothesis.state === "ruled_out";
  const confirmed = hypothesis.state === "confirmed";
  return (
    <article className={cn("rounded-lg border border-line px-3 py-2.5", confirmed ? "border-l-2 border-l-emerald-500 bg-raised" : ruledOut ? "bg-surface-subtle" : "bg-raised")} data-state={hypothesis.state}>
      <div className="flex items-start justify-between gap-2">
        <p className={cn("min-w-0 flex-1 text-[13.5px] leading-5", ruledOut ? "text-ink-4" : "text-ink-1", confirmed && "font-medium")}>{hypothesis.text}</p>
        <StateTag tone={confirmed ? "good" : "neutral"}>{confirmed ? "Confirmed" : ruledOut ? "Ruled out" : "Open"}</StateTag>
      </div>
      {hypothesis.ruledOutBecause ? <p className="mt-1 text-[13px] leading-5 text-ink-4">{hypothesis.ruledOutBecause}</p> : null}
      {hypothesis.evidence.length ? <ul className="mt-1.5 space-y-1.5">{hypothesis.evidence.map((finding) => <li key={finding.id}><FindingRow finding={finding} muted={ruledOut} onOpenFile={onOpenFile} /></li>)}</ul> : null}
      <Chips refs={hypothesis.refs} onOpenFile={onOpenFile} />
    </article>
  );
}

function FindingRow({ finding, muted = false, onOpenFile }: { finding: Finding; muted?: boolean; onOpenFile?: (path: string) => void }) {
  return (
    <div>
      <p className={cn("text-[13.5px] leading-5", muted ? "text-ink-4" : "text-ink-2")}>{finding.text}</p>
      <Chips refs={finding.refs} onOpenFile={onOpenFile} />
    </div>
  );
}

const ICON: Record<EvidenceKind, LucideIcon> = { run: Play, ticket: Ticket, query: Database, file: FileText, knowledge: BookOpen, table: Table2, url: ExternalLink, log: ScrollText };

function isSameAppUrl(href: string): boolean {
  try { return new URL(href, window.location.href).origin === window.location.origin; }
  catch { return false; }
}

function Chips({ refs, onOpenFile }: { refs: EvidenceRef[]; onOpenFile?: (path: string) => void }) {
  if (!refs.length) return null;
  return <ul className="mt-1.5 flex flex-wrap gap-1.5">{refs.map((ref, index) => <li key={`${ref.label}-${index}`}><EvidenceChip evidence={ref} onOpenFile={onOpenFile} /></li>)}</ul>;
}

export function EvidenceChip({ evidence, onOpenFile }: { evidence: EvidenceRef; onOpenFile?: (path: string) => void }) {
  const target = evidenceTarget(evidence);
  const sameAppUrl = target.type === "url" && isSameAppUrl(target.href);
  const Icon = sameAppUrl ? Link2 : evidence.kind ? ICON[evidence.kind] : Link2;
  const classes = "inline-flex max-w-full items-center gap-1.5 rounded-md border border-line bg-raised px-2 py-0.5 text-[12px] font-medium text-ink-3 transition-colors";
  const body = <><Icon className="h-3 w-3 shrink-0 text-ink-5" aria-hidden="true" /><span className="truncate">{evidence.label}</span></>;
  const title = evidence.ref && evidence.ref !== evidence.label ? evidence.ref : undefined;
  if (target.type === "route") return <Link to={target.to} className={cn(classes, "hover:border-line-strong hover:text-ink-1")} title={title}>{body}</Link>;
  if (target.type === "url" && sameAppUrl) {
    const url = new URL(target.href, window.location.href);
    return <Link to={`${url.pathname}${url.search}${url.hash}`} className={cn(classes, "hover:border-line-strong hover:text-ink-1")} title={title}>{body}</Link>;
  }
  if (target.type === "url") return <a href={target.href} target="_blank" rel="noreferrer" className={cn(classes, "hover:border-line-strong hover:text-ink-1")} title={title}>{body}</a>;
  if (target.type === "file" && onOpenFile) return <button type="button" onClick={() => onOpenFile(target.path)} className={cn(classes, "hover:border-line-strong hover:text-ink-1")} title={title}>{body}</button>;
  return <span className={classes} title={title}>{body}</span>;
}
