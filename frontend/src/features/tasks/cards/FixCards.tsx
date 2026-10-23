import { ArrowRight, Check, ChevronRight, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { BoardWidget, WidgetCell } from "@/api/boards";
import type { FixSummary } from "@/api/tasks";
import { Skeleton, formatAbsoluteTime, formatRelativeTime } from "@/components/ui";
import { WidgetBody } from "@/features/boards/BoardWidgets";
import { cn } from "@/lib/utils";
import { AgentCard } from "./AgentCard";
import type { Block } from "./blocks";
import { StateTag } from "./DataBlocks";
import { expectation, type FixProposal, type FixResult, type FixRows, type FixSide } from "./fixes";

/**
 * Tested fixes in the thread (SPEC-tasks-13): the proposal NerveCenter measured on the sandbox copy (FR-8), the
 * same evidence on the approval (FR-11), and the verification after apply (FR-16). Widgets are drawn with the
 * board's own renderer, so "After fix" looks exactly as the board will.
 */

const VERDICT: Record<FixResult["status"], { word: string; tone: "good" | "bad" | "warning" }> = {
  passed: { word: "Verified", tone: "good" },
  failed: { word: "Check failed", tone: "bad" },
  inconclusive: { word: "Not verified", tone: "warning" },
};

const shown = (value: WidgetCell) => (value === null || value === undefined || value === "" ? "—" : typeof value === "number" ? value.toLocaleString() : String(value));
const count = (value: number | null) => (value === null ? "—" : value.toLocaleString());
const plural = (value: number | null, word: string) => `${count(value)} ${word}${value === 1 ? "" : "s"}`;

export function FixProposalCard({ block, compact = false, className }: { block: Extract<Block, { kind: "fix_proposal" }>; compact?: boolean; className?: string }) {
  if (block.pending) return <AgentCard title="Testing the fix" compact={compact} className={className}><div className="space-y-2" aria-hidden="true"><Skeleton className="h-4 w-2/3" /><Skeleton className="h-24 w-full" /></div></AgentCard>;
  const proposal = block.proposal;
  if (!proposal) return <AgentCard title="Fix not proposed" compact={compact} className={className}><p className="text-[13px] text-ink-4">{block.error || "The proposal could not be read"}</p></AgentCard>;
  return (
    <AgentCard title={proposal.title} note={`Tested on a copy · ${proposal.testsPassed} of ${proposal.testsTotal} tests passed`} compact={compact} className={className} action={<StateTag tone="brand">Proposed</StateTag>}>
      <FixEvidence proposal={proposal} compact={compact} />
    </AgentCard>
  );
}

/** What a tested fix changes: tests, the table change, the predicted checks, the widgets now and after, the statement. */
export function FixEvidence({ proposal, compact = false }: { proposal: FixProposal; compact?: boolean }) {
  const failed = proposal.tests.filter((test) => test.result === "failed");
  const { diff } = proposal;
  return (
    <div className="space-y-3.5" data-testid="fix-evidence">
      {failed.length ? (
        <ul className="space-y-1 rounded-lg bg-rose-50 px-3 py-2 text-[13px] text-rose-700" aria-label="Failed tests">
          {failed.map((test, index) => <li key={index} className="flex gap-2"><X className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" /><span><span className="font-medium">{test.name}</span>{test.detail ? ` · ${test.detail}` : ""}</span></li>)}
        </ul>
      ) : null}
      {proposal.summary ? <p className="text-[13.5px] leading-5 text-ink-2">{proposal.summary}</p> : null}

      <Section title={<><span className="font-mono text-[12px]">{proposal.target}</span></>}>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[13px]">
          <dt className="text-ink-4">Rows</dt>
          <dd className="flex items-center gap-1.5 tabular-nums text-ink-1">{count(diff.rowsBefore)}<ArrowRight className="h-3 w-3 text-ink-5" aria-label="after the fix" />{count(diff.rowsAfter)}</dd>
          <dt className="text-ink-4">Rows that change</dt>
          <dd className="tabular-nums text-ink-1">{plural(diff.onlyBefore, "row")} out, {plural(diff.onlyAfter, "row")} in</dd>
          {diff.changedColumns.length ? <><dt className="text-ink-4">Columns</dt><dd className="font-mono text-[12.5px] text-ink-2">{diff.changedColumns.join(", ")}</dd></> : null}
        </dl>
        {diff.before?.rows.length || diff.after?.rows.length ? (
          <div className={cn("mt-2.5 grid gap-2.5", !compact && "sm:grid-cols-2")}>
            <RowsTable label="Before" rows={diff.before} />
            <RowsTable label="After" rows={diff.after} />
          </div>
        ) : null}
      </Section>

      {proposal.checks.length ? (
        <Section title="Checks on the copy">
          <ul className="divide-y divide-line-soft">
            {proposal.checks.map((check, index) => (
              <li key={index} className="flex items-center gap-3 py-1.5 text-[13px]">
                <span className="min-w-0 flex-1 text-ink-2">{check.label}{check.error ? <span className="block text-[12px] text-rose-700">{check.error}</span> : null}</span>
                <span className="shrink-0 tabular-nums text-ink-4">expect {expectation(check)}</span>
                <span className="w-16 shrink-0 text-right font-medium tabular-nums text-ink-1">{shown(check.expected)}</span>
                <StateTag tone={check.predicted === "pass" ? "good" : "bad"}>{check.predicted === "pass" ? "Pass" : check.predicted === "fail" ? "Fail" : "Error"}</StateTag>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {proposal.previews.map((preview) => (
        <Section key={`${preview.boardId}/${preview.widgetId}`} title={<>{preview.title}{preview.boardTitle ? <span className="font-normal text-ink-5"> · <Link to={`/boards/${encodeURIComponent(preview.boardId)}`} className="hover:text-ink-1">{preview.boardTitle}</Link></span> : null}</>}>
          <WidgetPair left="Now" right="After fix" widget={previewWidget(preview)} before={preview.now} after={preview.after} compact={compact} />
        </Section>
      ))}

      {proposal.tests.length ? (
        <Section title="Tests">
          <ul className="space-y-1">
            {proposal.tests.map((test, index) => <li key={index} className="flex gap-2 text-[13px] leading-5 text-ink-2">{test.result === "passed" ? <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" aria-label="Passed" /> : test.result === "failed" ? <X className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-600" aria-label="Failed" /> : <span className="mt-0.5 w-3.5 shrink-0 text-center text-ink-5" aria-label="Skipped">–</span>}<span>{test.name}{test.detail ? <span className="text-ink-4"> · {test.detail}</span> : null}</span></li>)}
          </ul>
        </Section>
      ) : null}

      <Toggle label="statement">
        <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-line bg-surface-subtle p-2.5 font-mono text-[12.5px] text-ink-2">{proposal.statement}</pre>
        {proposal.files.map((file) => <div key={file.path} className="mt-2"><p className="truncate font-mono text-[12px] text-ink-4">{file.path}</p><pre className="mt-1 max-h-48 overflow-auto whitespace-pre rounded-lg border border-line bg-surface-subtle p-2.5 font-mono text-[12px] text-ink-2">{file.diff}</pre></div>)}
      </Toggle>
    </div>
  );
}

export function FixResultCard({ block, compact = false, className }: { block: Extract<Block, { kind: "fix_result" }>; compact?: boolean; className?: string }) {
  if (block.pending) return <AgentCard title="Applying the fix" compact={compact} className={className}><div className="space-y-2" aria-hidden="true"><Skeleton className="h-4 w-1/2" /><Skeleton className="h-16 w-full" /></div></AgentCard>;
  const result = block.result;
  if (!result) return <AgentCard title="Fix not applied" compact={compact} className={className}><p className="text-[13px] text-ink-4">{block.error || "The result could not be read"}</p></AgentCard>;
  const verdict = VERDICT[result.status];
  return (
    <AgentCard title={`Applied · ${result.title}`} note={result.appliedAt ? `${result.target} · ${formatRelativeTime(result.appliedAt)}` : result.target} compact={compact} className={className} action={<StateTag tone={verdict.tone}>{verdict.word}</StateTag>}>
      <div className="space-y-3.5" data-testid="fix-result">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[13px]">
          <dt className="text-ink-4">Rows</dt>
          <dd className="flex items-center gap-1.5 tabular-nums text-ink-1">{count(result.rowCount.before)}<ArrowRight className="h-3 w-3 text-ink-5" aria-label="after the fix" />{count(result.rowCount.after)}</dd>
          {result.appliedAt ? <><dt className="text-ink-4">Applied</dt><dd className="text-ink-2" title={formatAbsoluteTime(result.appliedAt)}>{formatAbsoluteTime(result.appliedAt)}</dd></> : null}
        </dl>
        {result.checks.length ? (
          <Section title="Checks">
            <table className="w-full text-[13px]">
              <thead className="text-left text-[12px] text-ink-4"><tr><th scope="col" className="py-1 font-medium">Check</th><th scope="col" className="py-1 text-right font-medium">Expected</th><th scope="col" className="py-1 text-right font-medium">Actual</th><th scope="col" className="w-14 py-1"><span className="sr-only">Result</span></th></tr></thead>
              <tbody className="divide-y divide-line-soft">
                {result.checks.map((check, index) => (
                  <tr key={index}>
                    <td className="py-1.5 pr-2 text-ink-2">{check.label}<span className="ml-1.5 text-[12px] text-ink-5">{expectation(check)}</span>{check.error ? <span className="block text-[12px] text-rose-700">{check.error}</span> : null}</td>
                    <td className="py-1.5 text-right tabular-nums text-ink-3">{shown(check.expected)}</td>
                    <td className="py-1.5 text-right font-medium tabular-nums text-ink-1">{shown(check.actual)}</td>
                    <td className="py-1.5 text-right"><StateTag tone={check.result === "pass" ? "good" : "bad"}>{check.result === "pass" ? "Pass" : "Fail"}</StateTag></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
        ) : null}
        {result.previews.map((preview) => (
          <Section key={`${preview.boardId}/${preview.widgetId}`} title={<>{preview.title}<span className="ml-2 align-middle"><StateTag tone={preview.matches ? "good" : "bad"}>{preview.matches ? "Matches the preview" : "Differs from the preview"}</StateTag></span></>}>
            {preview.error ? <p className="mb-2 text-[12.5px] text-rose-700">{preview.error}</p> : null}
            <WidgetPair left="Expected" right="Actual" widget={previewWidget(preview)} before={preview.expected ?? { error: "No preview was taken" }} after={preview.actual ?? { error: preview.error || "Not read" }} compact={compact} />
          </Section>
        ))}
        {[...new Set(result.previews.map((preview) => preview.boardId))].filter(Boolean).map((boardId, index, boards) => (
          <Link key={boardId} to={`/boards/${encodeURIComponent(boardId)}`} className="mr-4 inline-block text-[12.5px] font-medium text-brand hover:text-brand-hover">{boards.length > 1 ? `Open board ${index + 1}` : "Open the board"}</Link>
        ))}
        {result.note ? <p className="text-[12.5px] text-ink-4">{result.note}</p> : result.sandboxDropped ? <p className="text-[12.5px] text-ink-4">The sandbox copy was dropped.</p> : null}
      </div>
    </AgentCard>
  );
}

/**
 * The evidence on an `apply_fix` approval (FR-11): the stored proposal when the thread has it, else the summary
 * the server put on the approval (the Inbox, a thread cut short, or a decided approval, whose result card now
 * carries the evidence), always with the exact statement.
 */
export function FixApprovalSummary({ fix, proposal = null, compact = false, decided = false }: { fix: FixSummary; proposal?: FixProposal | null; compact?: boolean; decided?: boolean }) {
  return (
    <div className="mt-1 space-y-2.5" data-testid="fix-approval">
      <div>
        <p className="text-[14px] font-medium leading-6 text-ink-1">{fix.title}</p>
        <p className="text-[12.5px] text-ink-4"><span className="font-mono">{fix.target}</span> · {fix.testsPassed} of {fix.testsTotal} tests passed on <span className="font-mono">{fix.sandbox}</span></p>
      </div>
      {proposal ? <FixEvidence proposal={proposal} compact={compact} /> : (
        <Toggle label="statement"><pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-line bg-surface-subtle p-2.5 font-mono text-[12.5px] text-ink-2">{fix.statement}</pre></Toggle>
      )}
      {decided ? null : <p className="text-[11.5px] text-ink-5">Measured by NerveCenter on the copy. Approving runs this statement once; it stops if the table changed since the test.</p>}
    </div>
  );
}

function previewWidget(preview: { widgetId: string; title: string; type: BoardWidget["type"]; viz: BoardWidget["viz"] }): BoardWidget {
  return { id: preview.widgetId, title: preview.title, type: preview.type, size: "md", source: { kind: "sql" }, viz: preview.viz };
}

/** One widget twice, side by side ("Now | After fix", "Expected | Actual"); stacked in the panel, and for tables, whose columns need the width. */
function WidgetPair({ left, right, widget, before, after, compact }: { left: string; right: string; widget: BoardWidget; before: FixSide; after: FixSide; compact: boolean }) {
  return (
    <div className={cn("grid gap-3", !compact && widget.type !== "table" && "sm:grid-cols-2")} data-testid="widget-pair">
      <PairSide label={left} widget={widget} side={before} />
      <PairSide label={right} widget={widget} side={after} accent />
    </div>
  );
}

function PairSide({ label, widget, side, accent = false }: { label: string; widget: BoardWidget; side: FixSide; accent?: boolean }) {
  return (
    <figure className={cn("min-w-0 rounded-lg border px-3 pb-3 pt-2", accent ? "border-brand/30" : "border-line-soft")} aria-label={`${widget.title}, ${label}`}>
      <figcaption className={cn("mb-1.5 text-[12px] font-medium", accent ? "text-brand" : "text-ink-4")}>{label}</figcaption>
      {"error" in side ? <p className="text-[12.5px] text-ink-4">{side.error}</p> : <WidgetBody widget={widget} result={{ columns: side.columns, rows: side.rows, at: "" }} />}
    </figure>
  );
}

function RowsTable({ label, rows }: { label: string; rows: FixRows | null }) {
  return (
    <div className="min-w-0">
      <p className="mb-1 text-[12px] font-medium text-ink-4">{label}</p>
      {rows?.rows.length ? (
        <div className="overflow-x-auto rounded-lg border border-line-soft">
          <table className="w-full text-[12.5px]">
            <thead className="bg-surface-subtle text-left text-ink-4"><tr>{rows.columns.map((column) => <th key={column} scope="col" className="whitespace-nowrap px-2 py-1 font-medium">{column}</th>)}</tr></thead>
            <tbody className="divide-y divide-line-soft">{rows.rows.map((row, index) => <tr key={index}>{row.map((cell, column) => <td key={column} className="max-w-[180px] truncate px-2 py-1 tabular-nums text-ink-2" title={shown(cell)}>{shown(cell)}</td>)}</tr>)}</tbody>
          </table>
        </div>
      ) : <p className="text-[12.5px] text-ink-5">No rows</p>}
    </div>
  );
}

function Section({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <section className="min-w-0 border-t border-line-soft pt-3 first:border-t-0 first:pt-0">
      <h4 className="mb-1.5 min-w-0 truncate text-[12.5px] font-semibold text-ink-2">{title}</h4>
      {children}
    </section>
  );
}

function Toggle({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} className="flex items-center gap-1 text-[12.5px] font-medium text-ink-3 hover:text-ink-1"><ChevronRight className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-90")} aria-hidden="true" />{open ? `Hide ${label}` : `Show ${label}`}</button>
      {open ? <div className="mt-2">{children}</div> : null}
    </div>
  );
}
